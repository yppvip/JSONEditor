import { expect, test } from '@playwright/test'
import { launchApp } from './launch-app'
import { closeApp } from './close-app'
import { nodeMenu, treeRow } from './tree-actions'

test('hover groups expand without stealing focus, allow crossing the gap and execute a submenu command', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await nodeMenu(page, 'message')
    const type = page.getByRole('menuitem', { name: '类型', exact: true })
    const more = page.getByRole('menuitem', { name: '更多', exact: true })
    const submenu = page.getByRole('menu', { name: '类型菜单', exact: true })
    await type.hover()
    await expect(submenu).toBeVisible()
    await expect(type).toBeFocused()
    const a = (await type.boundingBox())!,
      b = (await submenu.boundingBox())!
    await page.mouse.move(
      b.x > a.x ? (a.x + a.width + b.x) / 2 : (b.x + b.width + a.x) / 2,
      a.y + a.height / 2,
    )
    // Deliberately spend part of the closing grace period in the gap.
    await page.waitForTimeout(100)
    await page.getByRole('menuitemradio', { name: '字符串', exact: true }).hover()
    await page.waitForTimeout(250)
    await expect(submenu).toBeVisible()
    await expect(type).toBeFocused()
    await page.getByRole('menuitemradio', { name: '字符串', exact: true }).click()
    await expect(treeRow(page, 'message').locator('.tree-type')).toHaveAttribute(
      'data-mode',
      'string',
    )

    await nodeMenu(page, 'message')
    await type.hover()
    await expect(submenu).toBeVisible()
    await more.hover()
    await expect(page.getByRole('menu', { name: '更多节点操作', exact: true })).toBeVisible()
    await expect(submenu).toHaveCount(0)
    await page.getByRole('menuitem', { name: '追加', exact: true }).hover()
    await expect(page.getByRole('menu', { name: '更多节点操作', exact: true })).toHaveCount(0)
    await expect(page.getByRole('menu', { name: '节点菜单', exact: true })).toBeVisible()
    await type.hover()
    await expect(submenu).toBeVisible()
    await page.mouse.move(600, 70)
    await expect(submenu).toHaveCount(0)
    await expect(page.getByRole('menu', { name: '节点菜单', exact: true })).toBeVisible()
    await page.mouse.click(600, 70)
    await expect(page.getByRole('menu')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('hover submenus flip at minimum size and remain compatible with keyboard and readonly menus', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(640, 480),
    )
    await treeRow(page, 'message')
      .locator('.tree-drag-handle')
      .evaluate((element) =>
        element.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            detail: 1,
            clientX: innerWidth - 2,
            clientY: innerHeight - 2,
          }),
        ),
      )
    const type = page.getByRole('menuitem', { name: '类型', exact: true })
    const submenu = page.getByRole('menu', { name: '类型菜单', exact: true })
    await type.hover()
    await expect(submenu).toBeVisible()
    const box = (await submenu.boundingBox())!,
      trigger = (await type.boundingBox())!
    expect(box.x).toBeLessThan(trigger.x)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(480)
    await page.screenshot({ path: test.info().outputPath('hover-submenu-left.png') })
    await type.press('ArrowRight')
    await expect(page.getByRole('menuitemradio', { name: '自动', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(submenu).toHaveCount(0)
    await expect(type).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitemradio', { name: '自动', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    const source = page.getByRole('textbox', { name: 'JSON 文本编辑器' })
    await source.focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.insertText('{"a":1,"a":2}')
    await expect(page.getByTestId('tree-status')).toContainText('重复属性名')
    await nodeMenu(page, '$')
    await expect(type).toBeDisabled()
    await type.hover()
    await page.waitForTimeout(150)
    await expect(submenu).toHaveCount(0)
    await page.getByRole('menuitem', { name: '更多', exact: true }).hover()
    await expect(page.getByRole('menu', { name: '更多节点操作', exact: true })).toBeVisible()
  } finally {
    await closeApp(app)
  }
})
