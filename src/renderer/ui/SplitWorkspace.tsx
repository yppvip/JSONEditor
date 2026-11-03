import { useEffect, useId, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { clampFraction, layoutBounds, MIN_PANE_WIDTH, SPLITTER_WIDTH } from './workspace-layout'
import type { WorkspaceLayout } from './workspace-layout'

interface Props {
  layout: WorkspaceLayout
  onChange: (layout: WorkspaceLayout) => void
  tree: ReactNode
  code: ReactNode
}

interface Drag {
  pointerId: number
  startX: number
  startLeft: number
  width: number
  treeOnLeft: boolean
  fraction: number
}

export function SplitWorkspace({ layout, onChange, tree, code }: Props): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const handle = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const frame = useRef<number | null>(null)
  const [width, setWidth] = useState(0)
  const [draft, setDraft] = useState<number | null>(null)
  const id = useId()
  const treeId = `${id}-tree`
  const codeId = `${id}-code`
  const hintId = `${id}-hint`
  const fraction = clampFraction(draft ?? layout.treeFraction, width)
  const left = layout.treeOnLeft ? fraction : 1 - fraction
  const bounds = layoutBounds(width)
  const minimum = `min(${MIN_PANE_WIDTH}px, calc((100% - ${SPLITTER_WIDTH}px) / 2))`

  useEffect(() => {
    if (!root.current) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setWidth(entry.contentRect.width)
      // A window resize changes gesture geometry. Keep the last committed preference.
      const active = drag.current
      if (active && Math.abs(entry.contentRect.width - active.width) > 0.5) {
        drag.current = null
        if (frame.current !== null) cancelAnimationFrame(frame.current)
        frame.current = null
        setDraft(null)
        if (handle.current?.hasPointerCapture(active.pointerId)) {
          handle.current.releasePointerCapture(active.pointerId)
        }
      }
    })
    observer.observe(root.current)
    return () => {
      observer.disconnect()
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      drag.current = null
    }
  }, [])

  const endDrag = (commit: boolean): void => {
    const active = drag.current
    if (!active) return
    drag.current = null
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    setDraft(null)
    if (commit) onChange({ treeOnLeft: active.treeOnLeft, treeFraction: active.fraction })
    if (handle.current?.hasPointerCapture(active.pointerId)) {
      handle.current.releasePointerCapture(active.pointerId)
    }
  }
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const active = drag.current
    if (!active || event.pointerId !== active.pointerId) return
    const nextLeft =
      active.startLeft + (event.clientX - active.startX) / (active.width - SPLITTER_WIDTH)
    active.fraction = clampFraction(active.treeOnLeft ? nextLeft : 1 - nextLeft, active.width)
    if (frame.current === null)
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        if (drag.current) setDraft(drag.current.fraction)
      })
  }

  return (
    <div
      className="editor-split"
      ref={root}
      data-tree-side={layout.treeOnLeft ? 'left' : 'right'}
      data-resizing={draft !== null}
      style={{
        gridTemplateColumns: `minmax(${minimum}, ${left}fr) ${SPLITTER_WIDTH}px minmax(${minimum}, ${1 - left}fr)`,
      }}
    >
      {/* Stable DOM positions preserve editors, selection, focus, scroll and history on swap. */}
      <div
        className="workspace-tree-slot"
        id={treeId}
        style={{ gridColumn: layout.treeOnLeft ? 1 : 3 }}
      >
        {tree}
      </div>
      <div
        className="workspace-splitter"
        ref={handle}
        role="separator"
        tabIndex={0}
        aria-label="调整树与代码宽度"
        aria-orientation="vertical"
        aria-controls={`${treeId} ${codeId}`}
        aria-valuemin={Math.round(bounds.min * 100)}
        aria-valuemax={Math.round(bounds.max * 100)}
        aria-valuenow={Math.round(left * 100)}
        aria-valuetext={`${layout.treeOnLeft ? '树' : '代码'} ${Math.round(left * 100)}%，${layout.treeOnLeft ? '代码' : '树'} ${Math.round((1 - left) * 100)}%`}
        aria-describedby={hintId}
        title="拖动调整宽度；双击恢复均分；方向键微调，Shift 加速，Home/End 到边界"
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary || drag.current) return
          event.preventDefault()
          const measured = root.current?.getBoundingClientRect().width ?? 0
          if (measured <= SPLITTER_WIDTH) return
          const start = clampFraction(layout.treeFraction, measured)
          drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startLeft: layout.treeOnLeft ? start : 1 - start,
            width: measured,
            treeOnLeft: layout.treeOnLeft,
            fraction: start,
          }
          setDraft(start)
          event.currentTarget.focus({ preventScroll: true })
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={move}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return
          move(event)
          endDrag(true)
        }}
        onPointerCancel={(event) => {
          if (drag.current?.pointerId === event.pointerId) endDrag(false)
        }}
        onLostPointerCapture={(event) => {
          if (drag.current?.pointerId === event.pointerId) endDrag(false)
        }}
        onBlur={() => endDrag(false)}
        onDoubleClick={() => {
          endDrag(false)
          onChange({ ...layout, treeFraction: 0.5 })
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            endDrag(false)
            return
          }
          if (drag.current) return
          const measured = root.current?.getBoundingClientRect().width ?? width
          const keyBounds = layoutBounds(measured)
          const current = clampFraction(layout.treeFraction, measured)
          const currentLeft = layout.treeOnLeft ? current : 1 - current
          const step = event.shiftKey ? 0.1 : 0.02
          const next =
            event.key === 'ArrowLeft'
              ? currentLeft - step
              : event.key === 'ArrowRight'
                ? currentLeft + step
                : event.key === 'Home'
                  ? keyBounds.min
                  : event.key === 'End'
                    ? keyBounds.max
                    : event.key === 'Enter'
                      ? 0.5
                      : null
          if (next === null) return
          event.preventDefault()
          onChange({
            ...layout,
            treeFraction: clampFraction(layout.treeOnLeft ? next : 1 - next, measured),
          })
        }}
      />
      <div
        className="workspace-code-slot"
        id={codeId}
        style={{ gridColumn: layout.treeOnLeft ? 3 : 1 }}
      >
        {code}
      </div>
      <span className="sr-only" id={hintId}>
        拖动或使用左右方向键调整两侧宽度，Shift 加速，Home 和 End 调到边界，双击或按 Enter
        恢复均分。
      </span>
    </div>
  )
}
