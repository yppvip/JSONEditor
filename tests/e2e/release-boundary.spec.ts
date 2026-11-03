import { expect, test } from '@playwright/test'
import { closeApp } from './close-app'
import { launchApp } from './launch-app'

test('production editor works offline with sandbox and denied browser permissions', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await page.context().route(/^https?:\/\//, (route) => route.abort('internetdisconnected'))
    await page.reload()
    await expect(page.getByTestId('worker-status')).toHaveText('后台环境就绪')
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    // Read the custom-protocol response in Chromium; CDP navigation headers can omit it.
    const policy = await page.evaluate(async () =>
      (await fetch(location.href)).headers.get('content-security-policy'),
    )
    expect(policy).toContain("script-src 'self'")
    expect(policy).not.toContain('unsafe-eval')
    const boundary = await page.evaluate(async () => ({
      runtime: await window.desktop.getAppInfo(),
      require: typeof (window as unknown as Record<string, unknown>).require,
      permission: (await navigator.permissions.query({ name: 'geolocation' })).state,
    }))
    expect(boundary.runtime.sandboxed).toBe(true)
    expect(boundary.runtime.contextIsolated).toBe(true)
    expect(boundary.require).toBe('undefined')
    expect(boundary.permission).toBe('denied')
    await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.insertText('{"offline":true}')
    await expect(page.locator('.tree-key').filter({ hasText: /^offline$/ })).toBeVisible()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
  } finally {
    await closeApp(app)
  }
})

test('JSON HTML content stays literal and application protocol rejects unsafe resources', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    const html = '<img src=x onerror="window.jsonInjected=true">'
    await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.insertText(JSON.stringify({ html }))
    await page
      .locator('.tree-key')
      .filter({ hasText: /^html$/ })
      .click()
    await expect(page.getByRole('textbox', { name: '节点 JSON 值', exact: true })).toHaveValue(
      JSON.stringify(html),
    )
    await expect(page.locator('img')).toHaveCount(0)
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).jsonInjected),
    ).toBeUndefined()
    const statuses = await app.evaluate(async ({ net }) => {
      const requests: [string, string][] = [
        ['app://editor/%2e%2e%2fpackage.json', 'GET'],
        ['app://editor/%5cpackage.json', 'GET'],
        ['app://editor/index.html', 'POST'],
      ]
      return Promise.all(
        requests.map(async ([url, method]) => (await net.fetch(url, { method })).status),
      )
    })
    expect(statuses).toEqual([403, 403, 403])
  } finally {
    await closeApp(app)
  }
})
