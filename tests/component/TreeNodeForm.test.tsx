import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { TreeNodeForm } from '../../src/renderer/tree-editor/TreeNodeForm'
import { buildTree, indexTree } from '../../src/core/tree-model/model'

function renderForm(disabled = false) {
  let id = 0
  const tree = buildTree(
    '{"n":900719925474099312345,"items":[]}',
    { documentId: 'doc', revision: 0 },
    () => String(++id),
  ).tree!
  const index = indexTree(tree)
  const node = tree.nodes.find((item) => item.key === 'n')!
  const command = vi.fn()
  const locate = vi.fn()
  const props = {
    node,
    parent: index.get(node.parentId!)!,
    rawValue: '900719925474099312345',
    disabled,
    onCommand: command,
    onLocate: locate,
  }
  return { ...render(<TreeNodeForm {...props} />), command, locate, tree, index }
}

it('submits key and exact numeric source in one operation', () => {
  const h = renderForm()
  fireEvent.change(screen.getByRole('textbox', { name: '属性名' }), {
    target: { value: 'renamed' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: '节点 JSON 值' }), {
    target: { value: '900719925474099312346' },
  })
  fireEvent.click(screen.getByRole('button', { name: '应用节点修改' }))
  expect(h.command).toHaveBeenCalledWith({
    kind: 'update',
    nodeId: '2',
    key: 'renamed',
    valueType: 'number',
    valueText: '900719925474099312346',
  })
  fireEvent.click(screen.getByRole('button', { name: '定位文本' }))
  expect(h.locate).toHaveBeenCalledOnce()
})

it('stages a type change before applying it', () => {
  const h = renderForm()
  fireEvent.change(screen.getByRole('combobox', { name: '节点类型' }), {
    target: { value: 'array' },
  })
  expect(h.command).not.toHaveBeenCalled()
  expect((screen.getByRole('textbox', { name: '节点 JSON 值' }) as HTMLTextAreaElement).value).toBe(
    '[]',
  )
  fireEvent.click(screen.getByRole('button', { name: '应用节点修改' }))
  expect(h.command).toHaveBeenCalledWith({
    kind: 'update',
    nodeId: '2',
    valueType: 'array',
    valueText: '[]',
  })
})

it('disables stale structure edits', () => {
  const h = renderForm(true)
  fireEvent.click(screen.getByRole('button', { name: '删除节点' }))
  expect(h.command).not.toHaveBeenCalled()
})

it('prevents root deletion and stages array additions', () => {
  let id = 0
  const tree = buildTree('[]', { documentId: 'doc', revision: 0 }, () => String(++id)).tree!
  const command = vi.fn()
  render(
    <TreeNodeForm
      node={tree.nodes[0]!}
      parent={undefined}
      rawValue="[]"
      disabled={false}
      onCommand={command}
      onLocate={() => {}}
    />,
  )
  expect((screen.getByRole('button', { name: '删除节点' }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  fireEvent.change(screen.getByRole('combobox', { name: '新节点类型' }), {
    target: { value: 'boolean' },
  })
  fireEvent.click(screen.getByRole('button', { name: '新增子节点' }))
  expect(command).toHaveBeenCalledWith({
    kind: 'add',
    nodeId: '1',
    valueType: 'boolean',
    valueText: 'false',
  })
})
