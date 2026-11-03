import { createContext } from 'react'
export interface MenuAnchor {
  id: string
  x: number
  y: number
}
export const OpenNodeMenu = createContext<(anchor: MenuAnchor) => void>(() => {})
