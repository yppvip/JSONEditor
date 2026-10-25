import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { StructuralActions } from '../../src/renderer/tree-editor/StructuralActions'
import { buildTree } from '../../src/core/tree-model/model'

function harness(disabled = false) {
  let id = 0
  const tree = buildTree('{"a":1,"box":{"a/b~":[]}}', { documentId: 'doc', revision: 0 }, () =>
    String(++id),
  ).tree!
  const node = tree.nodes[1]!
  const onCommand = vi.fn()
  render(<StructuralActions tree={tree} node={node} disabled={disabled} onCommand={onCommand} />)
  return { tree, node, onCommand }
}
it('resolves escaped JSON Pointer targets and submits an explicit move', () => {
  const h = harness()
  fireEvent.change(screen.getByRole('textbox', { name: '移动目标 JSON Pointer' }), {
    target: { value: '/box/a~1b~0' },
  })
  fireEvent.click(screen.getByRole('button', { name: '移动节点' }))
  expect(h.onCommand).toHaveBeenCalledWith({
    kind: 'move',
    nodeId: h.node.id,
    parentId: h.tree.nodes[3]!.id,
    index: 0,
  })
  fireEvent.change(screen.getByRole('textbox', { name: '移动目标 JSON Pointer' }), {
    target: { value: '/box/~2' },
  })
  fireEvent.click(screen.getByRole('button', { name: '移动节点' }))
  expect(screen.getByRole('alert', { name: '移动输入错误' }).textContent).toContain(
    '合法 JSON Pointer',
  )
})
it('blocks form submits while the tree is stale', () => {
  const h = harness(true)
  const button = screen.getByRole('button', { name: '移动节点' })
  fireEvent.submit(button.closest('form')!)
  expect(h.onCommand).not.toHaveBeenCalled()
})
