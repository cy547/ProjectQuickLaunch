import { useState } from 'react'
import { Button, Empty, message, Popconfirm, Space, Tag, Tooltip, Typography } from 'antd'
import {
  ApartmentOutlined,
  CodeOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined
} from '@ant-design/icons'
import { useAppStore } from '../store'
import { newId, sleep } from '../utils'
import type { Project } from '../../../shared/types'
import TaskCard from './TaskCard'

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

  const startAll = async (): Promise<void> => {
    for (const task of project.tasks) {
      const r = await window.api.taskStart(project.id, task.id)
      if (!r.ok && r.message) message.warning(`「${task.name}」${r.message}`)
      await sleep(400)
    }
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
    const r = await window.api.openInVSCode(project.path)
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
              <Tooltip title="用 VS Code 打开">
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
      </Space>
    </div>
  )
}
