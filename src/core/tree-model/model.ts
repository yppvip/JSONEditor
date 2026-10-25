import { visit } from 'jsonc-parser'
import type { DocumentVersion } from '../document/contracts'

export type JsonNodeType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
export const MAX_TREE_NODES = 100_000
export const MAX_FORM_VALUE_LENGTH = 65_536

export interface JsonTreeNode {
  id: string
  parentId: string | null
  key: string | null
  index: number | null
  type: JsonNodeType
  offset: number
  length: number
  memberOffset: number
  memberLength: number
  keyOffset: number | null
  keyLength: number | null
  children: string[]
  preview: string
}
export interface JsonTreeProjection extends DocumentVersion {
  rootId: string
  nodes: JsonTreeNode[]
  editable: boolean
  maxDepth: number
}
export interface TreeIdentityHint {
  parentId: string
  children: string[]
}
interface Container {
  node: JsonTreeNode
  pendingKey: { value: string; offset: number; length: number } | null
}

export function indexTree(tree: JsonTreeProjection): Map<string, JsonTreeNode> {
  return new Map(tree.nodes.map((node) => [node.id, node]))
}

export function jsonPointer(node: JsonTreeNode, index: ReadonlyMap<string, JsonTreeNode>): string {
  const parts: string[] = []
  let current: JsonTreeNode | undefined = node
  while (current?.parentId) {
    parts.push(
      current.key !== null
        ? current.key.replaceAll('~', '~0').replaceAll('/', '~1')
        : String(current.index),
    )
    current = index.get(current.parentId)
  }
  return parts.length ? '/' + parts.reverse().join('/') : ''
}

// Input has already passed strict validation and depth preflight. No native Object/number serialization.
export function buildTree(
  text: string,
  version: DocumentVersion,
  nextId: () => string,
  previous: JsonTreeProjection | null = null,
  hint?: TreeIdentityHint,
  identity?: { anchors?: ReadonlyMap<number, string>; restoredIds?: readonly string[] },
): { tree: JsonTreeProjection | null; message: string } {
  const old =
    previous?.documentId === version.documentId
      ? indexTree(previous)
      : new Map<string, JsonTreeNode>()
  const used = new Set<string>()
  const oldKeys = new Map<string, Map<string, string>>()
  const nodes: JsonTreeNode[] = []
  const stack: Container[] = []
  let editable = true
  let maxDepth = 0
  const seenKeys = new Map<string, Set<string>>()
  const limit = new Error('TreeLimit')

  const add = (type: JsonNodeType, offset: number, length: number): JsonTreeNode => {
    maxDepth = Math.max(maxDepth, stack.length)
    if (nodes.length >= MAX_TREE_NODES) throw limit
    const parent = stack.at(-1)
    const key = parent?.node.type === 'object' ? parent.pendingKey : null
    const position = parent?.node.children.length ?? 0
    let candidate: string | undefined
    if (identity?.restoredIds) candidate = identity.restoredIds[nodes.length]
    else if (!parent)
      candidate = previous?.documentId === version.documentId ? previous.rootId : undefined
    else if (identity?.anchors) {
      const anchored = identity.anchors.get(key?.offset ?? offset)
      const original = anchored ? old.get(anchored) : undefined
      if (
        original?.parentId === parent.node.id &&
        old.get(parent.node.id)?.type === parent.node.type
      )
        candidate = anchored
    } else {
      const oldParent = old.get(parent.node.id)
      const oldChildren = hint?.parentId === parent.node.id ? hint.children : oldParent?.children
      if (key && oldParent?.type === 'object') {
        let keys = oldKeys.get(oldParent.id)
        if (!keys) {
          keys = new Map(oldParent.children.map((id) => [old.get(id)?.key ?? '', id]))
          oldKeys.set(oldParent.id, keys)
        }
        candidate = keys.get(key.value)
      }
      if (!candidate || used.has(candidate)) candidate = oldChildren?.[position]
    }
    const id = candidate && !used.has(candidate) ? candidate : nextId()
    used.add(id)
    const memberOffset = key?.offset ?? offset
    const node: JsonTreeNode = {
      id,
      parentId: parent?.node.id ?? null,
      key: key?.value ?? null,
      index: parent?.node.type === 'array' ? position : null,
      type,
      offset,
      length,
      memberOffset,
      memberLength: offset + length - memberOffset,
      keyOffset: key?.offset ?? null,
      keyLength: key?.length ?? null,
      children: [],
      preview:
        type === 'object' || type === 'array'
          ? ''
          : text.slice(offset, offset + Math.min(length, 100)) + (length > 100 ? '…' : ''),
    }
    if (parent) {
      parent.node.children.push(id)
      parent.pendingKey = null
    }
    nodes.push(node)
    return node
  }
  const close = (offset: number, length: number): void => {
    const container = stack.pop()
    if (!container) throw new Error('Invalid validated container')
    container.node.length = offset + length - container.node.offset
    container.node.memberLength = offset + length - container.node.memberOffset
    container.node.preview = `${container.node.children.length} 项`
  }
  try {
    visit(
      text,
      {
        onObjectBegin: (offset, length) => {
          stack.push({ node: add('object', offset, length), pendingKey: null })
        },
        onArrayBegin: (offset, length) => {
          stack.push({ node: add('array', offset, length), pendingKey: null })
        },
        onObjectEnd: close,
        onArrayEnd: close,
        onObjectProperty: (value, offset, length) => {
          const container = stack.at(-1)!
          let keys = seenKeys.get(container.node.id)
          if (!keys) {
            keys = new Set()
            seenKeys.set(container.node.id, keys)
          }
          if (keys.has(value)) editable = false
          keys.add(value)
          container.pendingKey = { value, offset, length }
        },
        onLiteralValue: (value: unknown, offset, length) => {
          const type = value === null ? 'null' : typeof value
          if (type !== 'string' && type !== 'number' && type !== 'boolean' && type !== 'null')
            throw new Error('Unsupported literal')
          add(type, offset, length)
        },
        onError: () => {
          throw new Error('Tree input must be strictly validated')
        },
      },
      { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false },
    )
  } catch (error) {
    if (error === limit)
      return {
        tree: null,
        message: `节点超过 ${MAX_TREE_NODES.toLocaleString('en-US')} 个，当前仅支持文本编辑。`,
      }
    throw error
  }
  const root = nodes[0]
  if (!root) throw new Error('Missing validated root')
  return { tree: { ...version, rootId: root.id, nodes, editable, maxDepth }, message: '' }
}
