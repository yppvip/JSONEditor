import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'

const child = spawn(
  process.execPath,
  ['node_modules/electron-vite/dist/cli.js', 'dev', '--remoteDebuggingPort', '9223'],
  {
    cwd: resolve('.'),
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
let output = ''
child.stdout.on('data', (chunk) => {
  output += chunk.toString()
})
child.stderr.on('data', (chunk) => {
  output += chunk.toString()
})
let browser
try {
  const deadline = Date.now() + 60_000
  let endpoint
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const result = await fetch('http://127.0.0.1:9223/json/version')
      endpoint = (await result.json()).webSocketDebuggerUrl
      if (endpoint) break
    } catch {
      /* Electron has not opened its debugging endpoint yet. */
    }
    await new Promise((done) => setTimeout(done, 300))
  }
  if (!endpoint) throw new Error('Development app did not become ready.\n' + output)
  browser = await chromium.connectOverCDP(endpoint)
  const page = browser.contexts()[0]?.pages()[0]
  if (!page) throw new Error('Development window is missing')
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('button', { name: '关于 JSONEditor' }).click()
  await expect(page.getByRole('status', { name: '桌面连接' })).toHaveText(/桌面连接正常/)
  await page.getByRole('button', { name: '关闭操作面板' }).click()
  await expect(page.getByTestId('worker-status')).toHaveText('后台环境就绪')
  await expect(page.getByTestId('json-status')).toHaveText(/JSON 有效/)
  await expect(page.locator('.monaco-editor')).toBeVisible()
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
  await expect(page.getByRole('tree', { name: 'JSON 节点树' })).toBeVisible()
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/development.png' })
  await writeFile(
    process.env.JSONEDITOR_SMOKE_REPORT ?? 'docs/phase7-development-smoke.json',
    JSON.stringify(
      {
        capturedAtUtc: new Date().toISOString(),
        passed: true,
        url: page.url(),
        desktop: await page.evaluate(() => window.desktop.getAppInfo()),
        worker: 'ready',
      },
      null,
      2,
    ) + '\n',
  )
  await page.close()
  console.log('Development window, IPC and Worker: PASS')
} finally {
  await browser?.close()
  await mkdir('test-results', { recursive: true })
  await writeFile('test-results/development.log', output)
  if (child.exitCode === null) {
    await Promise.race([
      new Promise((done) => child.once('exit', done)),
      new Promise((done) => setTimeout(done, 3000)),
    ])
    if (child.exitCode === null) child.kill()
  }
}
