import { visit } from 'jsonc-parser'
import type { TextEdit } from '../document/contracts'
import { indexTree, MAX_TREE_NODES } from '../tree-model/model'
import type { JsonTreeNode, JsonTreeProjection } from '../tree-model/model'

/** Only generated names use suffixes. User-supplied names must be checked without rewriting. */
export function uniqueObjectKey(
  tree: JsonTreeProjection,
  parentId: string,
  preferred = 'key',
): string {
  const index = indexTree(tree)
  const parent = index.get(parentId)
  if (!parent || parent.type !== 'object') throw new Error('自动属性名只能用于 Object。')
  const keys = new Set(parent.children.map((id) => index.get(id)!.key))
  if (!keys.has(preferred)) return preferred
  let suffix = 1
  while (keys.has(preferred + suffix)) suffix++
  return preferred + suffix
}

export function assertNodeCount(count: number): void {
  if (count > MAX_TREE_NODES)
    throw new Error(
      `操作超出树节点上限（${MAX_TREE_NODES.toLocaleString('en-US')} 个），请减少节点后重试。`,
    )
}

/** Count validated JSON without serializing numeric values or constructing another tree. */
export function countAddedNodes(raw: string, existingCount: number): number {
  let count = 0
  const add = (): void => {
    assertNodeCount(existingCount + ++count)
  }
  visit(raw, { onObjectBegin: add, onArrayBegin: add, onLiteralValue: add })
  return count
}

export function subtreeSize(node: JsonTreeNode, tree: JsonTreeProjection): number {
  const index = indexTree(tree)
  const pending = [node.id]
  let count = 0
  while (pending.length) {
    const current = index.get(pending.pop()!)!
    count++
    for (const child of current.children) pending.push(child)
  }
  return count
}

/** Insert one member using original offsets; every existing token stays in the source. */
export function insertMember(
  text: string,
  tree: JsonTreeProjection,
  parent: JsonTreeNode,
  position: number,
  member: string,
): TextEdit {
  if (parent.type !== 'object' && parent.type !== 'array')
    throw new Error('只能向 Object 或 Array 新增子节点。')
  if (!Number.isSafeInteger(position) || position < 0 || position > parent.children.length)
    throw new Error('新增位置超出范围；位置从 0 开始，允许插入末尾。')
  const index = indexTree(tree)
  const next = index.get(parent.children[position] ?? '')
  const last = index.get(parent.children.at(-1) ?? '')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const parentIndent =
    text
      .slice(text.lastIndexOf('\n', parent.offset - 1) + 1, parent.offset)
      .match(/^[\t ]*/)?.[0] ?? ''
  const sibling = next ?? last
  const prefix = sibling
    ? text.slice(text.lastIndexOf('\n', sibling.memberOffset - 1) + 1, sibling.memberOffset)
    : ''
  const indent = sibling && /^[\t ]*$/.test(prefix) ? prefix : parentIndent + '  '
  if (next) return { offset: next.memberOffset, length: 0, text: member + ',' + eol + indent }
  if (last)
    return {
      offset: last.memberOffset + last.memberLength,
      length: 0,
      text: ',' + eol + indent + member,
    }
  return {
    offset: parent.offset + 1,
    length: parent.length - 2,
    text: eol + indent + member + eol + parentIndent,
  }
}
