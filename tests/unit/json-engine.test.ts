import { describe, expect, it } from 'vitest'
import { applyEdits } from 'jsonc-parser'
import {
  analyzeJson,
  formatJson,
  MAX_DEPTH,
  MAX_DIAGNOSTICS,
  MAX_TEXT_LENGTH,
} from '../../src/core/json/engine'

describe('strict JSON analysis', () => {
  it.each([
    '{}',
    '[]',
    'null',
    'true',
    'false',
    '42',
    '"文字 😀"',
    '[1e400,-0,1.2300,9007199254740993123456789]',
  ])('accepts %s', (text) => {
    expect(analyzeJson(text).valid).toBe(true)
  })
  it.each([
    '',
    '  ',
    '{"a":1,}',
    '[1,]',
    '{/*comment*/"a":1}',
    '// comment\n{}',
    "{'a':1}",
    '{a:1}',
    '01',
    'NaN',
    'Infinity',
    '{} {}',
    '{"a":}',
    '"bad\nline"',
    '"\\x01"',
  ])('rejects %j', (text) => {
    const result = analyzeJson(text)
    expect(result.valid).toBe(false)
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true)
  })
  it('reports exact UTF-16 offset after CRLF, CJK and emoji', () => {
    const text = '{\r\n  "😀": "中文",\r\n  "broken": @\r\n}'
    expect(
      analyzeJson(text).diagnostics.some((diagnostic) => diagnostic.offset === text.indexOf('@')),
    ).toBe(true)
  })
  it('warns about duplicate decoded names only within the same object', () => {
    const result = analyzeJson('{"a":1,"\\u0061":2,"nested":{"a":3},"__proto__":1,"__proto__":2}')
    expect(result.valid).toBe(true)
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === 'DuplicateKey'),
    ).toHaveLength(2)
    expect(analyzeJson('[{"a":1},{"a":2}]').diagnostics).toEqual([])
  })
  it('preflights recursive depth while ignoring brackets inside strings and comments', () => {
    expect(analyzeJson('['.repeat(MAX_DEPTH) + '0' + ']'.repeat(MAX_DEPTH)).valid).toBe(true)
    expect(
      analyzeJson('['.repeat(MAX_DEPTH + 1) + '0' + ']'.repeat(MAX_DEPTH + 1)).diagnostics[0]?.code,
    ).toBe('DepthLimit')
    expect(analyzeJson(JSON.stringify('['.repeat(2000))).valid).toBe(true)
  })
  it('limits retained diagnostics without hiding syntax errors behind warnings', () => {
    const text = '{' + Array.from({ length: 150 }, () => '"a":1').join(',') + ',"b":@}'
    const result = analyzeJson(text)
    expect(result.valid).toBe(false)
    expect(result.diagnosticsTruncated).toBe(true)
    expect(result.diagnostics).toHaveLength(MAX_DIAGNOSTICS)
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true)
  })
  it('rejects text above the supported analysis size without parsing it', () => {
    expect(analyzeJson(' '.repeat(MAX_TEXT_LENGTH + 1)).diagnostics[0]?.code).toBe('TextLimit')
  })
})

describe('source-preserving formatting', () => {
  it('preserves large numbers, negative zero, exponents, duplicate keys and original key order', () => {
    const text =
      '{"10":9007199254740993123456789,"2":-0,"n":1.2300e+02,"n":1e400,"escaped":"\\u0061"}'
    const result = formatJson(text)
    const formatted = applyEdits(
      text,
      result.edits.map(({ text: content, ...edit }) => ({ ...edit, content })),
    )
    expect(result.valid).toBe(true)
    expect(formatted.replace(/\s/g, '')).toBe(text)
    expect(formatted.indexOf('"10"')).toBeLessThan(formatted.indexOf('"2"'))
    expect(formatJson(formatted).edits).toEqual([])
  })
  it('preserves spaces inside strings and CRLF formatting', () => {
    const text = '{\r\n"s":"two words", "arr":[1,2]\r\n}'
    const formatted = applyEdits(
      text,
      formatJson(text).edits.map(({ text: content, ...edit }) => ({ ...edit, content })),
    )
    expect(formatted).toContain('"two words"')
    expect(formatted).toContain('\r\n  "s"')
    expect(formatted.replaceAll('\r\n', '')).not.toContain('\n')
  })
  it('never proposes edits for invalid source', () => {
    const result = formatJson('{"unfinished":')
    expect(result.valid).toBe(false)
    expect(result.edits).toEqual([])
  })
})
