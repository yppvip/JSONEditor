import { isAbsolute, relative, resolve } from 'node:path'

export const APPLICATION_URL = 'app://editor/index.html'

export function isTrustedFrame(
  actualUrl: string | undefined,
  expectedUrl: string,
  isMainFrame: boolean,
): boolean {
  return isMainFrame && actualUrl === expectedUrl
}

export function resolveApplicationAsset(requestUrl: string, rendererRoot: string): string | null {
  try {
    const url = new URL(requestUrl)
    if (
      url.protocol !== 'app:' ||
      url.hostname !== 'editor' ||
      url.port ||
      url.username ||
      url.password
    )
      return null
    const pathname = decodeURIComponent(url.pathname)
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes(':')) return null
    const target = resolve(rendererRoot, '.' + pathname)
    const localPath = relative(rendererRoot, target)
    if (!localPath || localPath.startsWith('..') || isAbsolute(localPath)) return null
    return target
  } catch {
    return null
  }
}

export function contentSecurityPolicy(developmentOrigin?: string): string {
  const scripts = developmentOrigin ? "'self' 'unsafe-inline'" : "'self'"
  const connections = developmentOrigin
    ? `'self' ${developmentOrigin} ${developmentOrigin.replace(/^http/, 'ws')}`
    : "'self'"
  return `default-src 'self'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self'; connect-src ${connections}; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`
}
