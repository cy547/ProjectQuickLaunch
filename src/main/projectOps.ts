import { BrowserWindow } from 'electron'
import { healthMonitor } from './health'
import { processManager } from './processes'
import { buildEnvForManaged } from './runtimes'
import { loadConfig } from './store'
import { taskKey } from '../shared/types'

/** 为任务构建托管运行环境的注入变量 */
export function managedEnvForTasks(): { managedPaths: string[]; javaHome?: string } {
  return buildEnvForManaged(loadConfig().settings.managedRuntimes)
}

function sender(): { send(channel: string, ...args: unknown[]): void } | undefined {
  const win = BrowserWindow.getAllWindows()[0]
  return win && !win.isDestroyed() ? win.webContents : undefined
}

/** 主进程侧直接启动一个项目的全部任务（托盘快捷操作用，不做预检） */
export function startProjectTasks(projectId: string): string[] {
  const config = loadConfig()
  const project = config.projects.find((p) => p.id === projectId)
  if (!project) return [`项目不存在（${projectId}）`]

  const messages: string[] = []
  const senderRef = sender()
  for (const task of project.tasks) {
    const result = processManager.start(project, task, managedEnvForTasks())
    if (result.ok && task.url && senderRef) {
      healthMonitor.start(taskKey(project.id, task.id), task.url, senderRef)
    }
    messages.push(result.ok ? `✅ ${task.name}` : `⚠️ ${task.name}：${result.message ?? '启动失败'}`)
  }
  return messages
}

/** 主进程侧停止一个项目的全部运行中任务 */
export function stopProjectTasks(projectId: string): void {
  for (const ref of processManager.listRunning()) {
    if (ref.projectId === projectId) {
      healthMonitor.stop(ref.key)
      void processManager.stop(ref.projectId, ref.taskId)
    }
  }
}
