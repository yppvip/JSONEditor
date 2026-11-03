// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import type { DesktopResult } from '../../src/shared/desktop-api'
const native = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  open: vi.fn(),
  save: vi.fn(),
  confirm: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => 'unused' },
  BrowserWindow: {
    fromWebContents: (sender: unknown) => ({ webContents: sender }),
    getFocusedWindow: () => null,
  },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
      native.handlers.set(channel, handler),
  },
  dialog: {
    showOpenDialog: native.open,
    showSaveDialog: native.save,
    showMessageBox: native.confirm,
  },
  clipboard: { readText: native.read, writeText: native.write },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
}))
import { DesktopHandlers, validSaveRequest } from '../../src/main/desktop-handlers'
const frame = { url: 'app://editor/index.html' }
const event = { sender: { id: 1, mainFrame: frame }, senderFrame: frame }
const invoke = async (channel: string, ...args: unknown[]) =>
  native.handlers.get(channel)!(event, ...args) as Promise<DesktopResult<unknown>>
beforeEach(() => {
  vi.clearAllMocks()
  native.handlers.clear()
  new DesktopHandlers(frame.url).register()
})
it('validates exact save schema and opaque IDs without accepting renderer paths', () => {
  expect(validSaveRequest({ fileId: null, text: '{}', saveAs: true })).toBe(true)
  expect(
    validSaveRequest({
      fileId: null,
      text: '{}',
      saveAs: true,
      editModes: [{ pointer: '/a', mode: 'auto' }],
    }),
  ).toBe(true)
  expect(
    validSaveRequest({
      fileId: null,
      text: '{}',
      saveAs: true,
      editModes: [{ pointer: '/a', mode: 'auto', path: 'D:/arbitrary' }],
    }),
  ).toBe(false)
  for (const invalid of [
    { fileId: null, text: '{}', saveAs: true, path: 'C:\\x' },
    { fileId: 'C:\\x', text: '{}', saveAs: false },
    { fileId: null, text: 2, saveAs: true },
    null,
  ])
    expect(validSaveRequest(invalid)).toBe(false)
})
it('rejects unauthorized frames and extra arguments before calling native APIs', async () => {
  const foreign = { ...event, senderFrame: { url: 'https://example.com' } }
  const result = (await native.handlers.get('desktop:read-clipboard')!(
    foreign,
  )) as DesktopResult<unknown>
  expect(result).toMatchObject({ ok: false, code: 'unauthorized' })
  expect(await invoke('desktop:open-file', 'unexpected')).toMatchObject({
    ok: false,
    code: 'invalid-request',
  })
  expect(native.read).not.toHaveBeenCalled()
  expect(native.open).not.toHaveBeenCalled()
})
it('retains the exclusive lock when rejected overlapping operations finish first', async () => {
  let resolve!: (value: { canceled: boolean; filePaths: string[] }) => void
  native.open.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r
    }),
  )
  const first = invoke('desktop:open-file')
  expect(await invoke('desktop:open-file')).toMatchObject({ ok: false, code: 'busy' })
  expect(await invoke('desktop:open-file')).toMatchObject({ ok: false, code: 'busy' })
  expect(native.open).toHaveBeenCalledOnce()
  resolve({ canceled: true, filePaths: [] })
  await first
  native.open.mockResolvedValueOnce({ canceled: true, filePaths: [] })
  expect(await invoke('desktop:open-file')).toMatchObject({ ok: false, code: 'cancelled' })
})
it('awaits native clipboard failures rather than reporting false success', async () => {
  native.write.mockRejectedValueOnce(new Error('Clipboard unavailable'))
  expect(await invoke('desktop:write-clipboard', '{}')).toMatchObject({ ok: false, code: 'io' })
  native.read.mockResolvedValueOnce('[1]')
  expect(await invoke('desktop:read-clipboard')).toEqual({ ok: true, value: '[1]' })
})
it('rejects unknown save capabilities before displaying a Save As dialog', async () => {
  expect(
    await invoke('desktop:save-file', {
      fileId: '11111111-1111-4111-8111-111111111111',
      text: '{}',
      saveAs: true,
    }),
  ).toMatchObject({ ok: false, code: 'unauthorized' })
  expect(native.save).not.toHaveBeenCalled()
})
it('rejects a forged close acknowledgement with no pending nonce', async () => {
  await expect(
    invoke('desktop:close-reply', '11111111-1111-4111-8111-111111111111', true),
  ).rejects.toThrow(/close reply/)
})
