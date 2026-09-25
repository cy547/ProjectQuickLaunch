import { Checkbox, message as antdMessage, Modal, Typography } from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import { RUNTIME_LABEL } from '../../shared/types'
import type { Project, RuntimeType, ServiceDep, TaskConfig } from '../../shared/types'
import { sleep, urlPort } from './utils'

function versionSatisfies(type: RuntimeType, installed: string, required: string): boolean {
  if (type === 'jdk') {
    const major = (v: string): number => {
      const n = Number(v.split('.')[0])
      return n === 1 ? 8 : n
    }
    return major(installed) === Number(required)
  }
  return installed.startsWith(required)
}

/**
 * 启动前预检：运行环境版本比对（pom 的 java.version / engines.node 等）+ 配置文件检查。
 * 发现问题弹窗列出（仍要启动/取消）；预检自身出错不阻塞启动。
 */
export async function preflightTask(project: Project, task: TaskConfig): Promise<boolean> {
  try {
    const problems: string[] = []
    const reqs = await window.api.getTaskRequirements(project.id, task.id)
    if (reqs.length > 0) {
      const versions = await window.api.getRuntimeVersions([...new Set(reqs.map((r) => r.type))])
      for (const r of reqs) {
        const installed = versions[r.type]
        const label = RUNTIME_LABEL[r.type]
        if (!installed) {
          problems.push(`未安装 ${label}${r.version ? `（项目需要 ${r.version}）` : ''} —— ${r.reason}`)
        } else if (r.version && !versionSatisfies(r.type, installed, r.version)) {
          problems.push(`${label} 版本不匹配：本机 ${installed}，项目需要 ${r.version} —— ${r.reason}`)
        }
      }
    }
    const env = await window.api.checkEnvFiles(task.cwd?.trim() || project.path)
    if (env.envMissing) {
      problems.push(
        '检测到 .env.example 但没有 .env —— 配置文件可能还没创建（复制 example 并填写后再启动）'
      )
    }
    if (problems.length === 0) return true
    return await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '启动前检查发现问题',
        icon: <ExclamationCircleOutlined />,
        content: (
          <div>
            {problems.map((p, i) => (
              <p key={i} style={{ margin: '4px 0' }}>
                • {p}
              </p>
            ))}
          </div>
        ),
        okText: '仍要启动',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
  } catch {
    return true // 预检本身出错不阻塞启动
  }
}

export type SmartStartResult = 'started' | 'cancelled'

/**
 * 智能启动单个任务：
 * 1. 启动前预检——运行环境版本比对 + 配置文件检查，发现问题弹窗确认
 * 2. 配置了访问地址的，先做端口预检——被占用时弹窗让用户选择「结束占用进程并启动 / 取消」
 * 3. 通过后调用 taskStart
 */
export async function startTaskSmart(
  project: Project,
  task: TaskConfig
): Promise<SmartStartResult> {
  if (!(await preflightTask(project, task))) return 'cancelled'
  const port = urlPort(task.url)
  if (port) {
    const check = await window.api.checkPort(port)
    if (check.occupied) {
      const lines = check.occupants
        .map((o) => `${o.processName}（PID ${o.pid}）监听 ${o.address}:${o.port}`)
        .join('\n')
      const action = await new Promise<'kill' | 'cancel'>((resolve) => {
        Modal.confirm({
          title: `端口 ${port} 已被占用`,
          icon: <ExclamationCircleOutlined />,
          content: (
            <div>
              <p style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>{lines}</p>
              <p style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
                「结束占用进程」会强制结束该进程（很可能是上次启动的残留），然后启动「{task.name}」。
                若该进程需要保留，请取消。
              </p>
            </div>
          ),
          okText: '结束占用进程并启动',
          okType: 'danger',
          cancelText: '取消',
          onOk: () => resolve('kill'),
          onCancel: () => resolve('cancel')
        })
      })
      if (action === 'cancel') return 'cancelled'
      for (const o of check.occupants) {
        await window.api.killProcess(o.pid)
      }
      // 等端口真正释放（最多 5s）
      for (let i = 0; i < 10; i++) {
        const re = await window.api.checkPort(port)
        if (!re.occupied) break
        await new Promise((r) => setTimeout(r, 500))
      }
    }
  }
  const r = await window.api.taskStart(project.id, task.id)
  if (!r.ok && r.message) {
    const { message } = await import('antd')
    message.warning(`「${task.name}」${r.message}`)
  }
  return r.ok ? 'started' : 'cancelled'
}

/** 依赖服务预检：返回未连通的服务列表 */
export async function checkProjectServices(project: Project): Promise<ServiceDep[]> {
  const services = project.services ?? []
  const down: ServiceDep[] = []
  for (const s of services) {
    const ok = await window.api.checkService(s.host || '127.0.0.1', s.port)
    if (!ok) down.push(s)
  }
  return down
}

/** 与主进程 dockerOps.planImageFor 对应的"可自动部署"判断 */
function dockerPlanKnown(name: string, port: number): boolean {
  const n = name.toLowerCase()
  const has = (kw: string): boolean => n.includes(kw)
  return (
    has('redis') ||
    port === 6379 ||
    has('mysql') ||
    port === 3306 ||
    has('postgres') ||
    port === 5432 ||
    has('mongo') ||
    port === 27017 ||
    has('rabbitmq') ||
    port === 5672 ||
    has('elastic') ||
    port === 9200
  )
}

export interface ServicesResolution {
  proceed: boolean
  /** 本次通过 Docker 部署并就绪的服务名 */
  deployed: string[]
}

/**
 * 依赖服务未就绪时的处理：Docker 可用时提供勾选式一键部署，
 * 部署完成自动重新检测端口并继续启动流程。
 */
export async function resolveServicesDown(down: ServiceDep[]): Promise<ServicesResolution> {
  if (down.length === 0) return { proceed: true, deployed: [] }

  const dockerOk = await window.api.dockerAvailable()
  const deployable = down.map((d) => ({
    dep: d,
    can: dockerOk && Boolean(d.dockerImage?.trim() || dockerPlanKnown(d.name, d.port))
  }))
  const anyDeployable = deployable.some((x) => x.can)

  const choices = deployable.map((x) => ({ dep: x.dep, checked: x.can }))

  const proceed = await new Promise<boolean>((resolve) => {
    Modal.confirm({
      title: '依赖服务未就绪',
      icon: <ExclamationCircleOutlined />,
      width: 520,
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>以下依赖服务连接失败：</p>
          {choices.map(({ dep, checked }, i) => (
            <div key={dep.id} style={{ marginBottom: 6 }}>
              <Checkbox
                defaultChecked={checked}
                disabled={!deployable[i].can}
                onChange={(e) => (choices[i].checked = e.target.checked)}
              >
                <b>{dep.name}</b>（{dep.host || '127.0.0.1'}:{dep.port}）
              </Checkbox>
              {!deployable[i].can && (
                <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                  {dockerOk ? '（无法自动识别镜像，可在编辑项目里填写 Docker 镜像）' : '（Docker 未运行）'}
                </Typography.Text>
              )}
            </div>
          ))}
          <p style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12, marginTop: 8 }}>
            {dockerOk
              ? '勾选的服务将用 Docker 自动部署（容器名 pql-*，可反复复用；MySQL/Postgres 默认密码 pql123456）。'
              : 'Docker 未运行——安装并启动 Docker Desktop 后即可在此一键部署依赖服务。'}
          </p>
        </div>
      ),
      okText: anyDeployable ? '按选择部署并继续' : '仍然启动',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    })
  })
  if (!proceed) return { proceed: false, deployed: [] }

  // 执行勾选的 Docker 部署
  const deployed: string[] = []
  const toDeploy = choices.filter((c) => c.checked).map((c) => c.dep)
  for (const dep of toDeploy) {
    const hide = antdMessage.loading(`正在用 Docker 部署「${dep.name}」（首次拉取镜像可能较慢）…`, 0)
    const r = await window.api.dockerDeploy({
      name: dep.name,
      host: dep.host,
      port: dep.port,
      ...(dep.dockerImage ? { dockerImage: dep.dockerImage } : {})
    })
    hide()
    if (r.ok) {
      antdMessage.success(r.message ?? '部署完成')
      deployed.push(dep.name)
    } else {
      antdMessage.error(r.message ?? '部署失败')
    }
  }

  // 部署后复查，仍有未就绪的再确认
  const stillDown: ServiceDep[] = []
  for (const dep of down) {
    if (deployed.includes(dep.name)) continue
    if (!(await window.api.checkService(dep.host || '127.0.0.1', dep.port))) stillDown.push(dep)
  }
  if (stillDown.length > 0) {
    const names = stillDown.map((s) => s.name).join('、')
    const go = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '部分依赖仍未就绪',
        icon: <ExclamationCircleOutlined />,
        content: <p>{names} 仍未连通，继续启动对应任务大概率会失败。</p>,
        okText: '仍然启动',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
    if (!go) return { proceed: false, deployed }
  }
  return { proceed: true, deployed }
}



/**
 * 就绪门禁：按任务的就绪判定方式轮询（HTTP / 端口 / 进程 / 日志关键字），
 * 未配置任何判定时视为立即就绪。返回 true=就绪；false=超时未就绪。
 */
export async function waitTaskReady(
  project: Project,
  task: TaskConfig,
  timeoutMs: number,
  onTick?: (elapsedSec: number) => void
): Promise<boolean> {
  const cond = task.ready ?? (task.url ? { type: 'url' as const, value: task.url } : null)
  if (!cond) return true
  const start = Date.now()
  const evaluate = async (): Promise<boolean> => {
    switch (cond.type) {
      case 'url':
        return window.api.checkUrl(cond.value || task.url || '')
      case 'port':
        return (await window.api.checkPort(Number(cond.value))).occupied
      case 'process':
        return window.api.checkTaskProcess(project.id, task.id, cond.value || '')
      case 'log':
        return window.api.checkTaskLog(project.id, task.id, cond.value || '')
      default:
        return true
    }
  }
  for (;;) {
    if (await evaluate()) return true
    const elapsed = Date.now() - start
    if (elapsed >= timeoutMs) return false
    onTick?.(Math.round(elapsed / 1000))
    await sleep(1500)
  }
}

/** 超时未就绪时询问是否继续启动后续任务 */
export function confirmContinueUnready(taskName: string, timeoutSec: number): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: `「${taskName}」${timeoutSec}s 未就绪`,
      icon: <ExclamationCircleOutlined />,
      content: (
        <p>
          访问地址 {timeoutSec}s 内没有探测通过，可能仍在启动（编译较慢）、配置有误或依赖未就绪。
          <br />
          仍要继续启动后续任务吗？
        </p>
      ),
      okText: '继续启动后续任务',
      cancelText: '停止流程',
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    })
  })
}
