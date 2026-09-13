import { useEffect, useState } from 'react'
import { Button, Card, Empty, Flex, Input, message, Popconfirm, Space, Switch, Table, Tag, Typography } from 'antd'
import { FolderOpenOutlined, SaveOutlined } from '@ant-design/icons'
import { useAppStore } from '../store'
import { RUNTIME_LABEL } from '../../../shared/types'
import type { ManagedRuntime } from '../../../shared/types'

export default function SettingsPage() {
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const [dir, setDir] = useState(settings.defaultCloneDir)
  const [proxy, setProxy] = useState(settings.cloneProxy ?? '')

  useEffect(() => {
    setDir(settings.defaultCloneDir)
  }, [settings.defaultCloneDir])

  const pickDir = async (): Promise<void> => {
    const folder = await window.api.selectFolder('选择默认克隆目录')
    if (folder) setDir(folder)
  }

  const save = async (): Promise<void> => {
    const saved = await window.api.saveSettings({ ...settings, defaultCloneDir: dir, cloneProxy: proxy.trim() })
    setSettings(saved)
    message.success('设置已保存')
  }

  const removeRuntime = async (id: string): Promise<void> => {
    const saved = await window.api.removeRuntime(id)
    setSettings(saved)
    message.success('已移除（目录保留在磁盘上，可手动删除）')
  }

  const managed: ManagedRuntime[] = settings.managedRuntimes ?? []

  return (
    <div style={{ padding: 20, maxWidth: 860, margin: '0 auto' }}>
      <Typography.Title level={4}>设置</Typography.Title>

      <Card title="克隆与导入">
        <Typography.Paragraph type="secondary">
          「拉取项目」和「导入项目」默认使用的目标目录。
        </Typography.Paragraph>
        <Flex gap={12}>
          <Input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            placeholder="默认目录"
            addonAfter={
              <FolderOpenOutlined onClick={() => void pickDir()} style={{ cursor: 'pointer' }} />
            }
          />
          <Button type="primary" icon={<SaveOutlined />} onClick={() => void save()}>
            保存
          </Button>
        </Flex>

        <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 8 }}>
          克隆代理：git 本身不读 Windows 系统代理。留空时自动检测系统代理并注入；也可手动指定，如 http://127.0.0.1:7897
        </Typography.Paragraph>
        <Input
          value={proxy}
          onChange={(e) => setProxy(e.target.value)}
          placeholder="留空 = 自动检测系统代理"
          style={{ maxWidth: 480 }}
        />
      </Card>

      <Card title="通用" style={{ marginTop: 16 }}>
        <Space size={8}>
          <Switch
            checked={settings.trayOnClose !== false}
            onChange={(v) => {
              void window.api.saveSettings({ ...settings, trayOnClose: v }).then(setSettings)
            }}
          />
          <Typography.Text>关闭窗口时最小化到系统托盘（不退出，托盘右键可退出）</Typography.Text>
        </Space>
      </Card>

      <Card title="运行环境（自动安装）" style={{ marginTop: 16 }}>
        <Typography.Paragraph type="secondary">
          「导入项目」自动下载的运行环境会列在这里。启动任务时优先使用这些版本（PATH 与 JAVA_HOME 自动注入）。
        </Typography.Paragraph>
        {managed.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有自动安装的运行环境" />
        ) : (
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={managed}
            columns={[
              {
                title: '类型',
                dataIndex: 'type',
                width: 120,
                render: (t: string) => (
                  <Tag color="blue">{RUNTIME_LABEL[t as keyof typeof RUNTIME_LABEL] ?? t}</Tag>
                )
              },
              { title: '版本', dataIndex: 'version', width: 180 },
              { title: '目录', dataIndex: 'dir', ellipsis: true },
              {
                title: '操作',
                width: 90,
                render: (_: unknown, record: ManagedRuntime) => (
                  <Popconfirm title="移除后任务将改用系统 PATH 中的版本，确定？" onConfirm={() => void removeRuntime(record.id)}>
                    <Button size="small" danger>
                      移除
                    </Button>
                  </Popconfirm>
                )
              }
            ]}
          />
        )}
      </Card>

      <Card title="关于" style={{ marginTop: 16 }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
          配置文件位置：%APPDATA%/ProjectQuickLaunch/config.json
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          项目速启（ProjectQuickLaunch）— 本地项目一键启动 + Git 仓库快速拉取 + 自动识别与环境管理。
        </Typography.Paragraph>
      </Card>
    </div>
  )
}
