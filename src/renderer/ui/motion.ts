import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)

/** Surface fades never own layout, focus, or document state. */
export function useSurfaceMotion(
  scope: RefObject<HTMLElement | null>,
  kind: 'menu' | 'submenu' | 'swap',
  signal: unknown = 0,
  enabled = true,
): void {
  const previous = useRef(signal)
  useGSAP(
    () => {
      const changed = previous.current !== signal
      previous.current = signal
      if (
        !scope.current ||
        !enabled ||
        (kind === 'swap' && !changed) ||
        typeof window.matchMedia !== 'function'
      )
        return
      const element = scope.current
      const media = gsap.matchMedia(element)
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const targets =
          kind === 'swap'
            ? element.querySelectorAll(
                ':scope > .workspace-tree-slot, :scope > .workspace-code-slot',
              )
            : element
        gsap.set(targets, { willChange: kind === 'submenu' ? 'opacity,transform' : 'opacity' })
        // Only the leaf submenu translates: a transformed parent would rebase its fixed submenu.
        gsap.fromTo(
          targets,
          { opacity: kind === 'swap' ? 0.86 : 0.65, ...(kind === 'submenu' ? { y: -3 } : {}) },
          {
            opacity: 1,
            ...(kind === 'submenu' ? { y: 0 } : {}),
            duration: kind === 'swap' ? 0.18 : 0.12,
            ease: 'power1.out',
            overwrite: 'auto',
            clearProps: kind === 'submenu' ? 'opacity,transform,willChange' : 'opacity,willChange',
          },
        )
      })
      return () => media.revert()
    },
    { scope, dependencies: [kind, signal, enabled], revertOnUpdate: true },
  )
}

/** CSS feedback only starts on a real change, never when a virtual row mounts. */
export function useCssFeedback(
  scope: RefObject<HTMLElement | null>,
  signal: unknown,
  enabled = true,
): void {
  const previous = useRef(signal)
  useLayoutEffect(() => {
    const changed = previous.current !== signal
    previous.current = signal
    const element = scope.current
    if (!element || !changed || !enabled) return
    element.classList.add('feedback-confirmed')
    const timer = setTimeout(() => element.classList.remove('feedback-confirmed'), 160)
    return () => {
      clearTimeout(timer)
      element.classList.remove('feedback-confirmed')
    }
  }, [scope, signal, enabled])
}
