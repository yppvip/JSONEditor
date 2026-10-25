import { createScanner } from 'jsonc-parser'
import { analyzeJson, formatJson } from './engine'
import type { JsonAnalysis } from './engine'
import { applySourceEdits } from '../document/source-edits'
import { MAX_TEXT_LENGTH } from './limits'

export function transformClipboardJson(
  text: string,
  mode: 'format' | 'compact',
): { analysis: JsonAnalysis; output?: string; outputError?: string } {
  const formatted = mode === 'format' ? formatJson(text) : null
  const result = formatted ?? analyzeJson(text)
  const analysis = {
    valid: result.valid,
    diagnostics: result.diagnostics,
    diagnosticsTruncated: result.diagnosticsTruncated,
  }
  if (!analysis.valid) return { analysis }
  let output: string
  if (formatted) output = applySourceEdits(text, formatted.edits)
  else {
    const scanner = createScanner(text, true),
      parts: string[] = []
    for (scanner.scan(); scanner.getTokenOffset() < text.length; scanner.scan())
      parts.push(
        text.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength()),
      )
    output = parts.join('')
  }
  return output.length > MAX_TEXT_LENGTH
    ? { analysis, outputError: '转换结果超过剪贴板上限。' }
    : { analysis, output }
}
