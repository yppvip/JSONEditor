import type { DocumentVersion, TextEdit } from '../core/document/contracts'
import type { JsonAnalysis } from '../core/json/engine'
import type { TreeCommand } from '../core/commands/tree-commands'
import type { JsonTreeProjection } from '../core/tree-model/model'
import type { ChangeBatch } from '../core/document/change-map'

export interface JsonWorkerRequest extends DocumentVersion {
  requestId: number
  action: 'validate' | 'format' | 'tree'
  text: string
  command?: TreeCommand
  historyVersion?: number
  changeJournal?: readonly ChangeBatch[]
}

export interface JsonWorkerResult extends DocumentVersion {
  kind: 'result'
  requestId: number
  action: JsonWorkerRequest['action']
  analysis: JsonAnalysis
  edits: readonly TextEdit[]
  durationMs: number
  tree?: JsonTreeProjection | null
  treeMessage?: string
  commandError?: string
}

export type JsonWorkerResponse =
  | { kind: 'ready' }
  | JsonWorkerResult
  | (DocumentVersion & { kind: 'failure'; requestId: number; message: string })

export interface JsonWorkerTransport {
  send: (request: JsonWorkerRequest) => void
  onMessage: (handler: (response: JsonWorkerResponse) => void) => void
  onFailure: (handler: () => void) => void
  dispose: () => void
}
