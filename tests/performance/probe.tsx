import { createRoot } from 'react-dom/client'
import { Tree } from 'react-arborist'
import * as monaco from 'monaco-editor/editor/editor.api'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

Object.assign(globalThis, { MonacoEnvironment: { getWorker: () => new EditorWorker() } })
const nextPaint = (): Promise<void> =>
  new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
const root = createRoot(document.getElementById('tree')!)

async function measure(count: number): Promise<Record<string, unknown>> {
  const data = Array.from({ length: count }, (_, index) => ({
    id: String(index),
    name: `Node ${index}`,
    value: index,
  }))
  const source = JSON.stringify(data)
  const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' })
  const workerStarted = performance.now()
  const workerResult = await new Promise<Record<string, number>>((done, reject) => {
    worker.onmessage = (event) => done(event.data)
    worker.onerror = reject
    worker.postMessage(source)
  })
  const workerRoundTripMs = performance.now() - workerStarted
  worker.terminate()
  const started = performance.now()
  root.render(<Tree data={data} height={420} width={700} rowHeight={28} openByDefault={false} />)
  await nextPaint()
  const treeMountMs = performance.now() - started
  const mountedRows = document.querySelectorAll('[role="treeitem"]').length
  const changed = [...data]
  changed[0] = { ...data[0]!, name: 'Changed' }
  const updateStarted = performance.now()
  root.render(<Tree data={changed} height={420} width={700} rowHeight={28} openByDefault={false} />)
  await nextPaint()
  const treeUpdateMs = performance.now() - updateStarted
  const editorStarted = performance.now()
  const model = monaco.editor.createModel(source, 'plaintext')
  const editor = monaco.editor.create(document.getElementById('editor')!, {
    model,
    minimap: { enabled: false },
    wordWrap: 'off',
    automaticLayout: false,
  })
  await nextPaint()
  const editorMountMs = performance.now() - editorStarted
  const editStarted = performance.now()
  editor.executeEdits('probe', [{ range: new monaco.Range(1, 1, 1, 1), text: ' ' }])
  await nextPaint()
  const editorEditMs = performance.now() - editStarted
  editor.dispose()
  model.dispose()
  root.render(null)
  await nextPaint()
  return {
    count,
    bytes: new TextEncoder().encode(source).length,
    shape: 'flat rows; one-line JSON; 3 properties per row',
    treeMountMs,
    treeUpdateMs,
    mountedRows,
    editorMountMs,
    editorEditMs,
    workerRoundTripMs,
    ...workerResult,
    editorMode: 'plaintext baseline; JSON services not enabled',
  }
}

Object.assign(window, { runPhase1Probe: measure })
