import { analyzeJson, formatJson } from '../core/json/engine'
import type { JsonWorkerRequest, JsonWorkerResponse } from '../shared/json-worker-protocol'

self.onmessage = (event: MessageEvent<JsonWorkerRequest>): void => {
  const request = event.data
  const { documentId, revision, requestId, action } = request
  const started = performance.now()
  let response: JsonWorkerResponse
  try {
    const result =
      action === 'format' ? formatJson(request.text) : { ...analyzeJson(request.text), edits: [] }
    response = {
      kind: 'result',
      documentId,
      revision,
      requestId,
      action,
      analysis: {
        valid: result.valid,
        diagnostics: result.diagnostics,
        diagnosticsTruncated: result.diagnosticsTruncated,
      },
      edits: result.edits,
      durationMs: performance.now() - started,
    }
  } catch {
    response = {
      kind: 'failure',
      documentId,
      revision,
      requestId,
      message: '后台处理失败；原文已保留，请重试后台。',
    }
  }
  self.postMessage(response)
}
self.postMessage({ kind: 'ready' } satisfies JsonWorkerResponse)
