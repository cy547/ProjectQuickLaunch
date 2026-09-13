import path from 'node:path'
import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import { loadConfig } from './store'
import { processManager } from './processes'
import { startProjectTasks, stopProjectTasks } from './projectOps'

let tray: Tray | null = null

function iconImage() {
  // dev 下 appPath = 项目根目录；打包后 = app.asar 根（build/icon.png 已加入 files）
  const iconPath = path.join(app.getAppPath(), 'build', 'icon.png')
  const img = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 })
  return img.isEmpty() ? nativeImage.createEmpty() : img
}

function showWindow(getWindow: () => BrowserWindow | null): void {
  const win = getWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function buildMenu(getWindow: () => BrowserWindow | null): Menu {
  const config = loadConfig()
  const runningKeys = new Set(
    processManager.listRunning().filter((r) => r.mainPid).map((r) => r.projectId)
  )

  const projectItems = config.projects.map((p) => ({
    label: `${p.name}${runningKeys.has(p.id) ? '（运行中）' : ''}`,
    submenu: [
      {
        label: '启动全部任务',
        click: (): void => {
          const messages = startProjectTasks(p.id)
          messages.forEach((m) => console.log(`[托盘启动] ${p.name}: ${m}`))
          showWindow(getWindow)
        }
      },
      {
        label: '全部停止',
        enabled: runningKeys.has(p.id),
        click: (): void => stopProjectTasks(p.id)
      },
      { type: 'separator' as const },
      { label: '打开面板', click: (): void => showWindow(getWindow) }
    ]
  }))

  return Menu.buildFromTemplate([
    ...(projectItems.length > 0 ? projectItems : [{ label: '还没有项目', enabled: false }]),
    { type: 'separator' },
    { label: '显示主窗口', click: (): void => showWindow(getWindow) },
    {
      label: '退出',
      click: (): void => {
        app.quit()
      }
    }
  ])
}

/** 创建系统托盘：左键显示/隐藏主窗口，右键快捷菜单 */
export function createTray(getWindow: () => BrowserWindow | null): void {
  const img = iconImage()
  if (img.isEmpty()) return
  tray = new Tray(img)
  tray.setToolTip('ProjectQuickLaunch — 项目速启')
  tray.on('click', () => {
    const win = getWindow()
    if (win && win.isVisible() && !win.isMinimized()) win.hide()
    else showWindow(getWindow)
  })
  tray.on('right-click', () => {
    tray?.popUpContextMenu(buildMenu(getWindow))
  })
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
