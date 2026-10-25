import type { DocumentVersion, TextEdit } from '../core/document/contracts'
import type { JsonAnalysis } from '../core/json/engine'

export interface JsonWorkerRequest extends DocumentVersion {
  requestId: number
  action: 'validate' | 'format'
  text: string
}

export type JsonWorkerResponse =
  | { kind: 'ready' }
  | (DocumentVersion & {
      kind: 'result'
      requestId: number
      action: JsonWorkerRequest['action']
      analysis: JsonAnalysis
      edits: readonly TextEdit[]
      durationMs: number
    })
  | (DocumentVersion & { kind: 'failure'; requestId: number; message: string })

export interface JsonWorkerTransport {
  send: (request: JsonWorkerRequest) => void
  onMessage: (handler: (response: JsonWorkerResponse) => void) => void
  onFailure: (handler: () => void) => void
  dispose: () => void
}
