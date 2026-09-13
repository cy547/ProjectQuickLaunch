import { useState } from 'react'
import { Button, Card, Empty, message, Popconfirm, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import {
  ApartmentOutlined,
  CodeOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { useAppStore } from '../store'
import { newId, sleep } from '../utils'
import {
  checkProjectServices,
  confirmContinueUnready,
  confirmServicesDown,
  startTaskSmart,
  waitTaskReady
} from '../startup'
import type { Project, TaskConfig } from '../../../shared/types'
import TaskCard from './TaskCard'

const READY_TIMEOUT_MS = 60_000

export default function ProjectDetail({ projectId }: { projectId: string }) {
  const project = useAppStore((s) => s.projects.find((p) => p.id === projectId))
  const taskStates = useAppStore((s) => s.taskStates)
  const setProjects = useAppStore((s) => s.setProjects)
  const openEdit = useAppStore((s) => s.openEdit)
  const [logKey, setLogKey] = useState<string | null>(null)

  if (!project) {
    return <Empty description="项目不存在" style={{ marginTop: 80 }} />
  }

  const runningTasks = project.tasks.filter(
    (t) => taskStates[`${project.id}:${t.id}`]?.status === 'running'
  )

  const [starting, setStarting] = useState(false)
  const [startHint, setStartHint] = useState<string | null>(null)

  /** 一键启动：依赖服务预检 → 顺序启动（含端口预检）→ 就绪门禁 */
  const startAll = async (): Promise<void> => {
    if (starting) return
    setStarting(true)
    try {
      const down = await checkProjectServices(project)
      if (down.length > 0 && !(await confirmServicesDown(down))) return

      for (const task of project.tasks) {
        setStartHint(`正在启动「${task.name}」…`)
        const r = await startTaskSmart(project, task)
        if (r === 'cancelled') return
        if (task.url || task.ready) {
          setStartHint(`等待「${task.name}」就绪…`)
          const ready = await waitTaskReady(project, task, READY_TIMEOUT_MS, (s) =>
            setStartHint(`等待「${task.name}」就绪… ${s}s`)
          )
          if (ready && document.hidden) {
            void window.api.notify(`「${task.name}」已就绪`, project.name + '：可以继续启动后续任务了')
          }
          if (!ready) {
            setStartHint(null)
            if (!(await confirmContinueUnready(task.name, READY_TIMEOUT_MS / 1000))) return
          }
        }
      }
    } finally {
      setStarting(false)
      setStartHint(null)
    }
  }

  /** 启动快捷命令（一次性任务），并自动打开它的日志面板 */
  const runQuickCommand = async (taskId: string): Promise<void> => {
    const r = await startTaskSmart(project, { id: taskId } as unknown as TaskConfig)
    if (r === 'started') setLogKey(`${project.id}:${taskId}`)
  }

  const stopAll = async (): Promise<void> => {
    for (const task of runningTasks) {
      await window.api.taskStop(project.id, task.id)
    }
  }

  const deleteProject = async (): Promise<void> => {
    const projects = await window.api.deleteProject(project.id)
    setProjects(projects)
    message.success('项目已删除')
  }

  const openVSCode = async (): Promise<void> => {
    // 配置了首选 IDE 用 IDE，否则回退 VS Code
    const req = project.idePath
      ? window.api.openIde(project.path, project.idePath)
      : window.api.openInVSCode(project.path)
    const r = await req
    if (!r.ok && r.message) message.warning(r.message)
  }

  const [detecting, setDetecting] = useState(false)

  /** 没有任务的项目：一键识别项目结构并生成启动任务 */
  const autoDetectTasks = async (): Promise<void> => {
    setDetecting(true)
    try {
      const det = await window.api.detectProject(project.path)
      if (det.tasks.length === 0) {
        message.info('未识别到可启动项目（支持 Node / Java Maven·Gradle / Go / Rust / .NET / Python / nginx / Docker Compose）')
        return
      }
      const updated: Project = {
        ...project,
        tasks: det.tasks.map((t) => ({
          id: newId(),
          name: t.name,
          command: t.command,
          ...(t.cwd ? { cwd: t.cwd } : {}),
          ...(t.url ? { url: t.url } : {})
        }))
      }
      const projects = await window.api.saveProject(updated)
      setProjects(projects)
      message.success(`已自动识别并添加 ${det.tasks.length} 个任务，点击「编辑」可调整`)
    } finally {
      setDetecting(false)
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 960, margin: '0 auto' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* 头部：项目信息 + 操作 */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {project.name}
            </Typography.Title>
            <Space wrap style={{ marginLeft: 'auto' }}>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={starting}
                disabled={project.tasks.length === 0}
                onClick={() => void startAll()}
              >
                一键启动
              </Button>
              <Button
                icon={<PauseCircleOutlined />}
                disabled={runningTasks.length === 0}
                onClick={() => void stopAll()}
              >
                全部停止
              </Button>
              <Tooltip title="打开文件夹">
                <Button icon={<FolderOpenOutlined />} onClick={() => void window.api.openPath(project.path)} />
              </Tooltip>
              <Tooltip title="在终端中打开">
                <Button
                  icon={<CodeOutlined />}
                  onClick={() => {
                    void window.api.openTerminal(project.path).then((r) => {
                      if (!r.ok && r.message) message.warning(r.message)
                    })
                  }}
                />
              </Tooltip>
              <Tooltip title={project.idePath ? `用 ${project.idePath.split(/[\\/]/).pop()} 打开` : '用 VS Code 打开'}>
                <Button icon={<CodeOutlined />} onClick={() => void openVSCode()} />
              </Tooltip>
              <Button icon={<EditOutlined />} onClick={() => openEdit({ project })} />
              <Popconfirm title="确定删除该项目？" onConfirm={() => void deleteProject()}>
                <Button danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          </div>
          <Typography.Text type="secondary" copyable style={{ fontSize: 12 }}>
            {project.path}
          </Typography.Text>
          {runningTasks.length > 0 && (
            <Tag color="green" style={{ marginLeft: 12 }}>
              {runningTasks.length} 个服务运行中
            </Tag>
          )}
        </div>
        {starting && startHint && (
          <div style={{ marginTop: 8 }}>
            <Space size={8}>
              <Spin size="small" />
              <Typography.Text type="secondary">{startHint}</Typography.Text>
            </Space>
          </div>
        )}

        {/* 任务列表 */}
        {project.tasks.length === 0 ? (
          <Empty description="还没有启动任务：可自动识别项目结构，或手动添加">
            <Space>
              <Button
                type="primary"
                icon={<ApartmentOutlined />}
                loading={detecting}
                onClick={() => void autoDetectTasks()}
              >
                自动识别任务
              </Button>
              <Button onClick={() => openEdit({ project })}>手动添加</Button>
            </Space>
          </Empty>
        ) : (
          project.tasks.map((task) => {
            const key = `${project.id}:${task.id}`
            return (
              <TaskCard
                key={task.id}
                projectId={project.id}
                taskId={task.id}
                logOpen={logKey === key}
                onToggleLog={() => setLogKey(logKey === key ? null : key)}
              />
            )
          })
        )}

        {/* 快捷命令 */}
        {(project.quickCommands?.length ?? 0) > 0 && (
          <Card size="small">
            <Space wrap size={8}>
              <Typography.Text type="secondary">
                <ThunderboltOutlined /> 快捷命令：
              </Typography.Text>
              {project.quickCommands!.map((qc) => {
                const qcKey = `${project.id}:${qc.id}`
                const running = taskStates[qcKey]?.status === 'running'
                return (
                  <Button
                    key={qc.id}
                    size="small"
                    icon={<ThunderboltOutlined />}
                    loading={running}
                    onClick={() => void runQuickCommand(qc.id)}
                  >
                    {qc.name}
                  </Button>
                )
              })}
            </Space>
          </Card>
        )}
      </Space>
    </div>
  )
}
