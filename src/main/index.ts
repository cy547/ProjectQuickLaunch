import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { registerIpc } from './ipc'
import { processManager } from './processes'
import { healthMonitor } from './health'
import { runSmokeTest } from './smoke'
import { createTray } from './tray'
import { loadConfig } from './store'

let mainWindow: BrowserWindow | null = null
let quitting = false

function getWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

function createWindow(): BrowserWindow {
  const devIcon = path.join(__dirname, '../../build/icon.ico')
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'ProjectQuickLaunch',
    autoHideMenuBar: true,
    ...(fs.existsSync(devIcon) ? { icon: devIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js')
    }
  })

  win.on('ready-to-show', () => win.show())

  // 关闭窗口时最小化到托盘（设置里可关）；真正退出放行
  win.on('close', (e) => {
    if (!quitting && loadConfig().settings.trayOnClose !== false) {
      e.preventDefault()
      win.hide()
    }
  })

  // 外部链接一律交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

const isSmoke = process.argv.includes('--smoke')

// 统一 dev 与打包版的用户数据目录（dev 下 app.name 取自 package.json name，与 productName 不一致）；
// 设置 PQL_USER_DATA_DIR 可隔离出独立实例（用于并行测试）
app.setPath(
  'userData',
  process.env.PQL_USER_DATA_DIR || path.join(app.getPath('appData'), 'ProjectQuickLaunch')
)

if (!isSmoke && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    if (isSmoke) {
      try {
        await runSmokeTest()
      } catch (err) {
        console.error('[SMOKE] crashed:', err)
        process.exitCode = 1
      }
      app.exit(process.exitCode === 1 ? 1 : 0)
      return
    }

    const win = createWindow()
    mainWindow = win
    registerIpc(win)
    createTray(getWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const newWin = createWindow()
        mainWindow = newWin
        registerIpc(newWin)
      }
    })
  })

  app.on('before-quit', () => {
    quitting = true
    healthMonitor.stopAll()
    processManager.stopAll()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
