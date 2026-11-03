import { createScanner } from 'jsonc-parser'
import { indexTree, jsonPointer, shareTreeTopology } from './model'
import type { JsonTreeNode, JsonTreeProjection } from './model'
import type { TreeCommand } from '../commands/tree-commands'

export type EditMode = 'auto' | 'string'
/** Sparse overrides: ordinary JSON strings default to locked string mode. */
export type ModeSnapshot = readonly { pointer: string; mode: EditMode }[]
export const MAX_MODE_SNAPSHOT_LENGTH = 4 * 1024 * 1024
export const modeOf = (node: JsonTreeNode): EditMode =>
  node.editMode ?? (node.type === 'string' ? 'string' : 'auto')

export function validModeSnapshot(value: unknown): value is ModeSnapshot {
  let length = 0
  return (
    Array.isArray(value) &&
    value.length <= 100_000 &&
    value.every((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      const entry = item as Record<string, unknown>
      if (typeof entry.pointer === 'string') length += entry.pointer.length + 32
      return (
        Object.keys(entry).sort().join(',') === 'mode,pointer' &&
        (entry.mode === 'auto' || entry.mode === 'string') &&
        typeof entry.pointer === 'string' &&
        entry.pointer.length <= 65_536 &&
        length <= MAX_MODE_SNAPSHOT_LENGTH &&
        (entry.pointer === '' || entry.pointer.startsWith('/')) &&
        !/~(?![01])/.test(entry.pointer)
      )
    }) &&
    JSON.stringify(value).length <= MAX_MODE_SNAPSHOT_LENGTH
  )
}

export function inputValue(value: string, mode: EditMode): string {
  const raw = value.trim()
  return mode === 'auto' &&
    (raw === 'true' ||
      raw === 'false' ||
      raw === 'null' ||
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw))
    ? raw
    : JSON.stringify(value)
}

export function modeValue(raw: string, node: JsonTreeNode, mode: EditMode): string {
  if (mode === 'auto' && (node.type === 'object' || node.type === 'array')) return raw
  const value = node.type === 'string' ? (JSON.parse(raw) as string) : raw
  return inputValue(value, mode)
}

export function snapshotModes(tree: JsonTreeProjection): ModeSnapshot {
  const index = indexTree(tree)
  return tree.nodes
    .filter((node) => node.type === 'string' && modeOf(node) === 'auto')
    .map((node) => ({ pointer: jsonPointer(node, index), mode: 'auto' as const }))
}

function withMode(node: JsonTreeNode, mode: EditMode): JsonTreeNode {
  const desired = node.type === 'string' && mode === 'auto' ? 'auto' : undefined
  if (node.editMode === desired) return node
  const { editMode: _old, ...rest } = node
  void _old
  return desired ? { ...rest, editMode: desired } : rest
}
function modeTree(tree: JsonTreeProjection, modes: Map<string, EditMode>): JsonTreeProjection {
  const next = {
    ...tree,
    nodes: tree.nodes.map((node) =>
      withMode(node, modes.get(node.id) ?? (node.type === 'string' ? 'string' : 'auto')),
    ),
  }
  shareTreeTopology(tree, next)
  return next
}

export function restoreModes(tree: JsonTreeProjection, entries: ModeSnapshot): JsonTreeProjection {
  const index = indexTree(tree)
  const changes = new Map<string, EditMode>()
  const keys = new Map<string, Map<string, string>>()
  const objectChild = (node: JsonTreeNode, key: string): JsonTreeNode | undefined => {
    if (!keys.has(node.id))
      keys.set(node.id, new Map(node.children.map((id) => [index.get(id)!.key!, id])))
    return index.get(keys.get(node.id)!.get(key) ?? '')
  }
  for (const entry of entries) {
    let node = index.get(tree.rootId)
    if (entry.pointer !== '')
      for (const part of entry.pointer
        .slice(1)
        .split('/')
        .map((p) => p.replaceAll('~1', '/').replaceAll('~0', '~'))) {
        node =
          node?.type === 'object'
            ? objectChild(node, part)
            : node?.type === 'array' && /^(0|[1-9]\d*)$/.test(part)
              ? index.get(node.children[Number(part)] ?? '')
              : undefined
      }
    if (node?.type === 'string') changes.set(node.id, entry.mode)
  }
  return modeTree(tree, changes)
}

export function inheritModes(
  previous: JsonTreeProjection,
  next: JsonTreeProjection,
  command?: TreeCommand,
): JsonTreeProjection {
  const old = indexTree(previous),
    index = indexTree(next)
  const modes = new Map<string, EditMode>()
  for (const node of next.nodes) {
    const before = old.get(node.id)
    modes.set(
      node.id,
      node.type === 'string' && before?.type === 'string'
        ? modeOf(before)
        : node.type === 'string'
          ? 'string'
          : 'auto',
    )
  }
  if (command) {
    const source = old.get(command.nodeId)!
    if (command.kind === 'copy' || command.kind === 'insert' || command.kind === 'add') {
      const parent = command.kind === 'add' ? source : old.get(source.parentId!)!
      const position =
        command.kind === 'add'
          ? (command.index ?? parent.children.length)
          : parent.children.indexOf(source.id) +
            (command.kind === 'copy' || command.position === 'after' ? 1 : 0)
      const added = index.get(index.get(parent.id)!.children[position]!)!
      if (command.kind === 'copy') {
        const pairs = [[source.id, added.id]]
        while (pairs.length) {
          const [from, to] = pairs.pop()!
          modes.set(to!, modeOf(old.get(from!)!))
          old
            .get(from!)!
            .children.forEach((child, i) => pairs.push([child, index.get(to!)!.children[i]!]))
        }
      } else modes.set(added.id, command.valueType === 'string' ? 'string' : 'auto')
    } else if (command.kind === 'convert') {
      const target = index.get(source.id)!
      target.children.forEach((id) => modes.set(id, 'auto'))
    } else if (command.kind === 'set-mode') modes.set(source.id, command.mode)
    else if (command.kind === 'edit-value') modes.set(source.id, modeOf(source))
    else if (command.kind === 'update' && command.valueType)
      modes.set(source.id, command.valueType === 'string' ? 'string' : 'auto')
  }
  return modeTree(next, modes)
}

/** Hash callers consume exact non-whitespace tokens; number and string lexemes remain distinct. */
export function* jsonTokens(text: string): Generator<string> {
  const scanner = createScanner(text, true)
  for (scanner.scan(); scanner.getTokenOffset() < text.length; scanner.scan()) {
    yield text.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength())
  }
}
