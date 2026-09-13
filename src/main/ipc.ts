import fs from 'node:fs'
import path from 'node:path'
import { exec, spawn } from 'node:child_process'
import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { IPC, taskKey } from './../shared/types'
import type {
  OpResult,
  Project,
  RuntimeRequirement,
  RuntimeType,
  Settings
} from '../shared/types'
import { loadConfig, removeProject, saveSettings, upsertProject } from './store'
import { processManager } from './processes'
import { healthMonitor } from './health'
import { cloneManager } from './gitClone'
import { scanSubProjects, requirementsForSuggestion } from './scan'
import { checkEnvFiles, detectProject } from './detect'
import { detectSystemProxy } from './proxy'
import { checkPortFree, checkServiceTcp, collectPortSnapshot, killProcessTree } from './ports'
import { probeUrl } from './health'
import { getAllStats } from './stats'
import { managedEnvForTasks } from './projectOps'
import {
  buildEnvForManaged,
  checkRuntimes,
  detectInstalled,
  installRuntime
} from './runtimes'
import type { PackageJsonInfo } from '../shared/api'

function stopTask(projectId: string, taskId: string): void {
  healthMonitor.stop(taskKey(projectId, taskId))
  void processManager.stop(projectId, taskId)
}

export function registerIpc(win: BrowserWindow): void {
  const notify = (channel: string, ...args: unknown[]): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }

  // 任务进程事件 -> 渲染进程
  processManager.on('output', (key: string, data: string) => {
    notify(IPC.EventTaskOutput, { key, data })
  })
  processManager.on('status', (payload: unknown) => {
    notify(IPC.EventTaskStatus, payload)
  })

  ipcMain.handle(IPC.ConfigLoad, () => loadConfig())

  ipcMain.handle(IPC.SaveProject, (_e, project: Project) => upsertProject(project))

  ipcMain.handle(IPC.DeleteProject, (_e, id: string) => {
    const config = loadConfig()
    const project = config.projects.find((p) => p.id === id)
    if (project) {
      for (const task of project.tasks) stopTask(project.id, task.id)
    }
    return removeProject(id)
  })

  ipcMain.handle(IPC.SaveSettings, (_e, settings: Settings) => saveSettings(settings))

  ipcMain.handle(IPC.SelectFolder, async (_e, title?: string) => {
    const result = await dialog.showOpenDialog(win, {
      title: title || '选择文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.SelectArchive, async (_e, title?: string) => {
    const result = await dialog.showOpenDialog(win, {
      title: title || '选择项目压缩包',
      filters: [{ name: '项目压缩包（zip）', extensions: ['zip'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.DetectProject, (_e, projectPath: string) => detectProject(projectPath))

  ipcMain.handle(IPC.CheckRuntimes, (_e, requirements: RuntimeRequirement[]) =>
    checkRuntimes(requirements ?? [])
  )

  ipcMain.handle(IPC.InstallRuntime, async (_e, type: RuntimeType, version?: string): Promise<OpResult> => {
    try {
      const runtime = await installRuntime(type, version, win.webContents)
      const settings: Settings = {
        ...loadConfig().settings,
        managedRuntimes: [
          ...(loadConfig().settings.managedRuntimes ?? []).filter((r) => r.type !== runtime.type),
          runtime
        ]
      }
      saveSettings(settings)
      return { ok: true, message: `${type} ${runtime.version} 安装完成` }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.RemoveRuntime, (_e, id: string) => {
    const settings = loadConfig().settings
    settings.managedRuntimes = (settings.managedRuntimes ?? []).filter((r) => r.id !== id)
    return saveSettings(settings)
  })

  ipcMain.handle(
    IPC.ExtractArchive,
    (_e, archivePath: string, destDir: string): Promise<OpResult> =>
      (async (): Promise<OpResult> => {
        try {
          if (!fs.existsSync(archivePath)) return { ok: false, message: '压缩包不存在' }
          if (fs.existsSync(destDir) && fs.readdirSync(destDir).length > 0) {
            return { ok: false, message: `目标目录已存在且不为空：${destDir}` }
          }
          fs.mkdirSync(destDir, { recursive: true })
          const { extractZip } = await import('./runtimes')
          await extractZip(archivePath, destDir)
          return { ok: true }
        } catch (err) {
          return { ok: false, message: (err as Error).message }
        }
      })()
  )

  ipcMain.handle(IPC.ReadPackageJson, (_e, projectPath: string): PackageJsonInfo | null => {
    try {
      const raw = fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8')
      const json = JSON.parse(raw) as { name?: string; scripts?: Record<string, string> }
      return { name: json.name, scripts: json.scripts ?? {} }
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.ScanSubProjects, (_e, projectPath: string) => scanSubProjects(projectPath))

  ipcMain.handle(IPC.TaskStart, (_e, projectId: string, taskId: string): OpResult => {
    const config = loadConfig()
    const project = config.projects.find((p) => p.id === projectId)
    const task = project?.tasks.find((t) => t.id === taskId)
    if (!project || !task) return { ok: false, message: '项目或任务不存在' }
    const result = processManager.start(project, task, managedEnvForTasks())
    if (result.ok && task.url) {
      healthMonitor.start(taskKey(projectId, taskId), task.url, win.webContents)
    }
    return result
  })

  ipcMain.handle(IPC.TaskStop, async (_e, projectId: string, taskId: string): Promise<OpResult> => {
    healthMonitor.stop(taskKey(projectId, taskId))
    return processManager.stop(projectId, taskId)
  })

  ipcMain.handle(IPC.TaskLogs, (_e, projectId: string, taskId: string) =>
    processManager.getLogs(projectId, taskId)
  )

  ipcMain.handle(IPC.Clone, async (_e, url: string, targetDir: string): Promise<OpResult> => {
    if (typeof url !== 'string' || !url.trim()) return { ok: false, message: '请输入仓库地址' }
    if (typeof targetDir !== 'string' || !targetDir.trim()) {
      return { ok: false, message: '请选择克隆目标目录' }
    }
    if (fs.existsSync(targetDir)) {
      const existing = fs.readdirSync(targetDir)
      if (existing.length > 0) {
        return { ok: false, message: `目标目录已存在且不为空：${targetDir}` }
      }
    } else {
      fs.mkdirSync(targetDir, { recursive: true })
    }
    // 克隆代理：设置里有手动值用设置，否则自动检测系统代理
    const manualProxy = loadConfig().settings.cloneProxy?.trim()
    const proxy = manualProxy ? manualProxy : await detectSystemProxy()
    return cloneManager.clone(url.trim(), targetDir, win.webContents, proxy)
  })

  ipcMain.handle(IPC.GetSystemProxy, () => detectSystemProxy())

  ipcMain.handle(IPC.GetPortSnapshot, async () => {
    const config = loadConfig()
    const refs = processManager.listRunning().map((r) => {
      const project = config.projects.find((p) => p.id === r.projectId)
      const task = project?.tasks.find((t) => t.id === r.taskId)
      return {
        key: r.key,
        projectId: r.projectId,
        taskId: r.taskId,
        projectName: project?.name ?? r.projectId,
        taskName: task?.name ?? r.taskId,
        mainPid: r.mainPid,
        url: task?.url
      }
    })
    return collectPortSnapshot(refs)
  })

  ipcMain.handle(IPC.KillProcess, (_e, pid: number) => killProcessTree(pid))

  ipcMain.handle(IPC.CheckPort, (_e, port: number) => checkPortFree(Number(port)))

  ipcMain.handle(IPC.CheckService, (_e, host: string, port: number) =>
    checkServiceTcp(String(host), Number(port))
  )

  ipcMain.handle(IPC.CheckUrl, (_e, url: string) => probeUrl(String(url)))

  ipcMain.handle(IPC.CheckEnvFiles, (_e, dir: string) => checkEnvFiles(String(dir)))

  // 某个任务需要的运行环境需求（含版本），供启动前预检使用
  ipcMain.handle(IPC.GetTaskRequirements, (_e, projectId: string, taskId: string) => {
    const config = loadConfig()
    const project = config.projects.find((p) => p.id === projectId)
    const task = project?.tasks.find((t) => t.id === taskId)
    if (!project || !task) return []
    return requirementsForSuggestion({
      name: task.name,
      command: task.command,
      cwd: task.cwd?.trim() || project.path
    })
  })

  // 检测本机已装的运行环境版本
  ipcMain.handle(IPC.GetRuntimeVersions, async (_e, types: RuntimeType[]) => {
    const out: Partial<Record<RuntimeType, string | null>> = {}
    for (const type of types ?? []) {
      out[type] = await detectInstalled(type)
    }
    return out
  })

  ipcMain.handle(IPC.CloneCancel, () => {
    cloneManager.cancel()
  })

  ipcMain.handle(IPC.OpenExternal, (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  ipcMain.handle(IPC.OpenPath, (_e, p: string) => {
    void shell.openPath(p)
  })

  ipcMain.handle(
    IPC.OpenInVSCode,
    (_e, p: string): Promise<OpResult> =>
      new Promise((resolve) => {
        const child = spawn('code', [p], { shell: true, detached: true, stdio: 'ignore' })
        child.on('error', () => resolve({ ok: false, message: '未找到 code 命令，请确认 VS Code 已加入 PATH' }))
        child.on('close', () => resolve({ ok: true }))
        child.unref()
      })
  )

  ipcMain.handle(IPC.OpenLogFile, (_e, projectId: string, taskId: string): OpResult => {
    const file = processManager.getLogFile(projectId, taskId)
    if (!file || !fs.existsSync(file)) {
      return { ok: false, message: '该任务还没有落盘日志（启动一次后生成）' }
    }
    void shell.openPath(file)
    return { ok: true }
  })

  // 在系统终端中打开目录：优先 Windows Terminal，回退 PowerShell
  ipcMain.handle(IPC.OpenTerminal, (_e, dir: string): Promise<OpResult> => {
    void dir
    return new Promise((resolve) => {
      const target = String(dir ?? '')
      if (!target || !fs.existsSync(target)) {
        resolve({ ok: false, message: '目录不存在' })
        return
      }
      exec('where wt.exe >nul 2>&1', { windowsHide: true }, (err) => {
        try {
          if (!err) {
            // Windows Terminal 的 app execution alias 需经 shell 解析
            spawn(`start wt -d "${target}"`, [], { shell: true, detached: true, stdio: 'ignore' }).unref()
          } else {
            spawn('powershell.exe', ['-NoLogo'], {
              cwd: target,
              detached: true,
              stdio: 'ignore'
            }).unref()
          }
          resolve({ ok: true })
        } catch {
          resolve({ ok: false, message: '打开终端失败' })
        }
      })
    })
  })

  ipcMain.handle(IPC.GetStats, () => {
    const config = loadConfig()
    return Object.entries(getAllStats())
      .map(([key, s]) => {
        const [projectId, taskId] = key.split(':')
        const project = config.projects.find((p) => p.id === projectId)
        const task = project?.tasks.find((t) => t.id === taskId)
        const quick = project?.quickCommands?.find((t) => t.id === taskId)
        return {
          key,
          projectName: project?.name ?? projectId,
          taskName: task?.name ?? quick?.name ?? taskId,
          count: s.count,
          totalMs: s.totalMs,
          lastStart: s.lastStart
        }
      })
      .sort((a, b) => b.count - a.count || b.lastStart - a.lastStart)
  })
}
