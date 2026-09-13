/** 任务启动配置 */
export interface TaskConfig {
  id: string
  name: string
  /** 启动命令，如 npm run dev */
  command: string
  /** 任务工作目录（选填，默认使用项目路径；前后端在不同子文件夹时各自指定） */
  cwd?: string
  /** 启动成功后的访问地址，如 http://localhost:5173（选填） */
  url?: string
}

/** 项目 */
export interface Project {
  id: string
  name: string
  path: string
  tasks: TaskConfig[]
  /** 快捷命令（一次性任务：npm install、git pull 等，执行完即结束） */
  quickCommands?: TaskConfig[]
  /** 依赖服务（一键启动前预检连通性，如 MySQL 3306 / Redis 6379） */
  services?: ServiceDep[]
  createdAt: number
}

/** 项目依赖的中间件服务 */
export interface ServiceDep {
  id: string
  name: string
  host: string
  port: number
}

/** 应用设置 */
export interface Settings {
  /** 默认克隆目录 */
  defaultCloneDir: string
  /** 克隆代理地址（空 = 自动检测系统代理，如 http://127.0.0.1:7897） */
  cloneProxy?: string
  /** 应用管理的运行环境（自动下载安装的 Node/JDK/Maven 等） */
  managedRuntimes?: ManagedRuntime[]
  /** 关闭窗口时最小化到托盘（默认 true） */
  trayOnClose?: boolean
}

/** 单个任务的启动统计 */
export interface StatEntry {
  key: string
  projectName: string
  taskName: string
  /** 启动次数 */
  count: number
  /** 累计运行时长（毫秒，按会话内正常退出的任务累计） */
  totalMs: number
  /** 最近一次启动时间戳 */
  lastStart: number
}

/** 运行环境类型（docker/go/rust/dotnet/python 仅检测，不支持自动安装） */
export type RuntimeType = 'node' | 'jdk' | 'maven' | 'python' | 'go' | 'rust' | 'dotnet' | 'docker'

/** 支持自动下载安装的类型 */
export const AUTO_INSTALLABLE: RuntimeType[] = ['node', 'jdk', 'maven']

/** 运行环境中文名 */
export const RUNTIME_LABEL: Record<RuntimeType, string> = {
  node: 'Node.js',
  jdk: 'JDK（Java）',
  maven: 'Maven',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  dotnet: '.NET SDK',
  docker: 'Docker'
}

/** 项目运行环境需求 */
export interface RuntimeRequirement {
  type: RuntimeType
  /** 需要的版本（主版本号，如 '17'；空表示任意版本） */
  version?: string
  /** 为什么需要（如：pom.xml 要求 Java 17） */
  reason: string
}

/** 本机运行环境检查结果 */
export interface RuntimeCheckResult {
  type: RuntimeType
  required?: string
  /** 本机已装版本（未装为空） */
  installed?: string
  status: 'ok' | 'missing' | 'mismatch'
  message: string
}

/** 应用托管的已安装运行环境 */
export interface ManagedRuntime {
  id: string
  type: RuntimeType
  version: string
  dir: string
  binDir: string
}

/** 运行环境安装进度事件载荷 */
export interface RuntimeProgressPayload {
  type: RuntimeType
  phase: 'download' | 'extract' | 'done'
  percent?: number
  message?: string
}

/** 一个被监听的端口及其占用进程 */
export interface PortOccupant {
  port: number
  protocol: 'TCP' | 'UDP'
  /** 监听地址，如 0.0.0.0 / 127.0.0.1 / [::] */
  address: string
  pid: number
  processName: string
}

/** 运行中任务的端口信息（含进程树聚合） */
export interface TaskPortInfo {
  key: string
  projectId: string
  taskId: string
  projectName: string
  taskName: string
  /** 任务主进程 PID */
  mainPid?: number
  /** 进程树内所有进程 */
  processes: Array<{ pid: number; name: string }>
  /** 进程树监听的端口（去重） */
  ports: PortOccupant[]
  /** 任务配置的访问地址（若有） */
  url?: string
}

/** 端口快照：应用内任务占用 + 系统其他进程占用 */
export interface PortSnapshot {
  tasks: TaskPortInfo[]
  /** 系统上其他进程监听的端口（不属于本应用任何任务） */
  others: PortOccupant[]
  /** 快照生成时间 */
  at: number
}

export interface AppConfig {
  projects: Project[]
  settings: Settings
}

export type TaskRunStatus = 'idle' | 'running' | 'stopped' | 'exited' | 'error'

export type UrlHealth = 'unknown' | 'checking' | 'ready' | 'fail'

/** 任务运行态（运行期内存状态，不持久化） */
export interface TaskState {
  status: TaskRunStatus
  pid?: number
  exitCode?: number | null
}

/** 主进程向渲染进程推送事件的发送端（WebContents 结构兼容，便于测试替换） */
export interface IpcSender {
  send(channel: string, ...args: unknown[]): void
}

/** IPC 通道名 */
export const IPC = {
  ConfigLoad: 'config:load',
  SaveProject: 'config:save-project',
  DeleteProject: 'config:delete-project',
  SaveSettings: 'config:save-settings',
  SelectFolder: 'dialog:select-folder',
  SelectArchive: 'dialog:select-archive',
  ReadPackageJson: 'fs:read-package-json',
  ScanSubProjects: 'fs:scan-subprojects',
  DetectProject: 'project:detect',
  ExtractArchive: 'fs:extract-archive',
  CheckRuntimes: 'runtime:check',
  InstallRuntime: 'runtime:install',
  RemoveRuntime: 'runtime:remove',
  GetSystemProxy: 'net:get-system-proxy',
  GetPortSnapshot: 'net:get-port-snapshot',
  KillProcess: 'net:kill-process',
  CheckPort: 'net:check-port',
  CheckService: 'net:check-service',
  CheckUrl: 'net:check-url',
  CheckEnvFiles: 'fs:check-env-files',
  GetTaskRequirements: 'project:task-requirements',
  GetRuntimeVersions: 'runtime:versions',
  OpenTerminal: 'app:open-terminal',
  GetStats: 'stats:get',
  TaskStart: 'task:start',
  TaskStop: 'task:stop',
  TaskLogs: 'task:logs',
  Clone: 'git:clone',
  CloneCancel: 'git:clone-cancel',
  OpenExternal: 'app:open-external',
  OpenPath: 'app:open-path',
  OpenInVSCode: 'app:open-vscode',
  OpenLogFile: 'app:open-log-file',

  EventTaskStatus: 'event:task-status',
  EventTaskOutput: 'event:task-output',
  EventCloneProgress: 'event:clone-progress',
  EventUrlHealth: 'event:url-health',
  EventRuntimeProgress: 'event:runtime-progress'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** task 状态事件载荷 */
export interface TaskStatusPayload {
  key: string
  status: TaskRunStatus
  pid?: number
  exitCode?: number | null
}

/** 任务输出事件载荷 */
export interface TaskOutputPayload {
  key: string
  data: string
}

/** git 克隆进度事件载荷 */
export interface CloneProgressPayload {
  line: string
  percent?: number
}

/** URL 健康检查事件载荷 */
export interface UrlHealthPayload {
  key: string
  url: string
  health: UrlHealth
}

export interface OpResult {
  ok: boolean
  message?: string
}

/** 子项目扫描建议：前后端分离在不同子文件夹时自动识别可启动的任务 */
export interface SubProjectSuggestion {
  /** 建议的任务名（一般取子目录名） */
  name: string
  /** 建议的启动命令 */
  command: string
  /** 任务工作目录（子文件夹绝对路径） */
  cwd: string
  /** 建议的访问地址（可选） */
  url?: string
}

/** 项目识别结果：任务建议 + 运行环境需求 */
export interface DetectionResult {
  tasks: SubProjectSuggestion[]
  requirements: RuntimeRequirement[]
  /** 一句话总结（如：识别到 2 个任务，需要 Node.js、JDK 17） */
  summary: string
}

/** 任务运行状态的内存键：projectId:taskId */
export function taskKey(projectId: string, taskId: string): string {
  return `${projectId}:${taskId}`
}
