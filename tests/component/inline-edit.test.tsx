import { useContext } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { buildTree } from '../../src/core/tree-model/model'
import { InlineEdit } from '../../src/renderer/tree-editor/InlineEdit'
import { BeginInlineEdit } from '../../src/renderer/tree-editor/inline-edit-context'

beforeEach(() => {
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function fixture(documentId = 'doc', revision = 0) {
  let id = 0
  const text = '{"name":"hello"}'
  const tree = buildTree(text, { documentId, revision }, () => `node${++id}`).tree!
  return {
    tree,
    readValue: (node: { offset: number; length: number }) =>
      text.slice(node.offset, node.offset + node.length),
  }
}
function Start() {
  const begin = useContext(BeginInlineEdit)
  return <button onClick={() => begin('node2', 'value')}>编辑</button>
}
function view(onCommand = vi.fn(), documentId = 'doc', revision = 0) {
  return (
    <InlineEdit
      {...fixture(documentId, revision)}
      current
      error=""
      onCommand={onCommand}
      onLocate={vi.fn()}
    >
      <Start />
    </InlineEdit>
  )
}
it('equivalent automatic input closes without a phantom transaction or pending state', () => {
  const command = vi.fn()
  let id = 0
  const text = '{"n":1}'
  const tree = buildTree(text, { documentId: 'doc', revision: 0 }, () => `node${++id}`).tree!
  render(
    <InlineEdit
      tree={tree}
      current
      error=""
      readValue={(node) => text.slice(node.offset, node.offset + node.length)}
      onCommand={command}
      onLocate={vi.fn()}
    >
      <Start />
    </InlineEdit>,
  )
  fireEvent.click(screen.getByText('编辑'))
  const input = screen.getByRole('textbox', { name: '行内值' })
  fireEvent.change(input, { target: { value: ' 1 ' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(command).not.toHaveBeenCalled()
  expect(screen.queryByRole('textbox', { name: '行内值' })).toBeNull()
})
it('a rejected command preserves the editable draft with a retry explanation', () => {
  const command = vi.fn().mockReturnValue(false)
  render(view(command))
  fireEvent.click(screen.getByText('编辑'))
  const input = screen.getByRole('textbox', { name: '行内值' })
  fireEvent.change(input, { target: { value: '123' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(command).toHaveBeenCalledWith({ kind: 'edit-value', nodeId: 'node2', value: '123' }, 0)
  expect(screen.getByRole('alert').textContent).toContain('暂不可编辑')
  expect((input as HTMLInputElement).value).toBe('123')
  expect((input as HTMLInputElement).readOnly).toBe(false)
})
it('an unacknowledged transaction times out without discarding the draft', () => {
  vi.useFakeTimers()
  render(view())
  fireEvent.click(screen.getByText('编辑'))
  const input = screen.getByRole('textbox', { name: '行内值' }) as HTMLInputElement
  fireEvent.change(input, { target: { value: 'draft' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(input.readOnly).toBe(true)
  act(() => {
    vi.advanceTimersByTime(16_000)
  })
  expect(input.value).toBe('draft')
  expect(input.readOnly).toBe(false)
  expect(screen.getByRole('alert').textContent).toContain('提交未确认')
})
it('a changed revision preserves stale text while switching documents removes the old draft', async () => {
  const command = vi.fn(),
    { rerender } = render(view(command))
  fireEvent.click(screen.getByText('编辑'))
  fireEvent.change(screen.getByRole('textbox', { name: '行内值' }), {
    target: { value: 'unsaved' },
  })
  rerender(view(command, 'doc', 1))
  const input = screen.getByRole('textbox', { name: '行内值' }) as HTMLInputElement
  expect(input.value).toBe('unsaved')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(command).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('文档已变化')
  rerender(view(command, 'other'))
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '行内值' })).toBeNull())
})

it('a Worker identity reset closes an untouched editor and preserves a modified draft', async () => {
  const command = vi.fn()
  const { rerender } = render(view())
  fireEvent.click(screen.getByText('编辑'))
  const data = fixture('doc', 1)
  let next = 100
  const rebuilt = buildTree(
    '{"name":"hello"}',
    { documentId: 'doc', revision: 0 },
    () => `node${++next}`,
  ).tree!
  rerender(
    <InlineEdit
      tree={rebuilt}
      readValue={data.readValue}
      current
      error=""
      onCommand={command}
      onLocate={vi.fn()}
    >
      <Start />
    </InlineEdit>,
  )
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '行内值' })).toBeNull())
  rerender(view())
  fireEvent.click(screen.getByText('编辑'))
  fireEvent.change(screen.getByRole('textbox', { name: '行内值' }), {
    target: { value: 'keep me' },
  })
  rerender(
    <InlineEdit
      tree={rebuilt}
      readValue={data.readValue}
      current
      error=""
      onCommand={command}
      onLocate={vi.fn()}
    >
      <Start />
    </InlineEdit>,
  )
  expect((screen.getByRole('textbox', { name: '行内值' }) as HTMLInputElement).value).toBe(
    'keep me',
  )
  fireEvent.keyDown(screen.getByRole('textbox', { name: '行内值' }), { key: 'Enter' })
  expect(command).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('文档已变化')
})
