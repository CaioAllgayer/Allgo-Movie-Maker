import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { registerAllgoProtocol, registerAllgoScheme } from './protocol'
import { registerIpc } from './ipc'
import { cancelAllExports } from './ffmpeg/export'

registerAllgoScheme()

// Uma instância só: abrir um .allgo pelo Explorer não deve subir outro editor.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#111114',
    autoHideMenuBar: true,
    title: 'Allgo Movie Maker',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Necessário para o <video> aceitar seek suave em arquivos grandes.
      backgroundThrottling: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // ALLGO_DEBUG=1 espelha o console do renderer no terminal — sem isso, um erro
  // de React só aparece se você abrir o DevTools.
  if (process.env['ALLGO_DEBUG']) {
    mainWindow.webContents.on('console-message', (_event, _level, message, line, source) => {
      console.log(`[renderer] ${message} (${source}:${line})`)
    })
    mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
      console.error(`[renderer] falha ao carregar: ${code} ${description}`)
    })
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('[renderer] processo morreu:', details.reason)
    })
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerAllgoProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  cancelAllExports()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  cancelAllExports()
})
