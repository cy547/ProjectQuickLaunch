import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Empty,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message
} from 'antd'
import { ApiOutlined, ReloadOutlined } from '@ant-design/icons'
import type { PortOccupant, PortSnapshot, TaskPortInfo } from '../../../shared/types'

export default function PortsPage() {
  const [snapshot, setSnapshot] = useState<PortSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setSnapshot(await window.api.getPortSnapshot())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => void refresh(), 10000)
    return () => clearInterval(timer)
  }, [autoRefresh, refresh])

  const runningTasks = snapshot?.tasks.filter((t) => t.mainPid) ?? []
  const totalPorts = new Set(
    (snapshot?.tasks ?? []).flatMap((t) => t.ports.map((p) => `${p.protocol}:${p.port}`))
  ).size

  const killPort = async (occ: PortOccupant): Promise<void> => {
    const r = await window.api.killProcess(occ.pid)
    if (r.ok) {
      message.success(r.message)
      await refresh()
    } else {
      message.error(r.message)
    }
  }

  const taskColumns = [
    {
      title: '项目 / 任务',
      dataIndex: 'taskName',
      width: 220,
      render: (_: unknown, t: TaskPortInfo) => (
        <Space size={4}>
          <Typography.Text strong>{t.taskName}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            @{t.projectName}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: '监听端口',
      dataIndex: 'ports',
      render: (_: unknown, t: TaskPortInfo) =>
        t.ports.length === 0 ? (
          <Typography.Text type="secondary">（未监听端口）</Typography.Text>
        ) : (
          <Space size={4} wrap>
            {t.ports.map((p) => {
              const clickable = Boolean(t.url && t.url.includes(`:${p.port}`))
              return (
                <Tag
                  key={`${p.protocol}:${p.address}:${p.port}`}
                  color={clickable ? 'green' : 'blue'}
                  style={{ cursor: clickable ? 'pointer' : 'default' }}
                  onClick={() => {
                    if (clickable && t.url) void window.api.openExternal(t.url)
                  }}
                >
                  {p.protocol} {p.port}
                  {p.address !== '0.0.0.0' && p.address !== '[::]' ? ` @${p.address}` : ''}
                </Tag>
              )
            })}
          </Space>
        )
    },
    {
      title: '进程树',
      dataIndex: 'processes',
      width: 260,
      ellipsis: true,
      render: (_: unknown, t: TaskPortInfo) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={false}>
          {t.processes.map((p) => `${p.pid}:${p.name}`).join(' → ') || `主进程 ${t.mainPid ?? '?'}`}
        </Typography.Text>
      )
    },
    {
      title: '操作',
      width: 150,
      render: (_: unknown, t: TaskPortInfo) =>
        t.url ? (
          <Button size="small" type="link" onClick={() => void window.api.openExternal(t.url!)}>
            打开地址
          </Button>
        ) : null
    }
  ]

  const otherColumns = [
    {
      title: '端口',
      dataIndex: 'port',
      width: 90,
      render: (v: number) => <Typography.Text strong>{v}</Typography.Text>
    },
    { title: '协议', dataIndex: 'protocol', width: 80 },
    { title: '监听地址', dataIndex: 'address', width: 160 },
    { title: 'PID', dataIndex: 'pid', width: 100 },
    { title: '进程', dataIndex: 'processName' },
    {
      title: '操作',
      width: 120,
      render: (_: unknown, occ: PortOccupant) => (
        <Popconfirm
          title={`确定结束进程 ${occ.processName}（PID ${occ.pid}）？`}
          description="结束它将释放该端口，进程未保存的数据会丢失。"
          onConfirm={() => void killPort(occ)}
        >
          <Button size="small" danger>
            结束进程
          </Button>
        </Popconfirm>
      )
    }
  ]

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <ApiOutlined /> 运行与端口
        </Typography.Title>
        <Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            每 10 秒自动刷新
          </Typography.Text>
          <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>
            刷新
          </Button>
        </Space>
      </Space>

      <Space size={16} style={{ marginTop: 12, marginBottom: 16 }}>
        <Badge count={runningTasks.length} color="#52c41a" offset={[0, 0]} />
        <Typography.Text>
          {runningTasks.length} 个任务运行中，占用 {totalPorts} 个端口
        </Typography.Text>
      </Space>

      <Card title="应用内任务占用的端口" style={{ marginBottom: 16 }}>
        {runningTasks.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有运行中的任务" />
        ) : (
          <Table
            size="small"
            pagination={false}
            rowKey="key"
            dataSource={runningTasks}
            columns={taskColumns}
          />
        )}
      </Card>

      <Card title="系统其他进程占用的端口（含系统服务）">
        <Table
          size="small"
          pagination={{ pageSize: 15, showSizeChanger: false }}
          rowKey={(o) => `${o.protocol}:${o.address}:${o.port}:${o.pid}`}
          dataSource={snapshot?.others ?? []}
          columns={otherColumns}
          loading={loading && !snapshot}
        />
      </Card>
    </div>
  )
}
