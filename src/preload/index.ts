import { contextBridge, ipcRenderer } from 'electron'
import { APP_INFO_CHANNEL } from '../shared/desktop-api'
import type { DesktopApi } from '../shared/desktop-api'

const desktop: DesktopApi = Object.freeze({
  getAppInfo: async () => ({
    ...(await ipcRenderer.invoke(APP_INFO_CHANNEL)),
    sandboxed: process.sandboxed,
    contextIsolated: process.contextIsolated,
  }),
})

contextBridge.exposeInMainWorld('desktop', desktop)
