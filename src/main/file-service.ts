import { createHash, randomUUID } from 'node:crypto'
import { open, lstat, realpath, rename, unlink, mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { MAX_TEXT_LENGTH } from '../core/json/limits'
import type { FileMetadata, OpenedFile, RecentFile } from '../shared/desktop-api'

export const MAX_FILE_BYTES = 64 * 1024 * 1024
export class FileError extends Error {
  constructor(
    public readonly code: 'too-large' | 'encoding' | 'conflict' | 'io' | 'unauthorized',
    message: string,
  ) {
    super(message)
  }
}
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
export function decodeFile(bytes: Uint8Array): { text: string; bom: boolean; eol: 'LF' | 'CRLF' } {
  if (bytes.length > MAX_FILE_BYTES)
    throw new FileError('too-large', '文件超过 64 MiB，未载入当前文档。')
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bom ? bytes.subarray(3) : bytes,
    )
  } catch {
    throw new FileError('encoding', '无法按 UTF-8 解码；当前仅支持 UTF-8 或 UTF-8 BOM。')
  }
  if (text.length > MAX_TEXT_LENGTH)
    throw new FileError('too-large', '文件超过 20 Mi UTF-16 字符，未载入当前文档。')
  if (text.startsWith('\ufeff'))
    throw new FileError('encoding', '文件包含重复 UTF-8 BOM，请移除多余 BOM 后再打开。')
  const crlf = text.includes('\r\n')
  // Scan without allocating one match entry per line in large files.
  if (/\r(?!\n)/.test(text) || (crlf && /(^|[^\r])\n/.test(text)))
    throw new FileError('encoding', '文件包含混合换行或单独 CR；请先转换为一致的 LF 或 CRLF。')
  return { text, bom, eol: crlf ? 'CRLF' : 'LF' }
}
export function encodeFile(text: string, bom: boolean): Buffer {
  if (text.length > MAX_TEXT_LENGTH)
    throw new FileError('too-large', '文本超过 20 Mi UTF-16 字符，未写入文件。')
  if (text.startsWith('\ufeff'))
    throw new FileError('encoding', '文本开头包含额外 BOM，请移除后再保存，避免不可见字符丢失。')
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text))
    throw new FileError('encoding', '文本含未配对 UTF-16 代理字符，不能无损编码为 UTF-8。')
  return Buffer.from((bom ? '\ufeff' : '') + text, 'utf8')
}

async function readRegular(path: string): Promise<Buffer> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new FileError('io', '目标不是普通文件。')
  if (info.size > MAX_FILE_BYTES) throw new FileError('too-large', '文件超过 64 MiB。')
  const handle = await open(path, 'r')
  try {
    // Bounded read also covers files that grow after stat; never allocate from an unchecked size.
    const chunks: Buffer[] = []
    let total = 0
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_FILE_BYTES + 1 - total))
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
      if (!bytesRead) break
      chunks.push(chunk.subarray(0, bytesRead))
      total += bytesRead
      if (total > MAX_FILE_BYTES) throw new FileError('too-large', '文件读取期间超过 64 MiB。')
    }
    return Buffer.concat(chunks, total)
  } finally {
    await handle.close()
  }
}

/** Temp and target share a directory; a failed write never truncates the destination. */
export async function atomicWrite(
  path: string,
  bytes: Uint8Array,
  verify?: () => Promise<void>,
): Promise<void> {
  const temp = join(dirname(path), `.jsoneditor-${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  let created = false
  try {
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    if (info && (!info.isFile() || info.isSymbolicLink()))
      throw new FileError('io', '拒绝覆盖非普通文件或符号链接。')
    handle = await open(temp, 'wx', info ? info.mode & 0o777 : 0o600)
    created = true
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = undefined
    await verify?.()
    await rename(temp, path)
  } finally {
    await handle?.close().catch(() => {})
    if (created)
      await unlink(temp).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
  }
}

export class RecentFiles {
  private pending: Promise<void> = Promise.resolve()
  constructor(private readonly location: () => string) {}
  async list(): Promise<RecentFile[]> {
    await this.pending
    try {
      const path = this.location()
      if ((await lstat(path)).size > 128 * 1024) return []
      const data: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (!Array.isArray(data)) return []
      return data
        .filter(
          (value): value is RecentFile =>
            !!value &&
            typeof value === 'object' &&
            typeof value.id === 'string' &&
            /^[\da-f-]{36}$/.test(value.id) &&
            typeof value.path === 'string' &&
            value.path.length <= 32768 &&
            isAbsolute(value.path) &&
            typeof value.name === 'string' &&
            value.name === basename(value.path),
        )
        .slice(0, 10)
    } catch {
      return []
    }
  }
  async add(path: string): Promise<void> {
    const location = this.location()
    const previousPending = this.pending
    const task = previousPending.then(async () => {
      let previous: RecentFile[] = []
      try {
        const reader = new RecentFiles(() => location)
        previous = await reader.list()
      } catch {
        /* A damaged history does not affect the document. */
      }
      const next = [
        {
          id: previous.find((item) => item.path === path)?.id ?? randomUUID(),
          name: basename(path),
          path,
        },
        ...previous.filter((item) => item.path !== path),
      ].slice(0, 10)
      await mkdir(dirname(location), { recursive: true })
      await atomicWrite(location, Buffer.from(JSON.stringify(next, null, 2) + '\n'))
    })
    this.pending = task.catch(() => {})
    await task
  }
}
interface Grant {
  owner: number
  metadata: FileMetadata
  digest: string
}
export class FileService {
  private readonly grants = new Map<string, Grant>()
  constructor(readonly recent: RecentFiles) {}
  release(owner: number, id: string): void {
    if (this.grants.get(id)?.owner === owner) this.grants.delete(id)
  }
  releaseOwner(owner: number): void {
    this.grants.forEach((grant, id) => {
      if (grant.owner === owner) this.grants.delete(id)
    })
  }
  private grant(owner: number, id: string): Grant {
    const grant = this.grants.get(id)
    if (!grant || grant.owner !== owner)
      throw new FileError('unauthorized', '文件授权已失效，请重新打开或另存为。')
    return grant
  }
  metadata(owner: number, id: string): FileMetadata {
    return this.grant(owner, id).metadata
  }
  async open(owner: number, selected: string): Promise<OpenedFile> {
    if ([...this.grants.values()].filter((grant) => grant.owner === owner).length >= 8)
      throw new FileError('io', '文件授权过多，请关闭窗口后重试。')
    const path = await realpath(selected)
    const bytes = await readRegular(path)
    const decoded = decodeFile(bytes)
    const metadata: FileMetadata = {
      fileId: randomUUID(),
      name: basename(path),
      path,
      bom: decoded.bom,
      eol: decoded.eol,
    }
    this.grants.set(metadata.fileId, { owner, metadata, digest: hash(bytes) })
    return { ...metadata, text: decoded.text }
  }
  async save(
    owner: number,
    fileId: string | null,
    text: string,
    selectedPath?: string,
  ): Promise<FileMetadata> {
    const existing = fileId ? this.grant(owner, fileId) : null
    if (!existing && [...this.grants.values()].filter((grant) => grant.owner === owner).length >= 8)
      throw new FileError('io', '文件授权过多，请关闭窗口后重试。')
    if (!existing && !selectedPath) throw new FileError('unauthorized', '尚未选择保存位置。')
    let path = existing?.metadata.path ?? ''
    if (selectedPath) {
      const info = await lstat(selectedPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return null
      })
      if (info && (!info.isFile() || info.isSymbolicLink()))
        throw new FileError('io', '请选择实际普通文件，不能覆盖符号链接。')
      path = info
        ? await realpath(selectedPath)
        : join(await realpath(dirname(selectedPath)), basename(selectedPath))
    }
    const bytes = encodeFile(text, existing?.metadata.bom ?? false)
    const expected =
      existing?.metadata.path === path
        ? existing.digest
        : await readRegular(path)
            .then(hash)
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') return null
              throw error
            })
    const verify = async (): Promise<void> => {
      const actual = await readRegular(path)
        .then(hash)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
      if (actual !== expected)
        throw new FileError(
          'conflict',
          '磁盘文件已变化或被删除；请重新打开检查，或另存为其他文件。',
        )
    }
    await verify()
    await atomicWrite(path, bytes, verify)
    const metadata: FileMetadata = {
      fileId: existing?.metadata.fileId ?? randomUUID(),
      path,
      name: basename(path),
      bom: existing?.metadata.bom ?? false,
      eol: text.includes('\r\n') ? 'CRLF' : 'LF',
    }
    this.grants.set(metadata.fileId, { owner, metadata, digest: hash(bytes) })
    return metadata
  }
}
