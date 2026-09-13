import { create } from 'zustand'
import { resetBuffer } from './utils'
import { taskKey } from '../../shared/types'
import type {
  AppConfig,
  Project,
  Settings,
  TaskRunStatus,
  UrlHealth
} from '../../shared/types'
import type { TaskStatusPayload } from '../../shared/types'

export type View =
  | { type: 'project'; projectId: string }
  | { type: 'clone' }
  | { type: 'import' }
  | { type: 'ports' }
  | { type: 'settings' }

export interface EditModalState {
  open: boolean
  /** 编辑已有项目 */
  project?: Project
  /** 预填（克隆/导入完成后“添加为项目”场景） */
  presetName?: string
  presetPath?: string
  presetTasks?: Array<{ name: string; command: string; cwd?: string; url?: string }>
}

interface TaskRuntime {
  status: TaskRunStatus
  pid?: number
  exitCode?: number | null
}

const LOG_LIMIT = 1200

interface AppState {
  loaded: boolean
  projects: Project[]
  settings: Settings
  view: View
  onboardingOpen: boolean
  taskStates: Record<string, TaskRuntime>
  urlHealth: Record<string, UrlHealth>
  logs: Record<string, string[]>
  urlCandidates: Record<string, string[]>
  editModal: EditModalState

  init: (cfg: AppConfig) => void
  setProjects: (projects: Project[]) => void
  setSettings: (settings: Settings) => void
  setView: (view: View) => void
  applyTaskStatus: (p: TaskStatusPayload) => void
  appendLogLines: (key: string, lines: string[]) => void
  clearLog: (key: string) => void
  setUrlHealth: (key: string, health: UrlHealth) => void
  addUrlCandidate: (key: string, url: string) => void
  updateTaskUrl: (projectId: string, taskId: string, url: string) => Promise<void>
  openEdit: (state?: Omit<EditModalState, 'open'>) => void
  closeEdit: () => void
  setOnboardingOpen: (open: boolean) => void
  markOnboarded: () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  loaded: false,
  projects: [],
  settings: { defaultCloneDir: '' },
  view: { type: 'clone' },
  taskStates: {},
  urlHealth: {},
  logs: {},
  urlCandidates: {},
  editModal: { open: false },
  onboardingOpen: false,

  init: (cfg) => {
    const firstProject = cfg.projects[0]
    set({
      loaded: true,
      projects: cfg.projects,
      settings: cfg.settings,
      view: firstProject ? { type: 'project', projectId: firstProject.id } : { type: 'clone' },
      onboardingOpen: !cfg.settings.onboarded && cfg.projects.length === 0
    })
  },

  setProjects: (projects) => {
    const { view } = get()
    let nextView = view
    if (view.type === 'project' && !projects.some((p) => p.id === view.projectId)) {
      nextView = projects[0] ? { type: 'project', projectId: projects[0].id } : { type: 'clone' }
    }
    set({ projects, view: nextView })
  },

  setSettings: (settings) => set({ settings }),

  setView: (view) => set({ view }),

  applyTaskStatus: (p) =>
    set((state) => ({
      taskStates: {
        ...state.taskStates,
        [p.key]: { status: p.status, pid: p.pid, exitCode: p.exitCode }
      }
    })),

  appendLogLines: (key, lines) =>
    set((state) => {
      const prev = state.logs[key] ?? []
      const next = [...prev, ...lines]
      if (next.length > LOG_LIMIT) next.splice(0, next.length - LOG_LIMIT)
      return { logs: { ...state.logs, [key]: next } }
    }),

  clearLog: (key) => {
    resetBuffer(key)
    set((state) => ({ logs: { ...state.logs, [key]: [] } }))
  },

  setUrlHealth: (key, health) =>
    set((state) => ({ urlHealth: { ...state.urlHealth, [key]: health } })),

  addUrlCandidate: (key, url) =>
    set((state) => {
      const normalized = url.replace(/\/+$/, '')
      const prev = state.urlCandidates[key] ?? []
      if (prev.includes(normalized)) return state
      return { urlCandidates: { ...state.urlCandidates, [key]: [...prev, normalized] } }
    }),

  updateTaskUrl: async (projectId, taskId, url) => {
    const project = get().projects.find((p) => p.id === projectId)
    if (!project) return
    const tasks = project.tasks.map((t) => (t.id === taskId ? { ...t, url } : t))
    const projects = await window.api.saveProject({ ...project, tasks })
    get().setProjects(projects)
  },

  openEdit: (state) => set({ editModal: { open: true, ...state } }),

  closeEdit: () => set({ editModal: { open: false } }),

  setOnboardingOpen: (open) => set({ onboardingOpen: open }),

  markOnboarded: () => {
    const settings = { ...get().settings, onboarded: true }
    set({ settings })
    void window.api.saveSettings(settings).then(get().setSettings)
  }
}))

/** 某项目当前运行中的任务数 */
export function runningCountOf(
  taskStates: Record<string, TaskRuntime>,
  projectId: string
): number {
  return Object.entries(taskStates).filter(
    ([k, v]) => k.startsWith(`${projectId}:`) && v.status === 'running'
  ).length
}

export { taskKey }
