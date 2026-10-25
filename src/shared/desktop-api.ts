export const APP_INFO_CHANNEL = 'desktop:app-info'

export interface AppInfo {
  name: string
  version: string
  platform: string
  electron: string
}

export interface DesktopApi {
  getAppInfo: () => Promise<AppInfo & { sandboxed: boolean; contextIsolated: boolean }>
}
