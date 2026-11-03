import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { launchApp } from './launch-app'
import { closeApp } from './close-app'
import { advanced, closeNodeDialog, menuAction, nodeMenu, treeRow } from './tree-actions'

async function withTree(run: (page: Page) => Promise<void>): Promise<void> {
  const application = await launchApp()
  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await ready(page)
    await run(page)
    expect(errors).toEqual([])
  } finally {
    await closeApp(application)
  }
}
async function ready(page: Page): Promise<void> {
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
}
async function source(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
}
function key(page: Page, name: string) {
  return page
    .locator('.tree-key')
    .filter({ hasText: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') })
}

test('nested tree edits key/value atomically and shares text undo/redo', async () => {
  await withTree(async (page) => {
    await source(page, '{"object":{"name":"old","flag":false},"list":[1,true,null]}')
    await ready(page)
    await expect(page.getByTestId('tree-count')).toHaveText('8 个节点')
    await page.getByRole('button', { name: '展开 object', exact: true }).click()
    await key(page, 'name').click()
    await advanced(page, 'name')
    await page.getByRole('textbox', { name: '属性名', exact: true }).fill('renamed')
    await page.getByRole('textbox', { name: '节点 JSON 值', exact: true }).fill('"new 😀"')
    await page.getByRole('button', { name: '应用节点修改' }).click()
    await ready(page)
    await closeNodeDialog(page)
    await expect(key(page, 'renamed')).toBeVisible()
    await expect(treeRow(page, 'renamed').locator('.tree-preview')).toHaveText('"new 😀"')
    await expect(page.locator('.view-lines')).toContainText('"renamed"')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await ready(page)
    await expect(key(page, 'name')).toBeVisible()
    await expect(treeRow(page, 'name').locator('.tree-preview')).toHaveText('"old"')
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await ready(page)
    await expect(key(page, 'renamed')).toBeVisible()
    await menuAction(page, 'renamed', '转到代码', '更多')
    await expect(page.getByRole('textbox', { name: 'JSON 文本编辑器' })).toBeFocused()
  })
})

test('object and array insertion/deletion preserve untouched large numeric source', async () => {
  await withTree(async (page) => {
    await source(page, '{"keep":900719925474099312345,"items":[]}')
    await ready(page)
    await advanced(page, '$')
    await page.getByRole('textbox', { name: '新属性名', exact: true }).fill('fresh')
    await page.getByRole('combobox', { name: '新节点类型', exact: true }).selectOption('boolean')
    await page.getByRole('textbox', { name: '新节点 JSON 值', exact: true }).fill('true')
    await page.getByRole('button', { name: '新增子节点', exact: true }).click()
    await ready(page)
    await closeNodeDialog(page)
    await key(page, 'fresh').click()
    await menuAction(page, 'fresh', '移除')
    await ready(page)
    await expect(key(page, 'fresh')).toHaveCount(0)
    await key(page, 'items').click()
    await page.getByRole('button', { name: '展开 items', exact: true }).click()
    await advanced(page, 'items')
    await page.getByRole('combobox', { name: '新节点类型', exact: true }).selectOption('object')
    await page.getByRole('textbox', { name: '新节点 JSON 值', exact: true }).fill('{"x":1}')
    await page.getByRole('button', { name: '新增子节点', exact: true }).click()
    await ready(page)
    await closeNodeDialog(page)
    await expect(key(page, '[0]')).toBeVisible()
    await advanced(page, 'items')
    await page.getByRole('combobox', { name: '新节点类型', exact: true }).selectOption('number')
    await page.getByRole('textbox', { name: '新节点 JSON 值', exact: true }).fill('2')
    await page.getByRole('button', { name: '新增子节点', exact: true }).click()
    await ready(page)
    await closeNodeDialog(page)
    await expect(key(page, '[1]')).toBeVisible()
    await key(page, '[0]').click()
    await menuAction(page, '[0]', '移除')
    await ready(page)
    await expect(key(page, '[1]')).toHaveCount(0)
    await expect(key(page, '[0]')).toBeVisible()
    await expect(page.locator('.view-lines')).toContainText('900719925474099312345')
  })
})

test('all six node types can be applied without implicit number coercion', async () => {
  await withTree(async (page) => {
    await nodeMenu(page, '$')
    await expect(page.getByRole('menuitem', { name: '移除', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await source(page, '{"v":1}')
    await ready(page)
    await key(page, 'v').click()
    await advanced(page, 'v')
    for (const [type, value] of [
      ['boolean', 'true'],
      ['null', 'null'],
      ['object', '{"n":[true]}'],
      ['array', '[1,false,null]'],
      ['string', '"文字"'],
      ['number', '900719925474099312345'],
    ] as const) {
      await page.getByRole('combobox', { name: '节点类型', exact: true }).selectOption(type)
      await page.getByRole('textbox', { name: '节点 JSON 值', exact: true }).fill(value)
      await page.getByRole('button', { name: '应用节点修改' }).click()
      await ready(page)
      await expect(page.getByRole('combobox', { name: '节点类型', exact: true })).toHaveValue(type)
      await expect(page.getByRole('textbox', { name: '节点 JSON 值', exact: true })).toHaveValue(
        value,
      )
    }
  })
})

test('duplicate/stale trees are read-only and recover after valid text input', async () => {
  await withTree(async (page) => {
    await source(page, '{"a":1,"b":2}')
    await ready(page)
    await key(page, 'b').click()
    await advanced(page, 'b')
    await page.getByRole('textbox', { name: '属性名', exact: true }).fill('a')
    await page.getByRole('button', { name: '应用节点修改' }).click()
    await expect(page.getByRole('alert', { name: '节点操作错误' })).toContainText('同级已存在')
    await closeNodeDialog(page)
    await expect(key(page, 'b')).toBeVisible()
    await source(page, '{"broken":')
    await expect(page.getByTestId('json-status')).toHaveText(/JSON 校验未通过/)
    await expect(page.getByTestId('tree-status')).toContainText('树已过期')
    await expect(key(page, 'b')).toBeVisible()
    await expect(treeRow(page, 'b').locator('[data-edit-field="key"]')).toBeDisabled()
    await source(page, '{"a":1,"a":2}')
    await expect(page.getByTestId('tree-status')).toContainText('重复属性名')
    await expect(page.locator('[data-edit-field="key"]').first()).toBeDisabled()
    await source(page, '{"ok":true}')
    await ready(page)
    await expect(key(page, 'ok')).toBeVisible()
    await expect(treeRow(page, 'ok').locator('[data-edit-field="value"]')).toBeEnabled()
  })
})

test('deeply nested nodes remain reachable with horizontal scrolling', async () => {
  await withTree(async (page) => {
    let value: unknown = { leaf: true }
    for (let level = 19; level >= 0; level--) value = { [`level${level}`]: value }
    await source(page, JSON.stringify(value))
    await ready(page)
    for (let level = 0; level < 20; level++)
      await page.getByRole('button', { name: `展开 level${level}`, exact: true }).click()
    await key(page, 'leaf').click()
    await expect(treeRow(page, 'leaf').locator('.tree-preview')).toHaveText('true')
    expect(
      await page
        .locator('.tree-viewport')
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(true)
  })
})

test('the real normalized tree virtualizes large visible child lists', async () => {
  await withTree(async (page) => {
    await source(page, '[' + Array.from({ length: 2000 }, (_, index) => index).join(',') + ']')
    await ready(page)
    await expect(page.getByTestId('tree-count')).toHaveText('2,001 个节点')
    const rows = page.getByRole('treeitem')
    expect(await rows.count()).toBeLessThan(40)
    expect(await rows.count()).toBeGreaterThan(1)
    await page.getByRole('button', { name: '全部折叠', exact: true }).click()
    await expect(rows).toHaveCount(1)
    await page.getByRole('button', { name: '展开根节点', exact: true }).click()
    await expect.poll(() => rows.count()).toBeGreaterThan(1)
    expect(await rows.count()).toBeLessThan(40)
    await key(page, '$').click()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.json-tree-row.selected .tree-preview')).toHaveText('0')
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.json-tree-row.selected .tree-preview')).toHaveText('1')
  })
})
