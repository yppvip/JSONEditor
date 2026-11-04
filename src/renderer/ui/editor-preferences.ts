import { useEffect, useState } from 'react'

export interface EditorPreferences {
  treeFontSize: number
  codeFontSize: number
}
export const EDITOR_PREFERENCES_KEY = 'jsoneditor.editor-preferences.v1'
export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = { treeFontSize: 12, codeFontSize: 14 }
export const MIN_FONT_SIZE = 10
export const MAX_FONT_SIZE = 24

export function isFontSize(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_FONT_SIZE &&
    value <= MAX_FONT_SIZE
  )
}
export function readEditorPreferences(): EditorPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(EDITOR_PREFERENCES_KEY) ?? 'null')
    if (value && typeof value === 'object' && 'version' in value && value.version === 1) {
      const saved = value as Record<string, unknown>
      return {
        treeFontSize: isFontSize(saved.treeFontSize)
          ? saved.treeFontSize
          : DEFAULT_EDITOR_PREFERENCES.treeFontSize,
        codeFontSize: isFontSize(saved.codeFontSize)
          ? saved.codeFontSize
          : DEFAULT_EDITOR_PREFERENCES.codeFontSize,
      }
    }
  } catch {
    /* Damaged or unavailable preferences must not prevent editing. */
  }
  return { ...DEFAULT_EDITOR_PREFERENCES }
}
export function writeEditorPreferences(preferences: EditorPreferences): void {
  try {
    localStorage.setItem(EDITOR_PREFERENCES_KEY, JSON.stringify({ version: 1, ...preferences }))
  } catch {
    /* Changes still apply to the current session when storage is unavailable. */
  }
}
export function useEditorPreferences() {
  const [preferences, setPreferences] = useState(readEditorPreferences)
  useEffect(() => writeEditorPreferences(preferences), [preferences])
  return [preferences, setPreferences] as const
}
