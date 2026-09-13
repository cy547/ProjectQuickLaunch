import path from 'node:path'
import fs from 'node:fs'
import { app, BrowserWindow, Notification } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC } from '../shared/types'

export interface UpdaterEvent {
  event: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

let downloadedVersion: string | null = null

function emit(win: BrowserWindow | null, payload: UpdaterEvent): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.EventUpdater, payload)
  }
}

function appIcon(): string | undefined {
  const icon = path.join(app.getAppPath(), 'build', 'icon.png')
  return fs.existsSync(icon) ? icon : undefined
}

function systemNotify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, icon: appIcon() })
  n.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
  n.show()
}

/**
 * 初始化自动更新：仅打包版生效（dev 没有 app-update.yml）。
 * 启动 15s 后静默检查一次；下载完成后系统通知，重启应用自动安装。
 */
export function initUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => emit(getWindow(), { event: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    downloadedVersion = null
    emit(getWindow(), {
      event: 'available',
      version: info.version,
      message: `发现新版本 v${info.version}，正在后台下载…`
    })
  })
  autoUpdater.on('update-not-available', () => {
    emit(getWindow(), {
      event: 'not-available',
      version: app.getVersion(),
      message: `当前已是最新版本 v${app.getVersion()}`
    })
  })
  autoUpdater.on('download-progress', (p) => {
    emit(getWindow(), { event: 'downloading', percent: p.percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = info.version
    emit(getWindow(), {
      event: 'downloaded',
      version: info.version,
      message: `v${info.version} 下载完成，重启应用即可安装`
    })
    systemNotify(`v${info.version} 已就绪`, '重启应用即可完成安装')
  })
  autoUpdater.on('error', (err) => {
    downloadedVersion = null
    emit(getWindow(), { event: 'error', message: String(err?.message ?? err).slice(0, 160) })
  })

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      /* 网络不通时静默（GitHub 直连可能被墙） */
    })
  }, 15000)
}

/** 手动检查更新（设置页按钮） */
export function checkForUpdatesNow(getWindow: () => BrowserWindow | null): UpdaterEvent {
  if (!app.isPackaged) {
    return { event: 'error', message: '开发模式下不可用，请使用安装版' }
  }
  autoUpdater
    .checkForUpdates()
    .catch((err) => emit(getWindow(), { event: 'error', message: String(err?.message ?? err).slice(0, 160) }))
  return { event: 'checking', message: '正在检查更新…' }
}

/** 安装已下载的更新（重启应用） */
export function installDownloadedUpdate(): { ok: boolean; message?: string } {
  if (!downloadedVersion) {
    return { ok: false, message: '还没有下载完成的更新' }
  }
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
  return { ok: true, message: `正在安装 v${downloadedVersion}…` }
}
