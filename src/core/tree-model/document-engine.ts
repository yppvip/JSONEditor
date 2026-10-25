import { analyzeJson, formatJson } from '../json/engine'
import { applySourceEdits, compileTreeCommand } from '../commands/tree-commands'
import { buildTree } from './model'
import type { JsonTreeProjection, TreeIdentityHint } from './model'
import type { JsonWorkerRequest, JsonWorkerResult } from '../../shared/json-worker-protocol'
import { identityAnchors } from '../document/change-map'
import type { SourceChange } from '../document/change-map'
import { IdentityHistory } from './identity-history'
import { applyScalarTreePatch } from './scalar-patch'
import type { ScalarTreePatch } from './scalar-patch'
import type { JsonAnalysis } from '../json/engine'

export class JsonDocumentEngine {
  private tree: JsonTreeProjection | null = null
  private source: string | null = null
  private nextNode = 0
  private readonly history = new IdentityHistory()
  private analysis: JsonAnalysis | null = null
  private pendingIdentity: {
    documentId: string
    revision: number
    source: string
    hint?: TreeIdentityHint
    changes?: SourceChange[]
    ids?: string[]
    prepared?: JsonTreeProjection
    patch?: ScalarTreePatch
  } | null = null
  constructor(private readonly idPrefix: string) {}

  execute(request: JsonWorkerRequest): JsonWorkerResult {
    const started = performance.now()
    const { documentId, revision, requestId, action, text } = request
    const base = { kind: 'result' as const, documentId, revision, requestId, action }
    if (action === 'tree') {
      const analysis =
        this.source === text &&
        this.tree?.documentId === documentId &&
        this.tree.revision === revision &&
        this.analysis
          ? this.analysis
          : analyzeJson(text)
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
        this.pendingIdentity = result.edits.length
          ? {
              documentId,
              revision: revision + 1,
              source: applySourceEdits(text, result.edits),
              ...(result.identityHint ? { hint: result.identityHint } : {}),
              ...(result.identityIds ? { ids: result.identityIds } : {}),
              ...(result.scalarPatch
                ? {
                    prepared: applyScalarTreePatch(this.tree, result.scalarPatch),
                    patch: result.scalarPatch,
                  }
                : {}),
              changes: result.edits.map((edit) => ({
                offset: edit.offset,
                length: edit.length,
                insertedLength: edit.text.length,
              })),
            }
          : null
        return { ...base, analysis, edits: result.edits, durationMs: performance.now() - started }
      } catch (error) {
        this.pendingIdentity = null
        return {
          ...base,
          analysis,
          edits: [],
          durationMs: performance.now() - started,
          commandError: error instanceof Error ? error.message : '无法执行节点操作。',
        }
      }
    }
    const prepared = this.pendingIdentity
    if (
      action === 'validate' &&
      prepared?.prepared &&
      prepared.documentId === documentId &&
      prepared.revision === revision &&
      prepared.source === text
    ) {
      this.tree = prepared.prepared
      this.source = text
      this.analysis = { valid: true, diagnostics: [], diagnosticsTruncated: false }
      this.pendingIdentity = null
      this.history.remember(this.tree, request.historyVersion, text)
      return {
        ...base,
        analysis: this.analysis,
        edits: [],
        tree: this.tree,
        ...(prepared.patch ? { treePatch: prepared.patch } : {}),
        durationMs: performance.now() - started,
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
    if (result.valid && result.edits.length) {
      // Monaco may merge thousands of formatting ranges into a broad content event.
      // Identity follows our verified whitespace-only transaction, not that merged range.
      this.pendingIdentity =
        this.tree?.documentId === documentId &&
        this.tree.revision === revision &&
        this.source === text
          ? {
              documentId,
              revision: revision + 1,
              source: applySourceEdits(text, result.edits),
              ids: this.tree.nodes.map((node) => node.id),
            }
          : null
      response.durationMs = performance.now() - started
      return response
    }
    if (result.valid && !result.edits.length) {
      const candidate = this.pendingIdentity
      const pending =
        candidate?.documentId === documentId &&
        candidate.revision === revision &&
        candidate.source === text
          ? candidate
          : null
      const restoredIds =
        pending?.ids ?? this.history.find(documentId, request.historyVersion, text)
      const anchors =
        this.tree?.documentId === documentId && this.source !== null
          ? identityAnchors(
              this.tree.nodes,
              this.tree.revision,
              revision,
              this.source.length,
              text.length,
              pending?.changes ? [{ revision, changes: pending.changes }] : request.changeJournal,
            )
          : undefined
      const projection = buildTree(
        text,
        { documentId, revision },
        () => `${this.idPrefix}:${++this.nextNode}`,
        this.tree,
        pending?.hint,
        {
          ...(restoredIds ? { restoredIds } : {}),
          ...(anchors ? { anchors } : {}),
        },
      )
      response.tree = projection.tree
      response.treeMessage = projection.message
      if (projection.tree) {
        this.tree = projection.tree
        this.source = text
        this.analysis = response.analysis
        this.history.remember(projection.tree, request.historyVersion, text)
      }
    }
    this.pendingIdentity = null
    response.durationMs = performance.now() - started
    return response
  }
}
