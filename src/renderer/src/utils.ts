/** ANSI 转义序列（颜色码 / 光标控制等） */
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

/** 每个任务key对应的未换行缓冲（跨 chunk 拼接半行） */
const remainders = new Map<string, string>()

/**
 * 把进程输出的原始 chunk 切成完整行：
 * - 处理跨 chunk 的半行
 * - 处理 \r 覆盖式进度输出（取最后一次覆盖的内容）
 */
export function ingestChunk(key: string, raw: string): string[] {
  let buf = (remainders.get(key) ?? '') + raw
  const out: string[] = []
  const parts = buf.split('\n')
  buf = parts.pop() ?? ''
  for (const part of parts) {
    const segments = part.split('\r')
    const line = stripAnsi(segments[segments.length - 1] ?? '').replace(/\s+$/, '')
    if (line) out.push(line)
  }
  remainders.set(key, buf)
  return out
}

export function resetBuffer(key: string): void {
  remainders.delete(key)
}

/** 进程退出时冲刷未换行的半行缓冲，避免最后一行日志丢失 */
export function flushRemainder(key: string): string[] {
  const buf = remainders.get(key)
  remainders.delete(key)
  if (!buf) return []
  const line = stripAnsi(buf).replace(/\s+$/, '')
  return line ? [line] : []
}

/** 识别日志行里的本机/局域网访问地址 */
const URL_RE =
  /https?:\/\/(?:localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:\/[^\s"'<>`\\)\]]*)?/gi

export function extractUrls(line: string): string[] {
  const matches = line.match(URL_RE) ?? []
  return matches
    .map((m) => m.replace(/[.,;:!?]+$/, ''))
    .map((u) => u.replace(/\/+$/, ''))
}

export function newId(): string {
  return crypto.randomUUID()
}

/** 拼接 Windows 目录路径 */
export function joinDir(dir: string, name: string): string {
  const d = dir.replace(/[\\/]+$/, '')
  return `${d}\\${name}`
}

/** 从仓库地址推断文件夹名（支持 https / git@ 两种形式） */
export function repoNameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/\.git$/i, '')
  const last = cleaned.includes('/') ? cleaned.split('/').pop() ?? '' : cleaned
  const name = last.includes(':') ? last.split(':').pop() ?? '' : last
  return name.replace(/[^\w.-]+/g, '-') || 'repository'
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
