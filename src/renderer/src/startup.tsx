import { Modal } from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import type { Project, ServiceDep, TaskConfig } from '../../shared/types'
import { urlPort } from './utils'

export type SmartStartResult = 'started' | 'cancelled'

/**
 * 智能启动单个任务：
 * 1. 配置了访问地址的，先做端口预检——被占用时弹窗让用户选择「结束占用进程并启动 / 仍要启动 / 取消」
 * 2. 通过后调用 taskStart
 */
export async function startTaskSmart(
  project: Project,
  task: TaskConfig
): Promise<SmartStartResult> {
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

/** 弹窗确认依赖服务未连通：true=仍然启动 */
export function confirmServicesDown(down: ServiceDep[]): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: '依赖服务未就绪',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>以下依赖服务连接失败：</p>
          {down.map((s) => (
            <p key={s.id} style={{ margin: '2px 0' }}>
              <b>{s.name}</b>（{s.host || '127.0.0.1'}:{s.port}）
            </p>
          ))}
          <p style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
            请先启动对应服务（如 MySQL / Redis / MQ），否则任务可能启动失败。
          </p>
        </div>
      ),
      okText: '仍然启动',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    })
  })
}

/**
 * 就绪门禁：轮询 HTTP 探测直到就绪或超时。
 * 返回 true=就绪；false=超时未就绪。
 */
export async function waitReady(
  url: string,
  timeoutMs: number,
  onTick?: (elapsedSec: number) => void
): Promise<boolean> {
  const start = Date.now()
  for (;;) {
    if (await window.api.checkUrl(url)) return true
    const elapsed = Date.now() - start
    if (elapsed >= timeoutMs) return false
    onTick?.(Math.round(elapsed / 1000))
    await new Promise((r) => setTimeout(r, 1500))
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
