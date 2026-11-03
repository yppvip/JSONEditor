import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JsonTreeNode, JsonTreeProjection } from '../../core/tree-model/model'
import { indexTree, MAX_FORM_VALUE_LENGTH } from '../../core/tree-model/model'
import { inputValue, modeOf } from '../../core/tree-model/edit-modes'
import type { EditMode } from '../../core/tree-model/edit-modes'
import type { TreeCommand } from '../../core/commands/tree-commands'

import { BeginInlineEdit } from './inline-edit-context'
import type { EditField } from './inline-edit-context'
interface Draft {
  documentId: string
  id: string
  field: EditField
  value: string
  original: string
  revision: number
  mode: EditMode
  long: boolean
  blocked: boolean
  error: string
  pending: boolean
  tab: boolean
  restoreFocus: boolean
}
interface Props {
  tree: JsonTreeProjection | null
  current: boolean
  error: string
  readValue: (node: JsonTreeNode) => string | null
  onCommand: (command: TreeCommand, revision: number) => boolean | void
  onLocate: (node: JsonTreeNode, revision: number) => void
  children: React.ReactNode
}

/** Owned by the pane, not a virtual row: unmounting a row never discards its draft. */
export function InlineEdit({ children, ...props }: Props): React.JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [position, setPosition] = useState({ left: 10, top: 80, width: 240, detached: false })
  const latest = useRef(props)
  const active = useRef(draft)
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const busySeen = useRef(false)
  useLayoutEffect(() => {
    latest.current = props
    active.current = draft
  })
  const focusCell = useCallback((id: string, field: EditField) => {
    document
      .querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"] [data-edit-field="${field}"]`)
      ?.focus()
  }, [])
  const cancel = useCallback(() => {
    const previous = active.current
    active.current = null
    setDraft(null)
    if (previous) focusCell(previous.id, previous.field)
  }, [focusCell])
  const begin = useCallback((id: string, field: EditField) => {
    const p = latest.current
    if (active.current) {
      input.current?.focus()
      return
    }
    if (!p.current || !p.tree?.editable) return
    const node = indexTree(p.tree).get(id)
    if (!node) return
    if (
      field === 'key' &&
      (!node.parentId || indexTree(p.tree).get(node.parentId)?.type !== 'object')
    )
      return
    if (field === 'value' && (node.type === 'array' || node.type === 'object')) return
    const raw = field === 'value' ? p.readValue(node) : node.key
    const blocked = raw === null || raw.length > MAX_FORM_VALUE_LENGTH
    const value = blocked
      ? ''
      : field === 'value' && node.type === 'string'
        ? (JSON.parse(raw!) as string)
        : raw!
    const next: Draft = {
      documentId: p.tree.documentId,
      id,
      field,
      value,
      original: value,
      revision: p.tree.revision,
      mode: modeOf(node),
      long: blocked || value.length > 120 || /[\r\n]/.test(value),
      blocked,
      error: '',
      pending: false,
      tab: false,
      restoreFocus: true,
    }
    active.current = next
    setDraft(next)
  }, [])
  const finish = useCallback(
    (d: Draft) => {
      active.current = null
      setDraft(null)
      if (d.restoreFocus) focusCell(d.id, d.field)
      if (d.tab) {
        const tree = latest.current.tree
        if (!tree) return
        const node = indexTree(tree).get(d.id)
        if (d.field === 'key' && node && node.type !== 'object' && node.type !== 'array') {
          begin(d.id, 'value')
        } else {
          const cell = document.querySelector<HTMLElement>(
            `[data-node-id="${CSS.escape(d.id)}"] [data-edit-field="${d.field}"]`,
          )
          const cells = [
            ...document.querySelectorAll<HTMLElement>('[data-edit-field]:not(:disabled)'),
          ]
          const next = cells[cells.indexOf(cell!) + 1]
          next?.focus()
          if (next?.dataset.editField)
            begin(
              next.closest<HTMLElement>('[data-node-id]')!.dataset.nodeId!,
              next.dataset.editField as EditField,
            )
        }
      }
    },
    [begin, focusCell],
  )
  const commit = useCallback(
    (tab = false, restoreFocus = true) => {
      const d = active.current,
        p = latest.current
      if (!d || d.pending || d.blocked || composing.current) return
      if (
        d.revision !== p.tree?.revision ||
        !p.current ||
        !p.tree.editable ||
        !indexTree(p.tree).has(d.id)
      ) {
        setDraft({ ...d, error: '文档已变化，草稿已保留。请取消后基于最新内容重新编辑。' })
        return
      }
      if (
        d.value === d.original ||
        (d.field === 'value' &&
          inputValue(d.value, d.mode) === p.readValue(indexTree(p.tree).get(d.id)!))
      ) {
        finish({ ...d, tab, restoreFocus })
        return
      }
      if (d.value.length > MAX_FORM_VALUE_LENGTH) {
        setDraft({ ...d, error: '内容超过 65,536 字符，请缩短内容或转到代码编辑。' })
        return
      }
      if (d.field === 'key') {
        const index = indexTree(p.tree),
          node = index.get(d.id)!
        if (
          index
            .get(node.parentId!)!
            .children.some((id) => id !== d.id && index.get(id)!.key === d.value)
        ) {
          setDraft({ ...d, error: '同级属性名已存在，请修改名称。' })
          return
        }
      }
      busySeen.current = false
      const next = { ...d, pending: true, error: '', tab, restoreFocus }
      active.current = next
      setDraft(next)
      const accepted = p.onCommand(
        d.field === 'key'
          ? { kind: 'update', nodeId: d.id, key: d.value }
          : { kind: 'edit-value', nodeId: d.id, value: d.value },
        d.revision,
      )
      if (accepted === false) setDraft({ ...d, error: '树暂不可编辑，草稿已保留，请稍后重试。' })
    },
    [finish],
  )
  useEffect(() => {
    if (!draft) return
    let cancelled = false
    const update = (value: Draft | null) =>
      queueMicrotask(() => {
        if (!cancelled) setDraft(value)
      })
    if (
      props.tree &&
      (props.tree.documentId !== draft.documentId ||
        (props.current && !indexTree(props.tree).has(draft.id) && draft.value === draft.original))
    ) {
      update(null)
      return () => {
        cancelled = true
      }
    }
    if (!draft.pending) return
    if (!props.current) busySeen.current = true
    if (props.current && props.tree && props.tree.revision > draft.revision) {
      const node = indexTree(props.tree).get(draft.id)
      const applied =
        node &&
        (draft.field === 'key'
          ? node.key === draft.value
          : props.readValue(node) === inputValue(draft.value, draft.mode))
      if (applied)
        queueMicrotask(() => {
          if (!cancelled) finish(draft)
        })
      else
        update({
          ...draft,
          pending: false,
          error: '文档已变化，提交未确认；草稿已保留，请取消后重新编辑。',
        })
    } else if (props.current && props.error && busySeen.current) {
      update({ ...draft, pending: false, error: props.error })
    }
    return () => {
      cancelled = true
    }
  }, [draft, props, finish])
  useEffect(() => {
    if (!draft?.pending) return
    const timer = setTimeout(
      () =>
        setDraft((previous) =>
          previous?.pending
            ? {
                ...previous,
                pending: false,
                error: '提交未确认，草稿已保留；请检查后台状态后重试。',
              }
            : previous,
        ),
      16_000,
    )
    return () => clearTimeout(timer)
  }, [draft?.pending])
  useLayoutEffect(() => {
    if (!draft) return
    const place = () => {
      const anchor = document.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(draft.id)}"] [data-edit-field="${draft.field}"]`,
      )
      const rect = anchor?.getBoundingClientRect()
      const viewport = anchor?.closest('.tree-viewport')?.getBoundingClientRect()
      const detached =
        !rect || !viewport || rect.bottom <= viewport.top || rect.top >= viewport.bottom
      const width = Math.min(
        draft.long || draft.error || detached || draft.blocked ? 420 : Math.max(180, rect!.width),
        window.innerWidth - 20,
      )
      const height = draft.long ? 260 : draft.error || detached ? 110 : 30
      const next = {
        left: Math.max(10, Math.min(rect?.left ?? 20, window.innerWidth - width - 10)),
        top: Math.max(10, Math.min(detached ? 88 : rect!.top, window.innerHeight - height - 10)),
        width,
        detached,
      }
      setPosition((old) =>
        Object.keys(next).every(
          (key) => old[key as keyof typeof old] === next[key as keyof typeof next],
        )
          ? old
          : next,
      )
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    const observer = new ResizeObserver(place)
    const pane = document.querySelector('.tree-viewport')
    if (pane) observer.observe(pane)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      observer.disconnect()
    }
  }, [draft])
  useEffect(() => {
    if (input.current) {
      input.current?.focus()
      input.current?.select()
    }
  }, [draft?.id, draft?.field])
  const stale =
    !!draft &&
    !draft.pending &&
    (draft.revision !== props.tree?.revision || !props.tree || !indexTree(props.tree).has(draft.id))
  const Tag = draft?.long ? 'textarea' : 'input'
  return (
    <BeginInlineEdit.Provider value={begin}>
      {children}
      {draft &&
        createPortal(
          <div
            ref={panel}
            className={`inline-edit ${draft.long ? 'multiline' : ''} ${draft.error || stale ? 'has-error' : ''}`}
            style={{ left: position.left, top: position.top, width: position.width }}
            aria-label="树行编辑"
            role="group"
            aria-busy={draft.pending}
            onBlur={(event) => {
              if (!panel.current?.contains(event.relatedTarget as Node | null)) commit(false, false)
            }}
          >
            {(draft.long || position.detached) && (
              <div className="inline-edit-heading">
                {draft.field === 'key' ? '属性名' : '值'}
                {position.detached ? ' · 滚动后草稿仍保留' : ' · 多行编辑'}
              </div>
            )}
            {draft.blocked ? (
              <p>值超过行内编辑限制，请转到代码编辑。</p>
            ) : (
              <Tag
                ref={(element: HTMLInputElement | HTMLTextAreaElement | null) => {
                  input.current = element
                }}
                aria-label={draft.field === 'key' ? '行内属性名' : '行内值'}
                aria-invalid={!!draft.error || stale}
                aria-describedby={draft.error || stale ? 'inline-edit-error' : undefined}
                value={draft.value}
                readOnly={draft.pending}
                maxLength={MAX_FORM_VALUE_LENGTH + 1}
                onChange={(event) => setDraft({ ...draft, value: event.target.value, error: '' })}
                onCompositionStart={() => {
                  composing.current = true
                }}
                onCompositionEnd={() => {
                  composing.current = false
                }}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229)
                    return
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    if (!draft.pending) cancel()
                  } else if (event.key === 'Tab') {
                    event.preventDefault()
                    commit(true)
                  } else if (
                    event.key === 'Enter' &&
                    (!draft.long || event.ctrlKey || event.metaKey)
                  ) {
                    event.preventDefault()
                    commit()
                  }
                }}
              />
            )}
            {(draft.error || stale) && (
              <p role="alert" id="inline-edit-error">
                {draft.error || '文档已变化，草稿已保留。请取消后重新编辑。'}
              </p>
            )}
            {(draft.long || draft.error || stale || position.detached) && (
              <div className="inline-edit-actions" onMouseDown={(event) => event.preventDefault()}>
                {!draft.blocked && (
                  <button
                    disabled={draft.pending || stale || !props.current}
                    onClick={() => commit()}
                  >
                    提交
                  </button>
                )}
                <button disabled={draft.pending} onClick={cancel}>
                  取消
                </button>
                <button
                  disabled={!props.current}
                  onClick={() => {
                    const node = props.tree && indexTree(props.tree).get(draft.id)
                    if (node) props.onLocate(node, props.tree!.revision)
                  }}
                >
                  转到代码
                </button>
                {draft.long && !draft.blocked && <span>Ctrl+Enter 提交</span>}
              </div>
            )}
          </div>,
          document.body,
        )}
    </BeginInlineEdit.Provider>
  )
}
