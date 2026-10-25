// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir, truncate } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import {
  FileService,
  RecentFiles,
  atomicWrite,
  decodeFile,
  encodeFile,
  MAX_FILE_BYTES,
} from '../../src/main/file-service'
import { MAX_TEXT_LENGTH } from '../../src/core/json/limits'

const root = resolve('test-results')
let directory: string
beforeEach(async () => {
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'phase6-files-'))
})
afterEach(async () => {
  if (directory && resolve(directory).startsWith(root + sep))
    await rm(directory, { recursive: true, force: true })
})
const service = () =>
  new FileService(new RecentFiles(() => join(directory, 'profile', 'recent.json')))

describe('UTF-8 file boundaries', () => {
  it('rejects extra leading BOM characters instead of letting Monaco silently consume them', () => {
    expect(() => decodeFile(Buffer.from('\ufeff\ufeff{}'))).toThrow(/BOM/)
    expect(() => encodeFile('\ufeff{}', false)).toThrow(/BOM/)
  })
  it.each(['{"n":900719925474099312345}\n', '{\r\n  "text": "😀"\r\n}\r\n', '{"broken":'])(
    'round trips exact source with and without BOM: %s',
    (text) => {
      for (const bom of [false, true]) {
        const decoded = decodeFile(encodeFile(text, bom))
        expect(decoded.text).toBe(text)
        expect(decoded.bom).toBe(bom)
        expect(decoded.eol).toBe(text.includes('\r\n') ? 'CRLF' : 'LF')
      }
    },
  )
  it.each([
    Buffer.from([0xff, 0xfe, 0x7b, 0]),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('{\r\n\n}'),
    Buffer.from('{\r}'),
  ])('rejects unsupported encoding/newlines %#', (bytes) => {
    expect(() => decodeFile(bytes)).toThrow()
  })
  it('rejects unpaired UTF-16 and oversized source without replacement characters', () => {
    expect(() => encodeFile('"\ud800"', false)).toThrow(/代理/)
    expect(() => encodeFile('x'.repeat(MAX_TEXT_LENGTH + 1), false)).toThrow(/超过/)
  })
})
describe('capability scoped atomic persistence', () => {
  it('opens invalid JSON and saves its current source without parser serialization', async () => {
    const path = join(directory, 'draft.json'),
      files = service()
    await writeFile(path, encodeFile('{\r\n"n":900719925474099312345,\r\n', true))
    const opened = await files.open(1, path)
    const text = opened.text + '"ok":false\r\n}'
    await files.save(1, opened.fileId, text)
    expect(await readFile(path)).toEqual(encodeFile(text, true))
    expect(opened.bom).toBe(true)
  })
  it('rejects another owner and revoked capabilities', async () => {
    const path = join(directory, 'one.json'),
      files = service()
    await writeFile(path, '{}')
    const opened = await files.open(1, path)
    await expect(files.save(2, opened.fileId, 'null')).rejects.toMatchObject({
      code: 'unauthorized',
    })
    files.release(2, opened.fileId)
    expect(files.metadata(1, opened.fileId)).toBeDefined()
    files.releaseOwner(1)
    await expect(files.save(1, opened.fileId, 'null')).rejects.toMatchObject({
      code: 'unauthorized',
    })
    expect(await readFile(path, 'utf8')).toBe('{}')
  })
  it('detects external edits and deletion instead of overwriting or recreating', async () => {
    const path = join(directory, 'one.json'),
      files = service()
    await writeFile(path, '{}')
    const opened = await files.open(1, path)
    await writeFile(path, '{"external":true}')
    await expect(files.save(1, opened.fileId, 'null')).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(path, 'utf8')).toBe('{"external":true}')
    await rm(path)
    await expect(files.save(1, opened.fileId, 'null')).rejects.toMatchObject({ code: 'conflict' })
    expect(await readdir(directory)).toEqual([])
  })
  it('saves as a new location, preserves BOM and rebinds the same capability', async () => {
    const path = join(directory, 'one.json'),
      target = join(directory, 'two.json'),
      files = service()
    await writeFile(path, encodeFile('{}', true))
    const opened = await files.open(1, path)
    const saved = await files.save(1, opened.fileId, '[1]', target)
    expect(saved.fileId).toBe(opened.fileId)
    expect(await readFile(path)).toEqual(encodeFile('{}', true))
    expect(await readFile(target)).toEqual(encodeFile('[1]', true))
    await files.save(1, opened.fileId, '[2]')
    expect(await readFile(target)).toEqual(encodeFile('[2]', true))
  })
  it('keeps the original and cleans the temp file when the final conflict check fails', async () => {
    const path = join(directory, 'safe.json')
    await writeFile(path, 'original')
    await expect(
      atomicWrite(path, Buffer.from('new'), async () => {
        throw new Error('conflict')
      }),
    ).rejects.toThrow('conflict')
    expect(await readFile(path, 'utf8')).toBe('original')
    expect(await readdir(directory)).toEqual(['safe.json'])
  })
  it('rejects directories, missing save parents and oversized sparse files without touching the original', async () => {
    const files = service(),
      path = join(directory, 'large.json')
    await expect(files.save(1, null, '{}', directory)).rejects.toThrow()
    await expect(files.save(1, null, '{}', join(directory, 'missing', 'x.json'))).rejects.toThrow()
    await writeFile(path, '')
    await truncate(path, MAX_FILE_BYTES + 1)
    await expect(files.open(1, path)).rejects.toMatchObject({ code: 'too-large' })
  })
  it('serializes recent updates, deduplicates, caps and survives corrupt metadata', async () => {
    const location = join(directory, 'recent.json'),
      recent = new RecentFiles(() => location)
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => recent.add(join(directory, `${i}.json`))),
    )
    const list = await recent.list()
    expect(list).toHaveLength(10)
    const first = list[0]!
    await recent.add(first.path)
    expect((await recent.list())[0]!.id).toBe(first.id)
    expect(new Set((await recent.list()).map((item) => item.path)).size).toBe(10)
    await writeFile(location, 'broken')
    expect(await recent.list()).toEqual([])
    await recent.add(join(directory, 'recovered.json'))
    expect(await recent.list()).toHaveLength(1)
  })
})
