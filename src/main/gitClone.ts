import { spawn, type ChildProcess } from 'node:child_process'
import type { IpcSender } from '../shared/types'

/** ANSI 转义序列（进度条/颜色） */
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

/**
 * git clone 管理器：调用 git CLI 克隆仓库，解析 stderr 中的进度百分比，
 * 通过 sender 推送进度事件。同一时间只允许一个克隆任务。
 */
export class CloneManager {
  private proc: ChildProcess | null = null
  private cancelled = false

  isBusy(): boolean {
    return this.proc !== null
  }

  clone(
    url: string,
    targetDir: string,
    sender: IpcSender,
    proxy?: string | null
  ): Promise<{ ok: boolean; message?: string }> {
    if (this.proc) {
      return Promise.resolve({ ok: false, message: '已有克隆任务进行中，请先等待或取消' })
    }
    this.cancelled = false
    return new Promise((resolve) => {
      // git 不读 Windows 系统代理，需要时通过 -c 显式注入
      const proxyArgs = proxy ? ['-c', `http.proxy=${proxy}`, '-c', `https.proxy=${proxy}`] : []
      const proc = spawn('git', [...proxyArgs, 'clone', '--progress', url, targetDir], {
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      })
      this.proc = proc

      const recentLines: string[] = []
      let buf = ''

      const onChunk = (d: Buffer): void => {
        buf += d.toString('utf8')
        const lines = buf.split(/\r\n|\r|\n/)
        buf = lines.pop() ?? ''
        for (const rawLine of lines) {
          const line = stripAnsi(rawLine).trim()
          if (!line) continue
          recentLines.push(line)
          if (recentLines.length > 30) recentLines.shift()
          const match = line.match(/(\d+)%/)
          sender.send('event:clone-progress', {
            line,
            percent: match ? Number(match[1]) : undefined
          })
        }
      }

      proc.stdout?.on('data', onChunk)
      proc.stderr?.on('data', onChunk)

      proc.on('error', (err) => {
        this.proc = null
        resolve({ ok: false, message: `无法启动 git：${err.message}` })
      })

      proc.on('close', (code) => {
        this.proc = null
        if (this.cancelled) {
          resolve({ ok: false, message: '克隆已取消' })
        } else if (code === 0) {
          resolve({ ok: true })
        } else {
          const tail = recentLines.slice(-3).join('；')
          const hint =
            /connection was reset|failed to connect|unable to access|timed out/i.test(tail)
              ? proxy
                ? '（已使用代理，请确认代理软件已选择可用节点）'
                : '（克隆 GitHub 通常需要代理：开启代理软件的系统代理后重试，或在设置中手动指定代理）'
              : ''
          resolve({ ok: false, message: `git clone 失败（退出码 ${code}）：${tail || '未知错误'}${hint}` })
        }
      })
    })
  }

  cancel(): void {
    const proc = this.proc
    if (!proc) return
    this.cancelled = true
    const pid = proc.pid
    if (pid) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
  }
}

export const cloneManager = new CloneManager()
