import { expect, it } from 'vitest'
import {
  inputValue,
  modeOf,
  restoreModes,
  snapshotModes,
  validModeSnapshot,
} from '../../src/core/tree-model/edit-modes'
import { JsonDocumentEngine } from '../../src/core/tree-model/document-engine'
import { applySourceEdits } from '../../src/core/document/source-edits'
import type { TreeCommand } from '../../src/core/commands/tree-commands'
import { ModeTimeline } from '../../src/renderer/text-editor/mode-timeline'

it.each([
  ['123', '123'],
  ['-0', '-0'],
  ['900719925474099312345', '900719925474099312345'],
  ['1.2300e+02', '1.2300e+02'],
  ['1e9999', '1e9999'],
  [' true ', 'true'],
  ['false', 'false'],
  ['null', 'null'],
  ['001', '"001"'],
  ['NaN', '"NaN"'],
  ['Infinity', '"Infinity"'],
  ['TRUE', '"TRUE"'],
  ['', '""'],
  ['  words  ', '"  words  "'],
  ['{"n":1}', '"{\\"n\\":1}"'],
  ['[1]', '"[1]"'],
])('infers automatic input %s without rounding or parsing containers', (input, expected) => {
  expect(inputValue(input, 'auto')).toBe(expected)
})
it.each(['123', '-0', 'true', 'null', 'a\n"b"', '😀', '  x  ', ''])(
  'always quotes forced string input %s once',
  (input) => {
    expect(JSON.parse(inputValue(input, 'string'))).toBe(input)
  },
)

function document(initial: string) {
  const engine = new JsonDocumentEngine('modes')
  let text = initial,
    revision = 0,
    version = 1
  const parse = () =>
    engine.execute({
      documentId: 'doc',
      requestId: revision + 1,
      revision,
      historyVersion: version,
      text,
      action: 'validate',
    })
  let tree = parse().tree!
  return {
    tree: () => tree,
    text: () => text,
    node: (key: string) => tree.nodes.find((node) => node.key === key)!,
    run: (command: TreeCommand) => {
      const response = engine.execute({
        documentId: 'doc',
        requestId: revision + 1,
        revision,
        historyVersion: version,
        text,
        action: 'tree',
        command,
      })
      expect(response.commandError).toBeUndefined()
      if (response.edits.length || response.nextModes) {
        text = applySourceEdits(text, response.edits)
        revision++
        version++
        tree = parse().tree!
      }
      return response
    },
    restore: (
      source: string,
      historyVersion: number,
      modes: Parameters<typeof restoreModes>[1],
    ) => {
      text = source
      revision++
      version = historyVersion
      tree = engine.execute({
        documentId: 'doc',
        requestId: revision + 1,
        revision,
        historyVersion,
        text,
        action: 'validate',
        restoreModes: modes,
      }).tree!
    },
  }
}

it('changes metadata alone without text edits, is a no-op when selected twice, and restores sparse overrides', () => {
  const d = document('{"name":"hello"}'),
    id = d.node('name').id
  expect(modeOf(d.node('name'))).toBe('string')
  const result = d.run({ kind: 'set-mode', nodeId: id, mode: 'auto' })
  expect(result.edits).toEqual([])
  expect(result.nextModes).toEqual([{ pointer: '/name', mode: 'auto' }])
  expect(d.text()).toBe('{"name":"hello"}')
  expect(d.run({ kind: 'set-mode', nodeId: id, mode: 'auto' }).nextModes).toBeUndefined()
  d.restore(d.text(), 1, [])
  expect(modeOf(d.node('name'))).toBe('string')
  d.restore(d.text(), 2, [{ pointer: '/name', mode: 'auto' }])
  expect(modeOf(d.node('name'))).toBe('auto')
})

it('switches scalar types without double encoding, retains string locks, and treats raw containers as strings', () => {
  const d = document('{"value":900719925474099312345}'),
    id = d.node('value').id
  d.run({ kind: 'set-mode', nodeId: id, mode: 'string' })
  expect(d.node('value').preview).toBe('"900719925474099312345"')
  d.run({ kind: 'edit-value', nodeId: id, value: '123' })
  expect(d.node('value').preview).toBe('"123"')
  d.run({ kind: 'set-mode', nodeId: id, mode: 'auto' })
  expect(d.node('value').type).toBe('number')
  d.run({ kind: 'edit-value', nodeId: id, value: '{"a":1}' })
  expect(d.node('value').type).toBe('string')
  expect(modeOf(d.node('value'))).toBe('auto')
  d.run({ kind: 'edit-value', nodeId: id, value: 'false' })
  expect(d.node('value').type).toBe('boolean')
})

it('carries modes through rename, copy, sort, cross-container move and deletion; default additions and conversion children are automatic', () => {
  const d = document('{"z":{"name":"hello"},"target":[],"remove":"bye"}')
  d.run({ kind: 'set-mode', nodeId: d.node('name').id, mode: 'auto' })
  d.run({ kind: 'update', nodeId: d.node('name').id, key: 'renamed' })
  const id = d.node('renamed').id
  expect(modeOf(d.node('renamed'))).toBe('auto')
  d.run({ kind: 'copy', nodeId: d.node('z').id })
  const copy = d.node('z1')
  expect(modeOf(d.tree().nodes.find((node) => node.parentId === copy.id)!)).toBe('auto')
  d.run({ kind: 'move', nodeId: id, parentId: d.node('target').id, index: 0 })
  d.run({ kind: 'sort', nodeId: d.tree().rootId, direction: 'asc' })
  expect(snapshotModes(d.tree())).toContainEqual({ pointer: '/target/0', mode: 'auto' })
  d.run({ kind: 'add', nodeId: d.tree().rootId })
  expect(modeOf(d.node('key'))).toBe('auto')
  d.run({ kind: 'set-mode', nodeId: d.node('remove').id, mode: 'auto' })
  d.run({ kind: 'delete', nodeId: d.node('remove').id })
  expect(snapshotModes(d.tree()).some((entry) => entry.pointer === '/remove')).toBe(false)
  d.run({ kind: 'convert', nodeId: d.node('z').id, valueType: 'array' })
  expect(snapshotModes(d.tree())).toContainEqual({ pointer: '/z/0', mode: 'auto' })
})

it('restores modes with escaped pointers even when original node IDs have been evicted or a new Worker starts', () => {
  const d = document('{"a/b":{"~":"text"},"items":["first","second"]}')
  d.run({ kind: 'set-mode', nodeId: d.node('~').id, mode: 'auto' })
  const modes = snapshotModes(d.tree())
  expect(modes).toEqual([{ pointer: '/a~1b/~0', mode: 'auto' }])
  const other = document(d.text())
  other.restore(d.text(), 900, modes)
  expect(modeOf(other.node('~'))).toBe('auto')
  expect(modeOf(other.tree().nodes.at(-1)!)).toBe('string')
})

it('keeps metadata-only versions distinct on the same native version and preserves old snapshots across text and repeated mode history', () => {
  const timeline = new ModeTimeline(),
    first = timeline.version(1)
  timeline.remember(1, [])
  const tx = timeline.transaction(1)
  const automatic = timeline.version(1)
  timeline.remember(1, [{ pointer: '', mode: 'auto' }])
  expect(automatic).not.toBe(first)
  const textVersion = timeline.version(2)
  timeline.remember(2, [])
  expect(timeline.version(1)).toBe(automatic)
  tx.undo()
  expect(timeline.version(1)).toBe(first)
  expect(timeline.snapshot(1)).toEqual([])
  tx.redo()
  expect(timeline.snapshot(1)).toEqual([{ pointer: '', mode: 'auto' }])
  expect(timeline.version(2)).toBe(textVersion)
})

it('validates only bounded mode records and valid JSON Pointers at the IPC boundary', () => {
  expect(
    validModeSnapshot([
      { pointer: '', mode: 'auto' },
      { pointer: '/a~1b/~0', mode: 'string' },
    ]),
  ).toBe(true)
  for (const value of [
    null,
    {},
    [{ path: '/a', mode: 'auto' }],
    [{ pointer: 'a', mode: 'auto' }],
    [{ pointer: '/~2', mode: 'auto' }],
    [{ pointer: '/x', mode: 'number' }],
    [{ pointer: '/', mode: 'auto', path: 'D:/secret' }],
  ])
    expect(validModeSnapshot(value)).toBe(false)
})
