import { _electron as electron, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Each scenario uses its own profile, including tests against an installed executable. */
export async function launchApp() {
  const profile = test.info().outputPath('profile')
  await mkdir(profile, { recursive: true })
  const executablePath = process.env.JSONEDITOR_EXECUTABLE
  const args = [`--user-data-dir=${profile}`]
  return electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? args : [resolve('.'), ...args],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
}
