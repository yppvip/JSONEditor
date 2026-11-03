import { useRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { gsap } from 'gsap'
import { useCssFeedback, useSurfaceMotion } from '../../src/renderer/ui/motion'
import { DropFeedback } from '../../src/renderer/tree-editor/DropFeedback'

let reduced = false
beforeEach(() => {
  reduced = false
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return query.includes('no-preference') ? !reduced : reduced
    },
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function Surface({
  signal = true,
  enabled = true,
  kind = 'menu',
}: {
  signal?: boolean
  enabled?: boolean
  kind?: 'menu' | 'swap'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useSurfaceMotion(ref, kind, signal, enabled)
  return (
    <div ref={ref} data-testid="surface">
      <div className="workspace-tree-slot" data-testid="tree" />
      <div className="workspace-code-slot" />
    </div>
  )
}
it('reverts active surface tweens and inline compositor hints on unmount', () => {
  const { unmount } = render(<Surface />)
  const element = screen.getByTestId('surface')
  expect(gsap.getTweensOf(element)).toHaveLength(1)
  expect(element.style.willChange).toBe('opacity')
  unmount()
  expect(gsap.getTweensOf(element)).toHaveLength(0)
  expect(element.style.opacity).toBe('')
  expect(element.style.willChange).toBe('')
})
it('a live reduced-motion change immediately restores the final visible surface', () => {
  render(<Surface />)
  const element = screen.getByTestId('surface')
  expect(gsap.getTweensOf(element)).toHaveLength(1)
  act(() => {
    reduced = true
    gsap.matchMediaRefresh()
  })
  expect(gsap.getTweensOf(element)).toHaveLength(0)
  expect(element.style.opacity).toBe('')
  expect(element.style.willChange).toBe('')
})
it('reduced motion creates no entrance tween or hidden initial style', () => {
  reduced = true
  render(<Surface />)
  const element = screen.getByTestId('surface')
  expect(gsap.getTweensOf(element)).toHaveLength(0)
  expect(element.style.opacity).toBe('')
})
it('swap only reacts to a position change and cancels when resizing starts', () => {
  const { rerender } = render(<Surface kind="swap" />)
  const element = screen.getByTestId('tree')
  expect(gsap.getTweensOf(element)).toHaveLength(0)
  rerender(<Surface kind="swap" signal={false} />)
  expect(gsap.getTweensOf(element)).toHaveLength(1)
  rerender(<Surface kind="swap" signal={false} enabled={false} />)
  expect(gsap.getTweensOf(element)).toHaveLength(0)
  expect(element.style.opacity).toBe('')
  rerender(<Surface kind="swap" signal={false} enabled />)
  expect(gsap.getTweensOf(element)).toHaveLength(0)
})
it('CSS confirmation never flashes on virtual mount and cleans its timer on unmount', () => {
  vi.useFakeTimers()
  function Icon({ signal }: { signal: string }) {
    const ref = useRef<HTMLSpanElement>(null)
    useCssFeedback(ref, signal)
    return <span ref={ref} data-testid="icon" />
  }
  const { rerender, unmount } = render(<Icon signal="number" />)
  const element = screen.getByTestId('icon')
  expect(element.classList.contains('feedback-confirmed')).toBe(false)
  rerender(<Icon signal="string" />)
  expect(element.classList.contains('feedback-confirmed')).toBe(true)
  unmount()
  expect(element.classList.contains('feedback-confirmed')).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

it('a landing overlay is scoped to a visible row and scrolling immediately cancels it', () => {
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 200,
    height: 28,
    right: 200,
    bottom: 28,
    toJSON() {},
  }))
  function Landing({ nodeId }: { nodeId?: string }) {
    const ref = useRef<HTMLDivElement>(null)
    return (
      <div ref={ref} data-testid="viewport">
        <div data-node-id="one" />
        <DropFeedback viewport={ref} nodeId={nodeId} revision={1} />
      </div>
    )
  }
  const { rerender, unmount } = render(<Landing />)
  rerender(<Landing nodeId="one" />)
  const viewport = screen.getByTestId('viewport'),
    layer = viewport.querySelector<HTMLElement>('.tree-drop-feedback')!
  expect(gsap.getTweensOf(layer)).toHaveLength(1)
  fireEvent.scroll(viewport)
  expect(gsap.getTweensOf(layer)).toHaveLength(0)
  expect(layer.style.opacity).toBe('')
  rerender(<Landing nodeId="offscreen" />)
  expect(gsap.getTweensOf(layer)).toHaveLength(0)
  unmount()
  expect(gsap.getTweensOf(layer)).toHaveLength(0)
})
