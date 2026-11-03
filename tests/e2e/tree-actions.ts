import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
export function treeRow(page: Page, key: string) {
  return page.locator('.json-tree-row').filter({
    has: page
      .locator('.tree-key')
      .filter({ hasText: new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }),
  })
}
export async function nodeMenu(page: Page, key: string) {
  await treeRow(page, key).locator('.tree-drag-handle').click()
  await expect(page.getByRole('menu', { name: '节点菜单', exact: true })).toBeVisible()
}
export async function dragNode(page: Page, from: string, to: string, inside = false) {
  const handle = treeRow(page, from).locator('.tree-drag-handle')
  const start = (await handle.boundingBox())!
  const target = treeRow(page, to)
  const box = (await target.boundingBox())!
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down({ button: 'right' })
  try {
    await page.mouse.move(box.x + 100, box.y + (inside ? box.height / 2 : box.height - 2), {
      steps: 10,
    })
    await expect(page.locator('.tree-viewport')).toHaveAttribute('data-handle-dragging', 'true')
    if (inside) await expect(target).toHaveAttribute('data-pointer-drop', 'inside')
  } finally {
    await page.mouse.up({ button: 'right' })
  }
}
export async function menuAction(page: Page, key: string, name: string, group?: '更多' | '类型') {
  await nodeMenu(page, key)
  if (group) await page.getByRole('menuitem', { name: group, exact: true }).click()
  await page
    .getByRole(group === '类型' ? 'menuitemradio' : 'menuitem', { name, exact: true })
    .click()
}
export async function advanced(page: Page, key: string) {
  await menuAction(page, key, '完整 JSON 编辑…', '更多')
  await expect(page.getByRole('dialog', { name: '完整 JSON 编辑', exact: true })).toBeVisible()
}
export async function closeNodeDialog(page: Page) {
  await page.getByRole('button', { name: '关闭节点操作' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
export async function inlineValue(page: Page, key: string, value: string) {
  await treeRow(page, key).locator('[data-edit-field="value"]').click()
  const input = page.getByRole('textbox', { name: '行内值' })
  await input.fill(value)
  await input.press('ControlOrMeta+Enter')
  await expect(input).toHaveCount(0)
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
}
