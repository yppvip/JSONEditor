import { describe, expect, it } from 'vitest'
import { applySourceEdits, compileTreeCommand } from '../../src/core/commands/tree-commands'
import type { TreeCommand } from '../../src/core/commands/tree-commands'
import { uniqueObjectKey } from '../../src/core/commands/insertion-commands'
import { buildTree, indexTree, MAX_TREE_NODES } from '../../src/core/tree-model/model'
import { JsonDocumentEngine } from '../../src/core/tree-model/document-engine'
import { MAX_DEPTH, MAX_TEXT_LENGTH } from '../../src/core/json/limits'

function document(initial: string) {
  const engine = new JsonDocumentEngine('new-commands')
  let text = initial,
    revision = 0,
    requestId = 0,
    historyVersion = 1
  const validate = () =>
    engine.execute({
      documentId: 'doc',
      revision,
      requestId: ++requestId,
      historyVersion,
      action: 'validate',
      text,
    })
  let tree = validate().tree!
  const command = (value: TreeCommand, overrides = {}) =>
    engine.execute({
      documentId: 'doc',
      revision,
      requestId: ++requestId,
      action: 'tree',
      text,
      command: value,
      ...overrides,
    })
  return {
    tree: () => tree,
    text: () => text,
    node: (key: string) => tree.nodes.find((node) => node.key === key)!,
    command,
    run: (value: TreeCommand) => {
      const result = command(value)
      expect(result.commandError).toBeUndefined()
      if (result.edits.length) {
        text = applySourceEdits(text, result.edits)
        revision++
        historyVersion++
        tree = validate().tree!
      }
      return result
    },
    restore: (source: string, version: number) => {
      text = source
      revision++
      historyVersion = version
      tree = validate().tree!
    },
  }
}

const children = (tree: ReturnType<typeof document>['tree']) => {
  const value = tree(),
    index = indexTree(value)
  return index.get(value.rootId)!.children.map((id) => index.get(id)!)
}

describe('positioned additions and unique property names', () => {
  it.each([0, 1, 3])(
    'inserts at array position %i without changing sibling or descendant IDs',
    (position) => {
      const d = document('[{"n":900719925474099312345},{"n":-0},{"n":1.2300e+02}]')
      const ids = d.tree().nodes.map((node) => node.id)
      const before = children(d.tree).map((node) => node.id)
      expect(d.run({ kind: 'add', nodeId: d.tree().rootId, index: position }).edits).toHaveLength(1)
      const next = children(d.tree)
      expect(next.map((node) => node.index)).toEqual([0, 1, 2, 3])
      expect(next[position]!.type).toBe('string')
      expect(next[position]!.preview).toBe('""')
      expect(next.filter((_, index) => index !== position).map((node) => node.id)).toEqual(before)
      expect(
        d
          .tree()
          .nodes.filter((node) => ids.includes(node.id))
          .map((node) => node.id),
      ).toEqual(ids)
      expect(d.text()).toContain('900719925474099312345')
      expect(d.text()).toContain('1.2300e+02')
    },
  )

  it.each(['before', 'after'] as const)(
    'inserts a %s sibling of a container instead of a child',
    (position) => {
      const d = document('{"first":1,"box":{"inside":true},"last":2}')
      const box = d.node('box'),
        inside = d.node('inside')
      d.run({ kind: 'insert', nodeId: box.id, position })
      expect(children(d.tree).map((node) => node.key)).toEqual(
        position === 'before' ? ['first', 'key', 'box', 'last'] : ['first', 'box', 'key', 'last'],
      )
      expect(d.node('box').children).toEqual([inside.id])
      expect(d.node('key').preview).toBe('""')
    },
  )

  it('appends by default, creates a default child in empty containers, and preserves CRLF and tab indentation', () => {
    for (const initial of ['{}', '{\r\n\t\r\n}', '[]', '[\r\n]']) {
      const d = document(initial)
      d.run({ kind: 'add', nodeId: d.tree().rootId })
      expect(d.tree().nodes).toHaveLength(2)
      expect(d.tree().nodes[1]!.preview).toBe('""')
    }
    const d = document('{\r\n\t"a": -0,\r\n\t"b": 1.2300e+02\r\n}')
    d.run({ kind: 'add', nodeId: d.tree().rootId, index: 1, key: 'new', valueText: 'true' })
    expect(d.text()).toBe('{\r\n\t"a": -0,\r\n\t"new": true,\r\n\t"b": 1.2300e+02\r\n}')
    d.run({ kind: 'add', nodeId: d.tree().rootId })
    expect(children(d.tree).at(-1)!.key).toBe('key')
  })

  it('generates the first free numeric suffix and treats escaped, empty and prototype-like keys as ordinary keys', () => {
    const d = document('{"key":1,"key1":2,"key3":3,"\\u0061":0,"a1":0,"":0,"1":0,"__proto__":0}')
    expect(uniqueObjectKey(d.tree(), d.tree().rootId)).toBe('key2')
    expect(uniqueObjectKey(d.tree(), d.tree().rootId, 'a')).toBe('a2')
    expect(uniqueObjectKey(d.tree(), d.tree().rootId, '')).toBe('2')
    d.run({ kind: 'add', nodeId: d.tree().rootId })
    expect(d.node('key2').preview).toBe('""')
    d.run({ kind: 'copy', nodeId: d.node('__proto__').id })
    expect(d.node('__proto__1').preview).toBe('0')
    d.run({
      kind: 'add',
      nodeId: d.tree().rootId,
      key: 'quote"😀',
      valueText: 'null',
      valueType: 'null',
    })
    expect(d.node('quote"😀').type).toBe('null')
    expect(d.command({ kind: 'add', nodeId: d.tree().rootId, key: 'a' }).commandError).toContain(
      '已存在',
    )
    expect(
      d.command({ kind: 'update', nodeId: d.node('key2').id, key: 'key' }).commandError,
    ).toContain('已存在')
  })

  it.each([-1, 4, 0.5, NaN, Infinity])(
    'rejects out-of-range or noninteger position %s',
    (index) => {
      const d = document('[1,2,3]')
      expect(d.command({ kind: 'add', nodeId: d.tree().rootId, index }).commandError).toContain(
        '范围',
      )
      expect(d.text()).toBe('[1,2,3]')
    },
  )
})

describe('source-preserving deep duplication and atomic container conversion', () => {
  it('deep-copies after the original, generates all new IDs and leaves the original bytes unchanged', () => {
    const raw =
      '{"n":900719925474099312345,"e":1.2300e+02,"negative":-0,"s":"a\\u0061","inner":[true,null]}'
    const d = document('{"name":' + raw + ',"name1":false,"tail":true}')
    const originalIds = d.tree().nodes.map((node) => node.id)
    const original = d.node('name')
    const result = d.run({ kind: 'copy', nodeId: original.id })
    expect(result.edits).toHaveLength(1)
    expect(children(d.tree).map((node) => node.key)).toEqual(['name', 'name2', 'name1', 'tail'])
    const clone = d.node('name2')
    expect(d.text().slice(clone.offset, clone.offset + clone.length)).toBe(raw)
    expect(
      d.text().slice(d.node('name').offset, d.node('name').offset + d.node('name').length),
    ).toBe(raw)
    const cloneNodes = d
      .tree()
      .nodes.filter(
        (node) => node.offset >= clone.offset && node.offset < clone.offset + clone.length,
      )
    expect(cloneNodes).toHaveLength(8)
    expect(cloneNodes.every((node) => !originalIds.includes(node.id))).toBe(true)
    expect(
      d
        .tree()
        .nodes.filter((node) => originalIds.includes(node.id))
        .map((node) => node.id),
    ).toEqual(originalIds)
  })

  it('copies array elements immediately below the source, updating indices without reusing IDs', () => {
    const d = document('[{"child":[-0,1e9999]},false]')
    const originals = d.tree().nodes.map((node) => node.id)
    d.run({ kind: 'copy', nodeId: children(d.tree)[0]!.id })
    expect(children(d.tree).map((node) => node.index)).toEqual([0, 1, 2])
    expect(children(d.tree)[2]!.id).toBe(originals.at(-1))
    expect(children(d.tree)[1]!.id).not.toBe(originals[1])
    expect(d.text().match(/1e9999/g)).toHaveLength(2)
  })

  it.each(['array', 'object'] as const)(
    'replaces old content with one empty %s child in one edit and preserves the converted node ID',
    (valueType) => {
      const sourceType = valueType === 'array' ? '{"old":[1,true]}' : '[{"old":true}]'
      const d = document('{"box":' + sourceType + ',"keep":900719925474099312345}')
      const boxId = d.node('box').id,
        keepId = d.node('keep').id
      const removedIds = d
        .tree()
        .nodes.filter((node) => ![d.tree().rootId, boxId, keepId].includes(node.id))
        .map((node) => node.id)
      expect(d.run({ kind: 'convert', nodeId: boxId, valueType }).edits).toHaveLength(1)
      expect(d.node('box').id).toBe(boxId)
      expect(d.node('box').type).toBe(valueType)
      expect(d.node('box').children).toHaveLength(1)
      const child = indexTree(d.tree()).get(d.node('box').children[0]!)!
      expect(child.preview).toBe('""')
      expect(child.key).toBe(valueType === 'object' ? 'key' : null)
      expect(removedIds).not.toContain(child.id)
      expect(d.node('keep').id).toBe(keepId)
      expect(d.text()).toContain('900719925474099312345')
      expect(d.command({ kind: 'convert', nodeId: boxId, valueType }).edits).toEqual([])
    },
  )

  it.each(['array', 'object'] as const)(
    'converts a scalar root into %s and does not reset an existing container of that type',
    (valueType) => {
      const d = document('null'),
        root = d.tree().rootId
      d.run({ kind: 'convert', nodeId: root, valueType })
      expect(d.tree().rootId).toBe(root)
      expect(d.tree().nodes).toHaveLength(2)
      expect(d.tree().nodes[1]!.preview).toBe('""')
      const populated = document(valueType === 'array' ? '[1]' : '{"old":1}')
      expect(
        populated.run({ kind: 'convert', nodeId: populated.tree().rootId, valueType }).edits,
      ).toEqual([])
    },
  )

  it.each(['add', 'insert', 'copy', 'convert'] as const)(
    'restores exact original and resulting IDs through one undo/redo checkpoint for %s',
    (kind) => {
      const d = document('{"box":[{"n":-0}],"keep":1e9999}')
      const originalText = d.text(),
        originalIds = d.tree().nodes.map((node) => node.id)
      const nodeId = d.node('box').id
      const command: TreeCommand =
        kind === 'add'
          ? { kind, nodeId, index: 0 }
          : kind === 'insert'
            ? { kind, nodeId, position: 'before' }
            : kind === 'copy'
              ? { kind, nodeId }
              : { kind, nodeId, valueType: 'object' }
      d.run(command)
      const resultText = d.text(),
        resultIds = d.tree().nodes.map((node) => node.id)
      d.restore(originalText, 1)
      expect(d.tree().nodes.map((node) => node.id)).toEqual(originalIds)
      d.restore(resultText, 2)
      expect(d.tree().nodes.map((node) => node.id)).toEqual(resultIds)
    },
  )
})

describe('command gates and document limits', () => {
  it('rejects root siblings/copies, scalar child additions, invalid values and obsolete node IDs', () => {
    const d = document('true')
    for (const command of [
      { kind: 'insert', nodeId: d.tree().rootId, position: 'before' },
      { kind: 'copy', nodeId: d.tree().rootId },
      { kind: 'add', nodeId: d.tree().rootId },
    ] as const) {
      expect(d.command(command).edits).toEqual([])
      expect(d.command(command).commandError).toBeTruthy()
    }
    const container = document('[]')
    for (const valueText of ['{', '{"a":1,"a":2}', '01'])
      expect(
        container.command({ kind: 'add', nodeId: container.tree().rootId, valueText }).commandError,
      ).toBeTruthy()
    expect(container.command({ kind: 'copy', nodeId: 'missing' }).commandError).toContain('不存在')
  })

  it('rejects duplicate keys and stale revisions, document IDs or source before producing edits', () => {
    const duplicate = document('{"a":1,"\\u0061":2}')
    expect(
      duplicate.command({ kind: 'copy', nodeId: duplicate.node('a').id }).commandError,
    ).toContain('重复')
    const d = document('[true]'),
      command: TreeCommand = { kind: 'copy', nodeId: d.tree().nodes[1]!.id }
    for (const overrides of [{ revision: 4 }, { documentId: 'other' }, { text: '[false]' }]) {
      const result = d.command(command, overrides)
      expect(result.edits).toEqual([])
      expect(result.commandError).toContain('变化')
    }
  })

  it('refuses a copy/add/conversion crossing the tree node budget instead of committing a tree-less document', () => {
    const d = document(
      '[' +
        Array(MAX_TREE_NODES - 1)
          .fill('0')
          .join(',') +
        ']',
    )
    for (const command of [
      { kind: 'add', nodeId: d.tree().rootId },
      { kind: 'copy', nodeId: d.tree().nodes[1]!.id },
      { kind: 'convert', nodeId: d.tree().nodes[1]!.id, valueType: 'object' },
    ] as const) {
      expect(d.command(command).commandError).toContain('节点上限')
      expect(d.command(command).edits).toEqual([])
    }
    expect(d.tree().nodes).toHaveLength(MAX_TREE_NODES)
    d.run({ kind: 'convert', nodeId: d.tree().rootId, valueType: 'object' })
    expect(d.tree().nodes).toHaveLength(2)
  })

  it('allows the last available node, and rejects nested additions exceeding the depth limit', () => {
    const d = document(
      '[' +
        Array(MAX_TREE_NODES - 2)
          .fill('0')
          .join(',') +
        ']',
    )
    d.run({ kind: 'add', nodeId: d.tree().rootId })
    expect(d.tree().nodes).toHaveLength(MAX_TREE_NODES)
    const deep = document('['.repeat(MAX_DEPTH) + '0' + ']'.repeat(MAX_DEPTH))
    expect(
      deep.command({ kind: 'convert', nodeId: deep.tree().nodes.at(-1)!.id, valueType: 'array' })
        .commandError,
    ).toContain('嵌套')
  })

  it('rejects a source-size overflow before building the predicted full source', () => {
    const text = '["' + 'x'.repeat(Math.floor(MAX_TEXT_LENGTH / 2)) + '"]'
    let seq = 0
    const tree = buildTree(text, { documentId: 'doc', revision: 0 }, () => `n${++seq}`).tree!
    expect(() =>
      compileTreeCommand(text, tree, { kind: 'copy', nodeId: tree.nodes[1]!.id }),
    ).toThrow(/文本过大/)
  })
})
