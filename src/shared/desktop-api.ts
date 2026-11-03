import type { ModeSnapshot } from '../core/tree-model/edit-modes'
export const APP_INFO_CHANNEL = 'desktop:app-info'
export const DESKTOP_CHANNELS = {
  open: 'desktop:open-file',
  recent: 'desktop:recent-files',
  openRecent: 'desktop:open-recent',
  save: 'desktop:save-file',
  release: 'desktop:release-file',
  confirm: 'desktop:confirm-unsaved',
  readClipboard: 'desktop:read-clipboard',
  writeClipboard: 'desktop:write-clipboard',
  action: 'desktop:action',
  closeRequest: 'desktop:close-request',
  closeReply: 'desktop:close-reply',
} as const
export type DesktopAction =
  | 'undo'
  | 'redo'
  | 'new'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'copyRaw'
  | 'copyFormatted'
  | 'copyCompact'
  | 'paste'
export const DESKTOP_ACTIONS: readonly DesktopAction[] = [
  'undo',
  'redo',
  'new',
  'open',
  'save',
  'saveAs',
  'copyRaw',
  'copyFormatted',
  'copyCompact',
  'paste',
]
export type DesktopResult<T> =
  | { ok: true; value: T; warning?: string }
  | {
      ok: false
      code:
        | 'cancelled'
        | 'invalid-request'
        | 'unauthorized'
        | 'too-large'
        | 'encoding'
        | 'conflict'
        | 'io'
        | 'busy'
      message: string
    }
export interface FileMetadata {
  modesSaved?: boolean
  fileId: string
  name: string
  path: string
  bom: boolean
  eol: 'LF' | 'CRLF'
}
export interface OpenedFile extends FileMetadata {
  editModes?: ModeSnapshot
  modeWarning?: string
  text: string
}
export interface RecentFile {
  id: string
  name: string
  path: string
}
export interface SaveFileRequest {
  editModes?: ModeSnapshot
  fileId: string | null
  text: string
  saveAs: boolean
}

export interface AppInfo {
  name: string
  version: string
  platform: string
  electron: string
}

export interface DesktopApi {
  getAppInfo: () => Promise<AppInfo & { sandboxed: boolean; contextIsolated: boolean }>
  openFile: () => Promise<DesktopResult<OpenedFile>>
  getRecentFiles: () => Promise<DesktopResult<RecentFile[]>>
  openRecent: (id: string) => Promise<DesktopResult<OpenedFile>>
  saveFile: (request: SaveFileRequest) => Promise<DesktopResult<FileMetadata>>
  releaseFile: (fileId: string) => Promise<void>
  confirmUnsaved: () => Promise<DesktopResult<'save' | 'discard' | 'cancel'>>
  readClipboard: () => Promise<DesktopResult<string>>
  writeClipboard: (text: string) => Promise<DesktopResult<true>>
  onAction: (handler: (action: DesktopAction) => void) => () => void
  onCloseRequested: (handler: (requestId: string) => void) => () => void
  replyClose: (requestId: string, allow: boolean) => Promise<void>
}
