import type {
  DesktopApi,
  DesktopAction,
  DesktopResult,
  FileMetadata,
  OpenedFile,
  RecentFile,
} from '../../shared/desktop-api'
import { MAX_TEXT_LENGTH } from '../../core/json/limits'

export interface DocumentSnapshot {
  text: string
  revision: number
  historyVersion: number
  composing: boolean
}
export interface DesktopDocumentPort {
  lock: (locked: boolean) => void
  undo?: () => void
  redo?: () => void
  snapshot: () => DocumentSnapshot
  historyVersion: () => number
  load: (text: string) => Promise<void>
  paste: (text: string) => boolean
  transform: (mode: 'format' | 'compact') => Promise<string>
}
export interface FileStatus {
  file: FileMetadata | null
  dirty: boolean
  busy: boolean
  loading: boolean
  message: string
  error: boolean
  recent: readonly RecentFile[]
}
const initial: FileStatus = {
  file: null,
  dirty: false,
  busy: false,
  loading: false,
  message: '',
  error: false,
  recent: [],
}
const unwrap = <T>(result: DesktopResult<T>): T => {
  if (!result.ok) throw new Error(result.message)
  return result.value
}
export class DesktopDocumentSession {
  private status: FileStatus = { ...initial }
  private readonly listeners = new Set<() => void>()
  private baseline = 1
  private generation = 0
  private disposed = false
  private recentRequest = 0
  private port!: DesktopDocumentPort
  constructor(
    private readonly api: DesktopApi,
    port?: DesktopDocumentPort,
  ) {
    if (port) this.port = port
  }
  connect(port: DesktopDocumentPort): void {
    this.port = port
  }
  getSnapshot = (): FileStatus => this.status
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private publish(update: Partial<FileStatus>): void {
    if (this.disposed) return
    this.status = { ...this.status, ...update }
    this.listeners.forEach((listener) => listener())
  }
  activate(): void {
    this.disposed = false
  }
  dispose(): void {
    this.disposed = true
    this.generation++
    this.recentRequest++
  }
  attached(historyVersion: number): void {
    this.baseline = historyVersion
    this.publish({ dirty: false })
  }
  observe(historyVersion: number): void {
    if (!this.status.loading && this.status.dirty !== (historyVersion !== this.baseline))
      this.publish({
        dirty: historyVersion !== this.baseline,
        message: this.status.error ? this.status.message : '',
      })
  }
  async refreshRecent(): Promise<void> {
    const request = ++this.recentRequest
    try {
      const result = await this.api.getRecentFiles()
      if (request === this.recentRequest && result.ok) this.publish({ recent: result.value })
    } catch {
      /* File content does not depend on history metadata. */
    }
  }
  private marker(): string {
    const value = this.port.snapshot()
    return `${this.generation}:${value.revision}:${value.historyVersion}`
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.disposed || this.status.busy || this.status.loading) return
    this.publish({ busy: true, message: '', error: false })
    try {
      await action()
    } catch (error) {
      this.publish({
        message: error instanceof Error ? error.message : '桌面操作失败，当前文本已保留。',
        error: true,
      })
    } finally {
      this.publish({ busy: false, loading: false })
    }
  }
  private snapshot(): DocumentSnapshot {
    const snapshot = this.port.snapshot()
    if (snapshot.composing) throw new Error('请先完成输入法组合输入。')
    if (snapshot.text.length > MAX_TEXT_LENGTH) throw new Error('文本超过 20 Mi 字符，操作已取消。')
    return snapshot
  }
  private inputReady(): void {
    if (this.port.snapshot().composing) throw new Error('请先完成输入法组合输入。')
  }
  private async saveInternal(saveAs: boolean): Promise<boolean> {
    const snapshot = this.snapshot(),
      generation = this.generation
    const result = await this.api.saveFile({
      fileId: this.status.file?.fileId ?? null,
      text: snapshot.text,
      saveAs,
    })
    if (this.disposed || generation !== this.generation) return false
    if (!result.ok && result.code === 'cancelled') return false
    const file = unwrap(result)
    this.baseline = snapshot.historyVersion
    const dirty = this.port.historyVersion() !== this.baseline
    this.publish({
      file,
      dirty,
      message:
        result.ok && result.warning
          ? result.warning
          : dirty
            ? '已保存操作开始时的版本，当前仍有未保存修改。'
            : '已保存当前文本。',
      error: false,
    })
    void this.refreshRecent()
    return !this.status.dirty
  }
  private async mayDiscard(): Promise<boolean> {
    if (!this.status.dirty) return true
    const marker = this.marker(),
      result = unwrap(await this.api.confirmUnsaved())
    if (this.disposed) return false
    if (marker !== this.marker()) throw new Error('确认期间文档发生变化，请重试；当前文本已保留。')
    if (result === 'cancel') return false
    return result === 'discard' ? true : this.saveInternal(false)
  }
  private async install(text: string, file: FileMetadata | null): Promise<void> {
    const previous = this.status.file
    this.publish({ loading: true })
    this.port.lock(true)
    ++this.generation
    try {
      await this.port.load(text)
    } catch (error) {
      this.port.lock(false)
      throw error
    }
    this.baseline = this.port.historyVersion()
    this.publish({
      file,
      dirty: false,
      loading: false,
      message: file ? '文件已打开。' : '已新建文档。',
      error: false,
    })
    if (previous && previous.fileId !== file?.fileId)
      await this.api.releaseFile(previous.fileId).catch(() => {})
  }
  async dispatch(action: DesktopAction): Promise<void> {
    if (action === 'undo' || action === 'redo') {
      if (!this.status.loading && !this.disposed) this.port[action]?.()
      return
    }
    if (action === 'open') return this.open()
    if (action === 'new')
      return this.run(async () => {
        this.inputReady()
        if (await this.mayDiscard()) await this.install('{}\n', null)
      })
    if (action === 'save' || action === 'saveAs')
      return this.run(async () => {
        await this.saveInternal(action === 'saveAs')
      })
    if (action === 'paste')
      return this.run(async () => {
        this.inputReady()
        const marker = this.marker(),
          text = unwrap(await this.api.readClipboard())
        if (this.disposed) return
        if (marker !== this.marker()) throw new Error('读取剪贴板期间文档已变化，请重试。')
        if (text.length > MAX_TEXT_LENGTH || !this.port.paste(text))
          throw new Error('剪贴板文本超限或文档暂不可编辑，原文已保留。')
        this.publish({ message: '剪贴板已替换全文，可撤销。' })
      })
    return this.run(async () => {
      const snapshot = this.snapshot(),
        marker = this.marker()
      const text =
        action === 'copyRaw'
          ? snapshot.text
          : await this.port.transform(action === 'copyFormatted' ? 'format' : 'compact')
      if (this.disposed) return
      if (marker !== this.marker()) throw new Error('文档已变化，复制已取消。')
      unwrap(await this.api.writeClipboard(text))
      this.publish({ message: '已复制当前文本。' })
    })
  }
  async open(recentId?: string): Promise<void> {
    return this.run(async () => {
      this.inputReady()
      if (!(await this.mayDiscard())) return
      const marker = this.marker()
      const result = recentId ? await this.api.openRecent(recentId) : await this.api.openFile()
      if (!result.ok && result.code === 'cancelled') return
      const opened: OpenedFile = unwrap(result)
      if (this.disposed || marker !== this.marker()) {
        await this.api.releaseFile(opened.fileId).catch(() => {})
        if (!this.disposed) throw new Error('打开期间文档已变化，未覆盖当前文本；请重试。')
        return
      }
      const { text, ...metadata } = opened
      try {
        await this.install(text, metadata)
      } catch (error) {
        await this.api.releaseFile(opened.fileId).catch(() => {})
        throw error
      }
      if (result.ok && result.warning) this.publish({ message: result.warning })
      void this.refreshRecent()
    })
  }
  async requestClose(requestId: string): Promise<void> {
    if (this.status.busy || this.disposed) {
      await this.api.replyClose(requestId, false).catch(() => {})
      return
    }
    let allow = false
    await this.run(async () => {
      this.inputReady()
      allow = await this.mayDiscard()
    })
    if (allow) {
      this.port.lock(true)
      this.publish({ busy: true, loading: true })
    }
    try {
      await this.api.replyClose(requestId, allow)
    } catch {
      if (allow) {
        this.port.lock(false)
        this.publish({ busy: false, loading: false })
      }
    }
  }
}
