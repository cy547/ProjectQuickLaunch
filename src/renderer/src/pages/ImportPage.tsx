import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Flex,
  Input,
  message,
  Progress,
  Space,
  Spin,
  Table,
  Tag,
  Typography
} from 'antd'
import {
  ApartmentOutlined,
  FileZipOutlined,
  FolderOpenOutlined,
  ImportOutlined
} from '@ant-design/icons'
import { useAppStore } from '../store'
import { joinDir } from '../utils'
import type {
  DetectionResult,
  RuntimeCheckResult,
  RuntimeType
} from '../../../shared/types'
import { AUTO_INSTALLABLE, RUNTIME_LABEL } from '../../../shared/types'

/** 该环境缺失/不匹配时是否支持自动下载（JDK 8、Python 等需手动安装） */
function canAutoInstall(type: RuntimeType, required?: string): boolean {
  if (!AUTO_INSTALLABLE.includes(type)) return false
  if (type === 'jdk' && required && !['11', '17', '21'].includes(required)) return false
  return true
}

type Phase = 'idle' | 'working' | 'review'

export default function ImportPage() {
  const settings = useAppStore((s) => s.settings)
  const openEdit = useAppStore((s) => s.openEdit)
  const setProjects = useAppStore((s) => s.setProjects)
  const setView = useAppStore((s) => s.setView)

  const [sourcePath, setSourcePath] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [workingText, setWorkingText] = useState('')
  const [detection, setDetection] = useState<DetectionResult | null>(null)
  const [checks, setChecks] = useState<RuntimeCheckResult[]>([])
  const [installPlan, setInstallPlan] = useState<Set<RuntimeType>>(new Set())
  const [installing, setInstalling] = useState<RuntimeType | null>(null)
  const [installPercent, setInstallPercent] = useState<number | undefined>(undefined)
  const [targetDir, setTargetDir] = useState('')

  useEffect(() => {
    const unsub = window.api.onRuntimeProgress((p) => {
      if (p.phase === 'download' && typeof p.percent === 'number') setInstallPercent(p.percent)
      if (p.phase === 'extract') {
        setInstallPercent(undefined)
        setWorkingText('解压中…')
      }
    })
    return unsub
  }, [])

  const pickDir = async (): Promise<void> => {
    const dir = await window.api.selectFolder('选择项目目录')
    if (dir) setSourcePath(dir)
  }

  const pickZip = async (): Promise<void> => {
    const zip = await window.api.selectArchive('选择项目压缩包（zip）')
    if (zip) setSourcePath(zip)
  }

  const runDetection = async (dir: string): Promise<void> => {
    setPhase('working')
    setWorkingText('正在识别项目结构与运行环境需求…')
    const result = await window.api.detectProject(dir)
    setDetection(result)
    if (result.tasks.length === 0) {
      setPhase('idle')
      message.warning(result.summary)
      return
    }
    setWorkingText('正在检查本机运行环境…')
    const checkResults = await window.api.checkRuntimes(result.requirements)
    setChecks(checkResults)
    setInstallPlan(
      new Set(
        checkResults
          .filter(
            (c) =>
              (c.status === 'missing' || c.status === 'mismatch') &&
              canAutoInstall(c.type, c.required)
          )
          .map((c) => c.type)
      )
    )
    setPhase('review')
  }

  const detectFromDir = async (): Promise<void> => {
    if (!sourcePath.trim()) {
      message.warning('请先填写项目目录或 zip 包路径')
      return
    }
    await runDetection(sourcePath.trim())
  }

  const detectFromZip = async (): Promise<void> => {
    if (!sourcePath.trim()) {
      message.warning('请先填写 zip 包路径')
      return
    }
    setPhase('working')
    setWorkingText('正在解压项目包…')
    const base = sourcePath.split(/[\\/]/).pop()?.replace(/\.zip$/i, '') ?? 'imported-project'
    const dest = joinDir(settings.defaultCloneDir || 'C:\\projects', base)
    setTargetDir(dest)
    const result = await window.api.extractArchive(sourcePath.trim(), dest)
    if (!result.ok) {
      message.error(result.message ?? '解压失败')
      setPhase('idle')
      return
    }
    await runDetection(dest)
  }

  const confirmCreate = async (): Promise<void> => {
    if (!detection || !targetDirAndSource) return
    // 按计划安装缺失的运行环境
    for (const type of installPlan) {
      setInstalling(type)
      setInstallPercent(undefined)
      setWorkingText(`正在安装 ${RUNTIME_LABEL[type]}…`)
      const result = await window.api.installRuntime(type, detection.requirements.find((r) => r.type === type)?.version)
      if (!result.ok) {
        message.error(result.message ?? '安装失败')
        setInstalling(null)
        return
      }
      message.success(result.message)
    }
    setInstalling(null)
    setWorkingText('')

    openEdit({
      presetName: targetDirAndSource.split(/[\\/]/).pop(),
      presetPath: targetDirAndSource,
      presetTasks: detection.tasks
    })
    message.success('已生成启动配置，请确认后保存')
    reset()
  }

  const reset = (): void => {
    setPhase('idle')
    setDetection(null)
    setChecks([])
    setInstallPlan(new Set())
    setSourcePath('')
    setTargetDir('')
  }

  // zip 导入时项目路径 = 解压目录；目录导入时 = 所选目录
  const targetDirAndSource =
    phase === 'review' && detection ? (targetDir || sourcePath.trim()) : ''

  return (
    <div style={{ padding: 20, maxWidth: 960, margin: '0 auto' }}>
      <Typography.Title level={4}>
        <ImportOutlined /> 导入项目（自动识别）
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        提供项目目录或 zip 压缩包，自动识别前后端任务与启动命令；缺少运行环境（Node / JDK / Maven）时先确认再自动从国内镜像下载安装合适版本。
      </Typography.Paragraph>

      <Card>
        <Flex gap={12}>
          <Input
            value={sourcePath}
            onChange={(e) => setSourcePath(e.target.value)}
            placeholder="项目目录路径，或 zip 压缩包路径"
            disabled={phase !== 'idle'}
          />
          <Button icon={<FolderOpenOutlined />} disabled={phase !== 'idle'} onClick={() => void pickDir()}>
            选目录
          </Button>
          <Button icon={<FileZipOutlined />} disabled={phase !== 'idle'} onClick={() => void pickZip()}>
            选 zip 包
          </Button>
          <Button
            type="primary"
            icon={<ApartmentOutlined />}
            loading={phase === 'working'}
            disabled={phase !== 'idle'}
            onClick={() => void (/\.zip$/i.test(sourcePath) ? detectFromZip() : detectFromDir())}
          >
            开始识别
          </Button>
        </Flex>

        {phase === 'working' && (
          <div style={{ marginTop: 16 }}>
            <Space>
              <Spin />
              <Typography.Text type="secondary">{workingText}</Typography.Text>
            </Space>
            {installing && (
              <Progress percent={installPercent} status={installPercent === undefined ? 'active' : 'normal'} style={{ maxWidth: 560, marginTop: 8 }} />
            )}
          </div>
        )}
      </Card>

      {phase === 'review' && detection && (
        <Card title="识别结果" style={{ marginTop: 16 }}>
          <Alert type="success" showIcon message={detection.summary} style={{ marginBottom: 16 }} />

          <Typography.Text strong>将生成的启动任务</Typography.Text>
          <Table
            size="small"
            style={{ marginTop: 8 }}
            pagination={false}
            rowKey={(t) => `${t.name}-${t.command}`}
            dataSource={detection.tasks}
            columns={[
              { title: '任务名', dataIndex: 'name', width: 160 },
              {
                title: '启动命令',
                dataIndex: 'command',
                render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code>
              },
              { title: '工作目录', dataIndex: 'cwd', ellipsis: true },
              { title: '访问地址', dataIndex: 'url', width: 180, render: (v?: string) => v ?? '-' }
            ]}
          />

          {checks.length > 0 && (
            <>
              <Typography.Text strong style={{ display: 'block', marginTop: 20 }}>
                运行环境检查
              </Typography.Text>
              <Table
                size="small"
                style={{ marginTop: 8 }}
                pagination={false}
                rowKey="type"
                dataSource={checks}
                columns={[
                  { title: '环境', dataIndex: 'type', width: 140, render: (t: RuntimeType) => RUNTIME_LABEL[t] },
                  { title: '项目需要', dataIndex: 'required', width: 100, render: (v?: string) => v ?? '任意' },
                  { title: '本机状态', dataIndex: 'message' },
                  {
                    title: '缺失时自动安装',
                    width: 140,
                    render: (_: unknown, record: RuntimeCheckResult) =>
                      record.status === 'missing' || record.status === 'mismatch' ? (
                        canAutoInstall(record.type, record.required) ? (
                          <Checkbox
                            checked={installPlan.has(record.type)}
                            onChange={(e) => {
                              const next = new Set(installPlan)
                              if (e.target.checked) next.add(record.type)
                              else next.delete(record.type)
                              setInstallPlan(next)
                            }}
                          >
                            自动下载
                          </Checkbox>
                        ) : (
                          <Tag>请手动安装</Tag>
                        )
                      ) : (
                        <Tag color="success">就绪</Tag>
                      )
                  }
                ]}
              />
              <Typography.Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
                自动安装的运行环境放在应用数据目录统一管理（设置页可移除），启动任务时自动优先使用。
              </Typography.Paragraph>
            </>
          )}

          <Space style={{ marginTop: 20 }}>
            <Button type="primary" loading={installing !== null} onClick={() => void confirmCreate()}>
              {installPlan.size > 0 ? `安装 ${installPlan.size} 项并创建项目` : '创建项目'}
            </Button>
            <Button onClick={reset}>取消</Button>
          </Space>

          {installing && (
            <div style={{ marginTop: 16 }}>
              <Space>
                <Spin />
                <Typography.Text type="secondary">{workingText}</Typography.Text>
              </Space>
              <Progress
                percent={installPercent}
                status={installPercent === undefined ? 'active' : 'normal'}
                style={{ maxWidth: 560 }}
              />
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
