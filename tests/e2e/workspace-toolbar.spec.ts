import { expect, test } from '@playwright/test'
import { launchApp } from './launch-app'
import { closeApp } from './close-app'

test('compact toolbar fits desktop and minimum windows; overflow actions remain keyboard accessible', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('json-status')).toHaveText(/^JSON 有效/)
    for (const [width, height] of [
      [1100, 760],
      [640, 480],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height)
        },
        { width: width!, height: height! },
      )
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
      const toolbar = page.getByRole('toolbar', { name: '文件与文本操作' })
      const bounds = await toolbar.boundingBox()
      const buttons = await Promise.all(
        ['新建', '打开', '保存', '格式化', '校验'].map(async (name) => {
          const button = toolbar.getByRole('button', { name, exact: true })
          await expect(button).toBeVisible()
          return button.boundingBox()
        }),
      )
      for (const button of buttons) {
        expect(button!.y).toBe(buttons[0]!.y)
        expect(button!.x).toBeGreaterThanOrEqual(0)
        expect(button!.x + button!.width).toBeLessThanOrEqual(width!)
      }
      expect(bounds!.height).toBeLessThanOrEqual(34)
      const layout = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        viewportHeight: innerHeight,
      }))
      expect(layout.width).toBeLessThanOrEqual(width!)
      expect(layout.height).toBeLessThanOrEqual(layout.viewportHeight)
      await page.screenshot({ path: test.info().outputPath(`workspace-${width}.png`) })
    }
    const more = page.getByRole('button', { name: '更多操作', exact: true })
    await more.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: '另存为', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(more).toBeFocused()
    await expect(page.getByRole('region', { name: '更多操作' })).toHaveCount(0)
    await page.getByRole('button', { name: '复制选项', exact: true }).click()
    await expect(page.getByRole('button', { name: '复制原文', exact: true })).toBeVisible()
    await page.getByTestId('tree-status').click()
    await expect(page.getByRole('region', { name: '复制选项' })).toHaveCount(0)
    await more.click()
    await page.getByRole('button', { name: '关于 JSONEditor', exact: true }).click()
    await expect(page.getByRole('status', { name: '桌面连接' })).toContainText('桌面连接正常')
  } finally {
    await closeApp(app)
  }
})
