import { analyzeJson } from '../json/engine'
import type { TextEdit } from '../document/contracts'
import { indexTree } from '../tree-model/model'
import { applySourceEdits } from '../document/source-edits'
import { compileStructuralCommand } from './structural-commands'
import type { MoveCommand, SortCommand } from './structural-commands'
import type { ScalarTreePatch } from '../tree-model/scalar-patch'
import { MAX_TEXT_LENGTH } from '../json/limits'
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
  | { kind: 'add'; nodeId: string; key?: string; valueText: string; valueType: JsonNodeType }
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
  } else if (command.kind === 'add') {
    if (node.type !== 'object' && node.type !== 'array')
      throw new Error('只能向 Object 或 Array 新增子节点。')
    const raw = checkedValue(command.valueText, command.valueType)
    const member = node.type === 'object' ? checkKey(node, command.key) + ': ' + raw : raw
    const lineStart = text.lastIndexOf('\n', node.offset - 1) + 1
    const prefix = text.slice(lineStart, node.offset)
    const indent = prefix.match(/^[\t ]*/)?.[0] ?? ''
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const last = index.get(node.children.at(-1) ?? '')
    edits.push(
      last
        ? {
            offset: last.memberOffset + last.memberLength,
            length: 0,
            text: ',' + eol + indent + '  ' + member,
          }
        : { offset: node.offset + 1, length: 0, text: eol + indent + '  ' + member + eol + indent },
    )
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
    if (predicted.length > MAX_TEXT_LENGTH) throw new Error('操作超出当前文档支持范围：文本过大。')
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
