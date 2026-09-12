import { useMemo, useState } from 'react'
import { Button, Card, message, Select, Space, Tag, Typography } from 'antd'
import { CaretRightOutlined, FileTextOutlined, PauseOutlined } from '@ant-design/icons'
import { useAppStore } from '../store'
import { startTaskSmart } from '../startup'
import type { TaskRunStatus, UrlHealth } from '../../../shared/types'
import LogPanel from './LogPanel'

interface Props {
  projectId: string
  taskId: string
  logOpen: boolean
  onToggleLog: () => void
}

function StatusBadge({ status, exitCode }: { status?: TaskRunStatus; exitCode?: number | null }) {
  switch (status) {
    case 'running':
      return <Tag color="processing">运行中</Tag>
    case 'stopped':
      return <Tag color="default">已停止</Tag>
    case 'exited':
      return <Tag color="default">{`已退出（${exitCode ?? 0}）`}</Tag>
    case 'error':
      return <Tag color="error">{`异常退出（${exitCode ?? '?'}）`}</Tag>
    default:
      return <Tag color="default">未运行</Tag>
  }
}

function HealthTag({ health }: { health?: UrlHealth }) {
  switch (health) {
    case 'ready':
      return <Tag color="green">服务就绪</Tag>
    case 'checking':
      return <Tag color="blue">检测中…</Tag>
    case 'fail':
      return <Tag color="red">未响应</Tag>
    default:
      return null
  }
}

export default function TaskCard({ projectId, taskId, logOpen, onToggleLog }: Props) {
  const project = useAppStore((s) => s.projects.find((p) => p.id === projectId))
  const task = project?.tasks.find((t) => t.id === taskId)
  const runtime = useAppStore((s) => s.taskStates[`${projectId}:${taskId}`])
  const health = useAppStore((s) => s.urlHealth[`${projectId}:${taskId}`])
  const candidates = useAppStore((s) => s.urlCandidates[`${projectId}:${taskId}`])
  const updateTaskUrl = useAppStore((s) => s.updateTaskUrl)
  const [settingUrl, setSettingUrl] = useState(false)

  const running = runtime?.status === 'running'

  // 只在任务运行中且未配置访问地址时，才展示日志中检测到的候选地址
  const detected = useMemo(
    () => (running && !task?.url ? candidates ?? [] : []),
    [running, task?.url, candidates]
  )

  if (!project || !task) return null

  const key = `${projectId}:${taskId}`

  const start = async (): Promise<void> => {
    // 智能启动：配置了访问地址的先做端口预检（被占用时可一键结束占用进程）
    await startTaskSmart(project, task)
  }

  const stop = async (): Promise<void> => {
    const r = await window.api.taskStop(projectId, taskId)
    if (!r.ok && r.message) message.warning(r.message)
  }

  const setAsUrl = async (url: string): Promise<void> => {
    setSettingUrl(true)
    try {
      await updateTaskUrl(projectId, taskId, url)
      message.success(`已设为访问地址：${url}`)
    } finally {
      setSettingUrl(false)
    }
  }

  return (
    <Card size="small" className="task-card">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Space size={8} wrap>
            <Typography.Text strong>{task.name}</Typography.Text>
            <StatusBadge status={runtime?.status} exitCode={runtime?.exitCode} />
          </Space>
          <div style={{ marginTop: 4 }}>
            <span className="mono-text">{task.command}</span>
          </div>
          {task.cwd && (
            <div style={{ marginTop: 4 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                工作目录：{task.cwd}
              </Typography.Text>
            </div>
          )}
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {task.url ? (
              <>
                <a onClick={() => void window.api.openExternal(task.url!)}>{task.url}</a>
                <HealthTag health={health} />
              </>
            ) : detected.length > 0 ? (
              <Select
                size="small"
                placeholder="日志中检测到访问地址，点击设为"
                style={{ minWidth: 300, maxWidth: 480 }}
                loading={settingUrl}
                options={detected.map((u) => ({ value: u, label: u }))}
                onChange={(u) => void setAsUrl(u)}
              />
            ) : null}
          </div>
        </div>

        <Space>
          {running ? (
            <Button danger icon={<PauseOutlined />} onClick={() => void stop()}>
              停止
            </Button>
          ) : (
            <Button type="primary" icon={<CaretRightOutlined />} onClick={() => void start()}>
              启动
            </Button>
          )}
          <Button
            icon={<FileTextOutlined />}
            type={logOpen ? 'primary' : 'default'}
            onClick={onToggleLog}
          >
            日志
          </Button>
        </Space>
      </div>

      {logOpen && <LogPanel logKey={key} />}
    </Card>
  )
}
