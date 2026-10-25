import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { initialDocumentStatus } from '../../src/core/document/text-session'
import type { EditorStatus } from '../../src/renderer/text-editor/create-editor'
import { App } from '../../src/renderer/app/App'

const editor = vi.hoisted(() => ({
  create: vi.fn(),
  validate: vi.fn(),
  format: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  retry: vi.fn(),
  focusProblem: vi.fn(),
  dispose: vi.fn(),
}))
vi.mock('../../src/renderer/text-editor/create-editor', () => ({ createEditor: editor.create }))
let notify: (status: EditorStatus) => void
const valid: EditorStatus = {
  ...initialDocumentStatus,
  state: 'valid',
  workerReady: true,
  problems: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  editor.create.mockImplementation((_container: HTMLElement, onStatus: typeof notify) => {
    notify = onStatus
    queueMicrotask(() => onStatus(valid))
    return editor
  })
  window.desktop = {
    getAppInfo: vi.fn().mockResolvedValue({
      name: 'JSONEditor',
      version: '0.1.0',
      platform: 'win32',
      electron: '45.0.0',
    }),
  }
})

it('shows desktop and JSON status, and delegates toolbar actions', async () => {
  render(<App />)
  expect((await screen.findByText('桌面连接正常 · v0.1.0')).textContent).toContain('v0.1.0')
  await screen.findByText('JSON 有效')
  fireEvent.click(screen.getByRole('button', { name: '格式化' }))
  fireEvent.click(screen.getByRole('button', { name: '校验' }))
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  expect(editor.format).toHaveBeenCalledOnce()
  expect(editor.validate).toHaveBeenCalledOnce()
  expect(editor.undo).toHaveBeenCalledOnce()
})

it('reports a rejected desktop connection', async () => {
  window.desktop = { getAppInfo: vi.fn().mockRejectedValue(new Error('Unavailable')) }
  render(<App />)
  expect((await screen.findByText('桌面连接失败')).textContent).toBe('桌面连接失败')
})

it('links located errors to the editor and offers recovery', async () => {
  const { unmount } = render(<App />)
  await screen.findByText('JSON 有效')
  const problem = {
    offset: 12,
    length: 1,
    line: 2,
    column: 4,
    code: 'InvalidSymbol',
    severity: 'error' as const,
    message: '存在非法字符',
  }
  act(() => notify({ ...valid, state: 'invalid', diagnostics: [problem], problems: [problem] }))
  fireEvent.click(screen.getByRole('button', { name: /第 2 行，第 4 列/ }))
  expect(editor.focusProblem).toHaveBeenCalledWith(problem)
  act(() => notify({ ...valid, state: 'failed', workerReady: false, message: '后台不可用' }))
  fireEvent.click(screen.getByRole('button', { name: '重试后台' }))
  expect(editor.retry).toHaveBeenCalledOnce()
  unmount()
  expect(editor.dispose).toHaveBeenCalledOnce()
})
