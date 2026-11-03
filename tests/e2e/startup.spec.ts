import { expect, test } from '@playwright/test'
import { launchApp } from './launch-app'
import { closeApp } from './close-app'

test('local application loads with isolated IPC and a working bundled Worker', async () => {
  const application = await launchApp()
  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('toolbar', { name: '文件与文本操作' })).toBeVisible()
    await page.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('button', { name: '关于 JSONEditor' }).click()
    await expect(page.getByRole('status', { name: '桌面连接' })).toHaveText(/桌面连接正常/)
    await page.getByRole('button', { name: '关闭操作面板' }).click()
    await expect(page.getByTestId('worker-status')).toHaveText('后台环境就绪')
    expect(page.url()).toBe('app://editor/index.html')
    const boundary = await page.evaluate(() => ({
      require: typeof (window as unknown as Record<string, unknown>).require,
      process: typeof (window as unknown as Record<string, unknown>).process,
      methods: Object.keys(window.desktop),
    }))
    expect(boundary).toEqual({
      require: 'undefined',
      process: 'undefined',
      methods: [
        'getAppInfo',
        'openFile',
        'getRecentFiles',
        'openRecent',
        'saveFile',
        'releaseFile',
        'confirmUnsaved',
        'readClipboard',
        'writeClipboard',
        'onAction',
        'onCloseRequested',
        'replyClose',
      ],
    })
    const runtime = await page.evaluate(() => window.desktop.getAppInfo())
    expect(runtime.sandboxed).toBe(true)
    expect(runtime.contextIsolated).toBe(true)
    expect(await page.evaluate(() => window.open('https://example.com') === null)).toBe(true)
    expect(errors).toEqual([])
    await page.screenshot({ path: 'test-results/phase6-editor.png' })
  } finally {
    await closeApp(application)
  }
})
