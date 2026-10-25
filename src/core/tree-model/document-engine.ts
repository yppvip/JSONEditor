import { analyzeJson, formatJson } from '../json/engine'
import { applySourceEdits, compileTreeCommand } from '../commands/tree-commands'
import { buildTree } from './model'
import type { JsonTreeProjection, TreeIdentityHint } from './model'
import type { JsonWorkerRequest, JsonWorkerResult } from '../../shared/json-worker-protocol'

export class JsonDocumentEngine {
  private tree: JsonTreeProjection | null = null
  private source: string | null = null
  private nextNode = 0
  private pendingIdentity: {
    documentId: string
    revision: number
    source: string
    hint: TreeIdentityHint
  } | null = null
  constructor(private readonly idPrefix: string) {}

  execute(request: JsonWorkerRequest): JsonWorkerResult {
    const started = performance.now()
    const { documentId, revision, requestId, action, text } = request
    const base = { kind: 'result' as const, documentId, revision, requestId, action }
    if (action === 'tree') {
      const analysis = analyzeJson(text)
      try {
        if (
          !request.command ||
          !this.tree ||
          this.tree.documentId !== documentId ||
          this.tree.revision !== revision ||
          this.source !== text ||
          !analysis.valid
        )
          throw new Error('文档已变化，请等待树刷新后重试。')
        const result = compileTreeCommand(text, this.tree, request.command)
        this.pendingIdentity = result.identityHint
          ? {
              documentId,
              revision: revision + 1,
              source: applySourceEdits(text, result.edits),
              hint: result.identityHint,
            }
          : null
        return { ...base, analysis, edits: result.edits, durationMs: performance.now() - started }
      } catch (error) {
        return {
          ...base,
          analysis,
          edits: [],
          durationMs: performance.now() - started,
          commandError: error instanceof Error ? error.message : '无法执行节点操作。',
        }
      }
    }
    const result = action === 'format' ? formatJson(text) : { ...analyzeJson(text), edits: [] }
    const response: JsonWorkerResult = {
      ...base,
      analysis: {
        valid: result.valid,
        diagnostics: result.diagnostics,
        diagnosticsTruncated: result.diagnosticsTruncated,
      },
      edits: result.edits,
      durationMs: 0,
    }
    if (result.valid && !result.edits.length) {
      const pending = this.pendingIdentity
      const hint =
        pending?.documentId === documentId &&
        pending.revision === revision &&
        pending.source === text
          ? pending.hint
          : undefined
      const projection = buildTree(
        text,
        { documentId, revision },
        () => `${this.idPrefix}:${++this.nextNode}`,
        this.tree,
        hint,
      )
      response.tree = projection.tree
      response.treeMessage = projection.message
      if (projection.tree) {
        this.tree = projection.tree
        this.source = text
      } else this.source = null
    } else if (!result.valid) this.source = null
    this.pendingIdentity = null
    response.durationMs = performance.now() - started
    return response
  }
}
