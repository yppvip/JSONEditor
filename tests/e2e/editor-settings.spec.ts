import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { launchApp } from './launch-app'
import { closeApp } from './close-app'
import { treeRow, dragNode } from './tree-actions'

const dialog = (page: Page) => page.getByRole('dialog', { name: '编辑器设置' })
async function open(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(dialog(page)).toBeVisible()
}
async function fonts(page: Page, tree: number, code: number) {
  await expect(page.locator('.json-tree-row').first()).toHaveCSS('font-size', `${tree}px`)
  await expect(page.locator('.view-lines')).toHaveCSS('font-size', `${code}px`)
}
async function source(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
}

test('independent font changes preserve the editor, document and undo history; validation and reset work', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    const initial = await page.getByTestId('document-name').textContent()
    const editor = await page.locator('.monaco-editor').elementHandle()
    await open(page)
    const tree = page.getByRole('spinbutton', { name: '树文本大小', exact: true })
    const code = page.getByRole('spinbutton', { name: '代码文本大小', exact: true })
    await expect(tree).toBeFocused()
    await tree.fill('24')
    await fonts(page, 24, 14)
    for (const value of ['', '9', '25', '12.5']) {
      await code.fill(value)
      await expect(code).toHaveAttribute('aria-invalid', 'true')
      await fonts(page, 24, 14)
    }
    await code.fill('18')
    await fonts(page, 24, 18)
    // Native modal focus stays inside even across the boundary in both directions.
    await page.getByRole('button', { name: '完成', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(dialog(page).getByRole('button', { name: '关闭设置' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('button', { name: '完成', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: '设置', exact: true })).toBeFocused()
    expect(await editor!.evaluate((element) => element.isConnected)).toBe(true)
    await expect(page.getByTestId('document-name')).toHaveText(initial!)
    await source(page, '{"a":1,"b":2,"c":3}')
    await open(page)
    await code.fill('24')
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await expect(dialog(page)).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('before-drag.png') })
    await dragNode(page, 'a', 'c')
    await expect
      .poll(() => page.locator('.tree-key').allTextContents())
      .toEqual(['$', 'b', 'c', 'a'])
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect
      .poll(() => page.locator('.tree-key').allTextContents())
      .toEqual(['$', 'a', 'b', 'c'])
    await fonts(page, 24, 24)
    await treeRow(page, 'a').locator('[data-edit-field="value"]').click()
    await expect(page.getByRole('textbox', { name: '行内值' })).toHaveCSS('font-size', '24px')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await expect
      .poll(() => page.locator('.tree-key').allTextContents())
      .toEqual(['$', 'b', 'c', 'a'])
    await open(page)
    await page.getByRole('button', { name: '恢复默认', exact: true }).click()
    await expect(tree).toHaveValue('12')
    await expect(code).toHaveValue('14')
    await fonts(page, 12, 14)
  } finally {
    await closeApp(app)
  }
})

test('font preferences survive a new document, swapping panes and restarting', async () => {
  let app = await launchApp()
  try {
    let page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await open(page)
    await page.getByRole('spinbutton', { name: '树文本大小', exact: true }).fill('20')
    await page.getByRole('spinbutton', { name: '代码文本大小', exact: true }).fill('22')
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await page.getByRole('button', { name: '交换左右位置', exact: true }).click()
    await page.getByRole('button', { name: '新建', exact: true }).click()
    await fonts(page, 20, 22)
    await closeApp(app)
    app = await launchApp()
    page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await fonts(page, 20, 22)
    await open(page)
    await expect(page.getByRole('spinbutton', { name: '树文本大小', exact: true })).toHaveValue(
      '20',
    )
    await expect(page.getByRole('spinbutton', { name: '代码文本大小', exact: true })).toHaveValue(
      '22',
    )
  } finally {
    await closeApp(app)
  }
})

test('opening files retains fonts, and changing row height preserves the virtual scroll anchor', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await open(page)
    await page.getByRole('spinbutton', { name: '代码文本大小', exact: true }).fill('20')
    await page.getByRole('button', { name: '完成', exact: true }).click()
    const file = test.info().outputPath('fonts.json')
    await writeFile(file, JSON.stringify(Array.from({ length: 1000 }, (_, index) => index)))
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, file)
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await expect(page.getByTestId('document-name')).toHaveText('fonts.json')
    await fonts(page, 12, 20)
    await page.getByRole('tree').evaluate((element) => {
      const list = [...element.querySelectorAll<HTMLElement>('*')].find(
        (child) =>
          getComputedStyle(child).overflowY === 'auto' && child.scrollHeight > child.clientHeight,
      )!
      list.scrollTop = 600
    })
    await expect(treeRow(page, '[0]')).toHaveCount(0)
    const visibleKey = () =>
      page.locator('.tree-viewport').evaluate((area) => {
        const bounds = area.getBoundingClientRect()
        return [...area.querySelectorAll<HTMLElement>('.json-tree-row')]
          .find((row) => row.getBoundingClientRect().bottom > bounds.top)
          ?.querySelector('.tree-key')?.textContent
      })
    const before = await visibleKey()
    await open(page)
    await page.getByRole('spinbutton', { name: '树文本大小', exact: true }).fill('24')
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await expect.poll(visibleKey).toBe(before)
    await fonts(page, 24, 20)
    await expect(page.getByTestId('document-name')).toHaveText('fonts.json')
    expect(await page.getByRole('treeitem').count()).toBeLessThan(40)
  } finally {
    await closeApp(app)
  }
})

test('damaged and unavailable storage do not prevent adjusting fonts for the current session', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await page.evaluate(() => localStorage.setItem('jsoneditor.editor-preferences.v1', '{'))
    await page.reload()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await fonts(page, 12, 14)
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new Error('storage unavailable')
      }
    })
    await open(page)
    await page.getByRole('spinbutton', { name: '树文本大小', exact: true }).fill('10')
    await page.getByRole('spinbutton', { name: '代码文本大小', exact: true }).fill('24')
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await fonts(page, 10, 24)
    await page.getByRole('button', { name: '新建', exact: true }).click()
    await fonts(page, 10, 24)
    expect(errors).toEqual([])
  } finally {
    await closeApp(app)
  }
})

for (const scale of [1, 1.25, 1.5]) {
  test(`maximum fonts and settings fit desktop and minimum windows at ${scale * 100}% device scale`, async () => {
    const app = await launchApp({ deviceScaleFactor: scale })
    try {
      const page = await app.firstWindow()
      await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
      await source(page, '{"":"","name":"中文内容","items":[1,2]}')
      for (const [width, height] of [
        [1100, 760],
        [640, 480],
      ] as const) {
        await app.evaluate(
          ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(...size),
          [width, height] as [number, number],
        )
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
        await open(page)
        await page.getByRole('spinbutton', { name: '树文本大小', exact: true }).fill('24')
        await page.getByRole('spinbutton', { name: '代码文本大小', exact: true }).fill('24')
        const box = (await dialog(page).boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
        expect(box.y + box.height).toBeLessThanOrEqual(height)
        await page.screenshot({ path: test.info().outputPath(`settings-${width}.png`) })
        await page.getByRole('button', { name: '完成', exact: true }).click()
        await fonts(page, 24, 24)
        const row = treeRow(page, 'name')
        expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        await row.locator('[data-edit-field="value"]').click()
        await expect(page.getByRole('textbox', { name: '行内值' })).toHaveCSS('font-size', '24px')
        const input = (await page.getByRole('group', { name: '树行编辑' }).boundingBox())!
        expect(input.y + input.height).toBeLessThanOrEqual(height)
        await page.screenshot({ path: test.info().outputPath(`maximum-fonts-${width}.png`) })
        await page.keyboard.press('Escape')
      }
    } finally {
      await closeApp(app)
    }
  })
}
