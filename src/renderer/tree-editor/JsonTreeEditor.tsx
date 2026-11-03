import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Tree } from 'react-arborist'
import type { NodeRendererProps, TreeApi, NodeApi } from 'react-arborist'
import type { ComponentProps } from 'react'
import { indexTree, jsonPointer } from '../../core/tree-model/model'
import type { JsonTreeNode, JsonTreeProjection } from '../../core/tree-model/model'
import type { TreeCommand } from '../../core/commands/tree-commands'
import { TreeNodeForm } from './TreeNodeForm'
import { Icon } from '../ui/Icon'
import { StructuralActions } from './StructuralActions'
import { TreePresentationStore, presentationRoots } from './presentation-store'
import type { PresentationNode } from './presentation-store'

const RowStore = createContext<TreePresentationStore | null>(null)
type PresentationTreeProps = ComponentProps<typeof Tree<PresentationNode>>

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

function TreeRow({
  node,
  style,
  dragHandle,
}: NodeRendererProps<PresentationNode>): React.JSX.Element | null {
  const store = useContext(RowStore)!
  const nodeId = node.id
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(nodeId, listener),
    [store, nodeId],
  )
  const snapshot = useCallback(() => store.snapshot(nodeId), [store, nodeId])
  const { node: data, enabled } = useSyncExternalStore(subscribe, snapshot)
  if (!data) return null
  const container = data.type === 'object' || data.type === 'array'
  const name = label(data)
  return (
    <div
      style={style}
      className={`json-tree-row ${node.isSelected ? 'selected' : ''} ${node.willReceiveDrop ? 'drop-target' : ''}`}
      data-node-id={node.id}
      data-dragging={node.isDragging}
      onClick={() => node.select()}
    >
      {enabled && data.parentId !== null && (
        <div
          ref={dragHandle}
          className="tree-drag-handle"
          title={`拖动 ${name}`}
          aria-label={`拖动 ${name}`}
        >
          ⠿
        </div>
      )}
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
      <span className="tree-type">{data.type}</span>
      <span className="tree-preview">{data.preview}</span>
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
  const api = useRef<TreeApi<PresentationNode> | null>(null)
  const [store] = useState(() => new TreePresentationStore())
  const [size, setSize] = useState({ height: 240, width: 360 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const index = useMemo(() => (tree ? indexTree(tree) : new Map<string, JsonTreeNode>()), [tree])
  const roots = tree ? presentationRoots(tree) : []
  const selected = index.get(selectedId ?? tree?.rootId ?? '') ?? index.get(tree?.rootId ?? '')
  const rootId = tree?.rootId
  const initialOpenState = useMemo(() => (rootId ? { [rootId]: true } : {}), [rootId])
  // Arborist caches this flag while building topology. Dynamic read-only state hides the
  // source handle and is independently enforced by canDrop and the document command gate.
  const disableDrag = useCallback((node: PresentationNode) => node.parentId === null, [])
  const disableDrop = useCallback<
    Exclude<PresentationTreeProps['disableDrop'], string | boolean | undefined>
  >(
    ({ parentNode, dragNodes, index: position }) =>
      dragNodes.length !== 1 ||
      !parentNode ||
      !store.canDrop(dragNodes[0]!.id, parentNode.id, position),
    [store],
  )
  const move = useCallback<NonNullable<PresentationTreeProps['onMove']>>(
    ({ parentId, dragIds, index: position }) => {
      if (parentId && dragIds.length === 1) store.drop(dragIds[0]!, parentId, position)
    },
    [store],
  )
  const select = useCallback((nodes: NodeApi<PresentationNode>[]) => {
    if (nodes[0]) setSelectedId(nodes[0].id)
  }, [])
  useLayoutEffect(() => {
    store.update(tree, current && !!tree?.editable, onCommand)
  }, [store, tree, current, onCommand])
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
        <button
          className="icon-button"
          aria-label="全部折叠"
          title="全部折叠"
          disabled={!tree}
          onClick={() => api.current?.closeAll()}
        >
          <Icon name="collapse" />
        </button>
        <button
          className="icon-button"
          aria-label="展开根节点"
          title="展开根节点"
          disabled={!tree}
          onClick={() => tree && api.current?.open(tree.rootId)}
        >
          <Icon name="expand" />
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
          <RowStore.Provider value={store}>
            <Tree<PresentationNode>
              key={tree.rootId}
              ref={api}
              data={roots}
              idAccessor="id"
              childrenAccessor="children"
              width={contentWidth}
              height={Math.max(60, size.height - (contentWidth > size.width ? 16 : 0))}
              rowHeight={28}
              overscanCount={4}
              indent={16}
              openByDefault={false}
              initialOpenState={initialOpenState}
              selection={selected?.id ?? tree.rootId}
              disableDrag={disableDrag}
              disableDrop={disableDrop}
              onMove={move}
              disableEdit
              disableMultiSelection
              selectionFollowsFocus
              onSelect={select}
              aria-label="JSON 节点树"
            >
              {TreeRow}
            </Tree>
          </RowStore.Provider>
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
            modeEditing
            key={`${tree.revision}:${selected.id}`}
            node={selected}
            parent={selected.parentId ? index.get(selected.parentId) : undefined}
            rawValue={current ? readValue(selected) : null}
            disabled={disabled}
            onCommand={(command) => onCommand(command, tree.revision)}
            onLocate={() => onLocate(selected, tree.revision)}
            structuralActions={
              <StructuralActions
                tree={tree}
                node={selected}
                disabled={disabled}
                onCommand={(command) => onCommand(command, tree.revision)}
              />
            }
          />
        </>
      )}
    </section>
  )
}
