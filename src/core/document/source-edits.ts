import type { TextEdit } from './contracts'

export function applySourceEdits(text: string, edits: readonly TextEdit[]): string {
  const parts: string[] = []
  let boundary = text.length
  for (const edit of [...edits].sort((a, b) => b.offset - a.offset)) {
    if (
      !Number.isSafeInteger(edit.offset) ||
      !Number.isSafeInteger(edit.length) ||
      edit.offset < 0 ||
      edit.length < 0 ||
      edit.offset + edit.length > boundary
    )
      throw new Error('文本编辑范围冲突。')
    parts.push(text.slice(edit.offset + edit.length, boundary), edit.text)
    boundary = edit.offset
  }
  parts.push(text.slice(0, boundary))
  return parts.reverse().join('')
}
