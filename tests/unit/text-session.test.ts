import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyEdits } from 'jsonc-parser'
import type { TextEdit } from '../../src/core/document/contracts'
import { TextDocumentSession } from '../../src/core/document/text-session'
import {
  AUTOMATIC_VALIDATION_LIMIT,
  MAX_TEXT_LENGTH,
  analyzeJson,
  formatJson,
} from '../../src/core/json/engine'
import type {
  JsonWorkerRequest,
  JsonWorkerResponse,
  JsonWorkerTransport,
} from '../../src/shared/json-worker-protocol'

class FakeTransport implements JsonWorkerTransport {
  requests: JsonWorkerRequest[] = []
  handler: (response: JsonWorkerResponse) => void = () => {}
  failure: () => void = () => {}
  disposed = false
  send = (request: JsonWorkerRequest): void => {
    this.requests.push(request)
  }
  onMessage = (handler: typeof this.handler): void => {
    this.handler = handler
  }
  onFailure = (handler: () => void): void => {
    this.failure = handler
  }
  dispose = (): void => {
    this.disposed = true
  }
  ready(): void {
    this.handler({ kind: 'ready' })
  }
  finish(request = this.requests.at(-1)!): void {
    const result =
      request.action === 'format'
        ? formatJson(request.text)
        : { ...analyzeJson(request.text), edits: [] }
    this.handler({
      kind: 'result',
      documentId: request.documentId,
      revision: request.revision,
      requestId: request.requestId,
      action: request.action,
      analysis: result,
      edits: result.edits,
      durationMs: 1,
    })
  }
}

function harness(initialText = '{}', lengthOverride?: number) {
  let text = initialText
  const transports: FakeTransport[] = []
  const markers = vi.fn()
  const applied = vi.fn((edits: readonly TextEdit[]) => {
    text = applyEdits(
      text,
      edits.map(({ text: content, ...edit }) => ({ ...edit, content })),
    )
    session.changed()
  })
  const session = new TextDocumentSession(
    'document',
    {
      getText: () => text,
      getLength: () => lengthOverride ?? text.length,
      applyEdits: applied,
      setDiagnostics: markers,
    },
    () => {
      const transport = new FakeTransport()
      transports.push(transport)
      return transport
    },
  )
  return {
    session,
    transports,
    markers,
    applied,
    text: () => text,
    change: (value: string) => {
      text = value
      session.changed()
    },
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('versioned text session', () => {
  it('does not copy oversized source into a worker', () => {
    const h = harness('{}', MAX_TEXT_LENGTH + 1)
    const worker = h.transports[0]!
    worker.ready()
    h.session.request('validate')
    expect(worker.requests).toHaveLength(0)
    expect(h.session.getSnapshot().diagnostics[0]?.code).toBe('TextLimit')
    h.session.dispose()
  })
  it('reports worker construction failure and can retry', () => {
    const worker = new FakeTransport()
    const create = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Cannot create Worker')
      })
      .mockReturnValue(worker)
    const session = new TextDocumentSession(
      'construction',
      {
        getText: () => '{}',
        getLength: () => 2,
        applyEdits: () => {},
        setDiagnostics: () => {},
      },
      create,
    )
    expect(session.getSnapshot().state).toBe('failed')
    session.restart()
    worker.ready()
    worker.finish()
    expect(session.getSnapshot().state).toBe('valid')
    session.dispose()
  })
  it('validates after readiness and debounces to the latest source', () => {
    const h = harness()
    const worker = h.transports[0]!
    worker.ready()
    worker.finish()
    h.change('{"a":1}')
    h.change('{"a":2}')
    vi.advanceTimersByTime(299)
    expect(worker.requests).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(worker.requests).toHaveLength(2)
    expect(worker.requests[1]?.text).toBe('{"a":2}')
    worker.finish()
    expect(h.session.getSnapshot().state).toBe('valid')
    h.session.dispose()
  })
  it('does not publish stale validation or formatting after typing', () => {
    const h = harness('{"a":1}')
    const worker = h.transports[0]!
    worker.ready()
    worker.finish()
    h.session.request('format')
    const oldRequest = worker.requests.at(-1)!
    h.change('{"a":')
    worker.finish(oldRequest)
    expect(h.text()).toBe('{"a":')
    expect(h.applied).not.toHaveBeenCalled()
    expect(h.session.getSnapshot().state).toBe('pending')
    vi.advanceTimersByTime(300)
    worker.finish()
    expect(h.session.getSnapshot().state).toBe('invalid')
    h.session.dispose()
  })
  it('retains only one running request and the latest pending intent', () => {
    const h = harness()
    const worker = h.transports[0]!
    worker.ready()
    for (let index = 0; index < 10; index++) {
      h.change(String(index))
      vi.advanceTimersByTime(300)
    }
    expect(worker.requests).toHaveLength(1)
    worker.finish(worker.requests[0])
    expect(worker.requests).toHaveLength(2)
    expect(worker.requests[1]?.text).toBe('9')
    worker.finish()
    h.session.dispose()
  })
  it('ignores a response from another document', () => {
    const h = harness()
    const worker = h.transports[0]!
    worker.ready()
    worker.handler({
      kind: 'failure',
      documentId: 'other',
      revision: 0,
      requestId: 1,
      message: 'bad',
    })
    expect(h.session.getSnapshot().state).toBe('validating')
    worker.finish()
    expect(h.session.getSnapshot().state).toBe('valid')
    h.session.dispose()
  })
  it('applies valid format edits as one batch and validates the new revision', () => {
    const h = harness('{"n":900719925474099312345}')
    const worker = h.transports[0]!
    worker.ready()
    worker.finish()
    h.session.request('format')
    worker.finish()
    expect(h.applied).toHaveBeenCalledTimes(1)
    expect(h.text()).toContain('900719925474099312345')
    expect(worker.requests.at(-1)?.revision).toBe(1)
    worker.finish()
    expect(h.session.getSnapshot().state).toBe('valid')
    h.session.dispose()
  })
  it('preserves invalid source when format is requested', () => {
    const h = harness('{"a":')
    const worker = h.transports[0]!
    worker.ready()
    worker.finish()
    h.session.request('format')
    worker.finish()
    expect(h.text()).toBe('{"a":')
    expect(h.applied).not.toHaveBeenCalled()
    expect(h.session.getSnapshot().state).toBe('invalid')
    h.session.dispose()
  })
  it('waits for IME composition to end', () => {
    const h = harness()
    const worker = h.transports[0]!
    worker.ready()
    worker.finish()
    h.session.setComposing(true)
    h.change('"中文"')
    vi.advanceTimersByTime(600)
    h.session.request('format')
    expect(worker.requests).toHaveLength(1)
    h.session.setComposing(false)
    vi.advanceTimersByTime(300)
    expect(worker.requests).toHaveLength(2)
    h.session.dispose()
  })
  it('allows manual validation in large-file mode', () => {
    const h = harness('{}', AUTOMATIC_VALIDATION_LIMIT + 1)
    const worker = h.transports[0]!
    worker.ready()
    expect(worker.requests).toHaveLength(0)
    h.change('{"a":1}')
    vi.advanceTimersByTime(1000)
    expect(worker.requests).toHaveLength(0)
    expect(h.session.getSnapshot().state).toBe('manual')
    h.session.request('validate')
    expect(worker.requests).toHaveLength(1)
    h.session.dispose()
  })
  it('terminates timed-out work and restarts without losing source or revision', () => {
    const h = harness('{"a":1}')
    const old = h.transports[0]!
    old.ready()
    h.change('{"a":2}')
    vi.advanceTimersByTime(15_000)
    expect(h.session.getSnapshot().state).toBe('failed')
    expect(old.disposed).toBe(true)
    h.session.restart()
    const worker = h.transports[1]!
    worker.ready()
    worker.finish()
    expect(h.text()).toBe('{"a":2}')
    expect(h.session.getSnapshot().revision).toBe(1)
    old.finish()
    expect(h.session.getSnapshot().state).toBe('valid')
    h.session.dispose()
  })
  it('recovers from worker failure and releases timers on disposal', () => {
    const h = harness()
    const worker = h.transports[0]!
    worker.failure()
    expect(h.session.getSnapshot().state).toBe('failed')
    h.session.restart()
    h.session.dispose()
    expect(vi.getTimerCount()).toBe(0)
    expect(h.transports[1]?.disposed).toBe(true)
    worker.ready()
    expect(h.session.getSnapshot().workerReady).toBe(false)
  })
})
