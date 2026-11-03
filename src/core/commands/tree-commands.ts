import { analyzeJson } from '../json/engine'
import type { TextEdit } from '../document/contracts'
import { indexTree } from '../tree-model/model'
import { applySourceEdits } from '../document/source-edits'
import { compileStructuralCommand } from './structural-commands'
import type { MoveCommand, SortCommand } from './structural-commands'
import type { ScalarTreePatch } from '../tree-model/scalar-patch'
import { MAX_TEXT_LENGTH } from '../json/limits'
import { inputValue, modeOf, modeValue } from '../tree-model/edit-modes'
import type { EditMode } from '../tree-model/edit-modes'
import {
  assertNodeCount,
  countAddedNodes,
  insertMember,
  subtreeSize,
  uniqueObjectKey,
} from './insertion-commands'
export { applySourceEdits } from '../document/source-edits'
import type {
  JsonNodeType,
  JsonTreeNode,
  JsonTreeProjection,
  TreeIdentityHint,
} from '../tree-model/model'

export type TreeCommand =
  | MoveCommand
  | SortCommand
  | { kind: 'update'; nodeId: string; key?: string; valueText?: string; valueType?: JsonNodeType }
  | {
      kind: 'add'
      nodeId: string
      index?: number
      key?: string
      valueText?: string
      valueType?: JsonNodeType
    }
  | {
      kind: 'insert'
      nodeId: string
      position: 'before' | 'after'
      key?: string
      valueText?: string
      valueType?: JsonNodeType
    }
  | { kind: 'copy'; nodeId: string }
  | { kind: 'convert'; nodeId: string; valueType: 'array' | 'object' }
  | { kind: 'set-mode'; nodeId: string; mode: EditMode }
  | { kind: 'edit-value'; nodeId: string; value: string }
  | { kind: 'delete'; nodeId: string }

function checkedValue(text: string, type: JsonNodeType | undefined): string {
  const raw = text.trim()
  const analysis = analyzeJson(raw)
  if (!analysis.valid)
    throw new Error('节点值不是合法 JSON：' + (analysis.diagnostics[0]?.message ?? '请检查输入。'))
  if (analysis.diagnostics.some((item) => item.code === 'DuplicateKey'))
    throw new Error('节点值中存在重复属性名。')
  const first = raw[0]
  const actual =
    first === '{'
      ? 'object'
      : first === '['
        ? 'array'
        : first === '"'
          ? 'string'
          : raw === 'null'
            ? 'null'
            : raw === 'true' || raw === 'false'
              ? 'boolean'
              : 'number'
  if (type && actual !== type) throw new Error('JSON 值与所选类型不一致。')
  return raw
}

export function compileTreeCommand(
  text: string,
  tree: JsonTreeProjection,
  command: TreeCommand,
): {
  edits: TextEdit[]
  identityHint?: TreeIdentityHint
  identityIds?: string[]
  scalarPatch?: ScalarTreePatch
} {
  if (command.kind === 'move' || command.kind === 'sort')
    return compileStructuralCommand(text, tree, command)
  if (!tree.editable) throw new Error('存在重复属性名，请先在文本区消除歧义。')
  const index = indexTree(tree)
  const node = index.get(command.nodeId)
  if (!node) throw new Error('节点已不存在，请等待树刷新。')
  if (command.kind === 'set-mode' || command.kind === 'edit-value') {
    if (command.kind === 'set-mode' && command.mode !== 'auto' && command.mode !== 'string')
      throw new Error('输入模式无效。')
    if (command.kind === 'edit-value' && (node.type === 'object' || node.type === 'array'))
      throw new Error('容器内容请使用结构命令修改。')
    const raw =
      command.kind === 'set-mode'
        ? modeValue(text.slice(node.offset, node.offset + node.length), node, command.mode)
        : inputValue(command.value, modeOf(node))
    return compileTreeCommand(text, tree, { kind: 'update', nodeId: node.id, valueText: raw })
  }
  const parent = node.parentId ? index.get(node.parentId) : undefined
  const siblings = parent?.children.map((id) => index.get(id)!) ?? []
  const checkKey = (container: JsonTreeNode, key: string | undefined, except?: string): string => {
    if (key === undefined) throw new Error('Object 子节点需要属性名。')
    if (container.children.some((id) => id !== except && index.get(id)?.key === key))
      throw new Error('同级已存在该属性名。')
    return JSON.stringify(key)
  }
  const edits: TextEdit[] = []
  let identityHint: TreeIdentityHint | undefined
  if (command.kind === 'delete') {
    if (!parent) throw new Error('不能删除 JSON 根节点；可修改根值。')
    const position = parent.children.indexOf(node.id)
    const next = siblings[position + 1]
    const previous = siblings[position - 1]
    const start =
      next || !previous ? node.memberOffset : previous.memberOffset + previous.memberLength
    const end = next ? next.memberOffset : node.memberOffset + node.memberLength
    edits.push({ offset: start, length: end - start, text: '' })
    identityHint = { parentId: parent.id, children: parent.children.filter((id) => id !== node.id) }
  } else if (command.kind === 'add' || command.kind === 'insert' || command.kind === 'copy') {
    const container = command.kind === 'add' ? node : parent
    if (!container) throw new Error('根节点不能插入同级或复制；可向根容器添加子节点。')
    if (container.type !== 'object' && container.type !== 'array')
      throw new Error('只能向 Object 或 Array 新增子节点。')
    if (command.kind === 'insert' && command.position !== 'before' && command.position !== 'after')
      throw new Error('同级插入位置必须为 before 或 after。')
    const raw =
      command.kind === 'copy'
        ? text.slice(node.offset, node.offset + node.length)
        : checkedValue(command.valueText ?? '""', command.valueType)
    if (command.kind === 'copy') assertNodeCount(tree.nodes.length + subtreeSize(node, tree))
    else countAddedNodes(raw, tree.nodes.length)
    const key =
      container.type === 'object'
        ? command.kind === 'copy'
          ? uniqueObjectKey(tree, container.id, node.key!)
          : (command.key ?? uniqueObjectKey(tree, container.id))
        : undefined
    const member = container.type === 'object' ? checkKey(container, key) + ': ' + raw : raw
    const position =
      command.kind === 'add'
        ? (command.index ?? container.children.length)
        : container.children.indexOf(node.id) +
          (command.kind === 'copy' || command.position === 'after' ? 1 : 0)
    edits.push(insertMember(text, tree, container, position, member))
  } else if (command.kind === 'convert') {
    if (command.valueType !== 'array' && command.valueType !== 'object')
      throw new Error('容器类型必须为 Array 或 Object。')
    if (node.type !== command.valueType) {
      assertNodeCount(tree.nodes.length - subtreeSize(node, tree) + 2)
      edits.push({
        offset: node.offset,
        length: node.length,
        text: command.valueType === 'array' ? '[""]' : '{"key": ""}',
      })
    }
  } else {
    if (command.key !== undefined) {
      if (parent?.type !== 'object' || node.keyOffset === null || node.keyLength === null)
        throw new Error('该节点没有可修改的属性名。')
      const key = checkKey(parent, command.key, node.id)
      if (command.key !== node.key)
        edits.push({ offset: node.keyOffset, length: node.keyLength, text: key })
    }
    if (command.valueText !== undefined) {
      const raw = checkedValue(command.valueText, command.valueType)
      if (raw !== text.slice(node.offset, node.offset + node.length))
        edits.push({ offset: node.offset, length: node.length, text: raw })
    }
  }
  if (
    text.length + edits.reduce((delta, edit) => delta + edit.text.length - edit.length, 0) >
    MAX_TEXT_LENGTH
  )
    throw new Error('操作超出当前文档支持范围：文本过大。')
  const predicted = applySourceEdits(text, edits)
  if (
    command.kind === 'update' &&
    command.key === undefined &&
    edits.length === 1 &&
    node.type !== 'object' &&
    node.type !== 'array' &&
    edits[0]!.text[0] !== '{' &&
    edits[0]!.text[0] !== '['
  ) {
    const raw = edits[0]!.text
    const type =
      raw[0] === '"'
        ? 'string'
        : raw === 'null'
          ? 'null'
          : raw === 'true' || raw === 'false'
            ? 'boolean'
            : 'number'
    return {
      edits,
      scalarPatch: {
        documentId: tree.documentId,
        baseRevision: tree.revision,
        revision: tree.revision + 1,
        nodeId: node.id,
        type,
        edit: edits[0]!,
      },
    }
  }
  const analysis = analyzeJson(predicted)
  if (!analysis.valid)
    throw new Error('操作超出当前文档支持范围：' + analysis.diagnostics[0]?.message)
  return identityHint ? { edits, identityHint } : { edits }
}
