// Contracts only: parsing, editing and history are implemented in later phases.
export interface DocumentVersion {
  documentId: string
  revision: number
}

export interface TextEdit {
  offset: number
  length: number
  text: string
}

export interface EditTransaction {
  documentId: string
  baseRevision: number
  origin: 'user' | 'tree' | 'format' | 'history' | 'load'
  edits: readonly TextEdit[]
}

export interface ParseDiagnostic {
  offset: number
  length: number
  message: string
  severity: 'error' | 'warning'
  code: string
}
