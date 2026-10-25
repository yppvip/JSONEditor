import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { initialDocumentStatus } from '../../core/document/text-session'
import { createEditor } from './create-editor'
import type { EditorStatus, EditorView } from './create-editor'
import { JsonTreeEditor } from '../tree-editor/JsonTreeEditor'
import { DesktopDocumentSession } from './desktop-session'
import { desktopShortcut } from '../../shared/desktop-shortcuts'

const labels = {
  waiting: '正在准备编辑环境…',
  pending: '等待校验',
  validating: '正在校验…',
  valid: 'JSON 有效',
  invalid: 'JSON 校验未通过',
  manual: '等待手动校验',
  failed: '后台校验不可用',
}

export function JsonTextEditor(): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const [status, setStatus] = useState<EditorStatus>({
    ...initialDocumentStatus,
    problems: [],
    historyVersion: 1,
  })
  const [documentKey, setDocumentKey] = useState(0)
  const pendingLoad = useRef<{
    text: string
    resolve: () => void
    reject: (error: Error) => void
  } | null>(null)
  const [files] = useState(() => new DesktopDocumentSession(window.desktop))
  const fileStatus = useSyncExternalStore(files.subscribe, files.getSnapshot)
  useEffect(() => {
    if (!container.current) return
    const load = pendingLoad.current
    let editor: EditorView
    try {
      editor = createEditor(
        container.current,
        (next) => {
          setStatus(next)
          files.observe(next.historyVersion)
        },
        load?.text,
      )
      view.current = editor
      files.connect({
        lock: editor.setReadOnly,
        undo: editor.undo,
        redo: editor.redo,
        snapshot: editor.getSnapshot,
        historyVersion: editor.getHistoryVersion,
        load: (text) =>
          new Promise<void>((resolve, reject) => {
            editor.setReadOnly(true)
            pendingLoad.current = { text, resolve, reject }
            setDocumentKey((key) => key + 1)
          }),
        paste: editor.replaceText,
        transform: editor.transformClipboard,
      })
      files.attached(editor.getHistoryVersion())
      pendingLoad.current = null
      load?.resolve()
    } catch (error) {
      pendingLoad.current = null
      load?.reject(error instanceof Error ? error : new Error('编辑器启动失败。'))
      return
    }
    return () => {
      view.current = null
      editor.dispose()
    }
  }, [documentKey, files])
  useEffect(() => {
    files.activate()
    void files.refreshRecent()
    const action = window.desktop.onAction((action) => {
      void files.dispatch(action)
    })
    const close = window.desktop.onCloseRequested((id) => {
      void files.requestClose(id)
    })
    const keyboard = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const action = desktopShortcut({
        key: event.key,
        control: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey,
        alt: event.altKey,
        isComposing: event.isComposing,
        isAutoRepeat: event.repeat,
      })
      if (action) {
        event.preventDefault()
        event.stopPropagation()
        void files.dispatch(action)
      }
    }
    window.addEventListener('keydown', keyboard, true)
    return () => {
      window.removeEventListener('keydown', keyboard, true)
      action()
      close()
      files.dispose()
      pendingLoad.current?.reject(new Error('窗口已关闭。'))
      pendingLoad.current = null
    }
  }, [files])
  const name = fileStatus.file?.name ?? '未命名.json'
  useEffect(() => {
    document.title = `${fileStatus.dirty ? '● ' : ''}${name} — JSONEditor`
  }, [name, fileStatus.dirty])
  const busy = !status.workerReady || status.state === 'validating' || status.composing
  const fileBusy = fileStatus.busy || fileStatus.loading || status.composing
  const errors = status.problems.filter((problem) => problem.severity === 'error').length
  const warnings = status.problems.filter((problem) => problem.severity === 'warning').length
  return (
    <section className="text-workspace" aria-label="JSON 文本工作区">
      <div className="file-toolbar" role="toolbar" aria-label="文件与剪贴板操作">
        <button disabled={fileBusy} title="Ctrl+N" onClick={() => void files.dispatch('new')}>
          新建
        </button>
        <button disabled={fileBusy} title="Ctrl+O" onClick={() => void files.dispatch('open')}>
          打开
        </button>
        <button disabled={fileBusy} title="Ctrl+S" onClick={() => void files.dispatch('save')}>
          保存
        </button>
        <button
          disabled={fileBusy}
          title="Ctrl+Shift+S"
          onClick={() => void files.dispatch('saveAs')}
        >
          另存为
        </button>
        <span className="toolbar-separator" />
        <button
          disabled={fileBusy}
          title="Ctrl+Shift+C"
          onClick={() => void files.dispatch('copyRaw')}
        >
          复制原文
        </button>
        <button
          disabled={fileBusy || busy}
          title="Ctrl+Alt+C"
          onClick={() => void files.dispatch('copyFormatted')}
        >
          复制格式化
        </button>
        <button
          disabled={fileBusy || busy}
          title="Ctrl+Alt+M"
          onClick={() => void files.dispatch('copyCompact')}
        >
          复制压缩
        </button>
        <button
          disabled={fileBusy}
          title="Ctrl+Alt+V；一次可撤销事务"
          onClick={() => void files.dispatch('paste')}
        >
          剪贴板替换全文
        </button>
        <select
          aria-label="最近文件"
          value=""
          disabled={fileBusy}
          onChange={(event) => {
            if (event.target.value) void files.open(event.target.value)
          }}
        >
          <option value="">最近文件…</option>
          {fileStatus.recent.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} — {item.path}
            </option>
          ))}
        </select>
      </div>
      <p
        className={`file-status ${fileStatus.error ? 'error' : ''}`}
        role={fileStatus.error ? 'alert' : 'status'}
        aria-label={fileStatus.error ? '文件操作错误' : '文件操作状态'}
        data-testid="file-status"
      >
        {fileStatus.busy
          ? '文件/剪贴板操作中…'
          : fileStatus.message ||
            (fileStatus.dirty
              ? '有未保存的修改。'
              : fileStatus.file
                ? '已保存。'
                : '新文档尚未保存。')}
      </p>
      <div className="toolbar" role="toolbar" aria-label="文本操作">
        <button
          onClick={() => view.current?.format()}
          disabled={busy || fileStatus.loading}
          title="Ctrl+Shift+F"
        >
          格式化
        </button>
        <button onClick={() => view.current?.validate()} disabled={busy}>
          校验
        </button>
        <span className="toolbar-separator" />
        <button onClick={() => view.current?.undo()}>撤销</button>
        <button onClick={() => view.current?.redo()}>重做</button>
        <span className="document-label" title={fileStatus.file?.path} data-testid="document-name">
          {name}
          {fileStatus.dirty ? ' · 已修改' : ''}
        </span>
      </div>
      {status.largeFile && (
        <p className="notice">大文件模式：已暂停自动校验，请使用“校验”或“格式化”。</p>
      )}
      <div className="editor-split">
        <JsonTreeEditor
          tree={status.tree}
          current={
            !fileStatus.loading &&
            !status.composing &&
            status.state === 'valid' &&
            status.tree?.revision === status.revision
          }
          message={status.treeMessage}
          error={status.treeError}
          onCommand={(command, revision) => view.current?.editTree(command, revision)}
          readValue={(node) => view.current?.readNodeValue(node) ?? null}
          onLocate={(node, revision) => view.current?.locateNode(node, revision)}
        />
        <div className="editor-container" ref={container} data-testid="json-editor" />
      </div>
      <div className={`validation-strip ${status.state}`}>
        <span role="status" aria-label="JSON 校验状态" data-testid="json-status">
          {status.composing ? '输入中，暂停同步' : labels[status.state]}
          {warnings ? ` · ${warnings} 个警告` : ''}
          {errors ? ` · ${errors} 个错误` : ''}
        </span>
        <span data-testid="worker-status">
          {status.workerReady
            ? '后台环境就绪'
            : status.state === 'failed'
              ? '后台不可用'
              : '后台启动中…'}
        </span>
        {status.durationMs !== null && <span>{status.durationMs.toFixed(1)} ms</span>}
      </div>
      {status.state === 'failed' && (
        <div className="notice" role="alert">
          {status.message}
          <button onClick={() => view.current?.retry()}>重试后台</button>
        </div>
      )}
      {status.problems.length > 0 && (
        <aside className="diagnostics" aria-label="JSON 问题">
          <ul>
            {status.problems.map((problem, index) => (
              <li key={`${status.revision}-${index}`}>
                <button
                  className={`diagnostic ${problem.severity}`}
                  onClick={() => view.current?.focusProblem(problem)}
                >
                  {problem.severity === 'error' ? '错误' : '警告'} · 第 {problem.line} 行，第{' '}
                  {problem.column} 列：{problem.message}
                </button>
              </li>
            ))}
          </ul>
          {status.diagnosticsTruncated && <p>问题较多，仅显示前 100 项。</p>}
        </aside>
      )}
      <p className="document-note">
        {fileStatus.file
          ? `${fileStatus.file.path} · UTF-8${fileStatus.file.bom ? ' BOM' : ''} · ${fileStatus.file.eol}`
          : '新文档尚未保存；可使用“保存”选择位置。'}{' '}
        非法 JSON 可按原文保存。
      </p>
    </section>
  )
}
