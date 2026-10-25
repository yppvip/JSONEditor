import type { JsonTreeProjection } from './model'

export const IDENTITY_HISTORY_LIMITS = {
  entries: 8,
  nodes: 200_000,
  characters: 4_194_304,
} as const
interface Checkpoint {
  documentId: string
  version: number
  source: string
  ids: string[]
}

/** Identity metadata only: Monaco alone owns the actual undo/redo text history. */
export class IdentityHistory {
  private entries: Checkpoint[] = []

  find(documentId: string, version: number | undefined, source: string): string[] | undefined {
    if (version === undefined) return undefined
    return this.entries.find(
      (entry) =>
        entry.documentId === documentId && entry.version === version && entry.source === source,
    )?.ids
  }

  remember(tree: JsonTreeProjection, version: number | undefined, source: string): void {
    if (version === undefined) return
    this.entries = this.entries.filter(
      (entry) => entry.documentId === tree.documentId && entry.version !== version,
    )
    if (
      tree.nodes.length <= IDENTITY_HISTORY_LIMITS.nodes &&
      source.length <= IDENTITY_HISTORY_LIMITS.characters
    )
      this.entries.push({
        documentId: tree.documentId,
        version,
        source,
        ids: tree.nodes.map((node) => node.id),
      })
    while (
      this.entries.length > IDENTITY_HISTORY_LIMITS.entries ||
      this.entries.reduce((sum, entry) => sum + entry.ids.length, 0) >
        IDENTITY_HISTORY_LIMITS.nodes ||
      this.entries.reduce((sum, entry) => sum + entry.source.length, 0) >
        IDENTITY_HISTORY_LIMITS.characters
    )
      this.entries.shift()
  }
}
