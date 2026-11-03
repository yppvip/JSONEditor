import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'
import type { TreeApi } from 'react-arborist'
import { indexTree } from '../../core/tree-model/model'
import type { JsonTreeProjection } from '../../core/tree-model/model'
import type { PresentationNode, TreePresentationStore } from './presentation-store'

interface DropTarget {
  parentId: string
  index: number
  inside: boolean
}

/** Positions are measured before removing the source; the store adjusts same-parent moves. */
export function handleDropTarget(
  tree: JsonTreeProjection,
  id: string,
  fraction: number,
): DropTarget | null {
  const index = indexTree(tree),
    node = index.get(id)
  if (!node) return null
  if ((node.type === 'array' || node.type === 'object') && fraction >= 0.25 && fraction <= 0.75)
    return { parentId: id, index: node.children.length, inside: true }
  if (!node.parentId) return null
  const parent = index.get(node.parentId)!
  return {
    parentId: parent.id,
    index: parent.children.indexOf(id) + (fraction >= 0.5 ? 1 : 0),
    inside: false,
  }
}

interface Props {
  viewport: RefObject<HTMLDivElement | null>
  api: RefObject<TreeApi<PresentationNode> | null>
  store: TreePresentationStore
  tree: JsonTreeProjection | null
  current: boolean
  onStart: () => void
  onDrop: (nodeId: string, parentId: string, index: number) => void
}

/** Pointer capture belongs to the viewport: the source row can unmount during virtual scrolling. */
export function useHandleDrag({ viewport, api, store, tree, current, onStart, onDrop }: Props) {
  useLayoutEffect(() => {
    const area = viewport.current
    if (!area || !tree) return
    let session: {
      id: string
      pointerId: number
      startX: number
      startY: number
      x: number
      y: number
      active: boolean
    } | null = null
    let frame = 0,
      suppressMenu = false
    let sourceRow: HTMLElement | null = null,
      targetRow: HTMLElement | null = null
    let target: DropTarget | null = null
    const cursor = document.createElement('div')
    cursor.className = 'tree-drop-cursor handle-drop-cursor'
    cursor.setAttribute('aria-hidden', 'true')
    const hint = document.createElement('div')
    hint.className = 'tree-drag-hint'
    hint.setAttribute('role', 'status')
    const clearMarks = () => {
      if (sourceRow) sourceRow.dataset.dragging = 'false'
      targetRow?.removeAttribute('data-pointer-drop')
      sourceRow = targetRow = null
      cursor.remove()
      hint.remove()
      area.removeAttribute('data-handle-dragging')
    }
    const stop = () => {
      const old = session
      session = null
      target = null
      cancelAnimationFrame(frame)
      frame = 0
      clearMarks()
      if (old && area.hasPointerCapture(old.pointerId)) area.releasePointerCapture(old.pointerId)
    }
    const valid = () => current && store.enabled && store.tree === tree
    const paint = () => {
      const drag = session
      if (!drag?.active) return
      if (!valid()) {
        stop()
        return
      }
      const bounds = area.getBoundingClientRect()
      const list = api.current?.listEl.current
      target = null
      targetRow?.removeAttribute('data-pointer-drop')
      targetRow = null
      cursor.remove()
      if (
        drag.x >= bounds.left &&
        drag.x < bounds.right &&
        drag.y >= bounds.top &&
        drag.y < bounds.bottom
      ) {
        const listBounds = list?.getBoundingClientRect()
        if (list && listBounds && drag.x < listBounds.right && drag.y < listBounds.bottom) {
          const speed =
            drag.y < listBounds.top + 32 ? -10 : drag.y > listBounds.bottom - 32 ? 10 : 0
          if (speed) list.scrollBy(0, speed)
        }
        // Never use event.target under pointer capture; hit-test current virtual rows by coordinates.
        const element = document.elementFromPoint(drag.x, drag.y)
        const hit =
          element?.closest<HTMLElement>('[data-node-id]') ??
          element?.closest('[role="treeitem"]')?.querySelector<HTMLElement>('[data-node-id]')
        if (hit && area.contains(hit)) {
          // The virtual row includes a small gap below its content; it is still a valid drop zone.
          const rect = (hit.closest('[role="treeitem"]') ?? hit).getBoundingClientRect()
          const candidate = handleDropTarget(
            tree,
            hit.dataset.nodeId!,
            (drag.y - rect.top) / rect.height,
          )
          targetRow = hit
          if (candidate && store.canDrop(drag.id, candidate.parentId, candidate.index)) {
            target = candidate
            if (candidate.inside) hit.dataset.pointerDrop = 'inside'
            else {
              cursor.style.left = `${rect.left - bounds.left + area.scrollLeft + 28}px`
              cursor.style.top = `${(drag.y < rect.top + rect.height / 2 ? rect.top : rect.bottom) - bounds.top + area.scrollTop - 1}px`
              cursor.style.width = `${Math.max(0, Math.min(rect.right, bounds.right) - rect.left - 36)}px`
              area.append(cursor)
            }
          } else hit.dataset.pointerDrop = 'invalid'
        }
      }
      const mountedSource = area.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(drag.id)}"]`,
      )
      if (sourceRow !== mountedSource && sourceRow) sourceRow.dataset.dragging = 'false'
      sourceRow = mountedSource
      if (sourceRow) sourceRow.dataset.dragging = 'true'
      area.dataset.handleDragging = 'true'
      const message = target ? '松开右键放置 · Esc 取消' : '请选择有效的容器或同级位置 · Esc 取消'
      if (hint.textContent !== message) hint.textContent = message
      hint.dataset.valid = String(!!target)
      if (!hint.isConnected) document.body.append(hint)
      hint.style.left = `${Math.max(8, Math.min(drag.x + 14, window.innerWidth - hint.offsetWidth - 8))}px`
      hint.style.top = `${Math.max(8, Math.min(drag.y + 14, window.innerHeight - hint.offsetHeight - 8))}px`
    }
    const tick = () => {
      paint()
      if (session?.active) frame = requestAnimationFrame(tick)
    }
    const down = (event: PointerEvent) => {
      suppressMenu = false
      if (session) {
        stop()
        return
      }
      const handle =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('.tree-drag-handle')
          : null
      if (event.button !== 2 || !handle || !area.contains(handle)) return
      event.preventDefault()
      suppressMenu = true
      if (!valid() || handle.dataset.canDrag !== 'true' || document.querySelector('.inline-edit'))
        return
      const id = handle.closest<HTMLElement>('[data-node-id]')!.dataset.nodeId!
      session = {
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        active: false,
      }
      onStart()
      area.setPointerCapture(event.pointerId)
    }
    const move = (event: PointerEvent) => {
      const drag = session
      if (!drag || drag.pointerId !== event.pointerId) return
      if (!(event.buttons & 2)) {
        stop()
        return
      }
      event.preventDefault()
      drag.x = event.clientX
      drag.y = event.clientY
      if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 5) {
        drag.active = true
        tick()
      }
    }
    const up = (event: PointerEvent) => {
      const drag = session
      if (!drag || drag.pointerId !== event.pointerId) return
      if (event.button !== 2) {
        stop()
        return
      }
      event.preventDefault()
      drag.x = event.clientX
      drag.y = event.clientY
      // Re-hit-test the release coordinates, including any scroll since the last frame.
      paint()
      const drop = target
      const commit = drag.active && valid() && drop
      stop()
      if (commit) onDrop(drag.id, commit.parentId, commit.index)
    }
    const menu = (event: MouseEvent) => {
      if (
        session ||
        suppressMenu ||
        (event.target instanceof Element &&
          area.contains(event.target) &&
          event.target.closest('.tree-drag-handle'))
      ) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const key = (event: KeyboardEvent) => {
      if (!session) suppressMenu = false
      if (session && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        stop()
      }
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('pointermove', move, true)
    document.addEventListener('pointerup', up, true)
    document.addEventListener('pointercancel', stop, true)
    document.addEventListener('contextmenu', menu, true)
    document.addEventListener('keydown', key, true)
    area.addEventListener('lostpointercapture', stop)
    window.addEventListener('blur', stop)
    window.addEventListener('resize', stop)
    return () => {
      stop()
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('pointermove', move, true)
      document.removeEventListener('pointerup', up, true)
      document.removeEventListener('pointercancel', stop, true)
      document.removeEventListener('contextmenu', menu, true)
      document.removeEventListener('keydown', key, true)
      area.removeEventListener('lostpointercapture', stop)
      window.removeEventListener('blur', stop)
      window.removeEventListener('resize', stop)
    }
  }, [viewport, api, store, tree, current, onStart, onDrop])
}
