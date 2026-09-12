import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type {
  IpcSender,
  ManagedRuntime,
  RuntimeCheckResult,
  RuntimeRequirement,
  RuntimeType
} from '../shared/types'

const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000

async function runtimesRoot(): Promise<string> {
  const { app } = await import('electron')
  return path.join(app.getPath('appData'), 'ProjectQuickLaunch', 'runtimes')
}

/** 运行版本检测命令并取回输出（java -version 输出在 stderr，故合并捕获） */
function execVersion(command: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const proc = spawn(command, { shell: true, windowsHide: true })
    const finish = (result: string): void => {
      if (!done) {
        done = true
        resolve(result)
      }
    }
    proc.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    proc.stderr?.on('data', (d: Buffer) => (out += d.toString()))
    proc.on('error', () => finish(''))
    proc.on('close', () => finish(out))
    setTimeout(() => {
      finish(out)
      try {
        proc.kill()
      } catch {
        /* 忽略 */
      }
    }, timeoutMs)
  })
}

function firstMatch(text: string, re: RegExp): string | undefined {
  return text.match(re)?.[1]
}

// JDK 8 的版本号带构建后缀（如 1.8.0_452），引号内整体捕获再解析主版本
const JAVA_VERSION_RE = /version "([^"]+)"/

export interface JdkDetection {
  version: string | null
  /** 版本来源：JAVA_HOME（Maven 实际使用的）或 PATH（java 命令解析到的） */
  source: 'JAVA_HOME' | 'PATH'
}

/**
 * 检测 JDK：优先读 JAVA_HOME（Maven 构建实际使用的 JDK），
 * 因为 PATH 里的 java 可能被其他 JDK 抢占，与项目实际构建用的不一致。
 */
async function detectJdk(): Promise<JdkDetection> {
  const javaHome = process.env.JAVA_HOME?.trim()
  if (javaHome) {
    const exe = path.join(javaHome, 'bin', 'java.exe')
    const out = await execVersionFile(exe)
    const v = firstMatch(out, JAVA_VERSION_RE)
    if (v) return { version: v, source: 'JAVA_HOME' }
  }
  const out = await execVersion('java -version')
  const v = firstMatch(out, JAVA_VERSION_RE)
  return { version: v ?? null, source: 'PATH' }
}

/** 直接执行 exe -version（不走 shell，避免 cmd 对带引号路径的解析问题） */
function execVersionFile(exePath: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const proc = spawn(exePath, ['-version'], { windowsHide: true })
    const finish = (result: string): void => {
      if (!done) {
        done = true
        resolve(result)
      }
    }
    proc.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    proc.stderr?.on('data', (d: Buffer) => (out += d.toString()))
    proc.on('error', () => finish(''))
    proc.on('close', () => finish(out))
    setTimeout(() => finish(out), timeoutMs)
  })
}

/** 检测本机已安装的运行环境版本，未安装返回 null */
export async function detectInstalled(type: RuntimeType): Promise<string | null> {
  if (type === 'jdk') return (await detectJdk()).version
  const commands: Record<Exclude<RuntimeType, 'jdk'>, string> = {
    node: 'node --version',
    maven: 'mvn -version',
    python: 'python --version',
    go: 'go version',
    rust: 'rustc --version',
    dotnet: 'dotnet --version',
    docker: 'docker --version'
  }
  const out = await execVersion(commands[type])
  switch (type) {
    case 'node':
      return firstMatch(out, /v(\d+\.\d+\.\d+)/) ?? null
    case 'maven':
      return firstMatch(out, /Apache Maven (\d+\.\d+\.\d+)/) ?? null
    case 'python':
      return firstMatch(out, /Python (\d+\.\d+\.\d+)/) ?? null
    case 'go':
      return firstMatch(out, /go(\d+\.\d+(?:\.\d+)?)/) ?? null
    case 'rust':
    case 'dotnet':
    case 'docker':
      return firstMatch(out, /(\d+\.\d+\.\d+)/) ?? null
  }
}

function majorOf(version: string): number {
  const n = Number(version.split('.')[0])
  return n === 1 ? 8 : n // Java 1.8 记作 8
}

/** 对比需求与已装版本，得出检查结果列表 */
export async function checkRuntimes(requirements: RuntimeRequirement[]): Promise<RuntimeCheckResult[]> {
  const types = [...new Set(requirements.map((r) => r.type))]
  const results: RuntimeCheckResult[] = []
  for (const type of types) {
    const required = requirements.find((r) => r.type === type)?.version
    if (type === 'jdk') {
      const det = await detectJdk()
      results.push(
        judgeRuntime(type, required, det.version, det.version ? `已安装 ${det.version}（来自 ${det.source}）` : '')
      )
      continue
    }
    const installed = await detectInstalled(type)
    results.push(judgeRuntime(type, required, installed, installed ? `已安装 ${installed}` : ''))
  }
  return results
}

function judgeRuntime(
  type: RuntimeType,
  required: string | undefined,
  installed: string | null,
  installedText: string
): RuntimeCheckResult {
  if (!installed) {
    return { type, required, status: 'missing', message: `未安装${required ? `（需要 ${required}）` : ''}` }
  }
  if (required && !satisfies(installed, required, type)) {
    return {
      type,
      required,
      installed,
      status: 'mismatch',
      message: `${installedText}，但项目需要 ${required}`
    }
  }
  return { type, required, installed, status: 'ok', message: installedText }
}

/** 版本满足判断：JDK 按主版本号比，其余按前缀比（如 go 1.21 与 1.21.5） */
function satisfies(installed: string, required: string, type: RuntimeType): boolean {
  if (type === 'jdk') return majorOf(installed) === Number(required)
  return installed.startsWith(required)
}

/** 下载文件（带进度回调），返回本地文件路径 */
export async function downloadFile(
  url: string,
  destFile: string,
  onProgress: (loaded: number, total: number) => void
): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}（${url}）`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const out = fs.createWriteStream(destFile)
  let loaded = 0
  let lastEmit = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    loaded += value.byteLength
    out.write(Buffer.from(value))
    const now = Date.now()
    if (now - lastEmit > 400 || (total && loaded >= total)) {
      lastEmit = now
      onProgress(loaded, total)
    }
  }
  await new Promise<void>((resolve, reject) => {
    out.end(resolve)
    out.on('error', reject)
  })
}

/** 解压 zip：优先用系统自带 bsdtar，失败则回退 PowerShell Expand-Archive */
export function extractZip(zipFile: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true })
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-xf', zipFile, '-C', destDir], { windowsHide: true })
    tar.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      const ps = spawn(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `Expand-Archive -LiteralPath '${zipFile}' -DestinationPath '${destDir}' -Force`
        ],
        { windowsHide: true }
      )
      ps.on('close', (psCode) => (psCode === 0 ? resolve() : reject(new Error(`解压失败（${psCode}）`))))
      ps.on('error', () => reject(new Error('解压失败：tar 与 PowerShell 均不可用')))
    })
    tar.on('error', () => {
      /* tar 不存在时走 PowerShell 分支 */
    })
  })
}

/** 提取解压后唯一的根目录（node/jdk/maven 的 zip 都包一层目录） */
function soleChild(dir: string): string {
  const entries = fs.readdirSync(dir)
  return entries.length === 1 ? path.join(dir, entries[0]) : dir
}

/** 从 npmmirror 的版本索引里挑合适的 Node 版本 */
async function resolveNodeVersion(requiredMajor?: string): Promise<string> {
  const res = await fetch('https://npmmirror.com/mirrors/node/index.json')
  if (!res.ok) throw new Error(`获取 Node 版本列表失败：HTTP ${res.status}`)
  const list = (await res.json()) as Array<{ version: string; lts: boolean | string; files: string[] }>
  if (requiredMajor) {
    const match = list.find(
      (v) => v.version.startsWith(`v${requiredMajor}.`) && v.files.includes('win-x64-zip')
    )
    if (match) return match.version
    throw new Error(`镜像中没有 Node ${requiredMajor} 的 Windows 版本`)
  }
  const lts = list.find((v) => v.lts !== false && v.files.includes('win-x64-zip'))
  if (!lts) throw new Error('镜像中没有可用的 LTS 版本')
  return lts.version
}

async function installNode(
  requiredMajor: string | undefined,
  sender: IpcSender,
  onProgress: (percent: number | undefined, message: string) => void
): Promise<ManagedRuntime> {
  const version = await resolveNodeVersion(requiredMajor)
  const url = `https://npmmirror.com/mirrors/node/${version}/node-${version}-win-x64.zip`
  const dir = path.join(await runtimesRoot(), `node-${version}`)
  return await downloadAndExtract(
    'node',
    version,
    url,
    dir,
    (d) => fs.existsSync(path.join(d, 'node.exe')),
    (d) => d,
    sender,
    onProgress
  )
}

async function installJdk(
  requiredMajor: string | undefined,
  sender: IpcSender,
  onProgress: (percent: number | undefined, message: string) => void
): Promise<ManagedRuntime> {
  const major = requiredMajor ?? '17'
  if (!['11', '17', '21'].includes(major)) {
    throw new Error(
      `Java ${major} 暂不支持自动安装（支持 11/17/21），请从 https://adoptium.net 手动安装`
    )
  }
  const version = `${major}（微软 OpenJDK 最新版）`
  const url = `https://aka.ms/download-jdk/microsoft-jdk-${major}-windows-x64.zip`
  const dir = path.join(await runtimesRoot(), `jdk-${major}`)
  return await downloadAndExtract(
    'jdk',
    version,
    url,
    dir,
    (d) => fs.existsSync(path.join(d, 'bin', 'java.exe')),
    (d) => path.join(d, 'bin'),
    sender,
    onProgress
  )
}

async function installMaven(
  _required: string | undefined,
  sender: IpcSender,
  onProgress: (percent: number | undefined, message: string) => void
): Promise<ManagedRuntime> {
  // 先从 TUNA 列表取当前版本，失败则回退 archive.apache.org 的固定版本
  let version = '3.9.9'
  let baseUrl = `https://archive.apache.org/dist/maven/maven-3/${version}/binaries`
  try {
    const res = await fetch('https://mirrors.tuna.tsinghua.edu.cn/apache/maven/maven-3/')
    if (res.ok) {
      const html = await res.text()
      const versions = [...html.matchAll(/href="(3\.\d+\.\d+)\/"/g)].map((m) => m[1])
      const latest = versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
      if (latest) {
        version = latest
        baseUrl = `https://mirrors.tuna.tsinghua.edu.cn/apache/maven/maven-3/${version}/binaries`
      }
    }
  } catch {
    /* 用兜底版本 */
  }
  const url = `${baseUrl}/apache-maven-${version}-bin.zip`
  const dir = path.join(await runtimesRoot(), `maven-${version}`)
  return await downloadAndExtract(
    'maven',
    version,
    url,
    dir,
    (d) => fs.existsSync(path.join(d, 'bin', 'mvn.cmd')),
    (d) => path.join(d, 'bin'),
    sender,
    onProgress
  )
}

async function downloadAndExtract(
  type: RuntimeType,
  version: string,
  url: string,
  destDir: string,
  verify: (dir: string) => boolean,
  binDirOf: (dir: string) => string,
  sender: IpcSender,
  onProgress: (percent: undefined | number, message: string) => void
): Promise<ManagedRuntime> {
  if (verify(destDir)) {
    return finalize(destDir)
  }
  fs.mkdirSync(destDir, { recursive: true })
  const tmpZip = path.join(destDir, `.download.zip`)

  onProgress(undefined, `下载 ${url}`)
  await downloadFile(url, tmpZip, (loaded, total) => {
    const percent = total ? Math.round((loaded / total) * 100) : undefined
    sender.send('event:runtime-progress', { type, phase: 'download', percent })
    onProgress(percent, `下载中 ${total ? `${(loaded / 1024 / 1024).toFixed(1)}/${(total / 1024 / 1024).toFixed(1)}MB` : `${(loaded / 1024 / 1024).toFixed(1)}MB`}`)
  })

  sender.send('event:runtime-progress', { type, phase: 'extract' })
  onProgress(undefined, '解压中…')
  await extractZip(tmpZip, destDir)
  fs.rmSync(tmpZip, { force: true })

  const root = soleChild(destDir)
  // 单根目录时把内容上提一层，保证目录结构统一
  if (root !== destDir) {
    for (const entry of fs.readdirSync(root)) {
      fs.renameSync(path.join(root, entry), path.join(destDir, entry))
    }
    fs.rmdirSync(root)
  }

  if (!verify(destDir)) throw new Error('解压后未找到预期的可执行文件，安装包可能不完整')
  return finalize(destDir)

  function finalize(dir: string): ManagedRuntime {
    const runtime: ManagedRuntime = {
      id: `${type}-${version}-${Date.now()}`,
      type,
      version,
      dir,
      binDir: binDirOf(dir)
    }
    sender.send('event:runtime-progress', { type, phase: 'done' })
    onProgress(100, '安装完成')
    return runtime
  }
}

/** 安装指定运行环境（返回后已写入 settings.managedRuntimes） */
export async function installRuntime(
  type: RuntimeType,
  requiredVersion: string | undefined,
  sender: IpcSender
): Promise<ManagedRuntime> {
  if (type === 'python') {
    throw new Error('Python 暂不支持自动安装，请从 https://www.python.org/downloads/ 安装后重试')
  }
  if (type === 'go' || type === 'rust' || type === 'dotnet' || type === 'docker') {
    throw new Error('该环境暂不支持自动安装，请到官网下载安装后重试')
  }
  let lastMessage = ''
  const onProgress = (percent: undefined | number, message: string): void => {
    lastMessage = message
  }
  const runtime =
    type === 'node'
      ? await installNode(requiredVersion, sender, onProgress)
      : type === 'jdk'
        ? await installJdk(requiredVersion, sender, onProgress)
        : await installMaven(requiredVersion, sender, onProgress)
  void lastMessage
  return runtime
}

/** 为任务进程构建注入的环境变量：把托管运行环境的目录加进 PATH，JDK 时设置 JAVA_HOME */
export function buildEnvForManaged(managed: ManagedRuntime[] | undefined): {
  managedPaths: string[]
  javaHome?: string
} {
  const list = managed ?? []
  const managedPaths = [...list].reverse().map((r) => r.binDir)
  const jdk = [...list].reverse().find((r) => r.type === 'jdk')
  return { managedPaths, javaHome: jdk?.dir }
}
