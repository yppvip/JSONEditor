import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TextDocumentSession } from '../../src/core/document/text-session'
import { JsonDocumentEngine } from '../../src/core/tree-model/document-engine'
import { applySourceEdits } from '../../src/core/commands/tree-commands'
import type { TreeCommand } from '../../src/core/commands/tree-commands'
import type {
  JsonWorkerRequest,
  JsonWorkerResponse,
  JsonWorkerTransport,
} from '../../src/shared/json-worker-protocol'

function harness(source = '{"a":1,"b":2}') {
  let text = source
  let receive: (response: JsonWorkerResponse) => void = () => {}
  const requests: JsonWorkerRequest[] = []
  const engine = new JsonDocumentEngine('session')
  const transport: JsonWorkerTransport = {
    send: (request) => {
      requests.push(request)
    },
    onMessage: (handler) => {
      receive = handler
    },
    onFailure: () => {},
    dispose: () => {},
  }
  const apply = vi.fn((edits) => {
    text = applySourceEdits(text, edits)
    session.changed()
  })
  const session = new TextDocumentSession(
    'doc',
    {
      getText: () => text,
      getLength: () => text.length,
      applyEdits: apply,
      setDiagnostics: () => {},
    },
    () => transport,
  )
  return {
    session,
    requests,
    apply,
    receive: (response: JsonWorkerResponse) => receive(response),
    ready: () => receive({ kind: 'ready' }),
    finish: (request = requests.at(-1)!) => receive(engine.execute(request)),
    change: (value: string) => {
      text = value
      session.changed()
    },
    source: () => text,
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('commits tree edits through the buffer and publishes only the resulting revision', () => {
  const h = harness()
  h.ready()
  h.finish()
  const tree = h.session.getSnapshot().tree!
  const a = tree.nodes.find((node) => node.key === 'a')!
  expect(
    h.session.editTree(
      { kind: 'update', nodeId: a.id, valueType: 'number', valueText: '900719925474099312345' },
      0,
    ),
  ).toBe(true)
  h.finish()
  expect(h.apply).toHaveBeenCalledOnce()
  expect(h.source()).toContain('900719925474099312345')
  expect(h.session.getSnapshot().tree?.revision).toBe(0)
  expect(h.session.getSnapshot().revision).toBe(1)
  expect(h.session.editTree({ kind: 'delete', nodeId: a.id }, 0)).toBe(false)
  h.finish()
  expect(h.session.getSnapshot().tree?.revision).toBe(1)
  expect(h.session.getSnapshot().tree?.nodes.find((node) => node.key === 'a')?.id).toBe(a.id)
  h.session.dispose()
})

it('ignores a tree edit response after new text input and keeps the last valid projection', () => {
  const h = harness()
  h.ready()
  h.finish()
  const tree = h.session.getSnapshot().tree!
  h.session.editTree({ kind: 'delete', nodeId: tree.nodes[1]!.id }, 0)
  const old = h.requests.at(-1)!
  h.change('{')
  h.finish(old)
  expect(h.source()).toBe('{')
  expect(h.apply).not.toHaveBeenCalled()
  vi.advanceTimersByTime(300)
  h.finish()
  expect(h.session.getSnapshot().state).toBe('invalid')
  expect(h.session.getSnapshot().tree).toBe(tree)
  expect(h.session.editTree({ kind: 'delete', nodeId: tree.nodes[1]!.id }, 0)).toBe(false)
  h.session.dispose()
})

it('rejects stale versions, busy edits, and duplicate-key projections', () => {
  const h = harness('{"a":1,"a":2}')
  h.ready()
  h.finish()
  const tree = h.session.getSnapshot().tree!
  expect(tree.editable).toBe(false)
  expect(h.session.editTree({ kind: 'delete', nodeId: tree.nodes[1]!.id }, 0)).toBe(false)
  h.change('{"a":1}')
  vi.advanceTimersByTime(300)
  h.finish()
  const fresh = h.session.getSnapshot().tree!
  expect(h.session.editTree({ kind: 'update', nodeId: fresh.rootId, valueText: '[]' }, 0)).toBe(
    false,
  )
  expect(h.session.editTree({ kind: 'update', nodeId: fresh.rootId, valueText: '[]' }, 1)).toBe(
    true,
  )
  expect(h.session.editTree({ kind: 'update', nodeId: fresh.rootId, valueText: 'null' }, 1)).toBe(
    false,
  )
  h.session.dispose()
})

it('returns user command errors without failing the worker or changing text', () => {
  const h = harness()
  h.ready()
  h.finish()
  const tree = h.session.getSnapshot().tree!
  h.session.editTree(
    { kind: 'update', nodeId: tree.nodes.find((node) => node.key === 'b')!.id, key: 'a' },
    0,
  )
  h.finish()
  expect(h.source()).toBe('{"a":1,"b":2}')
  expect(h.session.getSnapshot().state).toBe('valid')
  expect(h.session.getSnapshot().treeError).toContain('已存在')
  expect(h.apply).not.toHaveBeenCalled()
  h.session.dispose()
})

it('does not accept a result with a different action', () => {
  const h = harness()
  h.ready()
  const request = h.requests[0]!
  const result = new JsonDocumentEngine('wrong').execute(request)
  h.receive({ ...result, action: 'format' })
  expect(h.session.getSnapshot().state).toBe('validating')
  h.finish()
  expect(h.session.getSnapshot().state).toBe('valid')
  h.session.dispose()
})

it.each(['add', 'insert', 'copy', 'convert'] as const)(
  'commits %s as one buffer transaction and rejects another command until the new tree is current',
  (kind) => {
    const h = harness()
    h.ready()
    h.finish()
    const tree = h.session.getSnapshot().tree!
    const nodeId = tree.nodes[1]!.id
    const command: TreeCommand =
      kind === 'add'
        ? { kind, nodeId: tree.rootId, index: 0 }
        : kind === 'insert'
          ? { kind, nodeId, position: 'after' }
          : kind === 'convert'
            ? { kind, nodeId, valueType: 'array' }
            : { kind, nodeId }
    expect(h.session.editTree(command, 0)).toBe(true)
    expect(h.session.editTree(command, 0)).toBe(false)
    h.finish()
    expect(h.apply).toHaveBeenCalledOnce()
    expect(h.apply.mock.calls[0]![0]).toHaveLength(1)
    expect(h.session.getSnapshot().revision).toBe(1)
    expect(h.session.editTree(command, 0)).toBe(false)
    h.finish()
    expect(h.session.getSnapshot().state).toBe('valid')
    expect(h.session.getSnapshot().tree?.revision).toBe(1)
    expect(h.session.getSnapshot().tree?.nodes.length).toBeGreaterThan(tree.nodes.length)
    h.session.dispose()
  },
)

it('drops a pending copy after intervening text input and blocks new commands during composition', () => {
  const h = harness()
  h.ready()
  h.finish()
  const nodeId = h.session.getSnapshot().tree!.nodes[1]!.id
  h.session.editTree({ kind: 'copy', nodeId }, 0)
  const old = h.requests.at(-1)!
  h.change('{"new":true}')
  h.finish(old)
  expect(h.apply).not.toHaveBeenCalled()
  expect(h.source()).toBe('{"new":true}')
  vi.advanceTimersByTime(300)
  h.finish()
  h.session.setComposing(true)
  expect(h.session.editTree({ kind: 'add', nodeId: h.session.getSnapshot().tree!.rootId }, 1)).toBe(
    false,
  )
  h.session.dispose()
})
