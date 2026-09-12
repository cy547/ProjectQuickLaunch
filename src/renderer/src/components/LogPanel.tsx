import { useEffect, useRef, useState } from 'react'
import { Button, Space, Typography, message } from 'antd'
import { ClearOutlined, CopyOutlined, FileTextOutlined } from '@ant-design/icons'
import { useAppStore } from '../store'

interface Props {
  logKey: string
  className?: string
}

/** 实时日志面板：从全局 store 读取对应任务的日志行 */
export default function LogPanel({ logKey, className }: Props) {
  const lines = useAppStore((s) => s.logs[logKey])
  const clearLog = useAppStore((s) => s.clearLog)
  const containerRef = useRef<HTMLPreElement>(null)
  const stickBottomRef = useState(() => ({ value: true }))[0]
  const [projectId, taskId] = logKey.split(':')

  useEffect(() => {
    const el = containerRef.current
    if (el && stickBottomRef.value) {
      el.scrollTop = el.scrollHeight
    }
  }, [lines?.length])

  const onScroll = (): void => {
    const el = containerRef.current
    if (!el) return
    stickBottomRef.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const text = (lines ?? []).join('\n')

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      message.success('日志已复制')
    } catch {
      message.warning('复制失败')
    }
  }

  return (
    <div>
      <pre ref={containerRef} onScroll={onScroll} className={`log-panel ${className ?? ''}`}>
        {text || '（暂无输出）'}
      </pre>
      <div className="log-toolbar">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          共 {lines?.length ?? 0} 行 · 实时输出
        </Typography.Text>
        <Space>
          <Button
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => {
              void window.api.openLogFile(projectId, taskId).then((r) => {
                if (!r.ok && r.message) message.info(r.message)
              })
            }}
          >
            日志文件
          </Button>
          <Button size="small" icon={<CopyOutlined />} disabled={!text} onClick={() => void copy()}>
            复制
          </Button>
          <Button
            size="small"
            icon={<ClearOutlined />}
            disabled={!text}
            onClick={() => clearLog(logKey)}
          >
            清空
          </Button>
        </Space>
      </div>
    </div>
  )
}
