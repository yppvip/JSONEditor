import { _electron as electron, expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { resolve } from 'node:path'
import { closeApp } from './close-app'

async function withEditor(run: (page: Page) => Promise<void>): Promise<void> {
  const executablePath = process.env.JSONEDITOR_EXECUTABLE
  const application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve('.')],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByTestId('json-status')).toHaveText(/^JSON 有效/)
    const resources = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => entry.name),
    )
    expect(resources.every((url) => url.startsWith('app://editor/'))).toBe(true)
    await run(page)
    expect(errors).toEqual([])
  } finally {
    await closeApp(application)
  }
}

async function replaceText(page: Page, text: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'JSON 文本编辑器' })
  await input.focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
}

test('real Monaco highlights JSON and formats without losing number lexemes; undo and redo work', async () => {
  await withEditor(async (page) => {
    await expect
      .poll(() =>
        page
          .locator('.view-lines span')
          .evaluateAll(
            (elements) =>
              new Set(
                elements.map((element) => element.className).filter((name) => /^mtk\d+/.test(name)),
              ).size,
          ),
      )
      .toBeGreaterThan(1)
    await replaceText(
      page,
      '{"large":9007199254740993123456789,"negative":-0,"exponent":1.2300e+02}',
    )
    await expect(page.getByTestId('json-status')).toHaveText(/^JSON 有效/)
    const lines = page.locator('.view-lines > .view-line')
    await expect(lines).toHaveCount(1)
    await page.getByRole('button', { name: '格式化', exact: true }).click()
    await expect(lines).toHaveCount(5)
    await expect(page.locator('.view-lines')).toContainText('9007199254740993123456789')
    await expect(page.locator('.view-lines')).toContainText('1.2300e+02')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(lines).toHaveCount(1)
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await expect(lines).toHaveCount(5)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(lines).toHaveCount(1)
    await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus()
    await page.keyboard.press('ControlOrMeta+Shift+F')
    await expect(lines).toHaveCount(5)
  })
})

test('invalid text is retained, errors focus the exact line, and duplicate keys remain warnings', async () => {
  await withEditor(async (page) => {
    await replaceText(page, '{\n  "中文😀": 1,\n  "broken": @\n}')
    await expect(page.getByTestId('json-status')).toHaveText(/JSON 校验未通过/)
    const problem = page.getByRole('button', { name: /第 3 行，第 13 列：存在非法字符/ })
    await expect(problem).toBeVisible()
    await problem.click()
    await expect(page.getByRole('textbox', { name: 'JSON 文本编辑器' })).toBeFocused()
    const before = await page.locator('.view-lines').innerText()
    await page.getByRole('button', { name: '格式化', exact: true }).click()
    await expect(page.getByTestId('json-status')).toHaveText(/JSON 校验未通过/)
    expect(await page.locator('.view-lines').innerText()).toBe(before)
    await replaceText(page, '{"a":1,"a":2}')
    await expect(page.getByTestId('json-status')).toHaveText('JSON 有效 · 1 个警告')
    await expect(page.getByRole('button', { name: /重复属性名/ })).toBeVisible()
  })
})

test('large documents use explicit background validation', async () => {
  await withEditor(async (page) => {
    const input = page.getByRole('textbox', { name: 'JSON 文本编辑器' })
    await input.focus()
    await page.keyboard.press('ControlOrMeta+A')
    // Exercise Monaco's bulk paste path without reading or changing the OS clipboard.
    await input.evaluate(
      (node, text) => {
        const data = new DataTransfer()
        data.setData('text/plain', text)
        node.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        )
      },
      '"' + 'x'.repeat(2 * 1024 * 1024) + '"',
    )
    await expect(page.getByText(/大文件模式：已暂停自动校验/)).toBeVisible()
    await expect(page.getByTestId('json-status')).toHaveText('等待手动校验')
    await page.getByRole('button', { name: '校验', exact: true }).click()
    await expect(page.getByTestId('json-status')).toHaveText(/^JSON 有效/)
  })
})
