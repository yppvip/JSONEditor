import { useLayoutEffect, useRef } from 'react'
import type { JsonTreeNode, JsonTreeProjection } from '../../core/tree-model/model'
import type { TreeCommand } from '../../core/commands/tree-commands'
import { indexTree, jsonPointer } from '../../core/tree-model/model'
import { TreeNodeForm } from './TreeNodeForm'
import { StructuralActions } from './StructuralActions'
import { focusHandle } from './menu-helpers'
interface Props {
  kind: 'advanced' | 'move'
  tree: JsonTreeProjection
  node: JsonTreeNode
  disabled: boolean
  error: string
  rawValue: string | null
  onCommand: (command: TreeCommand, revision: number) => void
  onLocate: () => void
  onClose: () => void
}
export function NodeDialog({
  kind,
  tree,
  node,
  disabled,
  error,
  rawValue,
  onCommand,
  onLocate,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    ref.current?.showModal()
  }, [])
  const close = () => {
    ref.current?.close()
    onClose()
    focusHandle(node.id)
  }
  return (
    <dialog
      ref={ref}
      className="node-dialog"
      aria-label={kind === 'advanced' ? '完整 JSON 编辑' : '精确移动'}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const r = event.currentTarget.getBoundingClientRect()
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            close()
        }
      }}
    >
      <header>
        <strong>{kind === 'advanced' ? '完整 JSON 编辑' : '精确移动'}</strong>
        <button onClick={close} aria-label="关闭节点操作">
          ×
        </button>
      </header>
      <p className="dialog-path" title={jsonPointer(node, indexTree(tree)) || '$'}>
        {(jsonPointer(node, indexTree(tree)) || '$').slice(0, 200)}
      </p>
      {error && (
        <p className="tree-command-error" role="alert" aria-label="节点操作错误">
          {error}
        </p>
      )}
      {kind === 'advanced' ? (
        <TreeNodeForm
          key={`${tree.revision}:${node.id}`}
          modeEditing
          node={node}
          parent={node.parentId ? indexTree(tree).get(node.parentId) : undefined}
          rawValue={rawValue}
          disabled={disabled}
          onCommand={(command) => onCommand(command, tree.revision)}
          onLocate={() => {
            ref.current?.close()
            onLocate()
          }}
        />
      ) : (
        <StructuralActions
          key={`${tree.revision}:${node.id}`}
          tree={tree}
          node={node}
          disabled={disabled}
          onCommand={(command) => onCommand(command, tree.revision)}
        />
      )}
    </dialog>
  )
}
