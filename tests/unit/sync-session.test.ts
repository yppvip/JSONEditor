import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TextDocumentSession } from '../../src/core/document/text-session'
import { MAX_CHANGE_RECORDS } from '../../src/core/document/change-map'
import type { SourceChange } from '../../src/core/document/change-map'
import type { TextEdit } from '../../src/core/document/contracts'
import { applySourceEdits } from '../../src/core/commands/tree-commands'
import { JsonDocumentEngine } from '../../src/core/tree-model/document-engine'
import type {
  JsonWorkerRequest,
  JsonWorkerResponse,
  JsonWorkerTransport,
} from '../../src/shared/json-worker-protocol'

class ControlledWorker implements JsonWorkerTransport {
  requests: JsonWorkerRequest[] = []
  receive: (message: JsonWorkerResponse) => void = () => {}
  failure: () => void = () => {}
  disposed = false
  readonly engine: JsonDocumentEngine
  constructor(prefix: string) {
    this.engine = new JsonDocumentEngine(prefix)
  }
  send = (request: JsonWorkerRequest): void => {
    this.requests.push(request)
  }
  onMessage = (handler: typeof this.receive): void => {
    this.receive = handler
  }
  onFailure = (handler: () => void): void => {
    this.failure = handler
  }
  dispose = (): void => {
    this.disposed = true
  }
  ready(): void {
    this.receive({ kind: 'ready' })
  }
  finish(request = this.requests.at(-1)!): void {
    this.receive(this.engine.execute(request))
  }
}

function harness(
  mode: 'normal' | 'reject' | 'throw' | 'silent' | 'corrupt' = 'normal',
  lengthOverride?: number,
) {
  let source = '{"a":1,"b":[2,3]}'
  let historyVersion = 1
  const workers: ControlledWorker[] = []
  const apply = vi.fn((edits: readonly TextEdit[]) => {
    if (mode === 'throw') throw new Error('Editor disposed')
    if (mode === 'reject') return false
    source = applySourceEdits(source, edits)
    if (mode === 'silent') return true
    if (mode === 'corrupt') source = 'null'
    historyVersion++
    session.changed(
      edits.map((edit) => ({
        offset: edit.offset,
        length: edit.length,
        insertedLength: edit.text.length,
      })),
    )
    return true
  })
  const session = new TextDocumentSession(
    'doc',
    {
      getText: () => source,
      getLength: () => lengthOverride ?? source.length,
      getHistoryVersion: () => historyVersion,
      applyEdits: apply,
      setDiagnostics: () => {},
    },
    () => {
      const worker = new ControlledWorker(`generation-${workers.length}`)
      workers.push(worker)
      return worker
    },
  )
  return {
    session,
    workers,
    apply,
    source: () => source,
    replace: (text: string, notify = true) => {
      const oldLength = source.length
      source = text
      historyVersion++
      if (notify) session.changed([{ offset: 0, length: oldLength, insertedLength: text.length }])
    },
    changed: (changes?: readonly SourceChange[]) => session.changed(changes),
    start: () => {
      workers[0]!.ready()
      if (!workers[0]!.requests.length) session.request('validate')
      workers[0]!.finish()
      return workers[0]!
    },
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('synchronization races and transaction boundaries', () => {
  it('accepts a compact scalar response without transferring a full node table', () => {
    const h = harness()
    const worker = h.start()
    const before = h.session.getSnapshot().tree!
    h.session.editTree({ kind: 'update', nodeId: before.nodes[1]!.id, valueText: '9' }, 0)
    worker.finish()
    const { tree: full, ...compact } = worker.engine.execute(worker.requests.at(-1)!)
    expect(full).toBeDefined()
    expect(compact.treePatch).toBeDefined()
    worker.receive(compact)
    expect(h.session.getSnapshot().state).toBe('valid')
    expect(h.session.getSnapshot().tree?.nodes[1]?.preview).toBe('9')
    expect(h.session.getSnapshot().tree?.nodes[0]).toBe(before.nodes[0])
    expect(h.apply).toHaveBeenCalledOnce()
    h.session.dispose()
  })
  it('stops on a compact patch with an incompatible base and preserves committed text', () => {
    const h = harness()
    const worker = h.start()
    const tree = h.session.getSnapshot().tree!
    h.session.editTree({ kind: 'update', nodeId: tree.nodes[1]!.id, valueText: '9' }, 0)
    worker.finish()
    const response = worker.engine.execute(worker.requests.at(-1)!)
    worker.receive({ ...response, treePatch: { ...response.treePatch!, baseRevision: 99 } })
    expect(h.session.getSnapshot().state).toBe('failed')
    expect(h.source()).toBe('{"a":9,"b":[2,3]}')
    h.session.dispose()
  })
  it('returns large documents to manual mode when composition consumes an in-flight result', () => {
    const h = harness('normal', 2_097_153)
    const worker = h.start()
    h.session.request('format')
    h.session.setComposing(true)
    worker.finish()
    expect(h.apply).not.toHaveBeenCalled()
    h.session.setComposing(false)
    expect(h.session.getSnapshot().state).toBe('manual')
    vi.advanceTimersByTime(1000)
    expect(worker.requests).toHaveLength(2)
    h.session.request('validate')
    worker.finish()
    expect(h.session.getSnapshot().state).toBe('valid')
    h.session.dispose()
  })
  it('never applies a tree or format result received during composition', () => {
    for (const action of ['tree', 'format'] as const) {
      const h = harness()
      const worker = h.start()
      const tree = h.session.getSnapshot().tree!
      if (action === 'tree') h.session.editTree({ kind: 'delete', nodeId: tree.nodes[1]!.id }, 0)
      else h.session.request('format')
      h.session.setComposing(true)
      expect(h.session.getSnapshot().composing).toBe(true)
      worker.finish()
      expect(h.apply).not.toHaveBeenCalled()
      expect(h.source()).toBe('{"a":1,"b":[2,3]}')
      h.session.setComposing(false)
      vi.advanceTimersByTime(300)
      worker.finish()
      expect(h.session.getSnapshot().state).toBe('valid')
      h.session.dispose()
    }
  })

  it('keeps only the latest text while a stale tree command and repeated intents are pending', () => {
    const h = harness()
    const worker = h.start()
    const tree = h.session.getSnapshot().tree!
    h.session.editTree({ kind: 'delete', nodeId: tree.nodes[1]!.id }, 0)
    const stale = worker.requests.at(-1)!
    for (let index = 0; index < 40; index++) {
      h.replace(`{"value":${index}}`)
      vi.advanceTimersByTime(300)
    }
    expect(worker.requests).toHaveLength(2)
    worker.finish(stale)
    expect(worker.requests).toHaveLength(3)
    expect(worker.requests.at(-1)?.text).toBe('{"value":39}')
    worker.finish()
    vi.advanceTimersByTime(1000)
    expect(worker.requests).toHaveLength(3)
    expect(h.apply).not.toHaveBeenCalled()
    expect(h.session.getSnapshot().tree?.revision).toBe(40)
    h.session.dispose()
  })

  it('rejects delayed command results and readiness from a terminated Worker generation', () => {
    const h = harness()
    const old = h.start()
    const before = h.session.getSnapshot().tree!
    h.session.editTree({ kind: 'delete', nodeId: before.nodes[1]!.id }, 0)
    const delayed = old.engine.execute(old.requests.at(-1)!)
    old.failure()
    expect(h.session.getSnapshot().tree).toBe(before)
    h.session.restart()
    old.receive(delayed)
    old.ready()
    expect(h.session.getSnapshot().workerReady).toBe(false)
    const next = h.workers[1]!
    next.ready()
    next.finish()
    expect(h.apply).not.toHaveBeenCalled()
    expect(h.source()).toBe('{"a":1,"b":[2,3]}')
    expect(h.session.getSnapshot().tree?.rootId).not.toBe(before.rootId)
    old.receive(delayed)
    expect(h.session.getSnapshot().state).toBe('valid')
    h.session.dispose()
  })

  it.each(['reject', 'throw', 'silent', 'corrupt'] as const)(
    'stops synchronization after adapter %s instead of looping',
    (mode) => {
      const h = harness(mode)
      const worker = h.start()
      h.session.request('format')
      worker.finish()
      expect(h.session.getSnapshot().state).toBe('failed')
      expect(h.session.getSnapshot().message).toContain('提交未完成')
      expect(worker.disposed).toBe(true)
      vi.advanceTimersByTime(30_000)
      expect(worker.requests).toHaveLength(2)
      expect(h.apply).toHaveBeenCalledOnce()
      if (mode === 'reject' || mode === 'throw') expect(h.source()).toBe('{"a":1,"b":[2,3]}')
      h.session.dispose()
    },
  )

  it('rejects malformed edit ranges before touching the adapter', () => {
    const h = harness()
    const worker = h.start()
    h.session.request('format')
    const response = worker.engine.execute(worker.requests.at(-1)!)
    worker.receive({ ...response, edits: [{ offset: -1, length: 1, text: '' }] })
    expect(h.session.getSnapshot().state).toBe('failed')
    expect(h.apply).not.toHaveBeenCalled()
    expect(h.source()).toBe('{"a":1,"b":[2,3]}')
    h.session.dispose()
  })

  it('checks the current source even if an adapter failed to report a content event', () => {
    const h = harness()
    const worker = h.start()
    h.session.request('format')
    h.replace('{"unreported":true}', false)
    worker.finish()
    expect(h.apply).not.toHaveBeenCalled()
    expect(worker.requests.at(-1)?.text).toBe('{"unreported":true}')
    worker.finish()
    expect(h.session.getSnapshot().revision).toBe(1)
    expect(h.session.getSnapshot().state).toBe('valid')
    h.session.dispose()
  })

  it('rejects a projection whose nested document version disagrees with its envelope', () => {
    const h = harness()
    const worker = h.workers[0]!
    worker.ready()
    const response = worker.engine.execute(worker.requests[0]!)
    worker.receive({ ...response, tree: { ...response.tree!, revision: 99 } })
    expect(h.session.getSnapshot().state).toBe('failed')
    expect(h.session.getSnapshot().tree).toBeNull()
    h.session.dispose()
  })

  it('bounds change metadata and omits incomplete traces after unknown model changes', () => {
    const h = harness()
    const worker = h.start()
    for (let index = 0; index < 400; index++) h.replace(String(index))
    vi.advanceTimersByTime(300)
    const last = worker.requests.at(-1)!
    expect(last.changeJournal).toHaveLength(MAX_CHANGE_RECORDS)
    expect(last.historyVersion).toBe(401)
    worker.finish()
    h.changed()
    vi.advanceTimersByTime(300)
    expect(worker.requests.at(-1)?.changeJournal).toBeUndefined()
    worker.finish()
    h.session.dispose()
  })

  it('does not create a second content authority or a tree-to-text feedback loop', () => {
    const h = harness()
    const worker = h.start()
    const a = h.session.getSnapshot().tree!.nodes.find((node) => node.key === 'a')!
    for (let value = 10; value < 50; value++) {
      const revision = h.session.getSnapshot().revision
      expect(
        h.session.editTree({ kind: 'update', nodeId: a.id, valueText: String(value) }, revision),
      ).toBe(true)
      worker.finish()
      expect(h.session.getSnapshot().lastChange).toBe('tree')
      worker.finish()
      expect(h.session.getSnapshot().tree!.nodes.find((node) => node.key === 'a')!.id).toBe(a.id)
      expect(h.source()).toBe(`{"a":${value},"b":[2,3]}`)
      vi.advanceTimersByTime(300)
    }
    expect(h.apply).toHaveBeenCalledTimes(40)
    expect(worker.requests).toHaveLength(81)
    h.session.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
