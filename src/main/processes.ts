import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { app } from 'electron'
import { findPortOccupants } from './ports'
import { recordEnd, recordStart } from './stats'
import { taskKey } from '../shared/types'
import type { Project, TaskConfig, TaskRunStatus } from '../shared/types'

/** 每个任务保留的日志块数量上限 */
const MAX_LOG_CHUNKS = 600

interface RunningEntry {
  proc: ChildProcess
  logs: string[]
  /** 用户主动停止标记，用于把退出状态归为 stopped 而非 error */
  killed: boolean
  /** 同步落盘的日志文件流 */
  logStream?: fs.WriteStream
  logFile?: string
  /** 本次运行开始时间（统计用） */
  startedAt: number
}

function logsDir(): string {
  return path.join(app.getPath('appData'), 'ProjectQuickLaunch', 'logs')
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '-')
}

function killTree(pid: number): void {
  spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
}

/**
 * 进程管理器：负责启动/停止任务进程、缓冲日志、广播状态。
 * Windows 下使用 taskkill /T /F 杀掉整棵进程树（如 npm -> node dev-server）。
 */
export class ProcessManager extends EventEmitter {
  private running = new Map<string, RunningEntry>()
  /** 每个任务最近一次运行的日志文件（退出后仍可打开） */
  private lastLogFiles = new Map<string, string>()

  isRunning(projectId: string, taskId: string): boolean {
    return this.running.has(taskKey(projectId, taskId))
  }

  start(
    project: Project,
    task: TaskConfig,
    managedEnv?: { managedPaths: string[]; javaHome?: string }
  ): { ok: boolean; message?: string } {
    const key = taskKey(project.id, task.id)
    if (this.running.has(key)) {
      return { ok: false, message: '该任务已在运行中' }
    }

    const cwd = task.cwd?.trim() || project.path
    const pathValue = managedEnv?.managedPaths.length
      ? `${managedEnv.managedPaths.join(';')};${process.env.PATH ?? ''}`
      : process.env.PATH

    // npm 任务且依赖未安装时，自动先执行 npm install（输出自然进入本任务日志）
    let command = task.command
    if (/^\s*npm\s+(run|start)/.test(command) && !fs.existsSync(path.join(cwd, 'node_modules'))) {
      command = `npm install --no-fund --no-audit && ${command}`
    }

    // 日志同步落盘：应用重启/进程退出后仍可查看
    let logStream: fs.WriteStream | undefined
    let logFile: string | undefined
    try {
      const dir = logsDir()
      fs.mkdirSync(dir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      logFile = path.join(dir, `${sanitizeName(project.name)}_${sanitizeName(task.name)}_${stamp}.log`)
      logStream = fs.createWriteStream(logFile, { flags: 'a' })
      this.lastLogFiles.set(key, logFile)
    } catch {
      // 日志落盘失败不影响任务运行
    }

    const entry: RunningEntry = {
      proc: null as unknown as ChildProcess,
      logs: [],
      killed: false,
      logStream,
      logFile,
      startedAt: Date.now()
    }

    const emitOutput = (data: string): void => {
      entry.logs.push(data)
      while (entry.logs.length > MAX_LOG_CHUNKS) entry.logs.shift()
      entry.logStream?.write(data)
      this.emit('output', key, data)
    }

    let proc: ChildProcess
    try {
      proc = spawn(command, {
        shell: true,
        cwd,
        windowsHide: true,
        env: {
          ...process.env,
          PATH: pathValue,
          ...(managedEnv?.javaHome ? { JAVA_HOME: managedEnv.javaHome } : {}),
          FORCE_COLOR: '0'
        }
      })
    } catch (err) {
      logStream?.end()
      return { ok: false, message: `启动失败：${(err as Error).message}` }
    }
    entry.proc = proc
    this.running.set(key, entry)
    recordStart(project.id, task.id)

    if (command !== task.command) {
      emitOutput('[准备] 未检测到 node_modules，先自动执行 npm install，完成后再启动任务…\n')
    }

    proc.stdout?.on('data', (d: Buffer) => emitOutput(d.toString('utf8')))
    proc.stderr?.on('data', (d: Buffer) => emitOutput(d.toString('utf8')))

    const finish = (exitCode: number | null): void => {
      if (this.running.get(key) !== entry) return
      this.running.delete(key)
      entry.logStream?.end()
      recordEnd(project.id, task.id, Date.now() - entry.startedAt)
      const finalStatus: TaskRunStatus = entry.killed
        ? 'stopped'
        : exitCode === 0
          ? 'exited'
          : 'error'
      const hadOutput = entry.logs.join('').trim().length > 0
      if (finalStatus === 'error' && !hadOutput) {
        emitOutput(
          `\n[诊断] 进程立即退出（代码 ${exitCode ?? '?'}）且没有任何输出，常见原因：\n` +
            '  1. 命令不存在：mvn / npm / go 等未安装或未加入系统 PATH\n' +
            '  2. 工作目录不正确\n' +
            '  3. 前端依赖未安装（缺 node_modules）\n' +
            '  4. 项目依赖的数据库/中间件（MySQL、Redis、MQ 等）未启动\n'
        )
      }
      // 识别 Spring Boot 的端口占用报错，自动查出占用进程并写进日志
      const portMatch = entry.logs.join('').match(/Port (\d+) was already in use/)
      if (portMatch) {
        const port = Number(portMatch[1])
        void findPortOccupants(port).then((occups) => {
          const listen = occups.filter((o) => o.state === 'LISTENING')
          if (listen.length === 0) {
            emitOutput(
              `\n[诊断] 端口 ${port} 当前已无进程监听（之前的占用可能是刚停止的残留连接，` +
                `等待 1-2 分钟或直接重试即可）。\n`
            )
            return
          }
          const lines = listen
            .map((o) => `    ${o.processName}（PID ${o.pid}）监听 ${o.address}:${o.port}`)
            .join('\n')
          emitOutput(
            `\n[诊断] 端口 ${port} 被以下进程占用：\n${lines}\n` +
              `  处理：在「运行与端口」页搜索 ${port}，确认后可一键结束该进程；或修改本项目的服务端口。\n`
          )
        })
      }
      this.emit('status', { key, status: finalStatus, exitCode })
    }

    proc.on('close', (code) => finish(code))
    proc.on('error', (err) => {
      emitOutput(`\n[进程错误] ${err.message}\n`)
      finish(-1)
    })

    this.emit('status', { key, status: 'running', pid: proc.pid })
    return { ok: true }
  }

  /** 最近一次运行的日志文件路径（退出后仍可打开） */
  getLogFile(projectId: string, taskId: string): string | null {
    return this.lastLogFiles.get(taskKey(projectId, taskId)) ?? null
  }

  /** 当前所有运行中任务的引用（供端口快照使用） */
  listRunning(): Array<{ key: string; projectId: string; taskId: string; mainPid?: number }> {
    const out: Array<{ key: string; projectId: string; taskId: string; mainPid?: number }> = []
    for (const [key, entry] of this.running) {
      const [projectId, taskId] = key.split(':')
      out.push({ key, projectId, taskId, mainPid: entry.proc.pid })
    }
    return out
  }

  getLogs(projectId: string, taskId: string): string {
    return this.running.get(taskKey(projectId, taskId))?.logs.join('') ?? ''
  }

  async stop(projectId: string, taskId: string): Promise<{ ok: boolean; message?: string }> {
    const key = taskKey(projectId, taskId)
    const entry = this.running.get(key)
    if (!entry) return { ok: false, message: '该任务未在运行' }
    entry.killed = true
    const pid = entry.proc.pid
    if (pid) killTree(pid)
    else entry.proc.kill()
    return { ok: true }
  }

  /** 应用退出时尽力杀掉所有子进程树 */
  stopAll(): void {
    for (const [, entry] of this.running) {
      const pid = entry.proc.pid
      if (pid) killTree(pid)
      else entry.proc.kill()
    }
    this.running.clear()
  }
}

export const processManager = new ProcessManager()
