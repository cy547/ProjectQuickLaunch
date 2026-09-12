import { exec } from 'node:child_process'

function execOut(command: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve) => {
    exec(command, { windowsHide: true, timeout: timeoutMs }, (err, stdout) => resolve(err ? '' : stdout))
  })
}

/**
 * 检测系统代理：环境变量优先，其次读 Windows Internet 设置（Clash/v2ray 等开启
 * 「系统代理」时写的就是这里）。git 本身不读系统代理，检测结果用于显式传给 git。
 * 返回规范化后的代理地址（如 http://127.0.0.1:7897），未检测到返回 null。
 */
export async function detectSystemProxy(): Promise<string | null> {
  const envProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy
  if (envProxy) return normalizeProxy(envProxy)

  const [enableOut, serverOut] = await Promise.all([
    execOut('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable'),
    execOut('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer')
  ])
  const enabled = /0x1/.test(enableOut)
  if (!enabled) return null
  const server = serverOut.match(/ProxyServer\s+REG_SZ\s+(\S+)/)?.[1]
  if (!server) return null

  // ProxyServer 可能是 "127.0.0.1:7897" 或 "http=...;https=...;ftp=..." 形式
  if (server.includes('=')) {
    const httpsEntry = server
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('https=') || s.startsWith('http='))
    if (!httpsEntry) return null
    return normalizeProxy(httpsEntry.split('=')[1])
  }
  return normalizeProxy(server)
}

function normalizeProxy(raw: string): string | null {
  const value = raw.trim()
  if (!value || value === '<local>' || value === 'direct') return null
  if (/^https?:\/\//.test(value)) return value
  return `http://${value}`
}
