import { AUTOMATIC_VALIDATION_LIMIT, MAX_TEXT_LENGTH, textLimitDiagnostic } from '../json/limits'
import type { ParseDiagnostic, TextEdit } from './contracts'
import type { JsonTreeProjection } from '../tree-model/model'
import type { TreeCommand } from '../commands/tree-commands'
import type {
  JsonWorkerRequest,
  JsonWorkerResponse,
  JsonWorkerTransport,
} from '../../shared/json-worker-protocol'

export interface DocumentBuffer {
  getText: () => string
  getLength: () => number
  applyEdits: (edits: readonly TextEdit[], origin?: 'format' | 'tree') => void
  setDiagnostics: (diagnostics: readonly ParseDiagnostic[]) => void
}

export interface DocumentStatus {
  revision: number
  state: 'waiting' | 'pending' | 'validating' | 'valid' | 'invalid' | 'manual' | 'failed'
  workerReady: boolean
  largeFile: boolean
  diagnostics: readonly ParseDiagnostic[]
  diagnosticsTruncated: boolean
  durationMs: number | null
  message: string
  tree: JsonTreeProjection | null
  treeMessage: string
  treeError: string
}

export const initialDocumentStatus: DocumentStatus = {
  revision: 0,
  state: 'waiting',
  workerReady: false,
  largeFile: false,
  diagnostics: [],
  diagnosticsTruncated: false,
  durationMs: null,
  message: '',
  tree: null,
  treeMessage: '',
  treeError: '',
}

export class TextDocumentSession {
  private snapshot: DocumentStatus = { ...initialDocumentStatus }
  private readonly listeners = new Set<() => void>()
  private transport!: JsonWorkerTransport
  private inFlight: JsonWorkerRequest | null = null
  private queued: JsonWorkerRequest['action'] | null = null
  private debounce: ReturnType<typeof setTimeout> | null = null
  private timeout: ReturnType<typeof setTimeout> | null = null
  private requestId = 0
  private generation = 0
  private disposed = false
  private composing = false

  constructor(
    private readonly documentId: string,
    private readonly buffer: DocumentBuffer,
    private readonly createTransport: () => JsonWorkerTransport,
    private readonly debounceMs = 300,
    private readonly timeoutMs = 15_000,
  ) {
    this.snapshot.largeFile = buffer.getLength() > AUTOMATIC_VALIDATION_LIMIT
    this.startWorker()
  }

  getSnapshot = (): DocumentStatus => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(update: Partial<DocumentStatus>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...update }
    this.listeners.forEach((listener) => listener())
  }

  private startWorker(): void {
    const generation = ++this.generation
    try {
      this.transport = this.createTransport()
    } catch {
      this.fail('后台启动失败；原文已保留，可重试后台。')
      return
    }
    this.transport.onMessage((response) => {
      if (!this.disposed && generation === this.generation) this.receive(response)
    })
    this.transport.onFailure(() => {
      if (!this.disposed && generation === this.generation)
        this.fail('后台校验不可用；原文已保留。')
    })
    this.armTimeout()
  }

  changed(): void {
    if (this.disposed) return
    this.queued = null
    this.clearDebounce()
    const largeFile = this.buffer.getLength() > AUTOMATIC_VALIDATION_LIMIT
    this.buffer.setDiagnostics([])
    this.publish({
      revision: this.snapshot.revision + 1,
      diagnostics: [],
      diagnosticsTruncated: false,
      durationMs: null,
      largeFile,
      treeError: '',
      treeMessage: '',
      state: this.snapshot.state === 'failed' ? 'failed' : largeFile ? 'manual' : 'pending',
    })
    if (!largeFile && this.snapshot.state !== 'failed' && !this.composing) this.schedule()
  }

  setComposing(composing: boolean): void {
    this.composing = composing
    if (composing) {
      this.clearDebounce()
      this.queued = null
    } else if (!this.snapshot.largeFile && this.snapshot.state !== 'failed') this.schedule()
  }

  private schedule(): void {
    this.clearDebounce()
    this.debounce = setTimeout(() => {
      this.debounce = null
      this.request('validate')
    }, this.debounceMs)
  }

  editTree(command: TreeCommand, baseRevision: number): boolean {
    const tree = this.snapshot.tree
    if (
      this.disposed ||
      this.composing ||
      this.inFlight ||
      this.snapshot.state !== 'valid' ||
      !tree?.editable ||
      tree.revision !== baseRevision ||
      baseRevision !== this.snapshot.revision
    ) {
      this.publish({ treeError: '文档已变化或树不可编辑，请等待校验完成。' })
      return false
    }
    this.request('tree', command)
    return true
  }

  request(action: JsonWorkerRequest['action'], command?: TreeCommand): void {
    if (this.disposed || this.composing || this.snapshot.state === 'failed') return
    this.clearDebounce()
    if (this.buffer.getLength() > MAX_TEXT_LENGTH) {
      const diagnostics = [textLimitDiagnostic()]
      this.buffer.setDiagnostics(diagnostics)
      this.publish({ state: 'invalid', diagnostics, diagnosticsTruncated: false, durationMs: null })
      return
    }
    if (!this.snapshot.workerReady || this.inFlight) {
      if (action === 'tree') return
      this.queued = action
      return
    }
    const request: JsonWorkerRequest = {
      documentId: this.documentId,
      revision: this.snapshot.revision,
      requestId: ++this.requestId,
      action,
      text: this.buffer.getText(),
      ...(command ? { command } : {}),
    }
    this.inFlight = request
    this.publish({ state: 'validating', message: '', treeError: '' })
    this.armTimeout()
    try {
      this.transport.send(request)
    } catch {
      this.fail('无法发送后台请求；原文已保留。')
    }
  }

  private receive(response: JsonWorkerResponse): void {
    if (response.kind === 'ready') {
      if (this.snapshot.workerReady) return
      this.clearTimeout()
      this.publish({ workerReady: true, state: this.snapshot.largeFile ? 'manual' : 'pending' })
      const action = this.queued
      this.queued = null
      if (action) this.request(action)
      else if (!this.snapshot.largeFile && !this.composing) this.request('validate')
      return
    }
    const current = this.inFlight
    if (
      !current ||
      response.documentId !== this.documentId ||
      response.requestId !== current.requestId ||
      response.revision !== current.revision ||
      (response.kind === 'result' && response.action !== current.action)
    )
      return
    this.inFlight = null
    this.clearTimeout()
    if (response.revision === this.snapshot.revision && !this.composing) {
      if (response.kind === 'failure') {
        this.fail(response.message)
        return
      }
      if (
        (response.action === 'format' || response.action === 'tree') &&
        response.analysis.valid &&
        response.edits.length &&
        !response.commandError
      ) {
        // The adapter's model event increments revision synchronously. Never replace all text.
        this.queued = null
        this.buffer.applyEdits(response.edits, response.action)
        this.request('validate')
        return
      }
      this.buffer.setDiagnostics(response.analysis.diagnostics)
      this.publish({
        state: response.analysis.valid ? 'valid' : 'invalid',
        diagnostics: response.analysis.diagnostics,
        diagnosticsTruncated: response.analysis.diagnosticsTruncated,
        durationMs: response.durationMs,
        ...(response.tree !== undefined
          ? { tree: response.tree ?? this.snapshot.tree, treeMessage: response.treeMessage ?? '' }
          : {}),
        treeError: response.commandError ?? '',
      })
    }
    const action = this.queued
    this.queued = null
    if (action) this.request(action)
  }

  restart(): void {
    if (this.disposed) return
    this.transport?.dispose()
    this.clearDebounce()
    this.clearTimeout()
    this.inFlight = null
    this.queued = null
    this.publish({ state: 'waiting', workerReady: false, message: '', diagnostics: [] })
    this.buffer.setDiagnostics([])
    this.startWorker()
  }

  private fail(message: string): void {
    this.clearDebounce()
    this.clearTimeout()
    this.inFlight = null
    this.queued = null
    ++this.generation
    this.transport?.dispose()
    this.publish({
      state: 'failed',
      workerReady: false,
      message,
      diagnostics: [],
      durationMs: null,
    })
    this.buffer.setDiagnostics([])
  }
  private armTimeout(): void {
    this.clearTimeout()
    this.timeout = setTimeout(
      () => this.fail('后台处理超时；原文已保留，可重试后台。'),
      this.timeoutMs,
    )
  }
  private clearTimeout(): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = null
  }
  private clearDebounce(): void {
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = null
  }
  dispose(): void {
    this.disposed = true
    this.clearDebounce()
    this.clearTimeout()
    this.transport?.dispose()
    this.listeners.clear()
  }
}
