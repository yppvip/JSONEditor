import { describe, expect, it } from 'vitest'
import { identityAnchors } from '../../src/core/document/change-map'
import type { ChangeBatch, SourceChange } from '../../src/core/document/change-map'
import { JsonDocumentEngine } from '../../src/core/tree-model/document-engine'
import {
  IdentityHistory,
  IDENTITY_HISTORY_LIMITS,
} from '../../src/core/tree-model/identity-history'
import { applySourceEdits } from '../../src/core/commands/tree-commands'
import type { TextEdit } from '../../src/core/document/contracts'

function document(initial: string) {
  const engine = new JsonDocumentEngine('sync')
  let text = initial
  let revision = 0
  let requestId = 0
  let historyVersion = 1
  const journal: ChangeBatch[] = []
  const validate = () =>
    engine.execute({
      documentId: 'doc',
      revision,
      requestId: ++requestId,
      action: 'validate',
      text,
      historyVersion,
      changeJournal: journal,
    })
  let tree = validate().tree!
  return {
    engine,
    tree: () => tree,
    source: () => text,
    edit: (edits: TextEdit[], version = historyVersion + 1, parse = true) => {
      text = applySourceEdits(text, edits)
      historyVersion = version
      journal.push({
        revision: ++revision,
        changes: edits.map(({ offset, length, text: value }) => ({
          offset,
          length,
          insertedLength: value.length,
        })),
      })
      const result = parse ? validate() : undefined
      if (result?.tree) tree = result.tree
      return result
    },
    command: (command: Parameters<typeof engine.execute>[0]['command']) =>
      engine.execute({
        documentId: 'doc',
        revision,
        requestId: ++requestId,
        action: 'tree',
        text,
        ...(command ? { command } : {}),
      }),
  }
}

describe('source anchored identity', () => {
  it('preserves array siblings and descendants across text prepend, delete and value change', () => {
    const d = document('[{"n":1},{"n":2}]')
    const before = d.tree()
    const ids = before.nodes.map((node) => node.id)
    d.edit([{ offset: 1, length: 0, text: '{"n":0},' }])
    expect(
      d
        .tree()
        .nodes.slice(3)
        .map((node) => node.id),
    ).toEqual(ids.slice(1))
    expect(d.tree().nodes[1]!.id).not.toBe(ids[1])
    d.edit([{ offset: 1, length: 8, text: '' }])
    expect(d.tree().nodes.map((node) => node.id)).toEqual(ids)
    d.edit([{ offset: 6, length: 1, text: '900719925474099312345' }])
    expect(d.tree().nodes.map((node) => node.id)).toEqual(ids)
  })

  it('handles a multi-edit property rename without stealing an existing key identity', () => {
    const d = document('{"a":1,"b":2,"c":{"x":3}}')
    const before = d.tree().nodes.map((node) => node.id)
    d.edit([
      { offset: 1, length: 3, text: '"renamed"' },
      { offset: 5, length: 1, text: 'false' },
    ])
    expect(d.tree().nodes.map((node) => node.id)).toEqual(before)
    expect(d.tree().nodes[1]!.key).toBe('renamed')
  })

  it('keeps a complete trace across invalid intermediate revisions', () => {
    const d = document('[1,2,3]')
    const before = d.tree().nodes.map((node) => node.id)
    expect(d.edit([{ offset: 1, length: 0, text: '0' }])?.analysis.valid).toBe(false)
    expect(d.tree().nodes.map((node) => node.id)).toEqual(before)
    d.edit([{ offset: 2, length: 0, text: ',' }])
    expect(
      d
        .tree()
        .nodes.slice(2)
        .map((node) => node.id),
    ).toEqual(before.slice(1))
  })

  it('can map accumulated edits not individually analyzed', () => {
    const d = document('[1,2]')
    const before = d.tree().nodes.map((node) => node.id)
    d.edit([{ offset: 1, length: 0, text: '0,' }], 2, false)
    d.edit([{ offset: 6, length: 0, text: ',3' }])
    expect(
      d
        .tree()
        .nodes.slice(2, 4)
        .map((node) => node.id),
    ).toEqual(before.slice(1))
  })

  it('does not give replaced descendants the identities of deleted children', () => {
    const d = document('{"box":{"a":1},"keep":2}')
    const before = d.tree()
    const box = before.nodes.find((node) => node.key === 'box')!
    const child = before.nodes.find((node) => node.key === 'a')!
    d.edit([{ offset: box.offset, length: box.length, text: '{"b":false}' }])
    expect(d.tree().nodes.find((node) => node.key === 'box')!.id).toBe(box.id)
    expect(d.tree().nodes.find((node) => node.key === 'b')!.id).not.toBe(child.id)
    expect(d.tree().nodes.find((node) => node.key === 'keep')!.id).toBe(before.nodes.at(-1)!.id)
  })

  it('round-trips command deletion through historical undo and redo identities', () => {
    const d = document('[{"n":1},{"n":2}]')
    const initial = d.source()
    const original = d.tree().nodes.map((node) => node.id)
    const result = d.command({ kind: 'delete', nodeId: original[1]! })
    d.edit([...result.edits], 2)
    const deleted = d.source()
    const remaining = d.tree().nodes.map((node) => node.id)
    d.edit([{ offset: 0, length: deleted.length, text: initial }], 1)
    expect(d.tree().nodes.map((node) => node.id)).toEqual(original)
    d.edit([{ offset: 0, length: initial.length, text: deleted }], 2)
    expect(d.tree().nodes.map((node) => node.id)).toEqual(remaining)
    const current = d.tree()
    expect(current.revision).toBe(3)
    expect(
      d.command({ kind: 'update', nodeId: remaining[2]!, valueText: 'true' }).commandError,
    ).toBeUndefined()
  })

  it('preserves IDs when formatting issues many whitespace source edits', () => {
    const d = document('{"a":[1,{"b":false}],"c":null}')
    const ids = d.tree().nodes.map((node) => node.id)
    const result = d.engine.execute({
      documentId: 'doc',
      revision: 0,
      requestId: 2,
      action: 'format',
      text: d.source(),
    })
    d.edit([...result.edits])
    expect(d.tree().nodes.map((node) => node.id)).toEqual(ids)
  })

  it('keeps formatter identity when the editor merges all ranges into one broad content event', () => {
    const d = document('{"a":[1,{"b":false}],"c":null}')
    const ids = d.tree().nodes.map((node) => node.id)
    const initial = d.source()
    const formatted = d.engine.execute({
      documentId: 'doc',
      revision: 0,
      requestId: 2,
      action: 'format',
      text: initial,
    })
    d.edit([
      { offset: 0, length: initial.length, text: applySourceEdits(initial, formatted.edits) },
    ])
    expect(d.tree().nodes.map((node) => node.id)).toEqual(ids)
  })
})

describe('identity guard and bounded retention', () => {
  it('assembles a large disjoint edit transaction without repeatedly rebuilding the full source', () => {
    const source = 'a😀'.repeat(10_000)
    const edits = Array.from({ length: 10_000 }, (_, index) => ({
      offset: index * 3,
      length: 1,
      text: String(index % 10),
    }))
    expect(applySourceEdits(source, edits)).toBe(
      Array.from({ length: 10_000 }, (_, index) => `${index % 10}😀`).join(''),
    )
    expect(source).toBe('a😀'.repeat(10_000))
  })
  const nodes = [{ id: 'n', offset: 1, keyOffset: null }]
  it.each<SourceChange[]>([
    [{ offset: -1, length: 0, insertedLength: 0 }],
    [{ offset: 0, length: 9, insertedLength: 0 }],
    [{ offset: 1.5, length: 0, insertedLength: 0 }],
    [
      { offset: 0, length: 2, insertedLength: 0 },
      { offset: 1, length: 1, insertedLength: 0 },
    ],
  ])('rejects malformed or overlapping trace %#', (...changes) => {
    expect(identityAnchors(nodes, 0, 1, 3, 3, [{ revision: 1, changes }])).toBeUndefined()
  })

  it('rejects gaps, wrong source lengths, and incomplete traces', () => {
    const change = { offset: 0, length: 0, insertedLength: 1 }
    expect(identityAnchors(nodes, 0, 2, 3, 4, [{ revision: 2, changes: [change] }])).toBeUndefined()
    expect(identityAnchors(nodes, 0, 1, 3, 3, [{ revision: 1, changes: [change] }])).toBeUndefined()
    expect(identityAnchors(nodes, 0, 1, 3, 3, undefined)).toBeUndefined()
  })

  it('restores identities only on exact source and document match', () => {
    const history = new IdentityHistory()
    const d = document('[1]')
    history.remember(d.tree(), 1, '[1]')
    expect(history.find('doc', 1, '[2]')).toBeUndefined()
    expect(history.find('other', 1, '[1]')).toBeUndefined()
    expect(history.find('doc', 1, '[1]')).toEqual(d.tree().nodes.map((node) => node.id))
  })

  it('evicts identity checkpoints by count, node budget and source budget', () => {
    const history = new IdentityHistory()
    const tree = document('[1]').tree()
    for (let version = 1; version <= 9; version++) history.remember(tree, version, '[1]')
    expect(history.find('doc', 1, '[1]')).toBeUndefined()
    expect(history.find('doc', 9, '[1]')).toHaveLength(2)
    const manyNodes = { ...tree, nodes: Array(100_001).fill(tree.nodes[0]!) }
    history.remember(manyNodes, 10, '[1]')
    history.remember(manyNodes, 11, '[1]')
    expect(history.find('doc', 10, '[1]')).toBeUndefined()
    expect(history.find('doc', 11, '[1]')).toHaveLength(100_001)
    const long = ' '.repeat(IDENTITY_HISTORY_LIMITS.characters)
    history.remember(tree, 12, long)
    expect(history.find('doc', 11, '[1]')).toBeUndefined()
    history.remember(tree, 13, long + ' ')
    expect(history.find('doc', 13, long + ' ')).toBeUndefined()
  })
})
