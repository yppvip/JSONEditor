/** Offsets in each batch refer to the source before that batch; no text copies. */
export interface SourceChange {
  offset: number
  length: number
  insertedLength: number
}
export interface ChangeBatch {
  revision: number
  changes: readonly SourceChange[]
}
export const MAX_CHANGE_RECORDS = 256

/** A covered, contiguous revision trace is required; partial traces are never used. */
export function identityAnchors(
  nodes: readonly { id: string; offset: number; keyOffset: number | null }[],
  baseRevision: number,
  revision: number,
  sourceLength: number,
  targetLength: number,
  journal: readonly ChangeBatch[] | undefined,
): Map<number, string> | undefined {
  if (!journal || revision <= baseRevision) return undefined
  const batches = journal.filter((batch) => batch.revision > baseRevision)
  if (batches.length !== revision - baseRevision) return undefined
  let length = sourceLength
  const sorted: SourceChange[][] = []
  for (const [index, batch] of batches.entries()) {
    if (batch.revision !== baseRevision + index + 1 || !batch.changes.length) return undefined
    const changes = [...batch.changes].sort((a, b) => a.offset - b.offset)
    let boundary = 0
    let delta = 0
    for (const change of changes) {
      if (
        !Number.isSafeInteger(change.offset) ||
        !Number.isSafeInteger(change.length) ||
        !Number.isSafeInteger(change.insertedLength) ||
        change.offset < boundary ||
        change.length < 0 ||
        change.insertedLength < 0 ||
        change.offset + change.length > length
      )
        return undefined
      boundary = change.offset + change.length
      delta += change.insertedLength - change.length
    }
    length += delta
    sorted.push(changes)
  }
  if (length !== targetLength) return undefined
  const anchors = new Map<number, string>()
  for (const node of nodes) {
    let position: number | null = node.keyOffset ?? node.offset
    for (const changes of sorted) {
      let delta = 0
      for (const change of changes) {
        if (position < change.offset) break
        if (position >= change.offset + change.length) {
          delta += change.insertedLength - change.length
        } else {
          // Replacement of a token at its start keeps that node; deleted/interior tokens do not.
          position = position === change.offset && change.insertedLength > 0 ? position : null
          break
        }
      }
      if (position === null) break
      position += delta
    }
    if (position !== null) anchors.set(position, node.id)
  }
  return anchors
}
