import { useState } from 'react'
import { Button, Modal, Space, Steps, Typography } from 'antd'
import {
  PlayCircleOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  RocketOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { useAppStore } from '../store'
import type { View } from '../store'
import type { ReactNode } from 'react'

interface Step {
  icon: ReactNode
  title: string
  lines: string[]
  /** 可选的“现在就试试”跳转 */
  action?: { text: string; view: View }
}

const STEPS: Step[] = [
  {
    icon: <RocketOutlined style={{ fontSize: 44, color: '#1677ff' }} />,
    title: '欢迎使用项目速启',
    lines: [
      '这是一款本地项目「一键启动」工具：把 nginx、后端、前端这些服务收进一个界面，',
      '点一下全部拉起，日志实时可看，服务就绪后点击地址直接跳转浏览器。',
      '三种方式添加项目：手动添加、自动识别导入、git 拉取 —— 下面逐个介绍。'
    ]
  },
  {
    icon: <PlusOutlined style={{ fontSize: 44, color: '#1677ff' }} />,
    title: '添加项目（三种方式）',
    lines: [
      '① 添加项目：手动选择目录；选好后会自动识别 package.json / 子项目并填充启动任务。',
      '② 导入项目（推荐）：丢一个目录或 zip 包，自动识别 10 种项目类型；',
      '    缺 Node/JDK/Maven 时先确认，再自动从国内镜像下载安装。',
      '③ 拉取项目：填 GitHub/Gitee 地址直接克隆（自动走系统代理），',
      '    克隆完成自动识别并预填「添加为项目」。'
    ],
    action: { text: '去导入项目', view: { type: 'import' } }
  },
  {
    icon: <PlayCircleOutlined style={{ fontSize: 44, color: '#52c41a' }} />,
    title: '一键启动与实时日志',
    lines: [
      '点「一键启动」按顺序拉起项目下所有任务：启动前自动预检（端口占用 / 依赖服务 / 版本匹配），',
      '有问题会弹窗让你决定；每个任务的日志实时显示，还能打开落盘的日志文件。',
      '任务配置了访问地址的，服务就绪后变绿，点击直接跳转浏览器。'
    ],
    action: { text: '查看运行与端口', view: { type: 'ports' } }
  },
  {
    icon: <ThunderboltOutlined style={{ fontSize: 44, color: '#faad14' }} />,
    title: '进阶：快捷命令与依赖服务',
    lines: [
      '编辑项目时可以配置：',
      '· 快捷命令：npm install、git pull 这类一次性操作，变成项目页上的按钮；',
      '· 依赖服务：MySQL/Redis/MQ 的地址端口，一键启动前自动预检连通性，',
      '  没启动会提前提醒，避免后端起半天死在连接上。'
    ]
  }
]

interface Faq {
  q: string
  a: ReactNode
}

const FAQS: Faq[] = [
  {
    q: '克隆 / 推送 GitHub 失败（Connection was reset）？',
    a: 'git 命令行不读 Windows 系统代理。应用内克隆会自动检测并注入代理；命令行的 git 已在首次配置时写入 github.com 代理（前提：代理软件开着并选择了可用节点）。如果 Clash 关了，运行：git config --global --unset http.https://github.com/.proxy'
  },
  {
    q: '提示「端口被占用」（如 8888）？',
    a: '打开「运行与端口」页，在搜索框输入端口号，找到占用进程后可一键结束；下次启动同类任务时应用也会自动预检并弹窗询问。'
  },
  {
    q: '后端起不来，提示 Redis / MySQL / MQ 连接失败？',
    a: '① 先把这些服务跑起来；② 在项目「编辑」里把依赖服务配置上（地址+端口），一键启动前会自动预检；③ 数据库 schema（如 vhr.sql）要提前导入。'
  },
  {
    q: '提示 JDK 版本不匹配？',
    a: '启动前预检会对比项目要求的 Java 版本（读 pom.xml）和本机 JAVA_HOME。需要 JDK 11/17/21 时可在「导入项目」向导里自动下载安装；Java 8 请手动安装并设置 JAVA_HOME。'
  },
  {
    q: '前端启动报 vue-cli-service 不存在 / 第一次很慢？',
    a: '应用检测到没有 node_modules 会自动先执行 npm install（日志里能看到进度），第一次需要几分钟，之后就是秒级。'
  },
  {
    q: '日志去哪了？',
    a: '任务卡片「日志」按钮看实时输出；「日志文件」按钮打开落盘的完整日志（%APPDATA%/ProjectQuickLaunch/logs/），应用重启后也能查。'
  }
]

export default function OnboardingModal() {
  const open = useAppStore((s) => s.onboardingOpen)
  const setOnboardingOpen = useAppStore((s) => s.setOnboardingOpen)
  const markOnboarded = useAppStore((s) => s.markOnboarded)
  const setView = useAppStore((s) => s.setView)
  const [tab, setTab] = useState<'guide' | 'faq'>('guide')
  const [step, setStep] = useState(0)

  const close = (): void => {
    setOnboardingOpen(false)
    markOnboarded()
  }

  const current = STEPS[step]

  const footer =
    tab === 'guide' ? (
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Button type="link" onClick={close}>
          跳过教程
        </Button>
        <Space>
          <Button disabled={step === 0} onClick={() => setStep(step - 1)}>
            上一步
          </Button>
          <Button
            type="primary"
            onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : close())}
          >
            {step < STEPS.length - 1 ? '下一步' : '开始使用'}
          </Button>
        </Space>
      </Space>
    ) : (
      <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
        <Button type="primary" onClick={close}>
          我知道了
        </Button>
      </Space>
    )

  return (
    <Modal
      open={open}
      onCancel={close}
      width={640}
      footer={footer}
      title={
        <Space>
          <QuestionCircleOutlined />
          新手教程
        </Space>
      }
    >
      <div style={{ minHeight: 340 }}>
        {tab === 'guide' ? (
          <>
            <Steps
              current={step}
              size="small"
              items={STEPS.map((_, i) => ({ title: `第 ${i + 1} 步` }))}
              style={{ margin: '8px 0 20px' }}
            />
            <div style={{ textAlign: 'center', marginBottom: 16 }}>{current.icon}</div>
            <Typography.Title level={5} style={{ textAlign: 'center' }}>
              {current.title}
            </Typography.Title>
            <div style={{ minHeight: 120 }}>
              {current.lines.map((line, i) => (
                <Typography.Paragraph
                  key={i}
                  style={{ marginBottom: 4, color: 'rgba(0,0,0,0.72)' }}
                >
                  {line}
                </Typography.Paragraph>
              ))}
            </div>
            {current.action && (
              <div style={{ textAlign: 'center' }}>
                <Button
                  type="primary"
                  ghost
                  onClick={() => {
                    setView(current.action!.view)
                    close()
                  }}
                >
                  {current.action.text}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div style={{ minHeight: 340 }}>
            {FAQS.map((f) => (
              <div key={f.q} style={{ marginBottom: 14 }}>
                <Typography.Text strong>
                  <QuestionCircleOutlined style={{ color: '#1677ff', marginRight: 6 }} />
                  {f.q}
                </Typography.Text>
                <Typography.Paragraph
                  style={{ marginBottom: 0, color: 'rgba(0,0,0,0.65)', fontSize: 13 }}
                >
                  {f.a}
                </Typography.Paragraph>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
