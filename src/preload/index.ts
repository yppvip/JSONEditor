import { contextBridge, ipcRenderer } from 'electron'
import {
  APP_INFO_CHANNEL,
  DESKTOP_CHANNELS as channels,
  DESKTOP_ACTIONS,
} from '../shared/desktop-api'
import type { DesktopApi } from '../shared/desktop-api'

const desktop: DesktopApi = Object.freeze({
  getAppInfo: async () => ({
    ...(await ipcRenderer.invoke(APP_INFO_CHANNEL)),
    sandboxed: process.sandboxed,
    contextIsolated: process.contextIsolated,
  }),
  openFile: () => ipcRenderer.invoke(channels.open),
  getRecentFiles: () => ipcRenderer.invoke(channels.recent),
  openRecent: (id: string) => ipcRenderer.invoke(channels.openRecent, id),
  saveFile: (request: Parameters<DesktopApi['saveFile']>[0]) =>
    ipcRenderer.invoke(channels.save, request),
  releaseFile: (id: string) => ipcRenderer.invoke(channels.release, id),
  confirmUnsaved: () => ipcRenderer.invoke(channels.confirm),
  readClipboard: () => ipcRenderer.invoke(channels.readClipboard),
  writeClipboard: (text: string) => ipcRenderer.invoke(channels.writeClipboard, text),
  onAction: (handler: Parameters<DesktopApi['onAction']>[0]) => {
    const listener = (_event: unknown, value: unknown): void => {
      if (DESKTOP_ACTIONS.includes(value as never)) handler(value as Parameters<typeof handler>[0])
    }
    ipcRenderer.on(channels.action, listener)
    return () => ipcRenderer.removeListener(channels.action, listener)
  },
  onCloseRequested: (handler: (id: string) => void) => {
    const listener = (_event: unknown, value: unknown): void => {
      if (typeof value === 'string' && /^[\da-f-]{36}$/i.test(value)) handler(value)
    }
    ipcRenderer.on(channels.closeRequest, listener)
    return () => ipcRenderer.removeListener(channels.closeRequest, listener)
  },
  replyClose: (id: string, allow: boolean) => ipcRenderer.invoke(channels.closeReply, id, allow),
})

contextBridge.exposeInMainWorld('desktop', desktop)
