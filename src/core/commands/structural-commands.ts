import { analyzeJson } from '../json/engine'
import { applySourceEdits } from '../document/source-edits'
import type { TextEdit } from '../document/contracts'
import { indexTree } from '../tree-model/model'
import type { JsonTreeNode, JsonTreeProjection } from '../tree-model/model'

export interface MoveCommand {
  kind: 'move'
  nodeId: string
  parentId: string
  /** Final position after removing the moved node. */
  index: number
  key?: string
}
export interface SortCommand {
  kind: 'sort'
  nodeId: string
  direction: 'asc' | 'desc'
}

export function validateMove(tree: JsonTreeProjection, command: MoveCommand): void {
  if (!tree.editable) throw new Error('存在重复属性名，不能移动节点。')
  const index = indexTree(tree)
  const node = index.get(command.nodeId)
  const target = index.get(command.parentId)
  if (!node || !target) throw new Error('移动节点或目标已不存在。')
  if (node.parentId === null) throw new Error('不能移动根节点。')
  if (target.type !== 'object' && target.type !== 'array')
    throw new Error('目标必须是 Object 或 Array。')
  for (
    let ancestor: JsonTreeNode | undefined = target;
    ancestor;
    ancestor = ancestor.parentId ? index.get(ancestor.parentId) : undefined
  )
    if (ancestor.id === node.id) throw new Error('不能移动到自身或后代，避免循环。')
  const size = target.children.length - (node.parentId === target.id ? 1 : 0)
  if (!Number.isSafeInteger(command.index) || command.index < 0 || command.index > size)
    throw new Error('目标位置超出范围；位置从 0 开始，按移除源节点后计算。')
  if (target.type === 'object') {
    const key = command.key ?? node.key
    if (key === null) throw new Error('Array 元素移入 Object 时需要显式填写属性名。')
    if (target.children.some((id) => id !== node.id && index.get(id)?.key === key))
      throw new Error('目标 Object 已存在该属性名。')
  }
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function numericKey(raw: string): { negative: boolean; magnitude: bigint; digits: string } {
  if (raw.length > 65_536) throw new Error('数字过长，暂不支持自动排序；请手动移动。')
  const [mantissa = '', exponent = '0'] = raw.toLowerCase().split('e')
  if (exponent.length > 1024) throw new Error('数字指数过长，暂不支持自动排序。')
  const digits = mantissa.replace('-', '').replace('.', '').replace(/^0+/, '')
  const fraction = mantissa.includes('.') ? mantissa.length - mantissa.indexOf('.') - 1 : 0
  return {
    negative: digits !== '' && raw.startsWith('-'),
    magnitude: BigInt(exponent) - BigInt(fraction) + BigInt(digits.length),
    digits,
  }
}
function compareNumbers(
  a: ReturnType<typeof numericKey>,
  b: ReturnType<typeof numericKey>,
): number {
  if (!a.digits && !b.digits) return 0
  if (a.negative !== b.negative) return a.negative ? -1 : 1
  let result = !a.digits
    ? -1
    : !b.digits
      ? 1
      : a.magnitude < b.magnitude
        ? -1
        : a.magnitude > b.magnitude
          ? 1
          : 0
  if (!result)
    result = compareText(
      a.digits.padEnd(Math.max(a.digits.length, b.digits.length), '0'),
      b.digits.padEnd(Math.max(a.digits.length, b.digits.length), '0'),
    )
  return a.negative ? -result : result
}

/** Reorders original source slices; numbers and property spellings are never serialized. */
export function compileStructuralCommand(
  text: string,
  tree: JsonTreeProjection,
  command: MoveCommand | SortCommand,
): { edits: TextEdit[]; identityIds: string[] } {
  if (!tree.editable) throw new Error('存在重复属性名，不能操作结构。')
  const index = indexTree(tree)
  const orders = new Map<string, string[]>()
  const renamed = new Map<string, string>()
  if (command.kind === 'move') {
    validateMove(tree, command)
    const node = index.get(command.nodeId)!
    const target = index.get(command.parentId)!
    orders.set(
      node.parentId!,
      index.get(node.parentId!)!.children.filter((id) => id !== node.id),
    )
    const destination = [...(orders.get(target.id) ?? target.children)]
    destination.splice(command.index, 0, node.id)
    orders.set(target.id, destination)
    if (target.type === 'object') renamed.set(node.id, command.key ?? node.key!)
  } else {
    const node = index.get(command.nodeId)
    if (!node || (node.type !== 'object' && node.type !== 'array'))
      throw new Error('只能对 Object 或 Array 的直接子节点排序。')
    const children = node.children.map((id) => index.get(id)!)
    const type = children[0]?.type
    if (
      node.type === 'array' &&
      children.some(
        (child) => child.type !== type || child.type === 'object' || child.type === 'array',
      )
    )
      throw new Error('Array 自动排序仅支持同一标量类型；混合/容器元素请手动移动。')
    const values = new Map(
      children.map((child) => {
        const raw = text.slice(child.offset, child.offset + child.length)
        return [
          child.id,
          node.type === 'object'
            ? child.key!
            : child.type === 'number'
              ? numericKey(raw)
              : child.type === 'string'
                ? (JSON.parse(raw) as string)
                : raw,
        ] as const
      }),
    )
    const direction = command.direction === 'asc' ? 1 : -1
    orders.set(
      node.id,
      [...node.children].sort((a, b) => {
        const va = values.get(a)!,
          vb = values.get(b)!
        return (
          direction *
          (typeof va === 'string' && typeof vb === 'string'
            ? compareText(va, vb)
            : compareNumbers(
                va as ReturnType<typeof numericKey>,
                vb as ReturnType<typeof numericKey>,
              ))
        )
      }),
    )
  }
  const changed = [...orders.keys()].filter((id) => {
    const original = index.get(id)!.children,
      next = orders.get(id)!
    return (
      original.length !== next.length ||
      original.some((child, i) => child !== next[i]) ||
      next.some((child) => renamed.has(child) && renamed.get(child) !== index.get(child)!.key)
    )
  })
  if (!changed.length) return { edits: [], identityIds: tree.nodes.map((node) => node.id) }
  const dirty = new Set<string>()
  for (const id of changed) {
    let node = index.get(id)
    while (node) {
      dirty.add(node.id)
      node = node.parentId ? index.get(node.parentId) : undefined
    }
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const render = (node: JsonTreeNode): string => {
    const raw = text.slice(node.offset, node.offset + node.length)
    if (!dirty.has(node.id)) return raw
    const order = orders.get(node.id)
    if (!order)
      return applySourceEdits(
        raw,
        node.children
          .filter((id) => dirty.has(id))
          .map((id) => {
            const child = index.get(id)!
            return { offset: child.offset - node.offset, length: child.length, text: render(child) }
          }),
      )
    const indent =
      text.slice(text.lastIndexOf('\n', node.offset - 1) + 1, node.offset).match(/^[\t ]*/)?.[0] ??
      ''
    const members = order.map((id) => {
      const child = index.get(id)!
      const key = renamed.get(id) ?? child.key
      const prefix =
        node.type !== 'object'
          ? ''
          : child.key === key && child.keyOffset !== null
            ? text.slice(child.memberOffset, child.offset)
            : JSON.stringify(key) + ': '
      return prefix + render(child)
    })
    return (
      raw[0] +
      (members.length
        ? eol + indent + '  ' + members.join(',' + eol + indent + '  ') + eol + indent
        : '') +
      raw.at(-1)!
    )
  }
  // Choose the smallest original container enclosing every changed parent.
  let ancestor = index.get(changed[0]!)!
  while (
    !changed.every((id) => {
      let node: JsonTreeNode | undefined = index.get(id)
      while (node && node.id !== ancestor.id)
        node = node.parentId ? index.get(node.parentId) : undefined
      return !!node
    })
  )
    ancestor = index.get(ancestor.parentId!)!
  const edits = [{ offset: ancestor.offset, length: ancestor.length, text: render(ancestor) }]
  const predicted = applySourceEdits(text, edits)
  const analysis = analyzeJson(predicted)
  if (!analysis.valid)
    throw new Error('移动或排序超出文档限制：' + analysis.diagnostics[0]?.message)
  const ids: string[] = []
  const pending = [tree.rootId]
  while (pending.length) {
    const id = pending.pop()!
    ids.push(id)
    const children = orders.get(id) ?? index.get(id)!.children
    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]!)
  }
  return { edits, identityIds: ids }
}
