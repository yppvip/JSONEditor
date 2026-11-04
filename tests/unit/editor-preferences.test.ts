import { beforeEach, expect, it, vi } from 'vitest'
import {
  DEFAULT_EDITOR_PREFERENCES,
  EDITOR_PREFERENCES_KEY,
  isFontSize,
  readEditorPreferences,
  writeEditorPreferences,
} from '../../src/renderer/ui/editor-preferences'

beforeEach(() => localStorage.clear())

it('validates each persisted font independently and rejects unknown versions or broken JSON', () => {
  for (const raw of ['{', 'null', '[]', '{"version":2,"treeFontSize":20,"codeFontSize":24}']) {
    localStorage.setItem(EDITOR_PREFERENCES_KEY, raw)
    expect(readEditorPreferences()).toEqual(DEFAULT_EDITOR_PREFERENCES)
  }
  writeEditorPreferences({ treeFontSize: 24, codeFontSize: 10 })
  expect(readEditorPreferences()).toEqual({ treeFontSize: 24, codeFontSize: 10 })
  localStorage.setItem(
    EDITOR_PREFERENCES_KEY,
    JSON.stringify({ version: 1, treeFontSize: 25, codeFontSize: 18 }),
  )
  expect(readEditorPreferences()).toEqual({ treeFontSize: 12, codeFontSize: 18 })
  for (const value of [NaN, Infinity, 9, 25, 12.5, '14', null, undefined])
    expect(isFontSize(value)).toBe(false)
})

it('reads defaults and allows writes without throwing when storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied')
  })
  expect(readEditorPreferences()).toEqual(DEFAULT_EDITOR_PREFERENCES)
  expect(() => writeEditorPreferences({ treeFontSize: 20, codeFontSize: 24 })).not.toThrow()
})
