import { expect, it } from 'vitest'
import { transformClipboardJson } from '../../src/core/json/clipboard-transform'

it.each(['format', 'compact'] as const)(
  'preserves number lexemes, key order, escapes and duplicates in %s output',
  (mode) => {
    const source =
      '{ "2": 900719925474099312345, "1": -0, "exp": 1e+999, "s": "a b \\u0061", "2": null }'
    const result = transformClipboardJson(source, mode)
    expect(result.analysis.valid).toBe(true)
    for (const literal of ['900719925474099312345', '-0', '1e+999', 'a b \\u0061'])
      expect(result.output).toContain(literal)
    expect(result.output!.indexOf('"2"')).toBeLessThan(result.output!.indexOf('"1"'))
    expect(result.analysis.diagnostics.some((item) => item.code === 'DuplicateKey')).toBe(true)
    if (mode === 'compact')
      expect(result.output).toBe(
        '{"2":900719925474099312345,"1":-0,"exp":1e+999,"s":"a b \\u0061","2":null}',
      )
  },
)
it.each(['{broken', '[1,]', '//x\n{}'])(
  'does not provide converted output for invalid input: %s',
  (source) => {
    expect(transformClipboardJson(source, 'compact').output).toBeUndefined()
    expect(transformClipboardJson(source, 'format').analysis.valid).toBe(false)
  },
)
