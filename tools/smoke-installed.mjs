import { _electron as electron, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const executablePath = process.env.JSONEDITOR_EXECUTABLE
const expectedVersion = process.env.JSONEDITOR_EXPECTED_VERSION
const directory = resolve(process.env.JSONEDITOR_SMOKE_DIRECTORY ?? 'test-results/installed-smoke')
if (!executablePath || !expectedVersion) throw new Error('Executable and expected version required')
await mkdir(directory, { recursive: true })
const application = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${join(directory, 'profile')}`],
  env: { ...process.env, ELECTRON_RENDERER_URL: '' },
})
try {
  const page = await application.firstWindow()
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
  await page.context().route(/^https?:\/\//, (route) => route.abort('internetdisconnected'))
  await page.reload()
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
  const runtime = await page.evaluate(() => window.desktop.getAppInfo())
  expect(runtime.version).toBe(expectedVersion)
  expect(runtime.sandboxed).toBe(true)
  expect(runtime.contextIsolated).toBe(true)
  const path = join(directory, 'saved.json')
  await application.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
  }, path)
  await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus()
  await page.keyboard.press('ControlOrMeta+A')
  const text = '{"installed":900719925474099312345,"unicode":"中文😀"}'
  await page.keyboard.insertText(text)
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByTestId('document-name')).toHaveText('saved.json')
  expect(await readFile(path, 'utf8')).toBe(text)
  await writeFile(
    join(directory, `smoke-${expectedVersion}.json`),
    JSON.stringify(
      { passed: true, runtime, offline: true, savedBytes: Buffer.byteLength(text) },
      null,
      2,
    ) + '\n',
  )
  console.log(`Installed ${expectedVersion}: offline, sandbox, Worker and exact-source save PASS`)
} finally {
  await application
    .evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    })
    .catch(() => {})
  await application.close()
}
