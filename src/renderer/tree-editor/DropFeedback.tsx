import { useRef } from 'react'
import type { RefObject } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
// Registers the React plugin once, shared with surface motion.
import '../ui/motion'

export function DropFeedback({
  viewport,
  nodeId,
  revision,
}: {
  viewport: RefObject<HTMLDivElement | null>
  nodeId: string | undefined
  revision: number
}) {
  const layer = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      const area = viewport.current,
        element = layer.current
      if (!area || !element || !nodeId || typeof window.matchMedia !== 'function') return
      const row = area.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`)
      if (!row) return
      const bounds = area.getBoundingClientRect(),
        rect = row.getBoundingClientRect()
      const left = Math.max(bounds.left, rect.left),
        top = Math.max(bounds.top, rect.top)
      const width = Math.min(bounds.right, rect.right) - left,
        height = Math.min(bounds.bottom, rect.bottom) - top
      if (width <= 0 || height <= 0) return
      const x = left - bounds.left + area.scrollLeft,
        y = top - bounds.top + area.scrollTop
      const media = gsap.matchMedia(area)
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.set(element, { left: x, top: y, width, height, willChange: 'opacity' })
        gsap.fromTo(
          element,
          { opacity: 0.5 },
          { opacity: 0, duration: 0.16, ease: 'power1.out', clearProps: 'opacity,willChange' },
        )
      })
      const stop = () => media.revert()
      area.addEventListener('scroll', stop, true)
      window.addEventListener('resize', stop)
      return () => {
        area.removeEventListener('scroll', stop, true)
        window.removeEventListener('resize', stop)
        media.revert()
      }
    },
    { scope: layer, dependencies: [nodeId, revision, viewport], revertOnUpdate: true },
  )
  return <div ref={layer} className="tree-drop-feedback" aria-hidden="true" />
}
