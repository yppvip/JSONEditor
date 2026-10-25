import { JsonDocumentEngine } from '../core/tree-model/document-engine'
import type { JsonWorkerRequest, JsonWorkerResponse } from '../shared/json-worker-protocol'

const engine = new JsonDocumentEngine(globalThis.crypto.randomUUID())
self.onmessage = (event: MessageEvent<JsonWorkerRequest>): void => {
  const request = event.data
  const { documentId, revision, requestId } = request
  let response: JsonWorkerResponse
  try {
    response = engine.execute(request)
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
