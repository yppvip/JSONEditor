import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import {
  DEFAULT_EDITOR_PREFERENCES,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  isFontSize,
} from './editor-preferences'
import type { EditorPreferences } from './editor-preferences'

export function SettingsDialog({
  preferences,
  onChange,
  onClose,
}: {
  preferences: EditorPreferences
  onChange: (preferences: EditorPreferences) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [draft, setDraft] = useState({
    treeFontSize: String(preferences.treeFontSize),
    codeFontSize: String(preferences.codeFontSize),
  })
  useLayoutEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement as HTMLElement | null
    element.showModal()
    element.querySelector('input')?.focus()
    return () => {
      element.close()
      previous?.focus()
    }
  }, [])
  const close = () => {
    dialog.current?.close()
    onClose()
  }
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <header>
        <strong id={`${id}-title`}>编辑器设置</strong>
        <button className="icon-button" aria-label="关闭设置" onClick={close}>
          <Icon name="close" />
        </button>
      </header>
      <p className="settings-description">分别调整树与代码的文本大小，修改后立即生效并自动保存。</p>
      {(
        [
          ['treeFontSize', '树文本大小'],
          ['codeFontSize', '代码文本大小'],
        ] as const
      ).map(([field, label]) => {
        const valid = draft[field].trim() !== '' && isFontSize(Number(draft[field]))
        return (
          <div className="settings-field" key={field}>
            <label htmlFor={`${id}-${field}`}>
              {label}
              <span className="settings-number">
                <input
                  id={`${id}-${field}`}
                  type="number"
                  min={MIN_FONT_SIZE}
                  max={MAX_FONT_SIZE}
                  step={1}
                  value={draft[field]}
                  aria-invalid={!valid}
                  aria-describedby={`${id}-${field}-help`}
                  onChange={(event) => {
                    const value = event.target.value
                    setDraft((previous) => ({ ...previous, [field]: value }))
                    if (value.trim() !== '' && isFontSize(Number(value)))
                      onChange({ ...preferences, [field]: Number(value) })
                  }}
                />
                <span aria-hidden="true">px</span>
              </span>
            </label>
            <p
              id={`${id}-${field}-help`}
              className={valid ? 'settings-help' : 'settings-help error'}
              aria-live="polite"
            >
              {valid
                ? `范围 ${MIN_FONT_SIZE}–${MAX_FONT_SIZE}px，步长 1px`
                : `请输入 ${MIN_FONT_SIZE}–${MAX_FONT_SIZE} 之间的整数；当前字号保持不变。`}
            </p>
          </div>
        )
      })}
      <footer>
        <button
          onClick={() => {
            setDraft({
              treeFontSize: String(DEFAULT_EDITOR_PREFERENCES.treeFontSize),
              codeFontSize: String(DEFAULT_EDITOR_PREFERENCES.codeFontSize),
            })
            onChange({ ...DEFAULT_EDITOR_PREFERENCES })
          }}
        >
          恢复默认
        </button>
        <button onClick={close}>完成</button>
      </footer>
    </dialog>
  )
}
