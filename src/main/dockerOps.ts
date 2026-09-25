import { spawn } from 'node:child_process'
import net from 'node:net'
import { loadConfig } from './store'
import type { ServiceDep } from '../shared/types'

interface DockerResult {
  code: number
  stdout: string
  stderr: string
}

function execDocker(args: string[], timeoutMs = 60_000): Promise<DockerResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let done = false
    const proc = spawn('docker', args, { windowsHide: true })
    const finish = (code: number): void => {
      if (!done) {
        done = true
        resolve({ code, stdout, stderr })
      }
    }
    proc.stdout?.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
    proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
    proc.on('error', () => finish(-1))
    proc.on('close', (code) => finish(code ?? -1))
    setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* 忽略 */
      }
      finish(-1)
    }, timeoutMs)
  })
}

/** Docker 是否可用（守护进程在运行） */
export async function dockerAvailable(): Promise<boolean> {
  const r = await execDocker(['version', '--format', '{{.Server.Version}}'], 8000)
  return r.code === 0
}

interface ImagePlan {
  image: string
  containerPort: number
  env?: Record<string, string>
  extraPorts?: Array<{ host: number; container: number }>
}

/** 常见中间件的默认镜像方案（按名称/端口识别） */
export function planImageFor(name: string, port: number): ImagePlan | null {
  const n = name.toLowerCase()
  const has = (kw: string): boolean => n.includes(kw)
  if (has('redis') || port === 6379) {
    return { image: 'redis:7-alpine', containerPort: 6379 }
  }
  if (has('mysql') || port === 3306) {
    return {
      image: 'mysql:8.0',
      containerPort: 3306,
      env: { MYSQL_ROOT_PASSWORD: 'pql123456', TZ: 'Asia/Shanghai' }
    }
  }
  if (has('postgres') || port === 5432) {
    return {
      image: 'postgres:16-alpine',
      containerPort: 5432,
      env: { POSTGRES_PASSWORD: 'pql123456' }
    }
  }
  if (has('mongo') || port === 27017) {
    return { image: 'mongo:7', containerPort: 27017 }
  }
  if (has('rabbitmq') || port === 5672) {
    return {
      image: 'rabbitmq:3-management',
      containerPort: 5672,
      extraPorts: [{ host: 15672, container: 15672 }]
    }
  }
  if (has('elastic') || port === 9200) {
    return {
      image: 'elasticsearch:8.14.3',
      containerPort: 9200,
      env: { 'discovery.type': 'single-node', 'xpack.security.enabled': 'false' }
    }
  }
  return null
}

function containerName(dep: ServiceDep): string {
  const safe = dep.name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()
  return `pql-${safe || 'svc'}-${dep.port}`
}

function portReady(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const done = (ok: boolean): void => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, host)
  })
}

/**
 * 用 Docker 一键部署依赖服务：
 * 已有同名容器 → 启动；没有 → docker run -d（自动拉取镜像）。
 * 部署后轮询端口直到就绪（MySQL 首次初始化可能要 30-60s）。
 */
export async function deployService(dep: ServiceDep): Promise<{ ok: boolean; message?: string }> {
  if (!/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i.test(dep.host || '127.0.0.1')) {
    return { ok: false, message: `${dep.host} 不是本机地址，Docker 部署只适用于本机服务` }
  }
  if (!(await dockerAvailable())) {
    return { ok: false, message: 'Docker 不可用：请确认 Docker Desktop 已安装并正在运行' }
  }

  const plan = dep.dockerImage?.trim()
    ? { image: dep.dockerImage.trim(), containerPort: dep.port }
    : planImageFor(dep.name, dep.port)
  if (!plan) {
    return {
      ok: false,
      message: `无法自动识别「${dep.name}」的镜像，请在编辑项目里为它填写 Docker 镜像`
    }
  }

  const mirror = loadConfig().settings.dockerMirror?.trim()
  const image = mirror && !/^[^/]+\//.test(plan.image) ? `${mirror}${plan.image}` : plan.image
  const name = containerName(dep)

  // 已有同名容器：running 直接复用，stopped 启动它
  const ps = await execDocker(
    ['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Status}}'],
    20_000
  )
  if (ps.code === 0 && ps.stdout.trim()) {
    if (/^Up/i.test(ps.stdout.trim())) {
      // 已在运行，直接等端口
    } else {
      const start = await execDocker(['start', name], 60_000)
      if (start.code !== 0) {
        return { ok: false, message: `启动已有容器失败：${start.stderr.trim().slice(0, 160)}` }
      }
    }
  } else {
    const args = ['run', '-d', '--name', name, '-p', `${dep.port}:${plan.containerPort}`]
    for (const [k, v] of Object.entries(plan.env ?? {})) args.push('-e', `${k}=${v}`)
    for (const p of plan.extraPorts ?? []) args.push('-p', `${p.host}:${p.container}`)
    args.push(image)
    const run = await execDocker(args, 10 * 60_000) // 首次拉取镜像可能较慢
    if (run.code !== 0) {
      const err = (run.stderr || run.stdout).trim()
      if (/port is already allocated|bind/i.test(err)) {
        return { ok: false, message: `端口 ${dep.port} 已被其他程序占用，无法映射给容器` }
      }
      return { ok: false, message: `容器创建失败：${err.slice(0, 200)}` }
    }
  }

  // 轮询等服务真正可连（MySQL 首次初始化较慢）
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (await portReady('127.0.0.1', dep.port)) {
      return { ok: true, message: `「${dep.name}」已通过 Docker 就绪（容器 ${name}）` }
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return {
    ok: false,
    message: `容器 ${name} 已启动但端口 ${dep.port} 尚未就绪（服务可能仍在初始化，稍后重试启动即可）`
  }
}
