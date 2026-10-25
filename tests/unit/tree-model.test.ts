import { describe, expect, it } from 'vitest'
import { buildTree, indexTree, jsonPointer, MAX_TREE_NODES } from '../../src/core/tree-model/model'
import type { JsonTreeProjection } from '../../src/core/tree-model/model'
import { compileTreeCommand, applySourceEdits } from '../../src/core/commands/tree-commands'
import type { TreeCommand } from '../../src/core/commands/tree-commands'
import { JsonDocumentEngine } from '../../src/core/tree-model/document-engine'

function model(text: string, previous: JsonTreeProjection | null = null): JsonTreeProjection {
  let sequence = previous?.nodes.length ?? 0
  return buildTree(
    text,
    { documentId: 'doc', revision: previous ? previous.revision + 1 : 0 },
    () => `node-${++sequence}`,
    previous,
  ).tree!
}
function nodeWithKey(tree: JsonTreeProjection, key: string) {
  return tree.nodes.find((node) => node.key === key)!
}
function execute(text: string, command: (tree: JsonTreeProjection) => TreeCommand): string {
  const tree = model(text)
  return applySourceEdits(text, compileTreeCommand(text, tree, command(tree)).edits)
}

describe('normalized source tree', () => {
  it('represents every JSON type, order, indices and UTF-16 source range without precision loss', () => {
    const source = '{"10":900719925474099312345,"2":-0,"😀":[true,null,"text",{}]}'
    const tree = model(source)
    const index = indexTree(tree)
    expect(tree.nodes).toHaveLength(8)
    expect(tree.maxDepth).toBe(2)
    expect(tree.nodes[0]?.children.map((id) => index.get(id)?.key)).toEqual(['10', '2', '😀'])
    expect(nodeWithKey(tree, '10').preview).toBe('900719925474099312345')
    const array = nodeWithKey(tree, '😀')
    expect(array.children.map((id) => index.get(id)?.index)).toEqual([0, 1, 2, 3])
    for (const node of tree.nodes) {
      expect(node.length).toBeGreaterThan(0)
      expect(source.slice(node.offset, node.offset + node.length)).toBeTruthy()
      if (node.parentId) expect(index.get(node.parentId)?.children).toContain(node.id)
    }
  })
  it.each(['null', 'true', '12345678901234567890', '"😀"', '[]', '{}'])(
    'supports root %s',
    (source) => {
      const tree = model(source)
      expect(tree.nodes).toHaveLength(1)
      expect(tree.nodes[0]?.parentId).toBeNull()
      expect(tree.nodes[0]?.preview.length).toBeGreaterThan(0)
    },
  )
  it('computes escaped JSON Pointer lazily and uses IDs independent of paths', () => {
    const tree = model('{"a/b":{"~":1},"":2}')
    expect(jsonPointer(nodeWithKey(tree, '~'), indexTree(tree))).toBe('/a~1b/~0')
    expect(jsonPointer(nodeWithKey(tree, ''), indexTree(tree))).toBe('/')
    const changed = model('{"a/b":{"renamed":1},"":2}', tree)
    expect(nodeWithKey(changed, 'renamed').id).toBe(nodeWithKey(tree, '~').id)
    expect(nodeWithKey(changed, '').id).toBe(nodeWithKey(tree, '').id)
  })
  it('keeps stable IDs on value changes and marks duplicate keys read-only', () => {
    const tree = model('{"a":1,"items":[1,2]}')
    const changed = model('{"a":123,"items":[3,2]}', tree)
    expect(changed.nodes.map((node) => node.id)).toEqual(tree.nodes.map((node) => node.id))
    expect(model('{"a":1,"\\u0061":2}').editable).toBe(false)
    expect(() =>
      compileTreeCommand('{"a":1,"a":2}', model('{"a":1,"a":2}'), {
        kind: 'delete',
        nodeId: 'node-2',
      }),
    ).toThrow(/重复/)
  })
  it('caps node metadata and long value previews', () => {
    const source = '[' + Array.from({ length: MAX_TREE_NODES }, () => '0').join(',') + ']'
    expect(buildTree(source, { documentId: 'doc', revision: 0 }, () => 'unused').tree).toBeNull()
    expect(model(JSON.stringify('x'.repeat(10_000))).nodes[0]?.preview.length).toBeLessThan(110)
  })
})

describe('source-based tree commands', () => {
  it.each(['{}', '{\n}', '{"x":1}', '{"x":900719925474099312345}'])(
    'adds to object %s without serializing other values',
    (text) => {
      const result = execute(text, (tree) => ({
        kind: 'add',
        nodeId: tree.rootId,
        key: '__proto__',
        valueType: 'string',
        valueText: '"ok"',
      }))
      expect(Object.hasOwn(JSON.parse(result), '__proto__')).toBe(true)
      if (text.includes('900719925474099312345')) expect(result).toContain('900719925474099312345')
    },
  )
  it.each(['[]', '[1]', '[1,2]'])('appends to array %s', (text) => {
    const result = execute(text, (tree) => ({
      kind: 'add',
      nodeId: tree.rootId,
      valueType: 'null',
      valueText: 'null',
    }))
    expect(JSON.parse(result).at(-1)).toBeNull()
  })
  it.each([0, 1, 2])('deletes array element %s with valid comma handling', (position) => {
    const result = execute('[1,2,3]', (tree) => ({
      kind: 'delete',
      nodeId: tree.nodes[0]!.children[position]!,
    }))
    expect(JSON.parse(result)).toEqual([1, 2, 3].filter((_, index) => index !== position))
  })
  it.each(['a', 'b', 'c'])('deletes object member %s with valid comma handling', (key) => {
    const result = execute('{\r\n  "a":1,\r\n  "b":[2],\r\n  "c":3\r\n}', (tree) => ({
      kind: 'delete',
      nodeId: nodeWithKey(tree, key).id,
    }))
    expect(Object.keys(JSON.parse(result))).toEqual(['a', 'b', 'c'].filter((item) => item !== key))
  })
  it('deletes sole members and renames escaped keys atomically with a value update', () => {
    expect(
      JSON.parse(
        execute('{"a":1}', (tree) => ({ kind: 'delete', nodeId: nodeWithKey(tree, 'a').id })),
      ),
    ).toEqual({})
    expect(
      JSON.parse(
        execute('[1]', (tree) => ({ kind: 'delete', nodeId: tree.nodes[0]!.children[0]! })),
      ),
    ).toEqual([])
    const result = execute('{"a":1,"keep":1.2300e+02}', (tree) => ({
      kind: 'update',
      nodeId: nodeWithKey(tree, 'a').id,
      key: 'quote"😀',
      valueType: 'number',
      valueText: '900719925474099312345',
    }))
    expect(Object.keys(JSON.parse(result))[0]).toBe('quote"😀')
    expect(result).toContain('900719925474099312345')
    expect(result).toContain('1.2300e+02')
  })
  it.each([
    ['object', '{}'],
    ['array', '[]'],
    ['string', '"word"'],
    ['number', '-0'],
    ['boolean', 'true'],
    ['null', 'null'],
  ] as const)('converts root to %s', (valueType, valueText) => {
    expect(
      execute('{"old":[1]}', (tree) => ({
        kind: 'update',
        nodeId: tree.rootId,
        valueType,
        valueText,
      })),
    ).toBe(valueText)
  })
  it('rejects root deletion, duplicate keys, invalid/mismatched values and scalar additions', () => {
    expect(() => execute('{}', (tree) => ({ kind: 'delete', nodeId: tree.rootId }))).toThrow(/根/)
    expect(() =>
      execute('{"a":1,"b":2}', (tree) => ({
        kind: 'update',
        nodeId: nodeWithKey(tree, 'b').id,
        key: 'a',
      })),
    ).toThrow(/已存在/)
    expect(() =>
      execute('{}', (tree) => ({
        kind: 'add',
        nodeId: tree.rootId,
        key: 'a',
        valueType: 'number',
        valueText: '"wrong"',
      })),
    ).toThrow(/类型/)
    expect(() =>
      execute('{}', (tree) => ({ kind: 'update', nodeId: tree.rootId, valueText: '{' })),
    ).toThrow(/合法 JSON/)
    expect(() =>
      execute('1', (tree) => ({
        kind: 'add',
        nodeId: tree.rootId,
        valueType: 'null',
        valueText: 'null',
      })),
    ).toThrow(/Object/)
  })
  it('rejects overlapping source edits', () => {
    expect(() =>
      applySourceEdits('1234', [
        { offset: 0, length: 3, text: '' },
        { offset: 2, length: 1, text: '' },
      ]),
    ).toThrow(/冲突/)
  })
})

describe('worker document engine', () => {
  it('preserves array sibling IDs across deletion and rejects stale commands', () => {
    const engine = new JsonDocumentEngine('stable')
    const request = {
      documentId: 'doc',
      revision: 0,
      requestId: 1,
      action: 'validate' as const,
      text: '[{"a":1},{"a":2}]',
    }
    const original = engine.execute(request).tree!
    const first = original.nodes[0]!.children[0]!
    const second = original.nodes[0]!.children[1]!
    const result = engine.execute({
      ...request,
      requestId: 2,
      action: 'tree',
      command: { kind: 'delete', nodeId: first },
    })
    const changedText = applySourceEdits(request.text, result.edits)
    const next = engine.execute({ ...request, revision: 1, requestId: 3, text: changedText }).tree!
    expect(next.nodes[0]!.children).toEqual([second])
    const stale = engine.execute({
      ...request,
      requestId: 4,
      action: 'tree',
      command: { kind: 'delete', nodeId: first },
    })
    expect(stale.edits).toEqual([])
    expect(stale.commandError).toContain('变化')
    const wrongSource = engine.execute({
      ...request,
      revision: 1,
      text: '{}',
      action: 'tree',
      command: { kind: 'delete', nodeId: second },
    })
    expect(wrongSource.edits).toEqual([])
    expect(wrongSource.commandError).toContain('变化')
  })
  it('does not publish invalid trees or reuse delete hints after unrelated text input', () => {
    const engine = new JsonDocumentEngine('engine')
    const base = {
      documentId: 'doc',
      revision: 0,
      requestId: 1,
      action: 'validate' as const,
      text: '[1,2]',
    }
    const tree = engine.execute(base).tree!
    engine.execute({
      ...base,
      action: 'tree',
      command: { kind: 'delete', nodeId: tree.nodes[0]!.children[0]! },
    })
    expect(engine.execute({ ...base, revision: 1, text: '{' }).tree).toBeUndefined()
    const recovered = engine.execute({ ...base, revision: 2, text: '[3,4]' })
    expect(recovered.tree?.nodes[0]?.children).toHaveLength(2)
    expect(recovered.analysis.valid).toBe(true)
  })
})
