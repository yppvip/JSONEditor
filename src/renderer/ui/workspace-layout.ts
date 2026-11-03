import { useEffect, useState } from 'react'

export interface WorkspaceLayout {
  treeFraction: number
  treeOnLeft: boolean
}

export const WORKSPACE_LAYOUT_KEY = 'jsoneditor.workspace-layout.v1'
export const DEFAULT_LAYOUT: WorkspaceLayout = { treeFraction: 0.5, treeOnLeft: true }
export const SPLITTER_WIDTH = 8
export const MIN_PANE_WIDTH = 240

export function layoutBounds(width: number): { min: number; max: number } {
  const available = width - SPLITTER_WIDTH
  const min = available > 0 ? Math.min(0.5, MIN_PANE_WIDTH / available) : 0.5
  return { min, max: 1 - min }
}

export function clampFraction(fraction: number, width: number): number {
  const { min, max } = layoutBounds(width)
  return Math.min(max, Math.max(min, fraction))
}

export function readWorkspaceLayout(): WorkspaceLayout {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(WORKSPACE_LAYOUT_KEY) ?? 'null')
    if (value && typeof value === 'object') {
      const saved = value as Record<string, unknown>
      if (
        saved.version === 1 &&
        typeof saved.treeOnLeft === 'boolean' &&
        typeof saved.treeFraction === 'number' &&
        Number.isFinite(saved.treeFraction) &&
        saved.treeFraction > 0 &&
        saved.treeFraction < 1
      ) {
        return { treeFraction: saved.treeFraction, treeOnLeft: saved.treeOnLeft }
      }
    }
  } catch {
    /* Unavailable or damaged preferences must not prevent editing. */
  }
  return { ...DEFAULT_LAYOUT }
}

export function useWorkspaceLayout() {
  const [layout, setLayout] = useState(readWorkspaceLayout)
  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify({ version: 1, ...layout }))
    } catch {
      /* The current session still supports resizing if storage is unavailable. */
    }
  }, [layout])
  return [layout, setLayout] as const
}
