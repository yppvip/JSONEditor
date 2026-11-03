import { beforeEach, expect, it, vi } from 'vitest'
import {
  clampFraction,
  DEFAULT_LAYOUT,
  layoutBounds,
  readWorkspaceLayout,
  WORKSPACE_LAYOUT_KEY,
} from '../../src/renderer/ui/workspace-layout'

beforeEach(() => localStorage.clear())

it('defaults to equal panes with the tree on the left, and rejects damaged preferences', () => {
  expect(readWorkspaceLayout()).toEqual(DEFAULT_LAYOUT)
  for (const raw of [
    '{',
    'null',
    '[]',
    '{"version":2,"treeOnLeft":true,"treeFraction":0.6}',
    '{"version":1,"treeOnLeft":false,"treeFraction":1}',
    '{"version":1,"treeOnLeft":"false","treeFraction":0.4}',
  ]) {
    localStorage.setItem(WORKSPACE_LAYOUT_KEY, raw)
    expect(readWorkspaceLayout()).toEqual(DEFAULT_LAYOUT)
  }
  localStorage.setItem(
    WORKSPACE_LAYOUT_KEY,
    JSON.stringify({ version: 1, treeOnLeft: false, treeFraction: 0.7 }),
  )
  expect(readWorkspaceLayout()).toEqual({ treeOnLeft: false, treeFraction: 0.7 })
})

it('continues with defaults when storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied')
  })
  expect(readWorkspaceLayout()).toEqual(DEFAULT_LAYOUT)
})

it('keeps each pane at least 240 pixels wide and allows smaller equally sized panes only when necessary', () => {
  for (const width of [640, 1100, 1920]) {
    const available = width - 8
    expect(clampFraction(0.01, width) * available).toBeCloseTo(240)
    expect((1 - clampFraction(0.99, width)) * available).toBeCloseTo(240)
    expect(clampFraction(0.5, width)).toBe(0.5)
  }
  for (const width of [0, 8, 400, 488]) {
    expect(layoutBounds(width)).toEqual({ min: 0.5, max: 0.5 })
  }
})
