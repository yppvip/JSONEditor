import { Icon } from '../ui/Icon'
import { modeOf } from '../../core/tree-model/edit-modes'
import type { JsonTreeNode } from '../../core/tree-model/model'
import { useRef } from 'react'
import { useCssFeedback } from '../ui/motion'
export function NodeTypeIcon({ node }: { node: JsonTreeNode }) {
  const mode = modeOf(node),
    container = node.type === 'object' || node.type === 'array'
  const ref = useRef<HTMLSpanElement>(null)
  useCssFeedback(ref, `${node.type}:${mode}`)
  const names = {
    object: '对象',
    array: '数组',
    string: '字符串',
    number: '数字',
    boolean: '布尔',
    null: 'null',
  }
  const title = container
    ? names[node.type]
    : `${mode === 'auto' ? '自动' : '锁定字符串'} · ${names[node.type]}`
  return (
    <span
      className="tree-type"
      ref={ref}
      data-mode={mode}
      data-type={node.type}
      title={title}
      aria-label={title}
    >
      <Icon name={node.type === 'string' && mode === 'auto' ? 'automatic' : node.type} />
    </span>
  )
}
