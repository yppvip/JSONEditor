import { createContext } from 'react'
export type EditField = 'key' | 'value'
export const BeginInlineEdit = createContext<(id: string, field: EditField) => void>(() => {})
