import { JsonDocumentEngine } from '../core/tree-model/document-engine'
import type { JsonWorkerRequest, JsonWorkerResponse } from '../shared/json-worker-protocol'

const engine = new JsonDocumentEngine(globalThis.crypto.randomUUID())
self.onmessage = (event: MessageEvent<JsonWorkerRequest>): void => {
  const request = event.data
  const { documentId, revision, requestId } = request
  let response: JsonWorkerResponse
  try {
    const result = engine.execute(request)
    if (result.treePatch) {
      // The core retains a full projection for history; send only the verified scalar delta.
      const { tree: _tree, ...compact } = result
      void _tree
      response = compact
    } else response = result
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
