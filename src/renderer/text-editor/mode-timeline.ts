import type { ModeSnapshot } from '../../core/tree-model/edit-modes'

/** Text versions remain Monaco-owned. Tags distinguish metadata-only undo elements. */
export class ModeTimeline {
  private serial = 0
  private tag = 0
  private tags = new Map<number, number>()
  private versions = new Map<string, number>()
  private last: ModeSnapshot = []
  private snapshots = new Map<number, ModeSnapshot>()
  version(native: number): number {
    const key = `${native}:${this.tags.get(native) ?? 0}`
    if (!this.versions.has(key)) this.versions.set(key, ++this.serial)
    return this.versions.get(key)!
  }
  snapshot(native: number): ModeSnapshot | undefined {
    return this.snapshots.get(this.version(native))
  }
  remember(native: number, modes: ModeSnapshot): void {
    if (
      modes.length !== this.last.length ||
      modes.some(
        (entry, i) => entry.pointer !== this.last[i]!.pointer || entry.mode !== this.last[i]!.mode,
      )
    )
      this.last = modes
    this.snapshots.set(this.version(native), this.last)
  }
  transaction(native: number) {
    const before = this.tags.get(native) ?? 0,
      after = ++this.tag
    this.tags.set(native, after)
    return { undo: () => this.tags.set(native, before), redo: () => this.tags.set(native, after) }
  }
}
