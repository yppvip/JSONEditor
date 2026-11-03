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
import { indexTree } from '../../core/tree-model/model'
import type { JsonTreeNode, JsonTreeProjection } from '../../core/tree-model/model'
import type { TreeCommand } from '../../core/commands/tree-commands'
import { Icon } from '../ui/Icon'
import { NodeTypeIcon } from './NodeTypeIcon'
import { TreeContextMenu } from './TreeContextMenu'
import { NodeDialog } from './NodeDialog'
import { OpenNodeMenu } from './menu-context'
import type { MenuAnchor } from './menu-context'
import { DropCursor } from './DropCursor'
import { DropFeedback } from './DropFeedback'
import { TreePresentationStore, presentationRoots } from './presentation-store'
import type { PresentationNode } from './presentation-store'
import { InlineEdit } from './InlineEdit'
import { BeginInlineEdit } from './inline-edit-context'

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
  const begin = useContext(BeginInlineEdit)
  const openMenu = useContext(OpenNodeMenu)
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
      onKeyDown={(event) => {
        if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
          event.preventDefault()
          event.stopPropagation()
          node.select()
          const rect = event.currentTarget.getBoundingClientRect()
          openMenu({ id: node.id, x: rect.left + 12, y: rect.bottom })
        }
      }}
    >
      <div
        ref={enabled && data.parentId !== null ? dragHandle : undefined}
        className="tree-drag-handle"
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        data-can-drag={enabled && data.parentId !== null}
        title={
          enabled && data.parentId !== null ? `按住拖动 ${name}；右键打开菜单` : `节点菜单 ${name}`
        }
        aria-label={`节点菜单 ${name}`}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          node.select()
          const rect = event.currentTarget.getBoundingClientRect()
          openMenu({
            id: node.id,
            x: Number.isFinite(event.clientX) ? event.clientX : rect.left,
            y: Number.isFinite(event.clientY) ? event.clientY : rect.bottom,
          })
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            node.select()
            openMenu({ id: node.id, x: rect.left, y: rect.bottom })
          }
        }}
      >
        <Icon name="drag" />
      </div>
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
      {data.key !== null && data.parentId !== null ? (
        <button
          className="tree-key tree-edit-cell"
          data-edit-field="key"
          disabled={!enabled}
          aria-label={`编辑属性名 ${name}`}
          title="点击编辑属性名"
          onClick={(event) => {
            event.stopPropagation()
            node.select()
            begin(data.id, 'key')
          }}
        >
          {name}
        </button>
      ) : (
        <span className="tree-key">{name}</span>
      )}
      <NodeTypeIcon node={data} />
      {container ? (
        <span className="tree-preview">{data.preview}</span>
      ) : (
        <button
          className="tree-preview tree-edit-cell"
          data-edit-field="value"
          disabled={!enabled}
          aria-label={`编辑值 ${name}`}
          title="点击编辑值"
          onClick={(event) => {
            event.stopPropagation()
            node.select()
            begin(data.id, 'value')
          }}
        >
          {data.preview}
        </button>
      )}
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
  const [menu, setMenu] = useState<(MenuAnchor & { revision: number; documentId: string }) | null>(
    null,
  )
  const [dialog, setDialog] = useState<{
    id: string
    kind: 'advanced' | 'move'
    documentId: string
  } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const live = useRef({ tree, current })
  const pending = useRef<{ command: TreeCommand; tree: JsonTreeProjection } | null>(null)
  const pendingDrop = useRef<{
    nodeId: string
    parentId: string
    index: number
    revision: number
    documentId: string
  } | null>(null)
  const [landing, setLanding] = useState<{
    nodeId: string
    revision: number
    documentId: string
  } | null>(null)
  useLayoutEffect(() => {
    live.current = { tree, current }
  }, [tree, current])
  const openMenu = useCallback((anchor: MenuAnchor) => {
    const currentTree = live.current.tree
    if (currentTree)
      setMenu({ ...anchor, revision: currentTree.revision, documentId: currentTree.documentId })
  }, [])
  const command = useCallback(
    (action: TreeCommand, revision: number) => {
      if (
        live.current.tree &&
        live.current.current &&
        !(
          action.kind === 'convert' &&
          indexTree(live.current.tree).get(action.nodeId)?.type === action.valueType
        ) &&
        ['add', 'insert', 'copy', 'convert'].includes(action.kind)
      )
        pending.current = { command: action, tree: live.current.tree }
      onCommand(action, revision)
    },
    [onCommand],
  )
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
      if (parentId && dragIds.length === 1 && store.canDrop(dragIds[0]!, parentId, position)) {
        const action = store.move(dragIds[0]!, parentId, position),
          tree = store.tree!
        const node = indexTree(tree).get(action.nodeId)!
        if (
          node.parentId !== parentId ||
          indexTree(tree).get(parentId)!.children.indexOf(node.id) !== action.index
        )
          pendingDrop.current = { ...action, revision: tree.revision, documentId: tree.documentId }
        store.drop(dragIds[0]!, parentId, position)
      }
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
    const attempt = pendingDrop.current
    if (!attempt || !tree) return
    if (error || tree.documentId !== attempt.documentId) {
      pendingDrop.current = null
      return
    }
    if (!current || tree.revision <= attempt.revision) return
    pendingDrop.current = null
    const index = indexTree(tree),
      node = index.get(attempt.nodeId)
    if (
      node?.parentId !== attempt.parentId ||
      index.get(attempt.parentId)?.children[attempt.index] !== attempt.nodeId
    )
      return
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled)
        setLanding({ nodeId: node.id, documentId: tree.documentId, revision: tree.revision })
    })
    return () => {
      cancelled = true
    }
  }, [tree, current, error])
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
  useEffect(() => {
    const viewport = area.current
    if (!viewport) return
    let dragging = false,
      frame = 0,
      speed = 0
    const tick = () => {
      if (!dragging || !live.current.current) {
        frame = 0
        return
      }
      if (speed) api.current?.listEl.current?.scrollBy(0, speed)
      frame = requestAnimationFrame(tick)
    }
    const start = (event: DragEvent) => {
      dragging =
        event.target instanceof Element &&
        !!event.target.closest('.tree-drag-handle[data-can-drag="true"]')
      if (dragging && !frame) frame = requestAnimationFrame(tick)
    }
    const over = (event: DragEvent) => {
      const rect = viewport.getBoundingClientRect()
      speed = event.clientY < rect.top + 32 ? -10 : event.clientY > rect.bottom - 32 ? 10 : 0
    }
    const stop = () => {
      dragging = false
      speed = 0
      cancelAnimationFrame(frame)
      frame = 0
    }
    const leave = (event: DragEvent) => {
      if (!viewport.contains(event.relatedTarget as Node | null)) speed = 0
    }
    viewport.addEventListener('dragstart', start)
    viewport.addEventListener('dragover', over)
    viewport.addEventListener('dragleave', leave)
    document.addEventListener('dragend', stop, true)
    document.addEventListener('drop', stop, true)
    return () => {
      stop()
      viewport.removeEventListener('dragstart', start)
      viewport.removeEventListener('dragover', over)
      viewport.removeEventListener('dragleave', leave)
      document.removeEventListener('dragend', stop, true)
      document.removeEventListener('drop', stop, true)
    }
  }, [])
  useEffect(() => {
    const creation = pending.current
    if (error && current) {
      pending.current = null
      return
    }
    if (!creation || !tree || !current || tree.revision <= creation.tree.revision) return
    pending.current = null
    if (tree.documentId !== creation.tree.documentId) return
    const index = indexTree(tree),
      before = indexTree(creation.tree),
      action = creation.command
    const source = index.get(action.nodeId)
    let target: JsonTreeNode | undefined
    if (action.kind === 'convert' && source) {
      api.current?.open(source.id)
      target = index.get(source.children[0] ?? '')
    } else if (source) {
      const parent = action.kind === 'add' ? source : index.get(source.parentId ?? '')
      if (parent) {
        api.current?.open(parent.id)
        target = parent.children.map((id) => index.get(id)!).find((node) => !before.has(node.id))
      }
    }
    if (!target) return
    const id = target.id,
      field = target.key !== null ? 'key' : 'value'
    api.current?.select(id)
    let frame = 0,
      tries = 0
    const focus = () => {
      const cell = document.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(id)}"] [data-edit-field="${field}"]`,
      )
      if (cell) {
        if (action.kind !== 'copy') cell.click()
        else cell.focus()
      } else if (++tries < 8) frame = requestAnimationFrame(focus)
    }
    frame = requestAnimationFrame(focus)
    return () => cancelAnimationFrame(frame)
  }, [tree, current, error])
  const disabled = !current || !tree?.editable
  const contentWidth = Math.max(size.width, ((tree?.maxDepth ?? 0) + 1) * 16 + 300)
  return (
    <InlineEdit
      tree={tree}
      current={current}
      error={error}
      onCommand={command}
      readValue={readValue}
      onLocate={onLocate}
    >
      <section
        className="tree-pane"
        aria-label="JSON 树编辑器"
        onKeyDownCapture={(event) => {
          if (
            !((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') ||
            !(event.target instanceof Element) ||
            !event.target.closest('[role="tree"]')
          )
            return
          event.preventDefault()
          event.stopPropagation()
          const row = event.target
            .closest('[role="treeitem"]')
            ?.querySelector<HTMLElement>('.json-tree-row')
          const id = row?.dataset.nodeId ?? selected?.id
          if (id) {
            const rect = (row ?? event.target).getBoundingClientRect()
            api.current?.select(id)
            openMenu({ id, x: rect.left + 12, y: rect.bottom })
          }
        }}
      >
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
            <OpenNodeMenu.Provider value={openMenu}>
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
                  renderCursor={DropCursor}
                  disableEdit
                  disableMultiSelection
                  selectionFollowsFocus
                  onSelect={select}
                  aria-label="JSON 节点树"
                >
                  {TreeRow}
                </Tree>
              </RowStore.Provider>
            </OpenNodeMenu.Provider>
          )}
          <DropFeedback
            viewport={area}
            nodeId={
              current &&
              landing?.documentId === tree?.documentId &&
              landing?.revision === tree?.revision
                ? landing?.nodeId
                : undefined
            }
            revision={tree?.revision ?? 0}
          />
        </div>
        {error && !dialog && (
          <p className="tree-command-error" role="alert" aria-label="节点操作错误">
            {error}
          </p>
        )}
        {tree &&
          menu &&
          menu.documentId === tree.documentId &&
          menu.revision === tree.revision &&
          index.has(menu.id) && (
            <TreeContextMenu
              key={`${menu.documentId}:${menu.revision}:${menu.id}:${menu.x}:${menu.y}`}
              anchor={menu}
              tree={tree}
              node={index.get(menu.id)!}
              enabled={!disabled}
              current={current}
              onClose={closeMenu}
              onCommand={command}
              onLocate={() => onLocate(index.get(menu.id)!, tree.revision)}
              onDialog={(kind) => setDialog({ id: menu.id, kind, documentId: tree.documentId })}
            />
          )}
        {tree && dialog && dialog.documentId === tree.documentId && index.has(dialog.id) && (
          <NodeDialog
            kind={dialog.kind}
            tree={tree}
            node={index.get(dialog.id)!}
            rawValue={current ? readValue(index.get(dialog.id)!) : null}
            disabled={disabled}
            error={error}
            onCommand={onCommand}
            onClose={() => setDialog(null)}
            onLocate={() => {
              setDialog(null)
              onLocate(index.get(dialog.id)!, tree.revision)
            }}
          />
        )}
      </section>
    </InlineEdit>
  )
}
