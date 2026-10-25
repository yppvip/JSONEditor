import { vi } from 'vitest'
import type { DesktopApi } from '../src/shared/desktop-api'

export function desktopStub(): DesktopApi {
  const cancelled = { ok: false as const, code: 'cancelled' as const, message: 'cancelled' }
  return {
    getAppInfo: vi.fn().mockResolvedValue({
      name: 'JSONEditor',
      version: '0.6.0',
      platform: 'win32',
      electron: '45.0.0',
      sandboxed: true,
      contextIsolated: true,
    }),
    openFile: vi.fn().mockResolvedValue(cancelled),
    openRecent: vi.fn().mockResolvedValue(cancelled),
    saveFile: vi.fn().mockResolvedValue(cancelled),
    getRecentFiles: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    confirmUnsaved: vi.fn().mockResolvedValue({ ok: true, value: 'cancel' }),
    releaseFile: vi.fn().mockResolvedValue(undefined),
    readClipboard: vi.fn().mockResolvedValue({ ok: true, value: '{}' }),
    writeClipboard: vi.fn().mockResolvedValue({ ok: true, value: true }),
    onAction: vi.fn().mockReturnValue(() => {}),
    onCloseRequested: vi.fn().mockReturnValue(() => {}),
    replyClose: vi.fn().mockResolvedValue(undefined),
  }
}
