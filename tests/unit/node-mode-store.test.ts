import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { modeFingerprint, NodeModeStore, MODE_STORE_LIMITS } from '../../src/main/node-mode-store'
import { atomicWrite, FileService, RecentFiles } from '../../src/main/file-service'

const dirs: string[] = []
async function location() {
  const dir = await mkdtemp(join(tmpdir(), 'json-mode-test-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

it('fingerprints exact JSON tokens ignoring whitespace, but distinguishes values, number lexemes, strings and member order', () => {
  expect(modeFingerprint('{"a":-0,"b":"a b"}')).toBe(
    modeFingerprint('{\r\n  "a": -0, "b": "a b"\r\n}'),
  )
  for (const text of ['{"a":0,"b":"a b"}', '{"a":-0,"b":"ab"}', '{"b":"a b","a":-0}'])
    expect(modeFingerprint(text)).not.toBe(modeFingerprint('{"a":-0,"b":"a b"}'))
  expect(modeFingerprint('{')).toBeNull()
  expect(modeFingerprint('{"a":1,"a":2}')).toBeNull()
})

it('stores schema/version and sparse paths without document values, restores on restart and rejects changed content', async () => {
  const dir = await location(),
    path = join(dir, 'document.json'),
    meta = join(dir, 'metadata.json')
  const store = new NodeModeStore(() => meta),
    modes = [{ pointer: '/name', mode: 'auto' as const }]
  const source = '{"name":"sensitive-content"}'
  await store.save(path, source, modes)
  const serialized = await readFile(meta, 'utf8')
  expect(serialized).not.toContain('sensitive-content')
  expect(JSON.parse(serialized).version).toBe(1)
  expect(
    (await new NodeModeStore(() => meta).load(path, '{ "name": "sensitive-content" }')).modes,
  ).toEqual(modes)
  expect((await store.load(path, '{"name":"changed"}')).warning).toContain('外部变化')
  expect((await store.load(join(dir, 'other.json'), source)).modes).toBeUndefined()
})

it('ignores corrupted metadata with a visible warning, expires stale records, and bounds retained files', async () => {
  const dir = await location(),
    meta = join(dir, 'metadata.json'),
    store = new NodeModeStore(() => meta)
  await writeFile(meta, '{broken')
  expect((await store.load('file', '"x"')).warning).toContain('不可用')
  for (let i = 0; i <= MODE_STORE_LIMITS.files; i++)
    await store.save(join(dir, String(i)), '"x"', [{ pointer: '', mode: 'auto' }])
  const data = JSON.parse(await readFile(meta, 'utf8'))
  expect(data.records).toHaveLength(MODE_STORE_LIMITS.files)
  data.records.forEach((record: { updated: number }) => {
    record.updated = Date.now() - MODE_STORE_LIMITS.ageMs - 1
  })
  await writeFile(meta, JSON.stringify(data))
  expect(await store.load(join(dir, '100'), '"x"')).toEqual({})
})

it('keeps saved JSON intact and the grant usable if metadata writing fails, then supports retry', async () => {
  const dir = await location(),
    meta = join(dir, 'metadata.json'),
    path = join(dir, 'file.json')
  const fail = vi.fn().mockRejectedValue(new Error('disk full'))
  const modes = new NodeModeStore(() => meta, fail)
  const files = new FileService(new RecentFiles(() => join(dir, 'recent.json')), modes)
  await writeFile(path, '{"name":"hello"}')
  const opened = await files.open(1, path)
  const saved = await files.save(1, opened.fileId, opened.text, undefined, [
    { pointer: '/name', mode: 'auto' },
  ])
  expect(saved.modesSaved).toBe(false)
  expect(await readFile(path, 'utf8')).toBe(opened.text)
  expect(files.metadata(1, opened.fileId).fileId).toBe(opened.fileId)
  fail.mockImplementation(atomicWrite)
  expect(
    (
      await files.save(1, opened.fileId, opened.text, undefined, [
        { pointer: '/name', mode: 'auto' },
      ])
    ).modesSaved,
  ).not.toBe(false)
  expect((await files.open(1, path)).editModes).toEqual([{ pointer: '/name', mode: 'auto' }])
})

it('Save As creates an independent mode record and denied file capabilities cannot access metadata', async () => {
  const dir = await location(),
    path = join(dir, 'original.json'),
    copy = join(dir, 'copy.json')
  const files = new FileService(
    new RecentFiles(() => join(dir, 'recent.json')),
    new NodeModeStore(() => join(dir, 'metadata.json')),
  )
  await writeFile(path, '{"name":"hello"}')
  const original = await files.open(1, path)
  await files.save(1, original.fileId, original.text, undefined, [
    { pointer: '/name', mode: 'auto' },
  ])
  await files.save(1, original.fileId, original.text, copy, [])
  expect((await files.open(1, path)).editModes).toEqual([{ pointer: '/name', mode: 'auto' }])
  expect((await files.open(1, copy)).editModes).toEqual([])
  await expect(files.save(2, original.fileId, original.text, copy, [])).rejects.toThrow(/授权/)
})
