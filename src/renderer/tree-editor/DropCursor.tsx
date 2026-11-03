import type { CursorProps } from 'react-arborist'
export function DropCursor({ top, left, indent }: CursorProps) {
  return (
    <div
      className="tree-drop-cursor"
      aria-hidden="true"
      style={{ top: top - 1, left, right: indent }}
    />
  )
}
