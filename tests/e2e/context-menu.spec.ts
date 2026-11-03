import { expect, test } from '@playwright/test'
import { launchApp } from './launch-app'
import { closeApp } from './close-app'
import { treeRow, nodeMenu, menuAction } from './tree-actions'
import type { Page } from '@playwright/test'
async function source(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'JSON 文本编辑器' })
  await input.focus()
  await page.keyboard.press('ControlOrMeta+A')
  await input.evaluate((element, value) => {
    const data = new DataTransfer()
    data.setData('text/plain', value)
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  }, text)
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
}
test('menu creates automatic siblings above/below, copies with unique keys, removes and undoes once', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await source(page, '{"a":900719925474099312345,"last":true}')
    await expect(page.locator('.tree-pane .tree-form, .tree-pane .tree-path')).toHaveCount(0)
    await menuAction(page, 'a', '追加')
    const input = page.getByRole('textbox', { name: '行内属性名' })
    await expect(input).toBeFocused()
    await input.press('Escape')
    expect(await page.locator('.tree-key').allTextContents()).toEqual(['$', 'a', 'key', 'last'])
    await expect(treeRow(page, 'key').locator('.tree-type')).toHaveAttribute('data-mode', 'auto')
    await menuAction(page, 'a', '插入')
    await input.press('Escape')
    expect(await page.locator('.tree-key').allTextContents()).toEqual([
      '$',
      'key1',
      'a',
      'key',
      'last',
    ])
    await menuAction(page, 'a', '复制节点')
    await expect(treeRow(page, 'a1').locator('.tree-preview')).toHaveText('900719925474099312345')
    await menuAction(page, 'a1', '移除')
    await expect(treeRow(page, 'a1')).toHaveCount(0)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(treeRow(page, 'a1')).toBeVisible()
  } finally {
    await closeApp(app)
  }
})
test('container conversion creates one automatic child, starts editing, and preserves root restrictions', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await source(page, '{"value":123}')
    await menuAction(page, 'value', '字符串', '类型')
    await expect(treeRow(page, 'value').locator('.tree-preview')).toHaveText('"123"')
    await menuAction(page, 'value', '数组', '类型')
    await expect(page.getByRole('textbox', { name: '行内值' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(treeRow(page, '[0]').locator('.tree-type')).toHaveAttribute('data-mode', 'auto')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(treeRow(page, 'value').locator('.tree-preview')).toHaveText('"123"')
    await nodeMenu(page, '$')
    for (const name of ['追加', '插入', '复制节点', '移除'])
      await expect(page.getByRole('menuitem', { name, exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(treeRow(page, '$').locator('.tree-drag-handle')).toBeFocused()
    await expect(treeRow(page, '$').locator('.tree-drag-handle')).toHaveAttribute(
      'data-can-drag',
      'false',
    )
  } finally {
    await closeApp(app)
  }
})
test('keyboard submenus, dismissal, boundary placement and readonly actions work at minimum size', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await source(page, '{"a":1}')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(640, 480))
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    const handle = treeRow(page, 'a').locator('.tree-drag-handle')
    await treeRow(page, 'a').locator('..').focus()
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menuitem', { name: '类型', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('menuitemradio', { name: '自动', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(treeRow(page, 'a').locator('.tree-type')).toHaveAttribute('data-mode', 'string')
    await handle.evaluate((element) =>
      element.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 620,
          clientY: 440,
        }),
      ),
    )
    await page.getByRole('menuitem', { name: '更多', exact: true }).click()
    for (const name of ['节点菜单', '更多节点操作']) {
      const rect = (await page.getByRole('menu', { name, exact: true }).boundingBox())!
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
      expect(rect.y + rect.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
    }
    await page.screenshot({ path: test.info().outputPath('node-menu.png') })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitem', { name: '更多', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(handle).toBeFocused()
    const input = page.getByRole('textbox', { name: 'JSON 文本编辑器' })
    await input.focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.insertText('{"a":1,"a":2}')
    await expect(page.getByTestId('tree-status')).toContainText('重复属性名')
    await nodeMenu(page, '$')
    await expect(page.getByRole('menuitem', { name: '类型', exact: true })).toBeDisabled()
    await expect(page.getByRole('menuitem', { name: '添加子节点', exact: true })).toBeDisabled()
    await page.mouse.click(600, 70)
    await expect(page.getByRole('menu', { name: '节点菜单', exact: true })).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('dragging near a viewport edge scrolls virtual rows and ends without changing source', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await source(page, JSON.stringify(Array.from({ length: 1000 }, (_, i) => i)))
    const transfer = await page.evaluateHandle(() => new DataTransfer())
    const handle = treeRow(page, '[0]').locator('.tree-drag-handle')
    await handle.dispatchEvent('dragstart', { dataTransfer: transfer })
    const viewport = page.locator('.tree-viewport'),
      box = (await viewport.boundingBox())!
    await viewport.dispatchEvent('dragover', {
      dataTransfer: transfer,
      clientX: box.x + 50,
      clientY: box.y + box.height - 5,
    })
    await expect
      .poll(() =>
        page.getByRole('tree').evaluate((element) => {
          const scroll = [...element.querySelectorAll<HTMLElement>('*')].find(
            (child) =>
              getComputedStyle(child).overflowY === 'auto' &&
              child.scrollHeight > child.clientHeight,
          )
          return scroll?.scrollTop ?? 0
        }),
      )
      .toBeGreaterThan(0)
    await viewport.dispatchEvent('dragend', { dataTransfer: transfer })
    await transfer.dispose()
    await expect(page.getByTestId('tree-count')).toHaveText('1,001 个节点')
    await expect(page.locator('.view-lines')).toContainText('998,999')
  } finally {
    await closeApp(app)
  }
})

test('native left-button handle drag has a movement threshold and reorders siblings', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await source(page, '{"a":1,"b":2,"c":3}')
    const from = (await treeRow(page, 'a').locator('.tree-drag-handle').boundingBox())!
    const to = (await treeRow(page, 'c').locator('..').boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down({ button: 'left' })
    await page.mouse.move(from.x + from.width / 2 + 2, from.y + from.height / 2)
    await expect(treeRow(page, 'a').first()).toHaveAttribute('data-dragging', 'false')
    await page.mouse.move(to.x + 100, to.y + to.height - 2, { steps: 10 })
    await page.mouse.up({ button: 'left' })
    await expect
      .poll(() => page.locator('.tree-key').allTextContents())
      .toEqual(['$', 'b', 'c', 'a'])
    expect(
      await treeRow(page, 'a')
        .locator('[data-edit-field="value"]')
        .evaluate((element) => (element as HTMLButtonElement).draggable),
    ).toBe(false)
  } finally {
    await closeApp(app)
  }
})
