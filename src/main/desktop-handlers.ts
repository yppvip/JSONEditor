import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu } from 'electron'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { DESKTOP_CHANNELS as channels } from '../shared/desktop-api'
import type {
  DesktopAction,
  DesktopResult,
  FileMetadata,
  OpenedFile,
  SaveFileRequest,
} from '../shared/desktop-api'
import { MAX_TEXT_LENGTH } from '../core/json/limits'
import { isTrustedFrame } from './security'
import { FileService, RecentFiles, FileError } from './file-service'
import { desktopShortcut } from '../shared/desktop-shortcuts'

const idPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const isId = (value: unknown): value is string => typeof value === 'string' && idPattern.test(value)
const cancelled = { ok: false as const, code: 'cancelled' as const, message: '操作已取消。' }
export function validSaveRequest(value: unknown): value is SaveFileRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const object = value as Record<string, unknown>
  return (
    Object.keys(object).sort().join(',') === 'fileId,saveAs,text' &&
    (object.fileId === null || isId(object.fileId)) &&
    typeof object.text === 'string' &&
    typeof object.saveAs === 'boolean'
  )
}
export class DesktopHandlers {
  readonly files = new FileService(
    new RecentFiles(() => join(app.getPath('userData'), 'recent-files.json')),
  )
  private readonly busy = new Set<number>()
  private readonly closing = new Map<number, string>()
  private readonly approved = new Set<number>()
  constructor(private readonly rendererUrl: string) {}
  private owner(event: IpcMainInvokeEvent): BrowserWindow {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (
      !window ||
      !isTrustedFrame(
        event.senderFrame?.url,
        this.rendererUrl,
        event.senderFrame === event.sender.mainFrame,
      )
    )
      throw new FileError('unauthorized', '不允许该页面访问桌面接口。')
    return window
  }
  private handle<T>(
    channel: string,
    validate: (args: unknown[]) => boolean,
    operation: (
      window: BrowserWindow,
      args: unknown[],
    ) => Promise<DesktopResult<T>> | DesktopResult<T>,
    exclusive = false,
  ): void {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<DesktopResult<T>> => {
      let owner: number | undefined
      let acquired = false
      try {
        const window = this.owner(event)
        if (!validate(args))
          return { ok: false, code: 'invalid-request', message: '桌面请求参数无效。' }
        owner = window.webContents.id
        if (exclusive && this.busy.has(owner))
          return { ok: false, code: 'busy', message: '文件操作正在进行，请稍后重试。' }
        if (exclusive) {
          this.busy.add(owner)
          acquired = true
        }
        return await operation(window, args)
      } catch (error) {
        return {
          ok: false,
          code: error instanceof FileError ? error.code : 'io',
          message:
            error instanceof FileError
              ? error.message
              : '桌面操作失败；当前文本已保留，请检查文件权限、位置或磁盘空间后重试。',
        }
      } finally {
        if (acquired && owner !== undefined) this.busy.delete(owner)
      }
    })
  }
  private async remember<T extends FileMetadata>(value: T): Promise<DesktopResult<T>> {
    try {
      await this.files.recent.add(value.path)
      return { ok: true, value }
    } catch {
      return { ok: true, value, warning: '文件操作成功，但最近文件记录写入失败。' }
    }
  }
  register(): void {
    const none = (args: unknown[]): boolean => args.length === 0
    this.handle<OpenedFile>(
      channels.open,
      none,
      async (window) => {
        const result = await dialog.showOpenDialog(window, {
          properties: ['openFile'],
          filters: [
            { name: 'JSON / 文本', extensions: ['json', 'jsonc', 'txt'] },
            { name: '所有文件', extensions: ['*'] },
          ],
        })
        if (result.canceled || !result.filePaths[0]) return cancelled
        return this.remember(await this.files.open(window.webContents.id, result.filePaths[0]))
      },
      true,
    )
    this.handle(channels.recent, none, async () => ({
      ok: true,
      value: await this.files.recent.list(),
    }))
    this.handle<OpenedFile>(
      channels.openRecent,
      (args) => args.length === 1 && isId(args[0]),
      async (window, args) => {
        const file = (await this.files.recent.list()).find((item) => item.id === args[0])
        if (!file) throw new FileError('unauthorized', '最近文件记录已失效，请使用打开文件。')
        return this.remember(await this.files.open(window.webContents.id, file.path))
      },
      true,
    )
    this.handle<FileMetadata>(
      channels.save,
      (args) => args.length === 1 && validSaveRequest(args[0]),
      async (window, args) => {
        const request = args[0] as SaveFileRequest
        const existing = request.fileId
          ? this.files.metadata(window.webContents.id, request.fileId)
          : null
        if (request.text.length > MAX_TEXT_LENGTH)
          throw new FileError('too-large', '文本超过保存上限，未写入文件。')
        let selected: string | undefined
        if (request.saveAs || !request.fileId) {
          const result = await dialog.showSaveDialog(window, {
            defaultPath: existing?.path ?? '未命名.json',
            filters: [
              { name: 'JSON', extensions: ['json'] },
              { name: '所有文件', extensions: ['*'] },
            ],
            properties: ['showOverwriteConfirmation', 'createDirectory'],
          })
          if (result.canceled || !result.filePath) return cancelled
          selected = result.filePath
        }
        return this.remember(
          await this.files.save(window.webContents.id, request.fileId, request.text, selected),
        )
      },
      true,
    )
    this.handle(
      channels.confirm,
      none,
      async (window) => {
        const result = await dialog.showMessageBox(window, {
          type: 'question',
          buttons: ['保存', '不保存', '取消'],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
          message: '当前文档有未保存的修改。',
          detail: '继续前是否保存当前文本？非法 JSON 也可按原文保存。',
        })
        return {
          ok: true,
          value: result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel',
        }
      },
      true,
    )
    this.handle(channels.readClipboard, none, async () => {
      const text = await clipboard.readText()
      if (text.length > MAX_TEXT_LENGTH)
        throw new FileError('too-large', '剪贴板文本超过 20 Mi 字符，未载入。')
      return { ok: true, value: text }
    })
    this.handle(
      channels.writeClipboard,
      (args) => args.length === 1 && typeof args[0] === 'string',
      async (_window, args) => {
        const text = args[0] as string
        if (text.length > MAX_TEXT_LENGTH)
          throw new FileError('too-large', '复制文本超过 20 Mi 字符，剪贴板未改写。')
        await clipboard.writeText(text)
        return { ok: true, value: true }
      },
    )
    ipcMain.handle(channels.release, (event, ...args: unknown[]) => {
      const window = this.owner(event)
      if (args.length !== 1 || !isId(args[0])) throw new Error('Invalid release request')
      this.files.release(window.webContents.id, args[0])
    })
    ipcMain.handle(channels.closeReply, (event, ...args: unknown[]) => {
      const window = this.owner(event),
        owner = window.webContents.id
      if (
        args.length !== 2 ||
        !isId(args[0]) ||
        typeof args[1] !== 'boolean' ||
        this.closing.get(owner) !== args[0]
      )
        throw new Error('Invalid close reply')
      this.closing.delete(owner)
      if (args[1]) {
        this.approved.add(owner)
        window.close()
      }
    })
    const send = (action: DesktopAction): void => {
      const window = BrowserWindow.getFocusedWindow()
      if (window) this.send(window, action)
    }
    const item = (
      label: string,
      action: DesktopAction,
      accelerator: string,
    ): MenuItemConstructorOptions => ({ label, accelerator, click: () => send(action) })
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: '文件',
          submenu: [
            item('新建', 'new', 'CmdOrCtrl+N'),
            item('打开…', 'open', 'CmdOrCtrl+O'),
            item('保存', 'save', 'CmdOrCtrl+S'),
            item('另存为…', 'saveAs', 'CmdOrCtrl+Shift+S'),
            { type: 'separator' },
            { role: 'quit', label: '退出' },
          ],
        },
        {
          label: '编辑',
          submenu: [
            { label: '撤销文档操作', click: () => send('undo') },
            { label: '重做文档操作', click: () => send('redo') },
            { type: 'separator' },
            { role: 'cut', label: '剪切' },
            { role: 'copy', label: '复制选区' },
            { role: 'paste', label: '粘贴选区' },
            { role: 'selectAll', label: '全选' },
            { type: 'separator' },
            item('复制全文', 'copyRaw', 'CmdOrCtrl+Shift+C'),
            item('复制格式化 JSON', 'copyFormatted', 'CmdOrCtrl+Alt+C'),
            item('复制压缩 JSON', 'copyCompact', 'CmdOrCtrl+Alt+M'),
            item('剪贴板替换全文', 'paste', 'CmdOrCtrl+Alt+V'),
          ],
        },
      ]),
    )
  }
  send(window: BrowserWindow, action: DesktopAction): void {
    window.webContents.send(channels.action, action)
  }
  attach(window: BrowserWindow): void {
    const owner = window.webContents.id
    window.on('close', (event) => {
      if (this.approved.has(owner)) return
      event.preventDefault()
      if (this.closing.has(owner)) return
      const requestId = randomUUID()
      this.closing.set(owner, requestId)
      window.webContents.send(channels.closeRequest, requestId)
    })
    window.once('closed', () => {
      this.files.releaseOwner(owner)
      this.closing.delete(owner)
      this.approved.delete(owner)
      this.busy.delete(owner)
    })
    window.webContents.on('before-input-event', (event, input) => {
      if (
        input.type !== 'keyDown' ||
        input.isAutoRepeat ||
        !(input.control || input.meta) ||
        input.isComposing
      )
        return
      const action = desktopShortcut(input)
      if (action) {
        event.preventDefault()
        this.send(window, action)
      }
    })
  }
}
