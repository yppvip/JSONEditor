import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { atomicWrite } from './file-service'
import { analyzeJson } from '../core/json/engine'
import { jsonTokens, validModeSnapshot } from '../core/tree-model/edit-modes'
import type { ModeSnapshot } from '../core/tree-model/edit-modes'

export const MODE_STORE_LIMITS = {
  files: 100,
  bytes: 8 * 1024 * 1024,
  ageMs: 90 * 24 * 60 * 60 * 1000,
} as const
interface RecordEntry {
  file: string
  fingerprint: string
  updated: number
  modes: ModeSnapshot
}

export function modeFingerprint(text: string): string | null {
  const analysis = analyzeJson(text)
  if (!analysis.valid || analysis.diagnostics.some((problem) => problem.code === 'DuplicateKey'))
    return null
  const hash = createHash('sha256')
  for (const token of jsonTokens(text)) hash.update(token.length + ':').update(token)
  return hash.digest('hex')
}
const fileKey = (path: string) =>
  createHash('sha256')
    .update(process.platform === 'win32' ? path.toLowerCase() : path)
    .digest('hex')

/** App-local, bounded metadata. Callers supply only canonical paths from file grants. */
export class NodeModeStore {
  private pending: Promise<void> = Promise.resolve()
  constructor(
    private readonly location: () => string,
    private readonly write = atomicWrite,
  ) {}
  private async records(): Promise<RecordEntry[]> {
    try {
      const info = await lstat(this.location())
      if (!info.isFile() || info.isSymbolicLink() || info.size > MODE_STORE_LIMITS.bytes)
        throw new Error('metadata too large')
      const data: unknown = JSON.parse(await readFile(this.location(), 'utf8'))
      if (
        !data ||
        typeof data !== 'object' ||
        !('version' in data) ||
        data.version !== 1 ||
        !('records' in data) ||
        !Array.isArray(data.records)
      )
        throw new Error('invalid metadata')
      return data.records
        .filter((item: unknown): item is RecordEntry => {
          if (!item || typeof item !== 'object') return false
          const value = item as Record<string, unknown>
          return (
            typeof value.file === 'string' &&
            /^[\da-f]{64}$/.test(value.file) &&
            typeof value.fingerprint === 'string' &&
            /^[\da-f]{64}$/.test(value.fingerprint) &&
            typeof value.updated === 'number' &&
            value.updated <= Date.now() + 60_000 &&
            value.updated > Date.now() - MODE_STORE_LIMITS.ageMs &&
            validModeSnapshot(value.modes)
          )
        })
        .slice(0, MODE_STORE_LIMITS.files)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
  async load(path: string, text: string): Promise<{ modes?: ModeSnapshot; warning?: string }> {
    await this.pending
    try {
      const entry = (await this.records()).find((record) => record.file === fileKey(path))
      if (!entry) return {}
      if (modeFingerprint(text) !== entry.fingerprint)
        return { warning: '文件内容已在外部变化，未恢复无法确认对应关系的输入模式。' }
      return { modes: entry.modes }
    } catch {
      return { warning: '输入模式记录不可用，已按 JSON 类型恢复默认模式。' }
    }
  }
  async save(path: string, text: string, modes: ModeSnapshot): Promise<void> {
    if (!validModeSnapshot(modes)) throw new Error('invalid mode snapshot')
    const task = this.pending.then(async () => {
      let previous: RecordEntry[]
      try {
        previous = await this.records()
      } catch {
        previous = []
      }
      const key = fileKey(path),
        fingerprint = modeFingerprint(text)
      let next = previous.filter((record) => record.file !== key)
      if (fingerprint) next.unshift({ file: key, fingerprint, updated: Date.now(), modes })
      next = next.slice(0, MODE_STORE_LIMITS.files)
      let bytes = Buffer.from(JSON.stringify({ version: 1, records: next }) + '\n')
      while (bytes.length > MODE_STORE_LIMITS.bytes && next.length > 1) {
        next.pop()
        bytes = Buffer.from(JSON.stringify({ version: 1, records: next }) + '\n')
      }
      if (bytes.length > MODE_STORE_LIMITS.bytes) throw new Error('mode metadata exceeds capacity')
      await mkdir(dirname(this.location()), { recursive: true })
      await this.write(this.location(), bytes)
    })
    this.pending = task.catch(() => {})
    return task
  }
}
