import { app, BrowserWindow, ipcMain, net, protocol, session } from 'electron'
import { join, isAbsolute } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { APP_INFO_CHANNEL } from '../shared/desktop-api'
import type { AppInfo } from '../shared/desktop-api'
import {
  APPLICATION_URL,
  contentSecurityPolicy,
  isTrustedFrame,
  resolveApplicationAsset,
} from './security'
import { DesktopHandlers } from './desktop-handlers'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

const developmentUrl =
  !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).href
    : undefined
const rendererUrl = developmentUrl ?? APPLICATION_URL
const policy = contentSecurityPolicy(developmentUrl ? new URL(developmentUrl).origin : undefined)
const desktop = new DesktopHandlers(rendererUrl)

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererUrl) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  desktop.attach(window)
  await window.loadURL(rendererUrl)
}

app
  .whenReady()
  .then(async () => {
    const profile = app.commandLine.getSwitchValue('user-data-dir')
    if (profile && isAbsolute(profile)) {
      await mkdir(profile, { recursive: true })
      app.setPath('userData', profile)
    }
    app.setAppUserModelId('io.jsoneditor.desktop')
    const rendererRoot = join(__dirname, '../renderer')
    protocol.handle('app', async (request) => {
      const asset = resolveApplicationAsset(request.url, rendererRoot)
      if (request.method !== 'GET' || !asset) return new Response(null, { status: 403 })
      try {
        return await net.fetch(pathToFileURL(asset).toString())
      } catch {
        return new Response(null, { status: 404 })
      }
    })
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] },
      })
    })
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    )
    session.defaultSession.setPermissionCheckHandler(() => false)
    ipcMain.handle(APP_INFO_CHANNEL, (event, ...args: unknown[]): AppInfo => {
      if (
        args.length !== 0 ||
        !isTrustedFrame(
          event.senderFrame?.url,
          rendererUrl,
          event.senderFrame === event.sender.mainFrame,
        )
      )
        throw new Error('Unauthorized desktop request')
      return {
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
        electron: process.versions.electron,
      }
    })
    desktop.register()
    await createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  })
  .catch((error: unknown) => {
    console.error('Application startup failed:', error)
    app.exit(1)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
