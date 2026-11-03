import { expect, it, vi } from 'vitest'
import { DesktopDocumentSession } from '../../src/renderer/text-editor/desktop-session'
import { desktopStub } from '../desktop-stub'
import type { FileMetadata, OpenedFile } from '../../src/shared/desktop-api'

const file: FileMetadata = {
  fileId: '11111111-1111-4111-8111-111111111111',
  name: 'one.json',
  path: 'D:\\one.json',
  bom: false,
  eol: 'LF',
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function harness() {
  let text = '{}',
    history = 1,
    revision = 0,
    composing = false
  const api = desktopStub(),
    paste = vi.fn((next: string) => {
      text = next
      history++
      revision++
      session.observe(history)
      return true
    })
  const load = vi.fn(async (next: string) => {
    text = next
    history = 1
    revision = 0
  })
  const transform = vi.fn(async () => '{"n":1}')
  const session = new DesktopDocumentSession(api, {
    lock: vi.fn(),
    snapshot: () => ({ text, historyVersion: history, revision, composing }),
    historyVersion: () => history,
    load,
    paste,
    transform,
  })
  return {
    api,
    session,
    load,
    paste,
    transform,
    text: () => text,
    change: (next: string, version = history + 1) => {
      text = next
      history = version
      revision++
      session.observe(history)
    },
    compose: (next: boolean) => {
      composing = next
    },
  }
}
it('saves current invalid source and tracks cleanliness through undo/redo history versions', async () => {
  const h = harness()
  h.change('{broken')
  vi.mocked(h.api.saveFile).mockResolvedValue({ ok: true, value: file })
  await h.session.dispatch('save')
  expect(h.api.saveFile).toHaveBeenCalledWith({ fileId: null, text: '{broken', saveAs: false })
  expect(h.session.getSnapshot().dirty).toBe(false)
  h.change('[]', 3)
  expect(h.session.getSnapshot().dirty).toBe(true)
  h.change('{broken', 2)
  expect(h.session.getSnapshot().dirty).toBe(false)
})
it('does not mark edits made during an asynchronous save as clean', async () => {
  const h = harness(),
    pending = deferred<Awaited<ReturnType<typeof h.api.saveFile>>>()
  h.change('[1]')
  vi.mocked(h.api.saveFile).mockReturnValue(pending.promise)
  const save = h.session.dispatch('save')
  h.change('[2]')
  pending.resolve({ ok: true, value: file })
  await save
  expect(h.session.getSnapshot().dirty).toBe(true)
  expect(h.text()).toBe('[2]')
})
it('keeps dirty state and the old binding after save cancellation or failure', async () => {
  const h = harness()
  h.change('null')
  await h.session.dispatch('saveAs')
  expect(h.session.getSnapshot().dirty).toBe(true)
  vi.mocked(h.api.saveFile).mockResolvedValue({ ok: false, code: 'conflict', message: 'conflict' })
  await h.session.dispatch('save')
  expect(h.session.getSnapshot().error).toBe(true)
  expect(h.session.getSnapshot().file).toBeNull()
})

it('keeps metadata-only changes dirty after a mode-record failure and clears them only after a successful retry', async () => {
  const h = harness()
  h.change('{}', 2)
  vi.mocked(h.api.saveFile).mockResolvedValueOnce({
    ok: true,
    value: { ...file, modesSaved: false },
    warning: '输入模式记录写入失败',
  })
  await h.session.dispatch('save')
  expect(h.session.getSnapshot().file?.fileId).toBe(file.fileId)
  expect(h.session.getSnapshot().dirty).toBe(true)
  expect(h.session.getSnapshot().message).toContain('模式')
  vi.mocked(h.api.saveFile).mockResolvedValueOnce({ ok: true, value: file })
  await h.session.dispatch('save')
  expect(h.session.getSnapshot().dirty).toBe(false)
})
it('cancels new/open on unsaved cancellation, then permits explicit discard', async () => {
  const h = harness()
  h.change('[1]')
  await h.session.dispatch('new')
  expect(h.load).not.toHaveBeenCalled()
  vi.mocked(h.api.confirmUnsaved).mockResolvedValue({ ok: true, value: 'discard' })
  await h.session.dispatch('new')
  expect(h.text()).toBe('{}\n')
  expect(h.session.getSnapshot().dirty).toBe(false)
})
it('does not discard after saving if newer edits are still unsaved', async () => {
  const h = harness(),
    pending = deferred<Awaited<ReturnType<typeof h.api.saveFile>>>()
  h.change('[1]')
  vi.mocked(h.api.confirmUnsaved).mockResolvedValue({ ok: true, value: 'save' })
  vi.mocked(h.api.saveFile).mockReturnValue(pending.promise)
  const next = h.session.dispatch('new')
  await Promise.resolve()
  await Promise.resolve()
  h.change('[2]')
  pending.resolve({ ok: true, value: file })
  await next
  expect(h.load).not.toHaveBeenCalled()
  expect(h.text()).toBe('[2]')
})
it('rejects a stale open response and releases the unused new capability', async () => {
  const h = harness(),
    pending = deferred<Awaited<ReturnType<typeof h.api.openFile>>>()
  vi.mocked(h.api.openFile).mockReturnValue(pending.promise)
  const opening = h.session.open()
  await Promise.resolve()
  h.change('{"new":true}')
  pending.resolve({ ok: true, value: { ...file, text: '[1]' } })
  await opening
  expect(h.load).not.toHaveBeenCalled()
  expect(h.api.releaseFile).toHaveBeenCalledWith(file.fileId)
  expect(h.text()).toBe('{"new":true}')
})
it('loads a new document without retaining file contents in its UI metadata snapshot', async () => {
  const h = harness(),
    opened: OpenedFile = { ...file, text: '[1]' }
  vi.mocked(h.api.openFile).mockResolvedValue({ ok: true, value: opened })
  await h.session.open()
  expect(h.text()).toBe('[1]')
  expect(h.session.getSnapshot().file).toEqual(file)
  expect(h.session.getSnapshot().file).not.toHaveProperty('text')
  expect(h.session.getSnapshot().dirty).toBe(false)
})
it('rejects an open if source changes while confirming discard', async () => {
  const h = harness(),
    pending = deferred<Awaited<ReturnType<typeof h.api.confirmUnsaved>>>()
  h.change('[1]')
  vi.mocked(h.api.confirmUnsaved).mockReturnValue(pending.promise)
  const opening = h.session.open()
  h.change('[2]')
  pending.resolve({ ok: true, value: 'discard' })
  await opening
  expect(h.api.openFile).not.toHaveBeenCalled()
  expect(h.text()).toBe('[2]')
})
it('pastes through an undoable buffer transaction and blocks stale clipboard reads', async () => {
  const h = harness()
  await h.session.dispatch('paste')
  expect(h.paste).toHaveBeenCalledWith('{}')
  const pending = deferred<Awaited<ReturnType<typeof h.api.readClipboard>>>()
  vi.mocked(h.api.readClipboard).mockReturnValue(pending.promise)
  const pasting = h.session.dispatch('paste')
  h.change('[2]')
  pending.resolve({ ok: true, value: '[1]' })
  await pasting
  expect(h.paste).toHaveBeenCalledOnce()
  expect(h.text()).toBe('[2]')
})
it('copies raw current source, but leaves clipboard unchanged after stale/invalid transformed copy', async () => {
  const h = harness()
  h.change('{broken')
  await h.session.dispatch('copyRaw')
  expect(h.api.writeClipboard).toHaveBeenCalledWith('{broken')
  vi.mocked(h.api.writeClipboard).mockClear()
  h.transform.mockRejectedValueOnce(new Error('invalid'))
  await h.session.dispatch('copyFormatted')
  expect(h.api.writeClipboard).not.toHaveBeenCalled()
  const pending = deferred<string>()
  h.transform.mockReturnValueOnce(pending.promise)
  const copying = h.session.dispatch('copyCompact')
  h.change('null')
  pending.resolve('{}')
  await copying
  expect(h.api.writeClipboard).not.toHaveBeenCalled()
})
it('handles close cancellation, discard and successful save before replying to the main process', async () => {
  const h = harness()
  h.change('[1]')
  await h.session.requestClose('request')
  expect(h.api.replyClose).toHaveBeenLastCalledWith('request', false)
  vi.mocked(h.api.confirmUnsaved).mockResolvedValue({ ok: true, value: 'discard' })
  await h.session.requestClose('request2')
  expect(h.api.replyClose).toHaveBeenLastCalledWith('request2', true)
  const saved = harness()
  saved.change('[1]')
  vi.mocked(saved.api.confirmUnsaved).mockResolvedValue({ ok: true, value: 'save' })
  vi.mocked(saved.api.saveFile).mockResolvedValue({ ok: true, value: file })
  await saved.session.requestClose('request3')
  expect(saved.api.replyClose).toHaveBeenLastCalledWith('request3', true)
})
it('blocks overlapping desktop actions and closes while a dialog is in flight', async () => {
  const h = harness(),
    pending = deferred<Awaited<ReturnType<typeof h.api.openFile>>>()
  vi.mocked(h.api.openFile).mockReturnValue(pending.promise)
  const opening = h.session.open()
  await Promise.resolve()
  await h.session.dispatch('save')
  await h.session.requestClose('close')
  expect(h.api.saveFile).not.toHaveBeenCalled()
  expect(h.api.replyClose).toHaveBeenCalledWith('close', false)
  pending.resolve({ ok: false, code: 'cancelled', message: 'cancel' })
  await opening
})
