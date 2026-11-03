import type { KeyboardEvent } from 'react'
export function focusHandle(id: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-node-id="${CSS.escape(id)}"] .tree-drag-handle`,
  )
  ;(element ?? document.querySelector<HTMLElement>('[role="tree"]'))?.focus()
}
export function menuKeys(event: KeyboardEvent<HTMLElement>, close: () => void) {
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)'),
  ]
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  let next: HTMLButtonElement | undefined
  if (event.key === 'ArrowDown') next = items[(current + 1) % items.length]
  else if (event.key === 'ArrowUp') next = items[(current - 1 + items.length) % items.length]
  else if (event.key === 'Home') next = items[0]
  else if (event.key === 'End') next = items.at(-1)
  else if (event.key === 'Escape' || event.key === 'Tab' || event.key === 'ArrowLeft') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if (next) {
    event.preventDefault()
    event.stopPropagation()
    next.focus()
  }
}
