import { useEffect, useRef, useState } from 'react'
import { initialDocumentStatus } from '../../core/document/text-session'
import { createEditor } from './create-editor'
import type { EditorStatus, EditorView } from './create-editor'
import { JsonTreeEditor } from '../tree-editor/JsonTreeEditor'

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
  const [status, setStatus] = useState<EditorStatus>({ ...initialDocumentStatus, problems: [] })
  useEffect(() => {
    if (!container.current) return
    const editor = createEditor(container.current, setStatus)
    view.current = editor
    return () => {
      view.current = null
      editor.dispose()
    }
  }, [])
  const busy = !status.workerReady || status.state === 'validating' || status.composing
  const errors = status.problems.filter((problem) => problem.severity === 'error').length
  const warnings = status.problems.filter((problem) => problem.severity === 'warning').length
  return (
    <section className="text-workspace" aria-label="JSON 文本工作区">
      <div className="toolbar" role="toolbar" aria-label="文本操作">
        <button onClick={() => view.current?.format()} disabled={busy} title="Ctrl+Shift+F">
          格式化
        </button>
        <button onClick={() => view.current?.validate()} disabled={busy}>
          校验
        </button>
        <span className="toolbar-separator" />
        <button onClick={() => view.current?.undo()}>撤销</button>
        <button onClick={() => view.current?.redo()}>重做</button>
        <span className="document-label">未命名.json{status.revision > 0 ? ' · 已修改' : ''}</span>
      </div>
      {status.largeFile && (
        <p className="notice">大文件模式：已暂停自动校验，请使用“校验”或“格式化”。</p>
      )}
      <div className="editor-split">
        <JsonTreeEditor
          tree={status.tree}
          current={
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
      <p className="document-note">当前为未保存的临时文档；文件打开和保存将在后续阶段加入。</p>
    </section>
  )
}
