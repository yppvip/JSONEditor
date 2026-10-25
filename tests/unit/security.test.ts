import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import {
  APPLICATION_URL,
  contentSecurityPolicy,
  isTrustedFrame,
  resolveApplicationAsset,
} from '../../src/main/security'

describe('desktop trust boundary', () => {
  it('accepts only the exact application main frame', () => {
    expect(isTrustedFrame(APPLICATION_URL, APPLICATION_URL, true)).toBe(true)
    for (const url of [
      undefined,
      'https://example.com',
      `${APPLICATION_URL}?other=1`,
      'app://other/index.html',
    ]) {
      expect(isTrustedFrame(url, APPLICATION_URL, true)).toBe(false)
    }
    expect(isTrustedFrame(APPLICATION_URL, APPLICATION_URL, false)).toBe(false)
  })
  it('keeps production scripts local and development HMR scoped', () => {
    expect(contentSecurityPolicy()).toContain("script-src 'self';")
    expect(contentSecurityPolicy()).not.toContain('unsafe-eval')
    expect(contentSecurityPolicy('http://127.0.0.1:5173')).toContain('ws://127.0.0.1:5173')
  })
})

describe('application assets', () => {
  const root = resolve('out/renderer')
  it('resolves local bundled assets', () => {
    expect(resolveApplicationAsset('app://editor/assets/main.js', root)).toBe(
      resolve(root, 'assets/main.js'),
    )
  })
  it.each([
    'https://editor/index.html',
    'app://other/index.html',
    'app://editor/%2e%2e%2foutside',
    'app://editor/%5coutside',
    'app://editor/%00',
    'app://editor/C:/Windows',
    'app://editor/%ZZ',
  ])('rejects invalid resource URL %s', (url) => {
    expect(resolveApplicationAsset(url, root)).toBeNull()
  })
})
