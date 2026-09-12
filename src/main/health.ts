import type { IpcSender, UrlHealth } from '../shared/types'

const CHECK_INTERVAL_MS = 3000
const REQUEST_TIMEOUT_MS = 2500

/** HTTP 探测：有任意响应即视为可达（不校验状态码） */
export async function probeUrl(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    await fetch(url, { signal: controller.signal, redirect: 'manual' })
    clearTimeout(timer)
    return true
  } catch {
    return false
  }
}

async function probe(url: string): Promise<boolean> {
  return probeUrl(url)
}

/**
 * URL 健康检查：任务运行期间轮询配置的访问地址，状态变化时通知渲染进程。
 * 只要有任意 HTTP 响应即视为服务就绪（不校验状态码，dev server 根路径可能 302/404）。
 */
export class HealthMonitor {
  private timers = new Map<string, NodeJS.Timeout>()
  private last = new Map<string, UrlHealth>()

  start(key: string, url: string, sender: IpcSender): void {
    this.stop(key)
    this.last.set(key, 'checking')
    sender.send('event:url-health', { key, url, health: 'checking' })

    const check = async (): Promise<void> => {
      const health: UrlHealth = (await probe(url)) ? 'ready' : 'fail'
      if (this.last.get(key) !== health) {
        this.last.set(key, health)
        sender.send('event:url-health', { key, url, health })
      }
    }

    void check()
    this.timers.set(key, setInterval(() => void check(), CHECK_INTERVAL_MS))
  }

  stop(key: string): void {
    const timer = this.timers.get(key)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(key)
      this.last.delete(key)
    }
  }

  stopAll(): void {
    for (const key of [...this.timers.keys()]) this.stop(key)
  }
}

export const healthMonitor = new HealthMonitor()
