import { expect, it, vi } from 'vitest'
import { buildTree } from '../../src/core/tree-model/model'
import { compileTreeCommand } from '../../src/core/commands/tree-commands'
import { applyScalarTreePatch } from '../../src/core/tree-model/scalar-patch'
import {
  TreePresentationStore,
  presentationRoots,
} from '../../src/renderer/tree-editor/presentation-store'

function fixture() {
  let id = 0
  const source = '{"a":1,"b":2}'
  const tree = buildTree(source, { documentId: 'doc', revision: 0 }, () => String(++id)).tree!
  const patch = compileTreeCommand(source, tree, {
    kind: 'update',
    nodeId: tree.nodes[1]!.id,
    valueText: '9',
  }).scalarPatch!
  return { tree, next: applyScalarTreePatch(tree, patch) }
}
it('reuses minimal topology input across scalar patches without holding stale value records', () => {
  const { tree, next } = fixture()
  const roots = presentationRoots(tree)
  expect(presentationRoots(next)).toBe(roots)
  expect(Object.keys(roots[0]!)).toEqual(['id', 'parentId', 'children'])
  expect(roots[0]!.children).toHaveLength(2)
  let id = 100
  const rebuilt = buildTree('{"b":2,"a":9}', { documentId: 'doc', revision: 2 }, () =>
    String(++id),
  ).tree!
  expect(presentationRoots(rebuilt)).not.toBe(roots)
})
it('notifies only subscribed changed rows and keeps unchanged row snapshots stable', () => {
  const { tree, next } = fixture()
  const store = new TreePresentationStore()
  const submit = vi.fn(),
    a = vi.fn(),
    b = vi.fn()
  store.update(tree, true, submit)
  const unA = store.subscribe(tree.nodes[1]!.id, a)
  const unB = store.subscribe(tree.nodes[2]!.id, b)
  const unchanged = store.snapshot(tree.nodes[2]!.id)
  store.update(next, true, submit)
  expect(a).toHaveBeenCalledOnce()
  expect(b).not.toHaveBeenCalled()
  expect(store.snapshot(tree.nodes[2]!.id)).toBe(unchanged)
  expect(store.snapshot(tree.nodes[1]!.id).node?.preview).toBe('9')
  store.update(next, false, submit)
  expect(b).toHaveBeenCalledOnce()
  unA()
  unB()
  store.update(tree, true, submit)
  expect(b).toHaveBeenCalledOnce()
})
it('uses the latest command revision and blocks drops after the tree becomes read-only', () => {
  const { tree, next } = fixture()
  const store = new TreePresentationStore(),
    submit = vi.fn()
  store.update(next, true, submit)
  store.drop(tree.nodes[1]!.id, tree.rootId, 2)
  expect(submit).toHaveBeenCalledWith(
    { kind: 'move', nodeId: tree.nodes[1]!.id, parentId: tree.rootId, index: 1 },
    1,
  )
  store.update(next, false, submit)
  store.drop(tree.nodes[1]!.id, tree.rootId, 2)
  expect(submit).toHaveBeenCalledOnce()
})
