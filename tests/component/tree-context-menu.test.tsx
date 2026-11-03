import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { buildTree } from '../../src/core/tree-model/model'
import { TreeContextMenu } from '../../src/renderer/tree-editor/TreeContextMenu'
beforeEach(() => vi.stubGlobal('CSS', { escape: (value: string) => value }))
afterEach(() => vi.unstubAllGlobals())
function fixture(root = false, enabled = true) {
  let n = 0
  const tree = buildTree('{"a":1,"b":2}', { documentId: 'doc', revision: 7 }, () => `n${++n}`).tree!
  const node = tree.nodes[root ? 0 : 1]!,
    command = vi.fn(),
    close = vi.fn(),
    dialog = vi.fn()
  render(
    <TreeContextMenu
      anchor={{ id: node.id, x: 20, y: 30 }}
      tree={tree}
      node={node}
      enabled={enabled}
      current={enabled}
      onCommand={command}
      onClose={close}
      onDialog={dialog}
      onLocate={vi.fn()}
    />,
  )
  return { tree, node, command, close, dialog }
}
it('root exposes creation but disables sibling operations and removal', () => {
  fixture(true)
  expect((screen.getByRole('menuitem', { name: '添加子节点' }) as HTMLButtonElement).disabled).toBe(
    false,
  )
  for (const name of ['追加', '插入', '复制节点', '移除'])
    expect((screen.getByRole('menuitem', { name }) as HTMLButtonElement).disabled).toBe(true)
})
it('readonly menus disable mutations and keep the more entry available', () => {
  fixture(false, false)
  expect((screen.getByRole('menuitem', { name: '类型' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('menuitem', { name: '更多' }))
  for (const name of ['上移节点', '下移节点', '完整 JSON 编辑…', '转到代码'])
    expect((screen.getByRole('menuitem', { name }) as HTMLButtonElement).disabled).toBe(true)
})
it('sibling actions submit the captured node and revision exactly once', () => {
  const { command, close, node } = fixture()
  fireEvent.click(screen.getByRole('menuitem', { name: '追加' }))
  expect(command).toHaveBeenCalledExactlyOnceWith(
    { kind: 'insert', nodeId: node.id, position: 'after' },
    7,
  )
  expect(close).toHaveBeenCalledOnce()
})
it('keyboard opens a submenu, traverses options and returns focus with Escape', () => {
  const { command, node } = fixture()
  const trigger = screen.getByRole('menuitem', { name: '类型' })
  expect(document.activeElement).toBe(trigger)
  fireEvent.keyDown(trigger, { key: 'ArrowRight' })
  const automatic = screen.getByRole('menuitemradio', { name: '自动' })
  expect(document.activeElement).toBe(automatic)
  fireEvent.keyDown(automatic, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '字符串' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: '字符串' }))
  expect(command).toHaveBeenCalledWith({ kind: 'set-mode', nodeId: node.id, mode: 'string' }, 7)
  fireEvent.keyDown(screen.getByRole('menuitemradio', { name: '字符串' }), { key: 'Escape' })
  expect(document.activeElement).toBe(trigger)
})
it('outside pointer dismissal and explicit advanced dialog selection are supported', () => {
  const { close, dialog } = fixture()
  fireEvent.pointerDown(document.body)
  expect(close).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('menuitem', { name: '更多' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '移动到…' }))
  expect(dialog).toHaveBeenCalledWith('move')
})
