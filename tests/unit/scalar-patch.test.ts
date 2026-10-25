import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildTree, indexTree } from '../../src/core/tree-model/model'
import { applyScalarTreePatch } from '../../src/core/tree-model/scalar-patch'
import { compileTreeCommand, applySourceEdits } from '../../src/core/commands/tree-commands'
import { JsonDocumentEngine } from '../../src/core/tree-model/document-engine'
import * as json from '../../src/core/json/engine'

afterEach(() => vi.restoreAllMocks())
describe('scalar projection optimization', () => {
  it.each([
    'null',
    'true',
    'false',
    '900719925474099312345',
    '-0',
    '1e999',
    '"😀文字\\u0061"',
    '"' + 'x'.repeat(120) + '"',
  ])('matches full independent parsing for %s', (value) => {
    for (const source of [
      '1',
      '[1,2,3]',
      '{"before":0,"box":{"n":1,"next":[true]},"after":false}',
    ]) {
      let id = 0
      const tree = buildTree(source, { documentId: 'd', revision: 0 }, () => String(++id)).tree!
      const target = source.startsWith('{')
        ? tree.nodes.find((node) => node.key === 'n')!
        : source.startsWith('[')
          ? tree.nodes[2]!
          : tree.nodes[0]!
      const result = compileTreeCommand(source, tree, {
        kind: 'update',
        nodeId: target.id,
        valueText: value,
      })
      const next = applyScalarTreePatch(tree, result.scalarPatch!)
      const text = applySourceEdits(source, result.edits)
      const rebuilt = buildTree(
        text,
        { documentId: 'd', revision: 1 },
        () => String(++id),
        null,
        undefined,
        { restoredIds: tree.nodes.map((node) => node.id) },
      ).tree!
      expect(next).toEqual(rebuilt)
      expect(tree.revision).toBe(0)
      expect(indexTree(tree)).toBe(indexTree(tree))
    }
  })
  it('shares unchanged node objects for equal-length edits and never mutates the previous tree', () => {
    let id = 0
    const tree = buildTree('[1,2,3]', { documentId: 'd', revision: 0 }, () => String(++id)).tree!
    const result = compileTreeCommand('[1,2,3]', tree, {
      kind: 'update',
      nodeId: tree.nodes[2]!.id,
      valueText: '9',
    })
    const next = applyScalarTreePatch(tree, result.scalarPatch!)
    expect(next.nodes[0]).toBe(tree.nodes[0])
    expect(next.nodes[1]).toBe(tree.nodes[1])
    expect(next.nodes[2]).not.toBe(tree.nodes[2])
    expect(tree.nodes[2]!.preview).toBe('2')
  })
  it('falls back to full validation for structural replacements and key changes', () => {
    let id = 0
    const source = '{"n":1}'
    const tree = buildTree(source, { documentId: 'd', revision: 0 }, () => String(++id)).tree!
    expect(
      compileTreeCommand(source, tree, {
        kind: 'update',
        nodeId: tree.nodes[1]!.id,
        valueText: '{}',
      }).scalarPatch,
    ).toBeUndefined()
    expect(
      compileTreeCommand(source, tree, {
        kind: 'update',
        nodeId: tree.nodes[1]!.id,
        key: 'a',
        valueText: '2',
      }).scalarPatch,
    ).toBeUndefined()
  })
  it('validates only the new scalar and avoids whole-source analysis on the confirmed fast path', () => {
    const engine = new JsonDocumentEngine('fast')
    const base = {
      documentId: 'doc',
      revision: 0,
      requestId: 1,
      action: 'validate' as const,
      text: '{"n":1,"large":[true,false,null]}',
    }
    const tree = engine.execute(base).tree!
    const spy = vi.spyOn(json, 'analyzeJson')
    const result = engine.execute({
      ...base,
      action: 'tree',
      command: { kind: 'update', nodeId: tree.nodes[1]!.id, valueText: '2' },
    })
    const text = applySourceEdits(base.text, result.edits)
    const committed = engine.execute({ ...base, revision: 1, text })
    expect(spy.mock.calls.map(([source]) => source)).toEqual(['2'])
    expect(committed.treePatch).toBeDefined()
    expect(committed.tree?.nodes[1]?.preview).toBe('2')
    expect(JSON.stringify(committed.treePatch).length).toBeLessThan(
      JSON.stringify(committed.tree).length,
    )
  })
  it('does not reuse a prepared projection for unrelated newer text', () => {
    const engine = new JsonDocumentEngine('race')
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
      command: { kind: 'update', nodeId: tree.nodes[1]!.id, valueText: '3' },
    })
    const result = engine.execute({ ...base, revision: 1, text: '[4,5]' })
    expect(result.treePatch).toBeUndefined()
    expect(result.tree?.nodes[1]?.preview).toBe('4')
  })
  it('rejects mismatched base versions, target ranges and container types', () => {
    let id = 0
    const tree = buildTree('[1]', { documentId: 'd', revision: 0 }, () => String(++id)).tree!
    const patch = compileTreeCommand('[1]', tree, {
      kind: 'update',
      nodeId: tree.nodes[1]!.id,
      valueText: '2',
    }).scalarPatch!
    for (const invalid of [
      { ...patch, baseRevision: 2 },
      { ...patch, documentId: 'other' },
      { ...patch, nodeId: 'missing' },
      { ...patch, type: 'array' as const },
      { ...patch, edit: { ...patch.edit, offset: 0 } },
    ])
      expect(() => applyScalarTreePatch(tree, invalid)).toThrow()
  })
})
