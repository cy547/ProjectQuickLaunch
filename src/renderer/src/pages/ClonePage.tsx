import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Flex,
  Form,
  Input,
  message,
  Progress,
  Space,
  Typography
} from 'antd'
import { CloudDownloadOutlined, FolderOpenOutlined, PlusOutlined } from '@ant-design/icons'
import { useAppStore } from '../store'
import { joinDir, repoNameFromUrl } from '../utils'
import LogPanel from '../components/LogPanel'
import type { CloneProgressPayload } from '../../../shared/types'

interface FormValues {
  url: string
  dir: string
  folder: string
}

const CLONE_KEY = '__clone__'

export default function ClonePage() {
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const setProjects = useAppStore((s) => s.setProjects)
  const setView = useAppStore((s) => s.setView)
  const openEdit = useAppStore((s) => s.openEdit)
  const appendLogLines = useAppStore((s) => s.appendLogLines)
  const clearLog = useAppStore((s) => s.clearLog)

  const [form] = Form.useForm<FormValues>()
  const [cloning, setCloning] = useState(false)
  const [percent, setPercent] = useState<number | null>(null)
  const [doneDir, setDoneDir] = useState<string | null>(null)
  const [detectedTasks, setDetectedTasks] = useState<Array<{ name: string; command: string; cwd?: string; url?: string }>>([])
  const [systemProxy, setSystemProxy] = useState<string | null>(null)
  const logLinesRef = useRef<string[]>([])

  useEffect(() => {
    void window.api.getSystemProxy().then(setSystemProxy)
  }, [])

  useEffect(() => {
    // 进入页面时带上上次的克隆目录
    if (settings.defaultCloneDir) {
      form.setFieldValue('dir', settings.defaultCloneDir)
    }
  }, [settings.defaultCloneDir, form])

  useEffect(() => {
    const unsub = window.api.onCloneProgress((p: CloneProgressPayload) => {
      logLinesRef.current = [...logLinesRef.current.slice(-199), p.line]
      appendLogLines(CLONE_KEY, [p.line])
      if (typeof p.percent === 'number') setPercent(p.percent)
    })
    return unsub
  }, [appendLogLines])

  const pickDir = async (): Promise<void> => {
    const folder = await window.api.selectFolder('选择克隆目标目录')
    if (!folder) return
    form.setFieldValue('dir', folder)
    if (!form.getFieldValue('folder')) {
      const url: string = form.getFieldValue('url') ?? ''
      if (url) form.setFieldValue('folder', repoNameFromUrl(url))
    }
  }

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const folder: string = form.getFieldValue('folder')
    if (!folder || folder === 'repository') {
      form.setFieldValue('folder', repoNameFromUrl(e.target.value))
    }
  }

  const handleClone = async (): Promise<void> => {
    const values = await form.validateFields()
    const target = values.folder.trim() ? joinDir(values.dir, values.folder.trim()) : values.dir
    setCloning(true)
    setPercent(null)
    setDoneDir(null)
    clearLog(CLONE_KEY)
    logLinesRef.current = []

    const result = await window.api.clone(values.url.trim(), target)
    setCloning(false)

    if (result.ok) {
      setDoneDir(target)
      // 克隆完成即自动识别项目结构，供「添加为项目」时预填
      const det = await window.api.detectProject(target)
      setDetectedTasks(det.tasks.map((t) => ({ name: t.name, command: t.command, cwd: t.cwd, url: t.url })))
      // 记住本次使用的目录作为默认克隆目录
      const next = { ...settings, defaultCloneDir: values.dir }
      const saved = await window.api.saveSettings(next)
      setSettings(saved)
      message.success(det.tasks.length > 0 ? `克隆完成，已识别 ${det.tasks.length} 个启动任务` : '克隆完成')
    } else {
      message.error(result.message ?? '克隆失败')
    }
  }

  const handleCancel = async (): Promise<void> => {
    await window.api.cloneCancel()
  }

  const addAsProject = (): void => {
    if (!doneDir) return
    openEdit({
      presetName: doneDir.split(/[\\/]/).pop() ?? '',
      presetPath: doneDir,
      presetTasks: detectedTasks.length > 0 ? detectedTasks : undefined
    })
  }

  const openProjectInVSCode = async (): Promise<void> => {
    if (!doneDir) return
    const r = await window.api.openInVSCode(doneDir)
    if (!r.ok && r.message) message.warning(r.message)
  }

  return (
    <div style={{ padding: 20, maxWidth: 960, margin: '0 auto' }}>
      <Typography.Title level={4}>从 Git 平台拉取项目</Typography.Title>
      <Typography.Paragraph type="secondary">
        支持 GitHub、Gitee、GitLab 等任意 git 仓库地址（需要本机已安装 git 并有对应访问权限）。
        git 本身不读系统代理，应用会自动检测并在克隆时注入。
      </Typography.Paragraph>
      <Typography.Paragraph>
        {settings.cloneProxy?.trim() ? (
          <Typography.Text type="secondary">
            克隆代理（手动指定）：<code>{settings.cloneProxy}</code>
          </Typography.Text>
        ) : systemProxy ? (
          <Typography.Text type="secondary">
            已检测到系统代理：<code>{systemProxy}</code>，克隆 GitHub 时将自动使用
          </Typography.Text>
        ) : (
          <Typography.Text type="warning">
            未检测到系统代理 —— 克隆 GitHub 通常需要代理（开启代理软件的系统代理并选择可用节点，或在设置中手动指定）
          </Typography.Text>
        )}
      </Typography.Paragraph>

      <Card>
        <Form form={form} layout="vertical">
          <Form.Item
            name="url"
            label="仓库地址"
            rules={[
              { required: true, message: '请输入仓库地址' },
              {
                validator: (_rule, value: string) =>
                  /^(https?:\/\/|git@)\S+/.test(value ?? '')
                    ? Promise.resolve()
                    : Promise.reject(new Error('地址需以 https:// 、http:// 或 git@ 开头'))
              }
            ]}
          >
            <Input
              placeholder="例如：https://github.com/vuejs/pinia.git 或 https://gitee.com/mirrors/…"
              onChange={handleUrlChange}
              allowClear
            />
          </Form.Item>

          <Flex gap={12}>
            <Form.Item
              name="dir"
              label="克隆到本地目录"
              rules={[{ required: true, message: '请选择目标目录' }]}
              style={{ flex: 1 }}
            >
              <Input
                placeholder="选择目标目录"
                addonAfter={
                  <FolderOpenOutlined onClick={() => void pickDir()} style={{ cursor: 'pointer' }} />
                }
              />
            </Form.Item>
            <Form.Item name="folder" label="文件夹名">
              <Input placeholder="自动识别" style={{ width: 200 }} />
            </Form.Item>
          </Flex>

          <Space>
            {cloning ? (
              <>
                <Button danger onClick={() => void handleCancel()}>
                  取消克隆
                </Button>
                <Button type="primary" loading>
                  克隆中…
                </Button>
              </>
            ) : (
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                onClick={() => void handleClone()}
              >
                开始克隆
              </Button>
            )}
          </Space>

          {cloning && (
            <Progress
              percent={percent ?? undefined}
              status={percent === null ? 'active' : 'normal'}
              style={{ marginTop: 16, maxWidth: 560 }}
            />
          )}

          {doneDir && (
            <Alert
              type="success"
              showIcon
              style={{ marginTop: 16 }}
              message={`克隆完成：${doneDir}`}
              action={
                <Space>
                  <Button size="small" type="primary" icon={<PlusOutlined />} onClick={addAsProject}>
                    添加为项目
                  </Button>
                  <Button
                    size="small"
                    icon={<FolderOpenOutlined />}
                    onClick={() => void window.api.openPath(doneDir)}
                  >
                    打开文件夹
                  </Button>
                  <Button size="small" onClick={() => void openProjectInVSCode()}>
                    VS Code 打开
                  </Button>
                  <Button size="small" onClick={() => setView({ type: 'clone' })}>
                    完成
                  </Button>
                </Space>
              }
            />
          )}

          <div style={{ marginTop: 16 }}>
            <LogPanel logKey={CLONE_KEY} className="clone-log-panel" />
          </div>
        </Form>
      </Card>
    </div>
  )
}
