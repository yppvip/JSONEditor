import { useEffect, useId, useRef, useState } from 'react'
import type { DesktopAction, RecentFile } from '../../shared/desktop-api'
import { Icon } from './Icon'
import type { IconName } from './Icon'

interface Props {
  name: string
  path?: string | undefined
  dirty: boolean
  fileBusy: boolean
  busy: boolean
  loading: boolean
  recent: readonly RecentFile[]
  desktopStatus: string
  treeOnLeft: boolean
  onSwap: () => void
  onResetSplit: () => void
  onAction: (action: DesktopAction) => void
  onOpenRecent: (id: string) => void
  onFormat: () => void
  onValidate: () => void
}

export function WorkspaceToolbar(props: Props): React.JSX.Element {
  const [panel, setPanel] = useState<'copy' | 'more' | 'about' | null>(null)
  const root = useRef<HTMLElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const panelId = useId()
  const close = (restoreFocus = false): void => {
    setPanel(null)
    if (restoreFocus) trigger.current?.focus()
  }
  useEffect(() => {
    if (!panel) return
    popup.current
      ?.querySelector<HTMLElement>('button:not(:disabled), select:not(:disabled)')
      ?.focus()
    const outside = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setPanel(null)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [panel])
  const toggle = (next: 'copy' | 'more', button: HTMLButtonElement): void => {
    trigger.current = button
    setPanel(panel === next || (next === 'more' && panel === 'about') ? null : next)
  }
  const action = (kind: DesktopAction): void => {
    close(true)
    props.onAction(kind)
  }
  const primary = (
    label: string,
    icon: IconName,
    shortcut: string,
    run: () => void,
    disabled: boolean,
    accent = false,
  ): React.JSX.Element => (
    <button
      className={`toolbar-action${accent ? ' primary' : ''}`}
      aria-label={label}
      title={`${label} · ${shortcut}`}
      disabled={disabled}
      onClick={run}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  )
  return (
    <header
      className="workspace-toolbar"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && panel) {
          event.preventDefault()
          close(true)
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPanel(null)
      }}
    >
      <div className="workspace-brand" title="JSONEditor">
        <Icon name="json" />
        <span>JSONEditor</span>
      </div>
      <span className="document-label" title={props.path ?? props.name} data-testid="document-name">
        {props.name}
        {props.dirty ? ' · 已修改' : ''}
      </span>
      <div className="workspace-actions" role="toolbar" aria-label="文件与文本操作">
        {primary('新建', 'new', 'Ctrl+N', () => props.onAction('new'), props.fileBusy)}
        {primary('打开', 'open', 'Ctrl+O', () => props.onAction('open'), props.fileBusy)}
        {primary('保存', 'save', 'Ctrl+S', () => props.onAction('save'), props.fileBusy)}
        <span className="toolbar-separator" />
        {primary(
          '格式化',
          'format',
          'Ctrl+Shift+F',
          props.onFormat,
          props.busy || props.loading,
          true,
        )}
        {primary('校验', 'check', '检查 JSON', props.onValidate, props.busy)}
        <span className="toolbar-separator" />
        <button
          className="icon-button"
          aria-label="撤销"
          title="撤销 · Ctrl+Z"
          onClick={() => props.onAction('undo')}
        >
          <Icon name="undo" />
        </button>
        <button
          className="icon-button"
          aria-label="重做"
          title="重做 · Ctrl+Y"
          onClick={() => props.onAction('redo')}
        >
          <Icon name="redo" />
        </button>
        <button
          className="toolbar-action copy-trigger"
          aria-label="复制选项"
          title="复制选项"
          aria-expanded={panel === 'copy'}
          aria-controls={panel === 'copy' ? panelId : undefined}
          onClick={(event) => toggle('copy', event.currentTarget)}
        >
          <Icon name="copy" />
          <span>复制</span>
          <Icon name="down" />
        </button>
        <button
          className="icon-button"
          aria-label="交换左右位置"
          aria-pressed={!props.treeOnLeft}
          title={`交换左右位置 · 当前树在${props.treeOnLeft ? '左' : '右'}侧`}
          onPointerDown={(event) => {
            if (event.button === 0) event.preventDefault()
          }}
          onClick={props.onSwap}
        >
          <Icon name="swap" />
        </button>
        <button
          className="icon-button"
          aria-label="更多操作"
          title="更多操作"
          aria-expanded={panel === 'more' || panel === 'about'}
          aria-controls={panel && panel !== 'copy' ? panelId : undefined}
          onClick={(event) => toggle('more', event.currentTarget)}
        >
          <Icon name="more" />
        </button>
      </div>
      {panel && (
        <div
          className="toolbar-popup"
          ref={popup}
          id={panelId}
          role="region"
          aria-label={
            panel === 'copy' ? '复制选项' : panel === 'more' ? '更多操作' : '关于 JSONEditor'
          }
        >
          <div className="popup-heading">
            <strong>
              {panel === 'copy' ? '复制 JSON' : panel === 'more' ? '更多操作' : '关于 JSONEditor'}
            </strong>
            <button className="icon-button" aria-label="关闭操作面板" onClick={() => close(true)}>
              <Icon name="close" />
            </button>
          </div>
          {panel === 'copy' ? (
            <>
              <button
                disabled={props.fileBusy}
                aria-label="复制原文"
                onClick={() => action('copyRaw')}
              >
                复制原文<kbd>Ctrl+Shift+C</kbd>
              </button>
              <button
                disabled={props.fileBusy || props.busy}
                aria-label="复制格式化"
                onClick={() => action('copyFormatted')}
              >
                复制格式化<kbd>Ctrl+Alt+C</kbd>
              </button>
              <button
                disabled={props.fileBusy || props.busy}
                aria-label="复制压缩"
                onClick={() => action('copyCompact')}
              >
                复制压缩<kbd>Ctrl+Alt+M</kbd>
              </button>
            </>
          ) : panel === 'more' ? (
            <>
              <button
                disabled={props.fileBusy}
                aria-label="另存为"
                onClick={() => action('saveAs')}
              >
                <Icon name="save" />
                另存为<kbd>Ctrl+Shift+S</kbd>
              </button>
              <button
                disabled={props.fileBusy}
                aria-label="剪贴板替换全文"
                onClick={() => action('paste')}
                title="一次可撤销的整篇替换"
              >
                <Icon name="paste" />
                剪贴板替换全文<kbd>Ctrl+Alt+V</kbd>
              </button>
              <label className="recent-files">
                <span>
                  <Icon name="history" />
                  最近文件
                </span>
                <select
                  aria-label="最近文件"
                  value=""
                  disabled={props.fileBusy || !props.recent.length}
                  onChange={(event) => {
                    if (event.target.value) {
                      close(true)
                      props.onOpenRecent(event.target.value)
                    }
                  }}
                >
                  <option value="">{props.recent.length ? '选择文件…' : '暂无最近文件'}</option>
                  {props.recent.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} — {item.path}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => {
                  close(true)
                  props.onResetSplit()
                }}
              >
                <Icon name="split" />
                恢复均分
              </button>
              <button onClick={() => setPanel('about')}>
                <Icon name="info" />
                关于 JSONEditor
              </button>
            </>
          ) : (
            <div className="about-content">
              <p role="status" aria-label="桌面连接">
                {props.desktopStatus}
              </p>
              <p>本地 JSON 文本与树编辑器</p>
              <p>支持原文保存、格式化及统一撤销重做。</p>
            </div>
          )}
        </div>
      )}
    </header>
  )
}
