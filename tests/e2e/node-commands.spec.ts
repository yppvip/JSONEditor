import { expect, test } from '@playwright/test'
import type { TreeCommand } from '../../src/core/commands/tree-commands'
import type { JsonTreeProjection } from '../../src/core/tree-model/model'
import type {
  JsonWorkerRequest,
  JsonWorkerResponse,
  JsonWorkerResult,
} from '../../src/shared/json-worker-protocol'
import { launchApp } from './launch-app'
import { closeApp } from './close-app'

test('bundled document Worker handles positioned insertion, deep copy and atomic conversion with historical identities', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    let url: string | undefined
    for (const worker of page.workers()) {
      if ((await worker.evaluate(() => self.name)) === 'json-document') url = worker.url()
    }
    expect(url).toBeTruthy()
    // An isolated instance exercises the production bundle without replacing the editor's live document.
    const result = await page.evaluate(async (workerUrl) => {
      const worker = new Worker(workerUrl!, { type: 'module', name: 'node-commands-test' })
      let text =
        '{"item":{"n":900719925474099312345,"exp":1.2300e+02,"negative":-0,"s":"a\\u0061"},"item1":true,"tail":false}'
      const initialText = text
      let revision = 0,
        historyVersion = 1,
        requestId = 0
      const send = (
        action: JsonWorkerRequest['action'],
        command?: TreeCommand,
        overrides?: Partial<JsonWorkerRequest>,
      ) =>
        new Promise<JsonWorkerResult>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Worker command timeout')), 5000)
          worker.onmessage = (event: MessageEvent<JsonWorkerResponse>) => {
            clearTimeout(timer)
            if (event.data.kind === 'result') resolve(event.data)
            else reject(new Error('Unexpected Worker response: ' + event.data.kind))
          }
          worker.onerror = () => {
            clearTimeout(timer)
            reject(new Error('Worker failed'))
          }
          worker.postMessage({
            documentId: 'node-command-test',
            text,
            revision,
            historyVersion,
            requestId: ++requestId,
            action,
            ...(command ? { command } : {}),
            ...overrides,
          } satisfies JsonWorkerRequest)
        })
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Worker readiness timeout')), 5000)
          worker.onmessage = (event: MessageEvent<JsonWorkerResponse>) => {
            clearTimeout(timer)
            if (event.data.kind === 'ready') resolve()
            else reject(new Error('Expected document Worker'))
          }
          worker.onerror = () => {
            clearTimeout(timer)
            reject(new Error('Worker startup failed'))
          }
        })
        let tree = (await send('validate')).tree!
        const initialIds = tree.nodes.map((node) => node.id)
        const node = (key: string) => tree.nodes.find((value) => value.key === key)!
        const keys = (projection: JsonTreeProjection) =>
          projection.nodes
            .filter((value) => value.parentId === projection.rootId)
            .map((value) => value.key)
        const counts: number[] = []
        const commit = async (command: TreeCommand) => {
          const response = await send('tree', command)
          if (response.commandError) throw new Error(response.commandError)
          counts.push(response.edits.length)
          for (const edit of [...response.edits].sort((a, b) => b.offset - a.offset)) {
            text = text.slice(0, edit.offset) + edit.text + text.slice(edit.offset + edit.length)
          }
          revision++
          historyVersion++
          tree = (await send('validate')).tree!
        }
        await commit({ kind: 'copy', nodeId: node('item').id })
        const clone = node('item2')
        const copyValue = text.slice(clone.offset, clone.offset + clone.length)
        const copyKeys = keys(tree)
        const cloneIdsAreNew = tree.nodes
          .filter(
            (value) => value.offset >= clone.offset && value.offset < clone.offset + clone.length,
          )
          .every((value) => !initialIds.includes(value.id))
        const originalsRetained = initialIds.every((id) =>
          tree.nodes.some((value) => value.id === id),
        )
        await commit({ kind: 'add', nodeId: tree.rootId, index: 0 })
        await commit({ kind: 'insert', nodeId: node('tail').id, position: 'before' })
        const insertedKeys = keys(tree)
        await commit({ kind: 'convert', nodeId: clone.id, valueType: 'array' })
        const converted = tree.nodes.find((value) => value.id === clone.id)!
        const child = tree.nodes.find((value) => value.id === converted.children[0])!
        const sameType = await send('tree', {
          kind: 'convert',
          nodeId: clone.id,
          valueType: 'array',
        })
        const conflict = await send('tree', { kind: 'add', nodeId: tree.rootId, key: 'item' })
        const rootCopy = await send('tree', { kind: 'copy', nodeId: tree.rootId })
        const stale = await send('tree', { kind: 'copy', nodeId: node('item').id }, { revision: 0 })
        const finalText = text,
          finalIds = tree.nodes.map((value) => value.id)
        text = initialText
        revision++
        historyVersion = 1
        const undoIds = (await send('validate')).tree!.nodes.map((value) => value.id)
        text = finalText
        revision++
        historyVersion = 5
        const redoIds = (await send('validate')).tree!.nodes.map((value) => value.id)
        return {
          copyValue,
          copyKeys,
          insertedKeys,
          counts,
          cloneIdsAreNew,
          originalsRetained,
          converted: {
            type: converted.type,
            count: converted.children.length,
            childType: child.type,
            childValue: child.preview,
          },
          noOpEdits: sameType.edits.length,
          conflict: conflict.commandError,
          rootCopy: rootCopy.commandError,
          stale: stale.commandError,
          rejectedEdits: [conflict.edits.length, rootCopy.edits.length, stale.edits.length],
          undoMatches: JSON.stringify(undoIds) === JSON.stringify(initialIds),
          redoMatches: JSON.stringify(redoIds) === JSON.stringify(finalIds),
        }
      } finally {
        worker.terminate()
      }
    }, url)
    expect(result.copyValue).toBe(
      '{"n":900719925474099312345,"exp":1.2300e+02,"negative":-0,"s":"a\\u0061"}',
    )
    expect(result.copyKeys).toEqual(['item', 'item2', 'item1', 'tail'])
    expect(result.insertedKeys).toEqual(['key', 'item', 'item2', 'item1', 'key1', 'tail'])
    expect(result.counts).toEqual([1, 1, 1, 1])
    expect(result.cloneIdsAreNew && result.originalsRetained).toBe(true)
    expect(result.converted).toEqual({
      type: 'array',
      count: 1,
      childType: 'string',
      childValue: '""',
    })
    expect(result.noOpEdits).toBe(0)
    expect(result.conflict).toContain('已存在')
    expect(result.rootCopy).toContain('根节点')
    expect(result.stale).toContain('变化')
    expect(result.rejectedEdits).toEqual([0, 0, 0])
    expect(result.undoMatches && result.redoMatches).toBe(true)
  } finally {
    await closeApp(app)
  }
})
