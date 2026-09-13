import type {
  AppConfig,
  OpResult,
  PortSnapshot,
  Project,
  Settings,
  SubProjectSuggestion,
  DetectionResult,
  RuntimeCheckResult,
  RuntimeRequirement,
  RuntimeType,
  RuntimeProgressPayload,
  TaskRunStatus,
  UrlHealth,
  CloneProgressPayload,
  TaskOutputPayload,
  TaskStatusPayload,
  StatEntry,
  UpdaterEvent,
  UrlHealthPayload
} from './types'

export interface PackageJsonInfo {
  name?: string
  scripts: Record<string, string>
}

/** 渲染进程可用的 API（preload 通过 contextBridge 暴露为 window.api） */
export interface RendererApi {
  configLoad(): Promise<AppConfig>
  saveProject(project: Project): Promise<Project[]>
  deleteProject(id: string): Promise<Project[]>
  saveSettings(settings: Settings): Promise<Settings>
  selectFolder(title?: string): Promise<string | null>
  selectArchive(title?: string): Promise<string | null>
  readPackageJson(projectPath: string): Promise<PackageJsonInfo | null>
  /** 扫描子目录，识别 nginx / Node / Maven Spring Boot / Python 等可启动的子项目 */
  scanSubProjects(projectPath: string): Promise<SubProjectSuggestion[]>
  /** 深度识别项目：根目录 + 子目录，生成任务建议与运行环境需求 */
  detectProject(projectPath: string): Promise<DetectionResult>
  /** 解压 zip 项目包到目标目录 */
  extractArchive(archivePath: string, destDir: string): Promise<OpResult>
  /** 检查本机运行环境是否满足需求 */
  checkRuntimes(requirements: RuntimeRequirement[]): Promise<RuntimeCheckResult[]>
  /** 自动下载安装运行环境（进度通过 onRuntimeProgress 推送） */
  installRuntime(type: RuntimeType, version?: string): Promise<OpResult>
  /** 删除应用托管的运行环境 */
  removeRuntime(id: string): Promise<Settings>

  taskStart(projectId: string, taskId: string): Promise<OpResult>
  taskStop(projectId: string, taskId: string): Promise<OpResult>
  taskLogs(projectId: string, taskId: string): Promise<string>

  clone(url: string, targetDir: string): Promise<OpResult>
  cloneCancel(): Promise<void>
  /** 检测系统代理（git 不读系统代理，检测结果用于显式注入） */
  getSystemProxy(): Promise<string | null>

  openExternal(url: string): Promise<void>
  openPath(p: string): Promise<void>
  openInVSCode(p: string): Promise<OpResult>
  /** 打开任务最近一次运行的日志文件（已落盘，重启后仍可查看） */
  openLogFile(projectId: string, taskId: string): Promise<OpResult>
  /** 端口快照：运行中任务的端口占用 + 系统其他进程占用 */
  getPortSnapshot(): Promise<PortSnapshot>
  /** 结束占用端口的进程树 */
  killProcess(pid: number): Promise<OpResult>
  /** 端口预检：是否被 LISTENING 进程占用 */
  checkPort(port: number): Promise<{ port: number; occupied: boolean; occupants: Array<{ pid: number; processName: string; state: string; address: string; port: number; protocol: string }> }>
  /** 依赖服务 TCP 连通性检测 */
  checkService(host: string, port: number): Promise<boolean>
  /** HTTP 就绪探测 */
  checkUrl(url: string): Promise<boolean>
  /** 启动前配置检查：有 .env.example 却没有 .env */
  checkEnvFiles(dir: string): Promise<{ envMissing: boolean }>
  /** 任务所需的运行环境需求（含版本要求） */
  getTaskRequirements(projectId: string, taskId: string): Promise<RuntimeRequirement[]>
  /** 检测本机已装的运行环境版本 */
  getRuntimeVersions(types: RuntimeType[]): Promise<Partial<Record<RuntimeType, string | null>>>
  /** 任务进程树中是否存在名字匹配的进程（就绪判定用） */
  checkTaskProcess(projectId: string, taskId: string, name: string): Promise<boolean>
  /** 任务日志中是否出现关键字（就绪判定用） */
  checkTaskLog(projectId: string, taskId: string, keyword: string): Promise<boolean>
  /** 选择可执行文件（IDE 路径等） */
  selectFile(title?: string): Promise<string | null>
  /** 用项目首选 IDE 打开目录（未配置时回退 VS Code） */
  openIde(dir: string, idePath?: string): Promise<OpResult>
  /** 系统通知（点击会打开主窗口） */
  notify(title: string, body: string): Promise<void>
  /** 手动检查更新 */
  updaterCheck(): Promise<UpdaterEvent>
  /** 安装已下载的更新（重启应用） */
  updaterInstall(): Promise<OpResult>
  /** 当前应用版本 */
  appVersion(): Promise<string>
  /** 更新器状态事件 */
  onUpdaterEvent(cb: (p: UpdaterEvent) => void): () => void
  /** 在系统终端（Windows Terminal/PowerShell）中打开指定目录 */
  openTerminal(dir: string): Promise<OpResult>
  /** 启动统计（按任务聚合） */
  getStats(): Promise<StatEntry[]>

  onTaskStatus(cb: (p: TaskStatusPayload) => void): () => void
  onTaskOutput(cb: (p: TaskOutputPayload) => void): () => void
  onCloneProgress(cb: (p: CloneProgressPayload) => void): () => void
  onUrlHealth(cb: (p: UrlHealthPayload) => void): () => void
  onRuntimeProgress(cb: (p: RuntimeProgressPayload) => void): () => void
}

export type { TaskRunStatus, UrlHealth, RuntimeType }
