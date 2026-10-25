import { expect, it } from 'vitest'
import { desktopShortcut } from '../../src/shared/desktop-shortcuts'
it('maps application shortcuts consistently while preserving normal editor and IME keys', () => {
  const input = { key: 's', control: true, meta: false, shift: false, alt: false }
  expect(desktopShortcut(input)).toBe('save')
  expect(desktopShortcut({ ...input, shift: true })).toBe('saveAs')
  expect(desktopShortcut({ ...input, key: 'c' })).toBeUndefined()
  expect(desktopShortcut({ ...input, key: 'v' })).toBeUndefined()
  expect(desktopShortcut({ ...input, key: 'z' })).toBeUndefined()
  expect(desktopShortcut({ ...input, key: 'c', alt: true })).toBe('copyFormatted')
  expect(desktopShortcut({ ...input, key: 'm', alt: true })).toBe('copyCompact')
  expect(desktopShortcut({ ...input, key: 'v', alt: true })).toBe('paste')
  expect(desktopShortcut({ ...input, isComposing: true })).toBeUndefined()
  expect(desktopShortcut({ ...input, isAutoRepeat: true })).toBeUndefined()
  expect(desktopShortcut({ ...input, control: false, meta: true })).toBe('save')
})
