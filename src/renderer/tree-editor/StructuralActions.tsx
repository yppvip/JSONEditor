import { useState } from 'react'
import type { TreeCommand } from '../../core/commands/tree-commands'
import { indexTree, jsonPointer } from '../../core/tree-model/model'
import type { JsonTreeNode, JsonTreeProjection } from '../../core/tree-model/model'

interface Props {
  tree: JsonTreeProjection
  node: JsonTreeNode
  disabled: boolean
  onCommand: (command: TreeCommand) => void
}
export function StructuralActions({ tree, node, disabled, onCommand }: Props): React.JSX.Element {
  const index = indexTree(tree)
  const parent = node.parentId ? index.get(node.parentId) : undefined
  const position = parent?.children.indexOf(node.id) ?? 0
  const [path, setPath] = useState(parent ? jsonPointer(parent, index) : '')
  const [destination, setDestination] = useState('0')
  const [key, setKey] = useState(node.key ?? '')
  const [error, setError] = useState('')
  const send = (command: TreeCommand): void => {
    if (!disabled) {
      setError('')
      onCommand(command)
    }
  }
  return (
    <section className="tree-structure" aria-label="节点结构操作">
      <h3>移动与排序</h3>
      {parent && (
        <>
          <div className="tree-form-actions">
            <button
              type="button"
              disabled={disabled || position === 0}
              onClick={() =>
                send({ kind: 'move', nodeId: node.id, parentId: parent.id, index: position - 1 })
              }
            >
              上移节点
            </button>
            <button
              type="button"
              disabled={disabled || position === parent.children.length - 1}
              onClick={() =>
                send({ kind: 'move', nodeId: node.id, parentId: parent.id, index: position + 1 })
              }
            >
              下移节点
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (disabled) return
              let target = index.get(tree.rootId)
              if (path !== '') {
                if (!path.startsWith('/') || /~(?![01])/.test(path)) {
                  setError('请输入合法 JSON Pointer；空字符串表示根节点。')
                  return
                }
                for (const part of path
                  .slice(1)
                  .split('/')
                  .map((value) => value.replaceAll('~1', '/').replaceAll('~0', '~'))) {
                  target =
                    target?.type === 'object'
                      ? target.children
                          .map((id) => index.get(id)!)
                          .find((child) => child.key === part)
                      : target?.type === 'array' && /^(0|[1-9]\d*)$/.test(part)
                        ? index.get(target.children[Number(part)] ?? '')
                        : undefined
                }
              }
              if (!target) {
                setError('目标路径不存在。')
                return
              }
              if (!/^\d+$/.test(destination)) {
                setError('目标位置需要非负整数。')
                return
              }
              send({
                kind: 'move',
                nodeId: node.id,
                parentId: target.id,
                index: Number(destination),
                ...(target.type === 'object' ? { key } : {}),
              })
            }}
          >
            <label>
              目标容器路径
              <input
                aria-label="移动目标 JSON Pointer"
                value={path}
                disabled={disabled}
                onChange={(e) => setPath(e.target.value)}
                placeholder="空字符串表示根节点"
              />
            </label>
            <label>
              目标位置（移除后，从 0 开始）
              <input
                aria-label="移动目标位置"
                inputMode="numeric"
                value={destination}
                disabled={disabled}
                onChange={(e) => setDestination(e.target.value)}
              />
            </label>
            <label>
              目标属性名（移入 Object 时使用）
              <input
                aria-label="移动目标属性名"
                value={key}
                disabled={disabled}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            <button type="submit" disabled={disabled}>
              移动节点
            </button>
          </form>
        </>
      )}
      {(node.type === 'object' || node.type === 'array') && (
        <>
          <p className="tree-hint">Object 按属性名，Array 按同一标量类型的值排序；数字保持精度。</p>
          <div className="tree-form-actions">
            <button
              type="button"
              disabled={disabled}
              onClick={() => send({ kind: 'sort', nodeId: node.id, direction: 'asc' })}
            >
              子节点升序
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => send({ kind: 'sort', nodeId: node.id, direction: 'desc' })}
            >
              子节点降序
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="tree-command-error" role="alert" aria-label="移动输入错误">
          {error}
        </p>
      )}
    </section>
  )
}
