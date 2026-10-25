import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tree } from 'react-arborist'
import type { NodeRendererProps, TreeApi } from 'react-arborist'
import { indexTree, jsonPointer } from '../../core/tree-model/model'
import type { JsonTreeNode, JsonTreeProjection } from '../../core/tree-model/model'
import type { TreeCommand } from '../../core/commands/tree-commands'
import { TreeNodeForm } from './TreeNodeForm'

function label(node: JsonTreeNode): string {
  const name =
    node.parentId === null
      ? '$'
      : node.key !== null
        ? !node.key.trim() || /[\r\n\t]/.test(node.key)
          ? JSON.stringify(node.key)
          : node.key
        : `[${node.index}]`
  return name.length > 70 ? name.slice(0, 70) + '…' : name
}

function TreeRow({ node, style }: NodeRendererProps<JsonTreeNode>): React.JSX.Element {
  const container = node.data.type === 'object' || node.data.type === 'array'
  const name = label(node.data)
  return (
    <div
      style={style}
      className={`json-tree-row ${node.isSelected ? 'selected' : ''}`}
      data-node-id={node.id}
      onClick={() => node.select()}
    >
      <button
        className="tree-toggle"
        disabled={!container}
        aria-label={`${node.isOpen ? '折叠' : '展开'} ${name}`}
        onClick={(event) => {
          event.stopPropagation()
          node.toggle()
        }}
      >
        {container ? (node.isOpen ? '▾' : '▸') : '·'}
      </button>
      <span className="tree-key">{name}</span>
      <span className="tree-type">{node.data.type}</span>
      <span className="tree-preview">{node.data.preview}</span>
    </div>
  )
}

interface Props {
  tree: JsonTreeProjection | null
  current: boolean
  message: string
  error: string
  onCommand: (command: TreeCommand, revision: number) => void
  readValue: (node: JsonTreeNode) => string | null
  onLocate: (node: JsonTreeNode, revision: number) => void
}

export function JsonTreeEditor({
  tree,
  current,
  message,
  error,
  onCommand,
  readValue,
  onLocate,
}: Props): React.JSX.Element {
  const area = useRef<HTMLDivElement>(null)
  const api = useRef<TreeApi<JsonTreeNode> | null>(null)
  const [size, setSize] = useState({ height: 240, width: 360 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const index = useMemo(() => (tree ? indexTree(tree) : new Map<string, JsonTreeNode>()), [tree])
  const roots = useMemo(
    () => (tree && index.get(tree.rootId) ? [index.get(tree.rootId)!] : []),
    [tree, index],
  )
  const selected = index.get(selectedId ?? tree?.rootId ?? '') ?? roots[0]
  const children = useCallback(
    (node: JsonTreeNode) =>
      node.type === 'object' || node.type === 'array'
        ? node.children.map((id) => index.get(id)!)
        : null,
    [index],
  )
  useEffect(() => {
    if (!area.current) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setSize({
          height: Math.max(120, Math.floor(entry.contentRect.height)),
          width: Math.max(200, Math.floor(entry.contentRect.width)),
        })
    })
    observer.observe(area.current)
    return () => observer.disconnect()
  }, [])
  const disabled = !current || !tree?.editable
  const contentWidth = Math.max(size.width, ((tree?.maxDepth ?? 0) + 1) * 16 + 300)
  return (
    <section className="tree-pane" aria-label="JSON 树编辑器">
      <div className="tree-header">
        <strong>JSON 树</strong>
        <span data-testid="tree-count">
          {tree
            ? `${tree.nodes.length.toLocaleString('en-US')} 个节点${current ? '' : '（旧）'}`
            : '暂无树'}
        </span>
        <button disabled={!tree} onClick={() => api.current?.closeAll()}>
          全部折叠
        </button>
        <button disabled={!tree} onClick={() => tree && api.current?.open(tree.rootId)}>
          展开根节点
        </button>
      </div>
      <p className={`tree-state ${disabled ? 'readonly' : ''}`} data-testid="tree-status">
        {message ||
          (!tree
            ? '等待有效 JSON'
            : !current
              ? '树已过期，仅供浏览；请先完成文本校验。'
              : !tree.editable
                ? '存在重复属性名，树仅供浏览；请在文本区消除歧义。'
                : '树可编辑')}
      </p>
      <div className="tree-viewport" ref={area}>
        {tree && (
          <Tree<JsonTreeNode>
            key={tree.rootId}
            ref={api}
            data={roots}
            idAccessor="id"
            childrenAccessor={children}
            width={contentWidth}
            height={Math.max(60, size.height - (contentWidth > size.width ? 16 : 0))}
            rowHeight={28}
            overscanCount={4}
            indent={16}
            openByDefault={false}
            initialOpenState={{ [tree.rootId]: true }}
            selection={selected?.id ?? tree.rootId}
            disableDrag
            disableDrop
            disableEdit
            disableMultiSelection
            selectionFollowsFocus
            onSelect={(nodes) => {
              if (nodes[0]) setSelectedId(nodes[0].id)
            }}
            aria-label="JSON 节点树"
          >
            {TreeRow}
          </Tree>
        )}
      </div>
      {error && (
        <p className="tree-command-error" role="alert" aria-label="节点操作错误">
          {error}
        </p>
      )}
      {tree && selected && (
        <>
          <p className="tree-path" title="JSON Pointer">
            {(jsonPointer(selected, index) || '(根节点)').slice(0, 200)}
          </p>
          <TreeNodeForm
            key={`${tree.revision}:${selected.id}`}
            node={selected}
            parent={selected.parentId ? index.get(selected.parentId) : undefined}
            rawValue={current ? readValue(selected) : null}
            disabled={disabled}
            onCommand={(command) => onCommand(command, tree.revision)}
            onLocate={() => onLocate(selected, tree.revision)}
          />
        </>
      )}
    </section>
  )
}
