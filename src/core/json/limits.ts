import type { ParseDiagnostic } from '../document/contracts'

export const MAX_DEPTH = 512
export const MAX_TEXT_LENGTH = 20 * 1024 * 1024
export const AUTOMATIC_VALIDATION_LIMIT = 2 * 1024 * 1024
export const MAX_DIAGNOSTICS = 100

export function textLimitDiagnostic(): ParseDiagnostic {
  return {
    offset: 0,
    length: 0,
    code: 'TextLimit',
    severity: 'error',
    message: '文本超过当前校验上限（20 Mi UTF-16 字符）；原文已保留。',
  }
}
