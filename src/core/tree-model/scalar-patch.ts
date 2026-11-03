import type { TextEdit } from '../document/contracts'
import type { JsonNodeType, JsonTreeProjection } from './model'
import { indexTree, shareTreeTopology } from './model'
import type { EditMode } from './edit-modes'

export interface ScalarTreePatch {
  documentId: string
  baseRevision: number
  revision: number
  nodeId: string
  type: JsonNodeType
  edit: TextEdit
  editMode?: EditMode
}
export function applyScalarTreePatch(
  tree: JsonTreeProjection,
  patch: ScalarTreePatch,
): JsonTreeProjection {
  const target = indexTree(tree).get(patch.nodeId)
  const edit = patch.edit
  if (
    !tree.editable ||
    tree.documentId !== patch.documentId ||
    tree.revision !== patch.baseRevision ||
    patch.revision !== patch.baseRevision + 1 ||
    !target ||
    target.children.length ||
    target.type === 'object' ||
    target.type === 'array' ||
    !['string', 'number', 'boolean', 'null'].includes(patch.type) ||
    edit.offset !== target.offset ||
    edit.length !== target.length ||
    !edit.text.length
  )
    throw new Error('标量投影更新的基准不匹配。')
  const end = edit.offset + edit.length
  const delta = edit.text.length - edit.length
  const nodes = tree.nodes.map((node) => {
    if (node.id === target.id)
      return {
        ...node,
        type: patch.type,
        ...(patch.editMode ? { editMode: patch.editMode } : {}),
        length: edit.text.length,
        memberLength: node.memberLength + delta,
        preview: edit.text.slice(0, 100) + (edit.text.length > 100 ? '…' : ''),
      }
    if (!delta) return node
    const offset = node.offset >= end ? node.offset + delta : node.offset
    const memberOffset = node.memberOffset >= end ? node.memberOffset + delta : node.memberOffset
    const keyOffset =
      node.keyOffset !== null && node.keyOffset >= end ? node.keyOffset + delta : node.keyOffset
    const length =
      node.length + (node.offset < edit.offset && node.offset + node.length >= end ? delta : 0)
    const memberLength =
      node.memberLength +
      (node.memberOffset < edit.offset && node.memberOffset + node.memberLength >= end ? delta : 0)
    return offset === node.offset &&
      memberOffset === node.memberOffset &&
      keyOffset === node.keyOffset &&
      length === node.length &&
      memberLength === node.memberLength
      ? node
      : { ...node, offset, memberOffset, keyOffset, length, memberLength }
  })
  const next = { ...tree, revision: patch.revision, nodes }
  shareTreeTopology(tree, next)
  return next
}
