import { spawn } from 'node:child_process'
import net from 'node:net'
import type { PortOccupant, TaskPortInfo } from '../shared/types'

interface ProcInfo {
  pid: number
  parentPid: number
  name: string
}

function execOut(command: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const proc = spawn(command, { shell: true, windowsHide: true })
    const finish = (): void => {
      if (!done) {
        done = true
        resolve(out)
      }
    }
    proc.stdout?.on('data', (d: Buffer) => (out += d.toString('utf8')))
    proc.stderr?.on('data', () => undefined)
    proc.on('error', finish)
    proc.on('close', finish)
    setTimeout(finish, timeoutMs)
  })
}

/** 获取全量进程表（PID / 父 PID / 进程名），用于构建进程树和匹配端口归属 */
async function listProcesses(): Promise<Map<number, ProcInfo>> {
  const csv = await execOut(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Csv -NoTypeInformation"'
  )
  const map = new Map<number, ProcInfo>()
  for (const line of csv.split(/\r?\n/).slice(1)) {
    // 兼容带引号的 CSV：1234,"5678","notepad.exe"（进程名取行尾，允许含逗号）
    const m = line.match(/^\s*"?(\d+)"?\s*,\s*"?(\d+)"?\s*,\s*"?(.+?)"?\s*$/)
    if (!m) continue
    const pid = Number(m[1])
    map.set(pid, { pid, parentPid: Number(m[2]), name: m[3].trim().replace(/\.exe$/i, '') })
  }
  return map
}

/** 解析 netstat -ano 输出，提取所有监听中的端口 */
async function listListeningPorts(): Promise<PortOccupant[]> {
  const text = await execOut('netstat -ano -p TCP & netstat -ano -p UDP')
  const out: PortOccupant[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    // TCP: TCP  0.0.0.0:8080  0.0.0.0:0  LISTENING  1234
    // UDP: UDP  0.0.0.0:5353  *:*  1234
    const m = line.match(/^\s*(TCP|UDP)\s+(\S+)\s+(\S+)\s+(?:LISTENING\s+)?(\d+)\s*$/i)
    if (!m) continue
    const protocol = m[1].toUpperCase() as 'TCP' | 'UDP'
    if (protocol === 'TCP' && !/LISTENING/i.test(line)) continue
    const local = m[2]
    const idx = local.lastIndexOf(':')
    if (idx < 0) continue
    const address = local.slice(0, idx)
    const port = Number(local.slice(idx + 1))
    if (!port) continue
    const pid = Number(m[4])
    const dedupeKey = `${protocol}:${local}:${pid}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push({ port, protocol, address, pid, processName: '' })
  }
  return out
}

/** 求某个 PID 的完整后代集合（含自身） */
function descendantsOf(rootPid: number, all: Map<number, ProcInfo>): Set<number> {
  const childrenOf = new Map<number, number[]>()
  for (const proc of all.values()) {
    if (!childrenOf.has(proc.parentPid)) childrenOf.set(proc.parentPid, [])
    childrenOf.get(proc.parentPid)!.push(proc.pid)
  }
  const result = new Set<number>([rootPid])
  const queue = [rootPid]
  while (queue.length > 0) {
    const pid = queue.shift()!
    for (const child of childrenOf.get(pid) ?? []) {
      if (!result.has(child)) {
        result.add(child)
        queue.push(child)
      }
    }
  }
  return result
}

export interface RunningTaskRef {
  key: string
  projectId: string
  taskId: string
  projectName: string
  taskName: string
  mainPid?: number
  url?: string
}

/** 组装端口快照：按任务聚合监听端口 + 系统其他进程占用的端口 */
export async function collectPortSnapshot(running: RunningTaskRef[]): Promise<{
  tasks: TaskPortInfo[]
  others: PortOccupant[]
  at: number
}> {
  const [processes, listening] = await Promise.all([listProcesses(), listListeningPorts()])

  // 进程名补全
  for (const occ of listening) {
    occ.processName = processes.get(occ.pid)?.name ?? `pid-${occ.pid}`
  }

  const taskInfos: TaskPortInfo[] = []
  const taskPids = new Set<number>()

  for (const ref of running) {
    const tree = ref.mainPid ? descendantsOf(ref.mainPid, processes) : new Set<number>([ref.mainPid ?? -1])
    const procList = [...tree]
      .map((pid) => ({ pid, name: processes.get(pid)?.name ?? `pid-${pid}` }))
      .filter((p) => p.pid > 0)
    for (const p of procList) taskPids.add(p.pid)

    const ports = listening.filter((l) => tree.has(l.pid))
    taskInfos.push({
      key: ref.key,
      projectId: ref.projectId,
      taskId: ref.taskId,
      projectName: ref.projectName,
      taskName: ref.taskName,
      mainPid: ref.mainPid,
      processes: procList,
      ports,
      url: ref.url
    })
  }

  const others = listening.filter((l) => !taskPids.has(l.pid))
  others.sort((a, b) => a.port - b.port)
  return { tasks: taskInfos, others, at: Date.now() }
}

export interface PortOccupantInfo {
  protocol: 'TCP' | 'UDP'
  address: string
  port: number
  state: string
  pid: number
  processName: string
}

/** 查询某个端口当前的占用情况（含 TIME_WAIT 等所有状态，用于失败诊断） */
export async function findPortOccupants(port: number): Promise<PortOccupantInfo[]> {
  const text = await execOut(`netstat -ano -p TCP | findstr ":${port} " & netstat -ano -p UDP | findstr ":${port} "`)
  const all = await listProcesses()
  const out: PortOccupantInfo[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(TCP|UDP)\s+(\S+)\s+(\S+)\s*(?:([A-Z_]+)\s+)?(\d+)\s*$/i)
    if (!m) continue
    const protocol = m[1].toUpperCase() as 'TCP' | 'UDP'
    const local = m[2]
    const idx = local.lastIndexOf(':')
    if (idx < 0 || Number(local.slice(idx + 1)) !== port) continue
    const state = protocol === 'UDP' ? 'UDP' : (m[4] ?? 'LISTENING').toUpperCase()
    const pid = Number(m[5])
    out.push({
      protocol,
      address: local.slice(0, idx),
      port,
      state,
      pid,
      processName: all.get(pid)?.name ?? `pid-${pid}`
    })
  }
  return out
}

/** 结束指定进程树（仅用于“结束占用端口的进程”功能；过滤系统关键 PID） */
export async function killProcessTree(pid: number): Promise<{ ok: boolean; message?: string }> {
  if (!Number.isInteger(pid) || pid <= 4) {
    return { ok: false, message: '非法 PID' }
  }
  return new Promise((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    killer.on('close', (code) =>
      code === 0
        ? resolve({ ok: true, message: `已结束进程 ${pid}` })
        : resolve({ ok: false, message: `结束进程失败（退出码 ${code}），可能需要管理员权限` })
    )
    killer.on('error', () => resolve({ ok: false, message: 'taskkill 执行失败' }))
  })
}

export interface PortCheckResult {
  port: number
  /** 有进程处于 LISTENING 时为 true */
  occupied: boolean
  occupants: PortOccupantInfo[]
}

/** 检查端口是否已被监听（启动前预检用），返回占用进程明细 */
export async function checkPortFree(port: number): Promise<PortCheckResult> {
  const occupants = (await findPortOccupants(port)).filter((o) => o.state === 'LISTENING')
  return { port, occupied: occupants.length > 0, occupants }
}

/** TCP 连通性检测（MySQL/Redis/MQ 等依赖服务用，1.5s 超时） */
export function checkServiceTcp(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
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
