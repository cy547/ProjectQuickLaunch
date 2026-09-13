import { useEffect, useState } from 'react'
import { Button, Flex, Form, Input, InputNumber, message, Modal, Select, Space, Typography } from 'antd'
import { ApartmentOutlined, DeleteOutlined, FolderOpenOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { useAppStore } from '../store'
import { newId } from '../utils'
import type { Project, TaskReadyType } from '../../../shared/types'

interface TaskFormValue {
  name: string
  command: string
  cwd?: string
  url?: string
  readyType?: TaskReadyType
  readyValue?: string
}

interface QuickCommandFormValue {
  name: string
  command: string
  cwd?: string
}

interface ServiceFormValue {
  name: string
  host: string
  port?: number
}

interface FormValues {
  name: string
  path: string
  idePath?: string
  tasks: TaskFormValue[]
  quickCommands: QuickCommandFormValue[]
  services: ServiceFormValue[]
}

const READY_OPTIONS = [
  { value: 'url', label: 'URL 探测' },
  { value: 'port', label: '端口被监听' },
  { value: 'process', label: '子进程出现' },
  { value: 'log', label: '日志关键字' }
]

const READY_PLACEHOLDER: Record<TaskReadyType, string> = {
  url: '探测地址（默认访问地址）',
  port: '端口号，如 8080',
  process: '子进程名，如 java',
  log: '日志关键字，如 Started Application'
}

export default function ProjectEditModal() {
  const editModal = useAppStore((s) => s.editModal)
  const closeEdit = useAppStore((s) => s.closeEdit)
  const setProjects = useAppStore((s) => s.setProjects)
  const setView = useAppStore((s) => s.setView)
  const [form] = Form.useForm<FormValues>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editModal.open) return
    const p = editModal.project
    form.resetFields()
    form.setFieldsValue({
      name: p?.name ?? editModal.presetName ?? '',
      path: p?.path ?? editModal.presetPath ?? '',
      idePath: p?.idePath,
      tasks:
        p?.tasks.map((t) => ({
          name: t.name,
          command: t.command,
          cwd: t.cwd,
          url: t.url,
          readyType: t.ready?.type,
          readyValue: t.ready?.value
        })) ??
        editModal.presetTasks?.map((t) => ({ name: t.name, command: t.command, cwd: t.cwd, url: t.url })) ??
        [],
      quickCommands:
        p?.quickCommands?.map((q) => ({ name: q.name, command: q.command, cwd: q.cwd })) ?? [],
      services: p?.services?.map((s) => ({ name: s.name, host: s.host, port: s.port })) ?? []
    })
  }, [
    editModal.open,
    editModal.project,
    editModal.presetName,
    editModal.presetPath,
    editModal.presetTasks,
    form
  ])

  /** 从 package.json 识别启动脚本；非强制模式下仅在任务为空时自动填充 */
  const detectScripts = async (force: boolean): Promise<void> => {
    const pathValue: string | undefined = form.getFieldValue('path')
    if (!pathValue) {
      message.warning('请先选择项目路径')
      return
    }
    const info = await window.api.readPackageJson(pathValue)
    if (!info) {
      if (force) message.warning('该目录下未找到 package.json（或不是 Node 项目）')
      return
    }
    const existing: TaskFormValue[] = form.getFieldValue('tasks') ?? []
    if (!force && existing.length > 0) return

    const scripts = Object.keys(info.scripts)
    const preferred = ['dev', 'start', 'serve'].filter((s) => scripts.includes(s))
    const chosen = preferred.length > 0 ? preferred : scripts.slice(0, 4)
    if (chosen.length === 0) {
      if (force) message.warning('package.json 中没有可用的 scripts')
      return
    }
    form.setFieldValue(
      'tasks',
      chosen.map((s) => ({ name: s, command: `npm run ${s}`, url: '' }))
    )
    message.success(`已识别到 ${chosen.length} 个启动脚本`)
  }

  /** 选好目录后自动识别（深度识别：根目录 + 子目录）；已有任务时不覆盖 */
  const autoDetectOnPath = async (): Promise<void> => {
    const pathValue: string | undefined = form.getFieldValue('path')
    if (!pathValue) return
    const existing: TaskFormValue[] = form.getFieldValue('tasks') ?? []
    if (existing.some((t) => t.name?.trim() && t.command?.trim())) return
    const det = await window.api.detectProject(pathValue)
    if (det.tasks.length === 0) return
    form.setFieldValue(
      'tasks',
      det.tasks.map((t) => ({ name: t.name, command: t.command, cwd: t.cwd, url: t.url ?? '' }))
    )
    message.success(`已自动识别 ${det.tasks.length} 个启动任务`)
  }

  const pickFolder = async (): Promise<void> => {
    const folder = await window.api.selectFolder('选择项目文件夹')
    if (!folder) return
    form.setFieldValue('path', folder)
    const currentName: string = form.getFieldValue('name')
    if (!currentName) {
      form.setFieldValue('name', folder.split(/[\\/]/).pop() ?? '')
    }
    await autoDetectOnPath()
  }

  /** 扫描子目录识别分离的子项目（nginx / Node / Maven / Python），追加为任务 */
  const scanSubProjects = async (): Promise<void> => {
    const pathValue: string | undefined = form.getFieldValue('path')
    if (!pathValue) {
      message.warning('请先选择项目路径')
      return
    }
    const subs = await window.api.scanSubProjects(pathValue)
    if (subs.length === 0) {
      message.info('子目录中未识别到可启动项目（支持 Node / Java Maven·Gradle / Go / Rust / .NET / Python / nginx / Docker Compose）')
      return
    }
    const existing: TaskFormValue[] = form.getFieldValue('tasks') ?? []
    const filled = existing.filter((t) => t.name?.trim() && t.command?.trim())
    const existKeys = new Set(filled.map((t) => `${t.name}|${t.command}|${t.cwd ?? ''}`))
    const additions = subs
      .filter((s) => !existKeys.has(`${s.name}|${s.command}|${s.cwd}`))
      .map((s) => ({ name: s.name, command: s.command, cwd: s.cwd, url: s.url ?? '' }))
    if (additions.length === 0) {
      message.info('识别到的任务已存在')
      return
    }
    form.setFieldValue('tasks', [...filled, ...additions])
    message.success(`已从子目录识别并添加 ${additions.length} 个任务`)
  }

  const pickTaskCwd = async (index: number): Promise<void> => {
    const folder = await window.api.selectFolder('选择任务工作目录')
    if (!folder) return
    form.setFieldValue(['tasks', index, 'cwd'], folder)
  }

  const pickIde = async (): Promise<void> => {
    const file = await window.api.selectFile('选择 IDE 可执行文件（如 idea64.exe）')
    if (file) form.setFieldValue('idePath', file)
  }

  const handleOk = async (): Promise<void> => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const editing = editModal.project
      const project: Project = {
        id: editing?.id ?? newId(),
        name: values.name.trim(),
        path: values.path.trim(),
        createdAt: editing?.createdAt ?? Date.now(),
        tasks: (values.tasks ?? []).map((t, i) => ({
          id: editing?.tasks[i]?.id ?? newId(),
          name: t.name.trim(),
          command: t.command.trim(),
          ...(t.cwd?.trim() ? { cwd: t.cwd.trim() } : {}),
          ...(t.url?.trim() ? { url: t.url.trim() } : {}),
          ...(t.readyType && (t.readyValue?.trim() || t.readyType === 'url')
            ? { ready: { type: t.readyType, ...(t.readyValue?.trim() ? { value: t.readyValue.trim() } : {}) } }
            : {})
        })),
        quickCommands: (values.quickCommands ?? [])
          .filter((q) => q.name?.trim() && q.command?.trim())
          .map((q, i) => ({
            id: editing?.quickCommands?.[i]?.id ?? newId(),
            name: q.name.trim(),
            command: q.command.trim(),
            ...(q.cwd?.trim() ? { cwd: q.cwd.trim() } : {})
          })),
        services: (values.services ?? [])
          .filter((s) => s.name?.trim() && s.port)
          .map((s, i) => ({
            id: editing?.services?.[i]?.id ?? newId(),
            name: s.name.trim(),
            host: s.host?.trim() || '127.0.0.1',
            port: Number(s.port)
          })),
        ...(values.idePath?.trim() ? { idePath: values.idePath.trim() } : {})
      }
      const projects = await window.api.saveProject(project)
      setProjects(projects)
      setView({ type: 'project', projectId: project.id })
      closeEdit()
      message.success('项目已保存')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={editModal.project ? '编辑项目' : '添加项目'}
      open={editModal.open}
      onOk={() => void handleOk()}
      onCancel={closeEdit}
      width={760}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Flex gap={12}>
          <Form.Item
            name="name"
            label="项目名称"
            rules={[{ required: true, message: '请输入项目名称' }]}
            style={{ width: 240 }}
          >
            <Input placeholder="如：我的后台系统" />
          </Form.Item>
          <Form.Item
            name="path"
            label="项目路径"
            rules={[{ required: true, message: '请选择项目路径' }]}
            style={{ flex: 1 }}
          >
            <Input
              placeholder="选择本地项目文件夹"
              onBlur={() => void autoDetectOnPath()}
              addonAfter={
                <FolderOpenOutlined onClick={() => void pickFolder()} style={{ cursor: 'pointer' }} />
              }
            />
          </Form.Item>
        </Flex>

        <Form.Item
          name="idePath"
          label="首选 IDE 路径（选填，留空使用 VS Code）"
          style={{ marginBottom: 12 }}
        >
          <Input
            placeholder="如 D:\develop_tools\IntelliJ IDEA\bin\idea64.exe"
            addonAfter={
              <FolderOpenOutlined onClick={() => void pickIde()} style={{ cursor: 'pointer' }} />
            }
          />
        </Form.Item>

        <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
          <Typography.Text strong>启动任务</Typography.Text>
          <Space>
            <Button size="small" icon={<ApartmentOutlined />} onClick={() => void scanSubProjects()}>
              扫描子目录
            </Button>
            <Button size="small" icon={<SearchOutlined />} onClick={() => void detectScripts(true)}>
              从 package.json 识别
            </Button>
            <Button
              size="small"
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => {
                const tasks: TaskFormValue[] = form.getFieldValue('tasks') ?? []
                form.setFieldValue('tasks', [...tasks, { name: '', command: '', url: '' }])
              }}
            >
              添加任务
            </Button>
          </Space>
        </Flex>

        <Form.List name="tasks">
          {(fields, { remove }) => (
            <>
              {fields.map((field) => (
                <div
                  key={field.key}
                  style={{ marginBottom: 12, padding: '10px 12px 4px', background: '#fafafa', borderRadius: 8 }}
                >
                  <Flex gap={8} align="center">
                    <Form.Item
                      name={[field.name, 'name']}
                      rules={[{ required: true, message: '必填' }]}
                      noStyle
                    >
                      <Input placeholder="任务名（前端）" style={{ width: 130 }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'command']}
                      rules={[{ required: true, message: '必填' }]}
                      noStyle
                    >
                      <Input placeholder="启动命令，如 npm run dev" style={{ flex: 1 }} />
                    </Form.Item>
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  </Flex>
                  <Flex gap={8} align="center" style={{ marginTop: 8, paddingBottom: 6 }}>
                    <Form.Item name={[field.name, 'cwd']} noStyle>
                      <Input
                        placeholder="工作目录（选填，默认为项目路径）"
                        style={{ flex: 1 }}
                        addonAfter={
                          <FolderOpenOutlined
                            onClick={() => void pickTaskCwd(field.name)}
                            style={{ cursor: 'pointer' }}
                          />
                        }
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, 'url']} noStyle>
                      <Input placeholder="访问地址（选填）" style={{ width: 220 }} />
                    </Form.Item>
                  </Flex>
                  <Flex gap={8} align="center" style={{ marginTop: 6, paddingBottom: 6 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                      就绪判定
                    </Typography.Text>
                    <Form.Item name={[field.name, 'readyType']} noStyle>
                      <Select
                        size="small"
                        allowClear
                        placeholder="选填"
                        style={{ width: 140 }}
                        options={READY_OPTIONS}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, 'readyValue']} noStyle>
                      <Input
                        size="small"
                        placeholder="就绪值（URL / 端口号 / 进程名 / 日志关键字）"
                        style={{ flex: 1 }}
                      />
                    </Form.Item>
                  </Flex>
                </div>
              ))}
              {fields.length === 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  还没有任务：可点击「从 package.json 识别」自动填充，或手动「添加任务」。
                  前后端在不同子文件夹时，请为每个任务单独指定工作目录。
                </Typography.Text>
              )}
            </>
          )}
        </Form.List>

        <Flex justify="space-between" align="center" style={{ margin: '16px 0 8px' }}>
          <Typography.Text strong>快捷命令（一次性任务，如 npm install / git pull）</Typography.Text>
          <Button
            size="small"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => {
              const list: QuickCommandFormValue[] = form.getFieldValue('quickCommands') ?? []
              form.setFieldValue('quickCommands', [...list, { name: '', command: '', cwd: '' }])
            }}
          >
            添加快捷命令
          </Button>
        </Flex>
        <Form.List name="quickCommands">
          {(fields, { remove }) => (
            <>
              {fields.map((field) => (
                <Flex gap={8} key={field.key} align="center" style={{ marginBottom: 8 }}>
                  <Form.Item name={[field.name, 'name']} noStyle>
                    <Input placeholder="名称（npm install）" style={{ width: 150 }} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'command']} noStyle>
                    <Input placeholder="命令，如 git pull" style={{ flex: 1 }} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'cwd']} noStyle>
                    <Input placeholder="工作目录（选填）" style={{ width: 220 }} />
                  </Form.Item>
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => remove(field.name)}
                  />
                </Flex>
              ))}
            </>
          )}
        </Form.List>

        <Flex justify="space-between" align="center" style={{ margin: '16px 0 8px' }}>
          <Typography.Text strong>依赖服务（一键启动前预检连通性，如 MySQL/Redis/MQ）</Typography.Text>
          <Button
            size="small"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => {
              const list: ServiceFormValue[] = form.getFieldValue('services') ?? []
              form.setFieldValue('services', [
                ...list,
                { name: '', host: '127.0.0.1', port: undefined }
              ])
            }}
          >
            添加依赖服务
          </Button>
        </Flex>
        <Form.List name="services">
          {(fields, { remove }) => (
            <>
              {fields.map((field) => (
                <Flex gap={8} key={field.key} align="center" style={{ marginBottom: 8 }}>
                  <Form.Item
                    name={[field.name, 'name']}
                    rules={[{ required: true, message: '必填' }]}
                    noStyle
                  >
                    <Input placeholder="名称（Redis）" style={{ width: 130 }} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'host']} noStyle>
                    <Input placeholder="127.0.0.1" style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, 'port']}
                    rules={[{ required: true, message: '必填' }]}
                    noStyle
                  >
                    <InputNumber placeholder="端口" min={1} max={65535} style={{ width: 110 }} />
                  </Form.Item>
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => remove(field.name)}
                  />
                </Flex>
              ))}
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  )
}
