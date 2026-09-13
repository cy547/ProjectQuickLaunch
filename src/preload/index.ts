import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type {
  CloneProgressPayload,
  RuntimeProgressPayload,
  RuntimeType,
  TaskOutputPayload,
  TaskStatusPayload,
  UrlHealthPayload
} from '../shared/types'
import type { RendererApi } from '../shared/api'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: RendererApi = {
  configLoad: () => ipcRenderer.invoke(IPC.ConfigLoad),
  saveProject: (project) => ipcRenderer.invoke(IPC.SaveProject, project),
  deleteProject: (id) => ipcRenderer.invoke(IPC.DeleteProject, id),
  saveSettings: (settings) => ipcRenderer.invoke(IPC.SaveSettings, settings),
  selectFolder: (title) => ipcRenderer.invoke(IPC.SelectFolder, title),
  selectArchive: (title) => ipcRenderer.invoke(IPC.SelectArchive, title),
  readPackageJson: (projectPath) => ipcRenderer.invoke(IPC.ReadPackageJson, projectPath),
  scanSubProjects: (projectPath) => ipcRenderer.invoke(IPC.ScanSubProjects, projectPath),
  detectProject: (projectPath) => ipcRenderer.invoke(IPC.DetectProject, projectPath),
  extractArchive: (archivePath, destDir) => ipcRenderer.invoke(IPC.ExtractArchive, archivePath, destDir),
  checkRuntimes: (requirements) => ipcRenderer.invoke(IPC.CheckRuntimes, requirements),
  installRuntime: (type, version) => ipcRenderer.invoke(IPC.InstallRuntime, type, version),
  removeRuntime: (id) => ipcRenderer.invoke(IPC.RemoveRuntime, id),

  taskStart: (projectId, taskId) => ipcRenderer.invoke(IPC.TaskStart, projectId, taskId),
  taskStop: (projectId, taskId) => ipcRenderer.invoke(IPC.TaskStop, projectId, taskId),
  taskLogs: (projectId, taskId) => ipcRenderer.invoke(IPC.TaskLogs, projectId, taskId),

  clone: (url, targetDir) => ipcRenderer.invoke(IPC.Clone, url, targetDir),
  cloneCancel: () => ipcRenderer.invoke(IPC.CloneCancel),
  getSystemProxy: () => ipcRenderer.invoke(IPC.GetSystemProxy),
  getPortSnapshot: () => ipcRenderer.invoke(IPC.GetPortSnapshot),
  killProcess: (pid: number) => ipcRenderer.invoke(IPC.KillProcess, pid),
  checkPort: (port: number) => ipcRenderer.invoke(IPC.CheckPort, port),
  checkService: (host: string, port: number) => ipcRenderer.invoke(IPC.CheckService, host, port),
  checkUrl: (url: string) => ipcRenderer.invoke(IPC.CheckUrl, url),
  checkEnvFiles: (dir: string) => ipcRenderer.invoke(IPC.CheckEnvFiles, dir),
  getTaskRequirements: (projectId: string, taskId: string) =>
    ipcRenderer.invoke(IPC.GetTaskRequirements, projectId, taskId),
  getRuntimeVersions: (types: RuntimeType[]) =>
    ipcRenderer.invoke(IPC.GetRuntimeVersions, types),

  openExternal: (url) => ipcRenderer.invoke(IPC.OpenExternal, url),
  openPath: (p) => ipcRenderer.invoke(IPC.OpenPath, p),
  openInVSCode: (p) => ipcRenderer.invoke(IPC.OpenInVSCode, p),
  openLogFile: (projectId, taskId) => ipcRenderer.invoke(IPC.OpenLogFile, projectId, taskId),
  openTerminal: (dir: string) => ipcRenderer.invoke(IPC.OpenTerminal, dir),
  getStats: () => ipcRenderer.invoke(IPC.GetStats),

  onTaskStatus: (cb) => subscribe<TaskStatusPayload>(IPC.EventTaskStatus, cb),
  onTaskOutput: (cb) => subscribe<TaskOutputPayload>(IPC.EventTaskOutput, cb),
  onCloneProgress: (cb) => subscribe<CloneProgressPayload>(IPC.EventCloneProgress, cb),
  onUrlHealth: (cb) => subscribe<UrlHealthPayload>(IPC.EventUrlHealth, cb),
  onRuntimeProgress: (cb) => subscribe<RuntimeProgressPayload>(IPC.EventRuntimeProgress, cb)
}

contextBridge.exposeInMainWorld('api', api)
