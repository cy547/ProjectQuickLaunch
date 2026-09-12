import { Badge, Button, Empty, Menu } from 'antd'
import {
  ApiOutlined,
  CloudDownloadOutlined,
  ImportOutlined,
  PlusOutlined,
  RocketOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { runningCountOf, useAppStore } from '../store'

export default function ProjectList() {
  const projects = useAppStore((s) => s.projects)
  const view = useAppStore((s) => s.view)
  const taskStates = useAppStore((s) => s.taskStates)
  const setView = useAppStore((s) => s.setView)
  const openEdit = useAppStore((s) => s.openEdit)

  return (
    <aside className="app-sider" style={{ width: 232, flexShrink: 0 }}>
      <div className="app-logo">
        <RocketOutlined style={{ color: '#1677ff' }} />
        项目速启
      </div>

      <div className="app-project-list">
        {projects.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有项目"
            style={{ marginTop: 32 }}
          />
        ) : (
          <Menu
            mode="inline"
            selectedKeys={view.type === 'project' ? [view.projectId] : []}
            onClick={({ key }) => setView({ type: 'project', projectId: key })}
            items={projects.map((p) => {
              const running = runningCountOf(taskStates, p.id)
              return {
                key: p.id,
                label: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.name}
                    </span>
                    {running > 0 && <Badge count={running} color="#52c41a" />}
                  </span>
                )
              }
            })}
          />
        )}
      </div>

      <div className="app-sider-footer">
        <Button block icon={<PlusOutlined />} onClick={() => openEdit()}>
          添加项目
        </Button>
        <Button block icon={<ImportOutlined />} onClick={() => setView({ type: 'import' })}>
          导入项目（自动识别）
        </Button>
        <Button
          block
          icon={<CloudDownloadOutlined />}
          onClick={() => setView({ type: 'clone' })}
        >
          拉取项目
        </Button>
        <Button block icon={<ApiOutlined />} onClick={() => setView({ type: 'ports' })}>
          运行与端口
        </Button>
        <Button block icon={<SettingOutlined />} onClick={() => setView({ type: 'settings' })}>
          设置
        </Button>
      </div>
    </aside>
  )
}
