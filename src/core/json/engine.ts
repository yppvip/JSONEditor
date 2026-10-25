import { createScanner, format, printParseErrorCode, visit } from 'jsonc-parser'
import type { ParseDiagnostic, TextEdit } from '../document/contracts'
import { MAX_DEPTH, MAX_TEXT_LENGTH, MAX_DIAGNOSTICS, textLimitDiagnostic } from './limits'
export { MAX_DEPTH, MAX_TEXT_LENGTH, MAX_DIAGNOSTICS, AUTOMATIC_VALIDATION_LIMIT } from './limits'

export interface JsonAnalysis {
  valid: boolean
  diagnostics: ParseDiagnostic[]
  diagnosticsTruncated: boolean
}

const messages: Record<string, string> = {
  InvalidSymbol: '存在非法字符',
  InvalidNumberFormat: '数字格式无效',
  PropertyNameExpected: '需要双引号包围的属性名',
  ValueExpected: '需要 JSON 值',
  ColonExpected: '缺少冒号',
  CommaExpected: '缺少逗号',
  CloseBraceExpected: '缺少右花括号 }',
  CloseBracketExpected: '缺少右方括号 ]',
  EndOfFileExpected: 'JSON 根值后存在多余内容',
  InvalidCommentToken: '严格 JSON 不允许注释',
  UnexpectedEndOfComment: '注释未结束（严格 JSON 不允许注释）',
  UnexpectedEndOfString: '字符串未结束',
  UnexpectedEndOfNumber: '数字未结束',
  InvalidUnicode: 'Unicode 转义无效',
  InvalidEscapeCharacter: '字符串转义无效',
  InvalidCharacter: '字符串包含非法字符',
}

export function analyzeJson(text: string): JsonAnalysis {
  const diagnostics: ParseDiagnostic[] = []
  let errorCount = 0
  let diagnosticCount = 0
  const add = (diagnostic: ParseDiagnostic): void => {
    diagnosticCount++
    if (diagnostic.severity === 'error') errorCount++
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(diagnostic)
    else if (diagnostic.severity === 'error') {
      const warning = diagnostics.findLastIndex((item) => item.severity === 'warning')
      if (warning >= 0) diagnostics[warning] = diagnostic
    }
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return {
      valid: false,
      diagnosticsTruncated: false,
      diagnostics: [textLimitDiagnostic()],
    }
  }
  // Preflight depth iteratively, before entering the library's recursive parser.
  const scanner = createScanner(text, true)
  let depth = 0
  for (scanner.scan(); scanner.getTokenOffset() < text.length; scanner.scan()) {
    // Strings and comments include delimiters; only structural tokens are single braces.
    if (scanner.getTokenLength() !== 1) continue
    const token = text[scanner.getTokenOffset()]
    if (token === '{' || token === '[') depth++
    if (depth > MAX_DEPTH) {
      return {
        valid: false,
        diagnosticsTruncated: false,
        diagnostics: [
          {
            offset: scanner.getTokenOffset(),
            length: scanner.getTokenLength(),
            code: 'DepthLimit',
            severity: 'error',
            message: `嵌套超过当前支持的 ${MAX_DEPTH} 层；原文已保留。`,
          },
        ],
      }
    }
    if (token === '}' || token === ']') depth = Math.max(0, depth - 1)
  }
  const objectKeys: Set<string>[] = []
  // No native Object conversion or numeric serialization: preserve every source lexeme.
  visit(
    text,
    {
      onObjectBegin: () => {
        objectKeys.push(new Set())
      },
      onObjectEnd: () => {
        objectKeys.pop()
      },
      onObjectProperty: (key, offset, length) => {
        const keys = objectKeys.at(-1)
        if (keys?.has(key))
          add({
            offset,
            length,
            severity: 'warning',
            code: 'DuplicateKey',
            message: '同一对象存在重复属性名，原文将保留。',
          })
        keys?.add(key)
      },
      onError: (error, offset, length) => {
        const code = printParseErrorCode(error)
        add({ offset, length, severity: 'error', code, message: messages[code] ?? code })
      },
    },
    { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false },
  )
  return {
    valid: errorCount === 0,
    diagnostics,
    diagnosticsTruncated: diagnosticCount > MAX_DIAGNOSTICS,
  }
}

export function formatJson(text: string): JsonAnalysis & { edits: TextEdit[] } {
  const analysis = analyzeJson(text)
  if (!analysis.valid) return { ...analysis, edits: [] }
  const edits = format(text, undefined, {
    insertSpaces: true,
    tabSize: 2,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
  })
  return {
    ...analysis,
    edits: edits.map(({ offset, length, content }) => ({ offset, length, text: content })),
  }
}
