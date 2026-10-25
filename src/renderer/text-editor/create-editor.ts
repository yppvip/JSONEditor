import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/editor/browser/coreCommands'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard'
import 'monaco-editor/editor/contrib/find/browser/findController'
import 'monaco-editor/editor/contrib/gotoError/browser/gotoError'
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution'
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations'
import 'monaco-editor/editor/contrib/tokenization/browser/tokenization'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching'
import { jsonDefaults } from 'monaco-editor/languages/features/json/register'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import { TextDocumentSession } from '../../core/document/text-session'
import type { DocumentStatus } from '../../core/document/text-session'
import type { ParseDiagnostic } from '../../core/document/contracts'
import { AUTOMATIC_VALIDATION_LIMIT } from '../../core/json/limits'
import type { JsonWorkerResponse, JsonWorkerTransport } from '../../shared/json-worker-protocol'
import { MAX_FORM_VALUE_LENGTH } from '../../core/tree-model/model'
import type { JsonTreeNode } from '../../core/tree-model/model'
import type { TreeCommand } from '../../core/commands/tree-commands'

Object.assign(globalThis, { MonacoEnvironment: { getWorker: () => new EditorWorker() } })
jsonDefaults.setDiagnosticsOptions({ validate: false, enableSchemaRequest: false })
jsonDefaults.setModeConfiguration({
  tokens: true,
  diagnostics: false,
  completionItems: false,
  hovers: false,
  documentSymbols: false,
  documentFormattingEdits: false,
  documentRangeFormattingEdits: false,
  colors: false,
  foldingRanges: false,
  selectionRanges: false,
})

export interface LocatedDiagnostic extends ParseDiagnostic {
  line: number
  column: number
}
export interface EditorStatus extends DocumentStatus {
  problems: readonly LocatedDiagnostic[]
}
export interface EditorView {
  validate: () => void
  format: () => void
  undo: () => void
  redo: () => void
  retry: () => void
  focusProblem: (problem: LocatedDiagnostic) => void
  editTree: (command: TreeCommand, baseRevision: number) => boolean
  readNodeValue: (node: JsonTreeNode) => string | null
  locateNode: (node: JsonTreeNode, baseRevision: number) => void
  dispose: () => void
}

function createTransport(): JsonWorkerTransport {
  const worker = new Worker(new URL('../../workers/json.worker.ts', import.meta.url), {
    type: 'module',
  })
  return {
    send: (request) => worker.postMessage(request),
    onMessage: (handler) => {
      worker.onmessage = (event: MessageEvent<JsonWorkerResponse>) => handler(event.data)
    },
    onFailure: (handler) => {
      worker.onerror = (event) => {
        event.preventDefault()
        handler()
      }
      worker.onmessageerror = handler
    },
    dispose: () => worker.terminate(),
  }
}

let sequence = 0
const initialText = '{\n  "message": "Hello, JSON",\n  "items": [1, true, null]\n}\n'

export function createEditor(
  container: HTMLElement,
  onStatus: (status: EditorStatus) => void,
): EditorView {
  const documentId = `untitled-${++sequence}`
  const model = monaco.editor.createModel(
    initialText,
    'json',
    monaco.Uri.parse(`inmemory://jsoneditor/${documentId}.json`),
  )
  model.updateOptions({ insertSpaces: true, tabSize: 2 })
  const editor = monaco.editor.create(container, {
    model,
    editContext: false,
    autoClosingBrackets: 'never',
    autoClosingQuotes: 'never',
    autoSurround: 'never',
    autoIndent: 'none',
    theme: 'vs',
    ariaLabel: 'JSON 文本编辑器',
    automaticLayout: true,
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace',
    minimap: { enabled: false },
    wordWrap: 'off',
    scrollBeyondLastLine: false,
    unicodeHighlight: { ambiguousCharacters: false },
    formatOnPaste: false,
    formatOnType: false,
    detectIndentation: false,
    links: false,
    folding: false,
    stickyScroll: { enabled: false },
  })
  const session = new TextDocumentSession(
    documentId,
    {
      getText: () => model.getValue(),
      getLength: () => model.getValueLength(),
      applyEdits: (edits, origin = 'format') => {
        editor.pushUndoStop()
        editor.executeEdits(
          `json-${origin}`,
          edits.map((edit) => {
            const start = model.getPositionAt(edit.offset)
            const end = model.getPositionAt(edit.offset + edit.length)
            return {
              range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
              text: edit.text,
            }
          }),
        )
        editor.pushUndoStop()
      },
      setDiagnostics: (diagnostics) => {
        monaco.editor.setModelMarkers(
          model,
          'json-core',
          diagnostics.map((diagnostic) => {
            const start = model.getPositionAt(diagnostic.offset)
            const end = model.getPositionAt(diagnostic.offset + diagnostic.length)
            return {
              startLineNumber: start.lineNumber,
              startColumn: start.column,
              endLineNumber: end.lineNumber,
              endColumn: end.column,
              message: diagnostic.message,
              code: diagnostic.code,
              severity:
                diagnostic.severity === 'error'
                  ? monaco.MarkerSeverity.Error
                  : monaco.MarkerSeverity.Warning,
            }
          }),
        )
      },
    },
    createTransport,
  )
  let disposed = false
  const publishStatus = (): void => {
    if (disposed) return
    const status = session.getSnapshot()
    onStatus({
      ...status,
      problems: status.diagnostics.map((diagnostic) => {
        const position = model.getPositionAt(diagnostic.offset)
        return { ...diagnostic, line: position.lineNumber, column: position.column }
      }),
    })
  }
  const unsubscribe = session.subscribe(publishStatus)
  queueMicrotask(publishStatus)
  const change = model.onDidChangeContent(() => {
    session.changed()
    const large = model.getValueLength() > AUTOMATIC_VALIDATION_LIMIT
    editor.updateOptions({ renderValidationDecorations: large ? 'off' : 'on' })
  })
  const compositionStart = editor.onDidCompositionStart(() => session.setComposing(true))
  const compositionEnd = editor.onDidCompositionEnd(() => session.setComposing(false))
  const formatAction = editor.addAction({
    id: 'jsoneditor.format',
    label: '格式化 JSON',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
    run: () => session.request('format'),
  })
  return {
    validate: () => session.request('validate'),
    format: () => session.request('format'),
    undo: () => {
      editor.focus()
      editor.trigger('toolbar', 'undo', null)
    },
    redo: () => {
      editor.focus()
      editor.trigger('toolbar', 'redo', null)
    },
    retry: () => session.restart(),
    editTree: (command, revision) => session.editTree(command, revision),
    readNodeValue: (node) => {
      const status = session.getSnapshot()
      if (
        status.state !== 'valid' ||
        status.tree?.revision !== status.revision ||
        node.length > MAX_FORM_VALUE_LENGTH
      )
        return null
      return model.getValueInRange(
        monaco.Range.fromPositions(
          model.getPositionAt(node.offset),
          model.getPositionAt(node.offset + node.length),
        ),
      )
    },
    locateNode: (node, revision) => {
      if (session.getSnapshot().revision !== revision) return
      const position = model.getPositionAt(node.offset)
      editor.focus()
      editor.setPosition(position)
      editor.revealPositionInCenter(position)
    },
    focusProblem: (problem) => {
      const position = model.getPositionAt(problem.offset)
      const end = model.getPositionAt(problem.offset + problem.length)
      editor.focus()
      editor.setSelection(
        new monaco.Range(position.lineNumber, position.column, end.lineNumber, end.column),
      )
      editor.revealPositionInCenter(position)
    },
    dispose: () => {
      disposed = true
      unsubscribe()
      change.dispose()
      compositionStart.dispose()
      compositionEnd.dispose()
      formatAction.dispose()
      session.dispose()
      monaco.editor.setModelMarkers(model, 'json-core', [])
      editor.dispose()
      model.dispose()
    },
  }
}
