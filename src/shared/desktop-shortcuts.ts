import type { DesktopAction } from './desktop-api'
export function desktopShortcut(input: {
  key: string
  control: boolean
  meta: boolean
  shift: boolean
  alt: boolean
  isComposing?: boolean
  isAutoRepeat?: boolean
}): DesktopAction | undefined {
  if (!(input.control || input.meta) || input.isComposing || input.isAutoRepeat) return undefined
  const key = input.key.toLowerCase()
  const plain: Partial<Record<string, DesktopAction>> = { n: 'new', o: 'open', s: 'save' }
  const shift: Partial<Record<string, DesktopAction>> = { s: 'saveAs', c: 'copyRaw' }
  const alt: Partial<Record<string, DesktopAction>> = {
    c: 'copyFormatted',
    m: 'copyCompact',
    v: 'paste',
  }
  return !input.alt && !input.shift
    ? plain[key]
    : !input.alt && input.shift
      ? shift[key]
      : input.alt && !input.shift
        ? alt[key]
        : undefined
}
