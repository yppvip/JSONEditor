import { describe, expect, it } from 'vitest'
import { buildTree, indexTree } from '../../src/core/tree-model/model'
import { compileTreeCommand, applySourceEdits } from '../../src/core/commands/tree-commands'
import type { TreeCommand } from '../../src/core/commands/tree-commands'
import { JsonDocumentEngine } from '../../src/core/tree-model/document-engine'

function document(text: string) {
  let sequence = 0
  const tree = buildTree(text, { documentId: 'doc', revision: 0 }, () => String(++sequence)).tree!
  const byKey = (key: string) => tree.nodes.find((node) => node.key === key)!
  return {
    tree,
    byKey,
    run: (command: TreeCommand) => {
      const result = compileTreeCommand(text, tree, command)
      const source = applySourceEdits(text, result.edits)
      const next = buildTree(
        source,
        { documentId: 'doc', revision: 1 },
        () => String(++sequence),
        tree,
        undefined,
        result.identityIds ? { restoredIds: result.identityIds } : undefined,
      ).tree!
      return { source, tree: next, result }
    },
  }
}
describe('source preserving structural commands', () => {
  it('rejects a move that would exceed the depth limit before committing source edits', () => {
    let branch = 'true',
      target = '{}'
    for (let i = 0; i < 270; i++) {
      branch = '{"b":' + branch + '}'
      target = '{"t":' + target + '}'
    }
    const d = document('{"branch":' + branch + ',"target":' + target + '}')
    const leaf = d.tree.nodes.find((node) => node.type === 'object' && !node.children.length)!
    expect(() =>
      d.run({ kind: 'move', nodeId: d.byKey('branch').id, parentId: leaf.id, index: 0 }),
    ).toThrow(/嵌套/)
  })
  it('bounds exponent comparison work instead of rounding extreme numbers', () => {
    const d = document('[1e' + '9'.repeat(1025) + ',1]')
    expect(() => d.run({ kind: 'sort', nodeId: d.tree.rootId, direction: 'asc' })).toThrow(
      /指数过长/,
    )
  })
  it.each([
    [0, 2],
    [2, 0],
    [1, 0],
    [1, 1],
  ] as const)('moves sibling %i to final position %i', (from, to) => {
    const d = document('[1,2,3]')
    const original = d.tree.nodes[0]!.children
    const order = [...original]
    const [id] = order.splice(from, 1)
    order.splice(to, 0, id!)
    const result = d.run({ kind: 'move', nodeId: id!, parentId: d.tree.rootId, index: to })
    expect(result.tree.nodes[0]!.children).toEqual(order)
    expect(result.tree.nodes.map((node) => node.id)).toEqual([d.tree.rootId, ...order])
    if (from === to) expect(result.result.edits).toEqual([])
  })
  it('moves an object subtree into an array and retains descendant IDs and numeric source', () => {
    const d = document('{"value":{"n":900719925474099312345},"target":[false]}')
    const result = d.run({
      kind: 'move',
      nodeId: d.byKey('value').id,
      parentId: d.byKey('target').id,
      index: 1,
    })
    const moved = indexTree(result.tree).get(d.byKey('value').id)!
    expect(moved.parentId).toBe(d.byKey('target').id)
    expect(moved.key).toBeNull()
    expect(moved.index).toBe(1)
    expect(indexTree(result.tree).get(d.byKey('n').id)!.parentId).toBe(moved.id)
    expect(result.source).toContain('900719925474099312345')
    expect(JSON.parse(result.source)).toHaveProperty('target')
  })
  it('moves an array element into an object with an explicit escaped or empty key', () => {
    for (const key of ['', 'a/b~"']) {
      const d = document('{"source":[true],"target":{}}')
      const source = indexTree(d.tree).get(d.byKey('source').children[0]!)!
      const result = d.run({
        kind: 'move',
        nodeId: source.id,
        parentId: d.byKey('target').id,
        index: 0,
        key,
      })
      expect(indexTree(result.tree).get(source.id)!.key).toBe(key)
      expect(JSON.parse(result.source).target[key]).toBe(true)
    }
  })
  it('moves a descendant up into its ancestor and handles a destination nested inside the source parent', () => {
    const d = document('{"a":{"x":1,"b":{}},"z":2}')
    const up = d.run({ kind: 'move', nodeId: d.byKey('x').id, parentId: d.tree.rootId, index: 0 })
    expect(indexTree(up.tree).get(d.byKey('x').id)!.parentId).toBe(d.tree.rootId)
    const down = d.run({
      kind: 'move',
      nodeId: d.byKey('x').id,
      parentId: d.byKey('b').id,
      index: 0,
    })
    expect(JSON.parse(down.source).a.b.x).toBe(1)
    expect(indexTree(down.tree).get(d.byKey('x').id)!.parentId).toBe(d.byKey('b').id)
  })
  it('moves an object property under a new name without rewriting unmodified raw literals', () => {
    const d = document('{"a":{"escaped":"\\u0061","n":-0},"target":{"v":1e+10}}')
    const result = d.run({
      kind: 'move',
      nodeId: d.byKey('a').id,
      parentId: d.byKey('target').id,
      index: 0,
      key: 'renamed',
    })
    expect(result.source).toContain('"\\u0061"')
    expect(result.source).toContain('-0')
    expect(result.source).toContain('1e+10')
    expect(indexTree(result.tree).get(d.byKey('a').id)!.key).toBe('renamed')
  })
  it('sorts only direct object members by ordinal UTF-16 key and preserves numeric-looking keys', () => {
    const d = document('{"z":{"b":1,"a":2},"2":-0,"10":1e9,"a":"\\u0061"}')
    const result = d.run({ kind: 'sort', nodeId: d.tree.rootId, direction: 'asc' })
    expect(result.tree.nodes[0]!.children.map((id) => indexTree(result.tree).get(id)!.key)).toEqual(
      ['10', '2', 'a', 'z'],
    )
    expect(result.source).toContain('"b":1,"a":2')
    expect(result.source).toContain('1e9')
    expect(new Set(result.tree.nodes.map((node) => node.id))).toEqual(
      new Set(d.tree.nodes.map((node) => node.id)),
    )
  })
  it.each([
    [
      '[900719925474099312346,900719925474099312345,-0,0,-1e999,1e999,1.00,1]',
      ['-1e999', '-0', '0', '1.00', '1', '900719925474099312345', '900719925474099312346', '1e999'],
    ],
    ['[1e-999,0.001,0,-1e-999,-0.001]', ['-0.001', '-1e-999', '0', '1e-999', '0.001']],
    ['[true,false,true]', ['false', 'true', 'true']],
    ['["z","a","\\u0061"]', ['"a"', '"\\u0061"', '"z"']],
    ['[null,null]', ['null', 'null']],
  ])('sorts homogeneous scalars exactly and stably: %s', (text, expected) => {
    const d = document(text as string)
    const result = d.run({ kind: 'sort', nodeId: d.tree.rootId, direction: 'asc' })
    expect(
      result.tree.nodes
        .slice(1)
        .map((node) => result.source.slice(node.offset, node.offset + node.length)),
    ).toEqual(expected)
    const desc = d.run({ kind: 'sort', nodeId: d.tree.rootId, direction: 'desc' })
    expect(desc.tree.nodes).toHaveLength(d.tree.nodes.length)
  })
  it('rejects roots, cycles, invalid positions, non-containers, missing names and collisions', () => {
    const d = document('{"a":{"x":1},"b":{"a":2},"list":[true]}')
    const commands: TreeCommand[] = [
      { kind: 'move', nodeId: d.tree.rootId, parentId: d.byKey('b').id, index: 0 },
      { kind: 'move', nodeId: d.byKey('a').id, parentId: d.byKey('a').id, index: 0 },
      { kind: 'move', nodeId: d.byKey('a').id, parentId: d.byKey('x').id, index: 0 },
      { kind: 'move', nodeId: d.byKey('x').id, parentId: d.tree.rootId, index: -1 },
      { kind: 'move', nodeId: d.byKey('x').id, parentId: d.tree.rootId, index: 99 },
      { kind: 'move', nodeId: d.byKey('x').id, parentId: d.tree.rootId, index: 0.5 },
      { kind: 'move', nodeId: d.byKey('a').id, parentId: d.byKey('b').id, index: 0 },
      { kind: 'move', nodeId: d.byKey('list').children[0]!, parentId: d.byKey('b').id, index: 0 },
    ]
    for (const command of commands) expect(() => d.run(command)).toThrow()
    const nested = document('{"a":{"b":{}}}')
    expect(() =>
      nested.run({
        kind: 'move',
        nodeId: nested.byKey('a').id,
        parentId: nested.byKey('b').id,
        index: 0,
      }),
    ).toThrow(/后代/)
  })
  it.each(['[1,"x"]', '[{}]', '[[]]', '1', '{"a":1,"a":2}'])(
    'rejects ambiguous automatic sorting: %s',
    (text) => {
      const d = document(text)
      expect(() => d.run({ kind: 'sort', nodeId: d.tree.rootId, direction: 'asc' })).toThrow()
    },
  )
  it('accepts empty containers and already sorted order as no-op', () => {
    for (const text of ['[]', '{}', '[1,2]', '{"a":1,"b":2}']) {
      const d = document(text)
      expect(d.run({ kind: 'sort', nodeId: d.tree.rootId, direction: 'asc' }).result.edits).toEqual(
        [],
      )
    }
  })
  it('retains moved identity through the engine and rejects stale structural commands', () => {
    const engine = new JsonDocumentEngine('move')
    const request = {
      documentId: 'doc',
      revision: 0,
      requestId: 1,
      action: 'validate' as const,
      text: '[1,2,3]',
    }
    const before = engine.execute(request).tree!
    const moved = before.nodes[1]!.id
    const change = engine.execute({
      ...request,
      action: 'tree',
      command: { kind: 'move', nodeId: moved, parentId: before.rootId, index: 2 },
    })
    const next = engine.execute({
      ...request,
      revision: 1,
      text: applySourceEdits(request.text, change.edits),
    }).tree!
    expect(next.nodes[0]!.children.at(-1)).toBe(moved)
    expect(
      engine.execute({
        ...request,
        action: 'tree',
        command: { kind: 'sort', nodeId: before.rootId, direction: 'desc' },
      }).commandError,
    ).toContain('变化')
  })
})
