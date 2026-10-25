import { indexTree, treeTopologyKey } from '../../core/tree-model/model'
import type { JsonTreeNode, JsonTreeProjection } from '../../core/tree-model/model'
import type { TreeCommand } from '../../core/commands/tree-commands'
import { validateMove } from '../../core/commands/structural-commands'
import type { MoveCommand } from '../../core/commands/structural-commands'

export interface PresentationNode {
  id: string
  parentId: string | null
  children: PresentationNode[] | null
}
const topologies = new WeakMap<object, PresentationNode[]>()
export function presentationRoots(tree: JsonTreeProjection): PresentationNode[] {
  const key = treeTopologyKey(tree)
  let roots = topologies.get(key)
  if (!roots) {
    const nodes = new Map(
      tree.nodes.map((node) => [
        node.id,
        { id: node.id, parentId: node.parentId, children: null } as PresentationNode,
      ]),
    )
    for (const node of tree.nodes)
      if (node.type === 'array' || node.type === 'object')
        nodes.get(node.id)!.children = node.children.map((id) => nodes.get(id)!)
    roots = [nodes.get(tree.rootId)!]
    topologies.set(key, roots)
  }
  return roots
}
interface RowSnapshot {
  node: JsonTreeNode | undefined
  enabled: boolean
}

/** Topology is stable across scalar patches; only mounted rows subscribe to current values. */
export class TreePresentationStore {
  tree: JsonTreeProjection | null = null
  enabled = false
  private index: ReadonlyMap<string, JsonTreeNode> = new Map()
  private readonly listeners = new Map<string, Set<() => void>>()
  private readonly snapshots = new Map<string, RowSnapshot>()
  private command: (command: TreeCommand, revision: number) => void = () => {}

  update(tree: JsonTreeProjection | null, enabled: boolean, command: typeof this.command): void {
    const oldIndex = this.index,
      oldEnabled = this.enabled
    this.tree = tree
    this.index = tree ? indexTree(tree) : new Map()
    this.enabled = enabled
    this.command = command
    this.listeners.forEach((listeners, id) => {
      if (oldIndex.get(id) !== this.index.get(id) || oldEnabled !== enabled)
        listeners.forEach((listener) => listener())
    })
  }
  snapshot(id: string): RowSnapshot {
    const node = this.index.get(id)
    let snapshot = this.snapshots.get(id)
    if (!snapshot || snapshot.node !== node || snapshot.enabled !== this.enabled) {
      snapshot = { node, enabled: this.enabled }
      this.snapshots.set(id, snapshot)
    }
    return snapshot
  }
  subscribe(id: string, listener: () => void): () => void {
    let listeners = this.listeners.get(id)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(id, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) {
        this.listeners.delete(id)
        this.snapshots.delete(id)
      }
    }
  }
  move(nodeId: string, parentId: string, position: number): MoveCommand {
    const node = this.index.get(nodeId)!
    const oldPosition =
      node.parentId === parentId ? this.index.get(parentId)!.children.indexOf(nodeId) : -1
    return {
      kind: 'move',
      nodeId,
      parentId,
      index: oldPosition >= 0 && oldPosition < position ? position - 1 : position,
    }
  }
  canDrop(nodeId: string, parentId: string, position: number): boolean {
    if (!this.enabled || !this.tree || !this.index.has(parentId) || !this.index.has(nodeId))
      return false
    try {
      validateMove(this.tree, this.move(nodeId, parentId, position))
      return true
    } catch {
      return false
    }
  }
  drop(nodeId: string, parentId: string, position: number): void {
    if (this.canDrop(nodeId, parentId, position))
      this.command(this.move(nodeId, parentId, position), this.tree!.revision)
  }
}
