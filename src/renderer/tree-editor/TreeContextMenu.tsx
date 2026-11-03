import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import type { TreeCommand } from '../../core/commands/tree-commands'
import { indexTree } from '../../core/tree-model/model'
import type { JsonTreeNode, JsonTreeProjection } from '../../core/tree-model/model'
import { modeOf } from '../../core/tree-model/edit-modes'
import type { MenuAnchor } from './menu-context'
import { focusHandle, menuKeys } from './menu-helpers'
import { useSurfaceMotion } from '../ui/motion'

function Submenu({
  title,
  name,
  children,
  close,
}: {
  title: string
  name: string
  children: ReactNode
  close: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const menu = ref.current!,
      trigger = document.querySelector<HTMLElement>(`[data-submenu="${name}"]`)!
    const anchor = trigger.getBoundingClientRect(),
      rect = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(anchor.right + 4, window.innerWidth - rect.width - 8) < anchor.right ? anchor.left - rect.width - 4 : anchor.right + 4)}px`
    menu.style.top = `${Math.max(8, Math.min(anchor.top, window.innerHeight - rect.height - 8))}px`
    menu.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
  }, [name])
  useSurfaceMotion(ref, 'submenu', name)
  return (
    <div
      className="tree-context-menu submenu"
      style={{ left: 8, top: 8 }}
      role="menu"
      aria-label={title}
      ref={ref}
      onKeyDown={(event) => menuKeys(event, close)}
    >
      {children}
    </div>
  )
}

interface Props {
  anchor: MenuAnchor
  tree: JsonTreeProjection
  node: JsonTreeNode
  enabled: boolean
  current: boolean
  onCommand: (command: TreeCommand, revision: number) => void
  onDialog: (kind: 'advanced' | 'move') => void
  onLocate: () => void
  onClose: () => void
}
export function TreeContextMenu({
  anchor,
  tree,
  node,
  enabled,
  current,
  onCommand,
  onDialog,
  onLocate,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [sub, setSub] = useState<'type' | 'more' | null>(null)
  const parent = node.parentId ? indexTree(tree).get(node.parentId) : undefined
  const position = parent?.children.indexOf(node.id) ?? -1
  const container = node.type === 'object' || node.type === 'array'
  useLayoutEffect(() => {
    const menu = ref.current!,
      rect = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(anchor.x, window.innerWidth - rect.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(anchor.y, window.innerHeight - rect.height - 8))}px`
    menu.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
    const outside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) {
        onClose()
        focusHandle(anchor.id)
      }
    }
    const close = () => onClose()
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', close)
    }
  }, [anchor, onClose])
  useSurfaceMotion(ref, 'menu')
  const dismiss = () => {
    onClose()
    focusHandle(node.id)
  }
  const send = (command: TreeCommand) => {
    if (enabled) {
      dismiss()
      onCommand(command, tree.revision)
    }
  }
  const closeSub = () => {
    const old = sub
    setSub(null)
    ref.current?.querySelector<HTMLElement>(`[data-submenu="${old}"]`)?.focus()
  }
  const trigger = (name: 'type' | 'more', text: string, disabled = false) => (
    <button
      role="menuitem"
      disabled={disabled}
      data-submenu={name}
      aria-haspopup="menu"
      aria-expanded={sub === name}
      onClick={() => setSub(sub === name ? null : name)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          event.stopPropagation()
          setSub(name)
        }
      }}
    >
      {text}
      <span aria-hidden="true">›</span>
    </button>
  )
  return createPortal(
    <div
      ref={ref}
      className="tree-context-menu"
      style={{
        left: Math.max(8, Math.min(anchor.x, window.innerWidth - 208)),
        top: Math.max(8, Math.min(anchor.y, window.innerHeight - 237)),
      }}
      role="menu"
      aria-label="节点菜单"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.closest('[role="menu"]') === event.currentTarget
        )
          menuKeys(event, dismiss)
      }}
    >
      {trigger('type', '类型', !enabled)}
      <button
        role="menuitem"
        disabled={!enabled || !container}
        onClick={() => send({ kind: 'add', nodeId: node.id })}
      >
        添加子节点
      </button>
      <button
        role="menuitem"
        disabled={!enabled || !parent}
        onClick={() => send({ kind: 'insert', nodeId: node.id, position: 'after' })}
      >
        追加
      </button>
      <button
        role="menuitem"
        disabled={!enabled || !parent}
        onClick={() => send({ kind: 'insert', nodeId: node.id, position: 'before' })}
      >
        插入
      </button>
      <button
        role="menuitem"
        disabled={!enabled || !parent}
        onClick={() => send({ kind: 'copy', nodeId: node.id })}
      >
        复制节点
      </button>
      <button
        role="menuitem"
        className="danger"
        disabled={!enabled || !parent}
        onClick={() => send({ kind: 'delete', nodeId: node.id })}
      >
        移除
      </button>
      <hr role="separator" />
      {trigger('more', '更多')}
      {sub === 'type' && (
        <Submenu title="类型菜单" name="type" close={closeSub}>
          {(['auto', 'string'] as const).map((mode) => (
            <button
              key={mode}
              role="menuitemradio"
              aria-label={mode === 'auto' ? '自动' : '字符串'}
              disabled={!enabled}
              aria-checked={!container && modeOf(node) === mode}
              onClick={() => send({ kind: 'set-mode', nodeId: node.id, mode })}
            >
              {mode === 'auto' ? '自动' : '字符串'}
            </button>
          ))}
          {(['array', 'object'] as const).map((valueType) => (
            <button
              key={valueType}
              role="menuitemradio"
              aria-label={valueType === 'array' ? '数组' : '对象'}
              disabled={!enabled}
              aria-checked={node.type === valueType}
              onClick={() => send({ kind: 'convert', nodeId: node.id, valueType })}
            >
              {valueType === 'array' ? '数组' : '对象'}
            </button>
          ))}
        </Submenu>
      )}
      {sub === 'more' && (
        <Submenu title="更多节点操作" name="more" close={closeSub}>
          <button
            role="menuitem"
            disabled={!enabled || !parent || position <= 0}
            onClick={() =>
              parent &&
              send({ kind: 'move', nodeId: node.id, parentId: parent.id, index: position - 1 })
            }
          >
            上移节点
          </button>
          <button
            role="menuitem"
            disabled={!enabled || !parent || position >= parent.children.length - 1}
            onClick={() =>
              parent &&
              send({ kind: 'move', nodeId: node.id, parentId: parent.id, index: position + 1 })
            }
          >
            下移节点
          </button>
          <button
            role="menuitem"
            disabled={!enabled || !parent}
            onClick={() => {
              onClose()
              onDialog('move')
            }}
          >
            移动到…
          </button>
          <button
            role="menuitem"
            disabled={!enabled || !container}
            onClick={() => send({ kind: 'sort', nodeId: node.id, direction: 'asc' })}
          >
            子节点升序
          </button>
          <button
            role="menuitem"
            disabled={!enabled || !container}
            onClick={() => send({ kind: 'sort', nodeId: node.id, direction: 'desc' })}
          >
            子节点降序
          </button>
          <hr role="separator" />
          <button
            role="menuitem"
            disabled={!enabled}
            onClick={() => {
              onClose()
              onDialog('advanced')
            }}
          >
            完整 JSON 编辑…
          </button>
          <button
            role="menuitem"
            disabled={!current}
            onClick={() => {
              onClose()
              onLocate()
            }}
          >
            转到代码
          </button>
        </Submenu>
      )}
    </div>,
    document.body,
  )
}
