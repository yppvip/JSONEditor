import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { launchApp } from './launch-app'
import { closeApp } from './close-app'

async function runEditor(run: (page: Page) => Promise<void>): Promise<void> {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await ready(page)
    await run(page)
    expect(errors).toEqual([])
  } finally {
    await closeApp(app)
  }
}
async function ready(page: Page): Promise<void> {
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
}
async function source(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
  await ready(page)
}
function row(page: Page, key: string) {
  return page.locator('.json-tree-row').filter({
    has: page
      .locator('.tree-key')
      .filter({ hasText: new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }),
  })
}
async function keys(page: Page): Promise<string[]> {
  return page.locator('.tree-key').allTextContents()
}

async function dragHtml5(page: Page, from: string, to: string, inside = false): Promise<void> {
  const handle = row(page, from).locator('.tree-drag-handle')
  const target = row(page, to).locator('..')
  const box = (await target.boundingBox())!
  const transfer = await page.evaluateHandle(() => new DataTransfer())
  try {
    await handle.dispatchEvent('dragstart', { dataTransfer: transfer })
    const event = {
      dataTransfer: transfer,
      clientX: box.x + 100,
      clientY: box.y + (inside ? box.height / 2 : box.height - 2),
    }
    await target.dispatchEvent('dragenter', event)
    await target.dispatchEvent('dragover', event)
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    )
    await target.dispatchEvent('dragover', event)
    if (inside) await expect(row(page, to)).toHaveClass(/drop-target/)
    await target.dispatchEvent('drop', event)
    // The source may have a new label or live inside a collapsed container after a move.
    await page.locator('[role="tree"]').dispatchEvent('dragend', { dataTransfer: transfer })
  } finally {
    await transfer.dispose()
  }
}

test('move buttons and sort preserve property IDs and share the text undo history', async () => {
  await runEditor(async (page) => {
    await source(page, '{"z":900719925474099312345,"a":-0,"m":1e9}')
    await row(page, 'z').click()
    const id = await row(page, 'z').getAttribute('data-node-id')
    await page.getByRole('button', { name: '下移节点', exact: true }).click()
    await ready(page)
    expect(await keys(page)).toEqual(['$', 'a', 'z', 'm'])
    await expect(row(page, 'z')).toHaveAttribute('data-node-id', id!)
    await row(page, '$').click()
    await page.getByRole('button', { name: '子节点升序', exact: true }).click()
    await ready(page)
    expect(await keys(page)).toEqual(['$', 'a', 'm', 'z'])
    await expect(row(page, 'z')).toHaveAttribute('data-node-id', id!)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await ready(page)
    expect(await keys(page)).toEqual(['$', 'a', 'z', 'm'])
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await ready(page)
    expect(await keys(page)).toEqual(['$', 'z', 'a', 'm'])
    await expect(page.locator('.view-lines')).toContainText('900719925474099312345')
  })
})

test('cross-container move form preserves a subtree, prevents cycles and rejects name conflicts', async () => {
  await runEditor(async (page) => {
    await source(page, '{"from":{"child":true},"target":{"child":false},"items":[]}')
    await row(page, 'from').click()
    await page.getByRole('textbox', { name: '移动目标 JSON Pointer' }).fill('/from')
    await page.getByRole('button', { name: '移动节点', exact: true }).click()
    await expect(page.getByRole('alert', { name: '节点操作错误' })).toContainText('自身或后代')
    await page.getByRole('button', { name: '展开 from', exact: true }).click()
    await row(page, 'child').click()
    const id = await row(page, 'child').getAttribute('data-node-id')
    await page.getByRole('textbox', { name: '移动目标 JSON Pointer' }).fill('/target')
    await page.getByRole('button', { name: '移动节点', exact: true }).click()
    await expect(page.getByRole('alert', { name: '节点操作错误' })).toContainText('已存在')
    await page.getByRole('textbox', { name: '移动目标 JSON Pointer' }).fill('/items')
    await page.getByRole('button', { name: '移动节点', exact: true }).click()
    await ready(page)
    await page.getByRole('button', { name: '展开 items', exact: true }).click()
    await expect(row(page, '[0]')).toHaveAttribute('data-node-id', id!)
    await row(page, '[0]').click()
    await page.getByRole('textbox', { name: '移动目标 JSON Pointer' }).fill('/target')
    await page.getByRole('textbox', { name: '移动目标属性名' }).fill('moved')
    await page.getByRole('button', { name: '移动节点', exact: true }).click()
    await ready(page)
    await page.getByRole('button', { name: '展开 target', exact: true }).click()
    await expect(row(page, 'moved')).toHaveAttribute('data-node-id', id!)
    await expect(page.getByRole('textbox', { name: '节点 JSON 值', exact: true })).toHaveValue(
      'true',
    )
  })
})

test('HTML5 drag events reorder siblings and undo restores their identities', async () => {
  await runEditor(async (page) => {
    await source(page, '{"a":1,"b":2,"c":3}')
    const id = await row(page, 'a').getAttribute('data-node-id')
    await dragHtml5(page, 'a', 'c')
    await expect.poll(() => keys(page)).toEqual(['$', 'b', 'c', 'a'])
    await ready(page)
    await expect(row(page, 'a')).toHaveAttribute('data-node-id', id!)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await ready(page)
    expect(await keys(page)).toEqual(['$', 'a', 'b', 'c'])
  })
})

test('HTML5 cross-container drop keeps the subtree ID and opens its destination', async () => {
  await runEditor(async (page) => {
    await source(page, '{"a":{"x":1},"items":[],"other":{}}')
    const id = await row(page, 'a').getAttribute('data-node-id')
    await dragHtml5(page, 'a', 'items', true)
    await ready(page)
    await expect(row(page, '[0]')).toHaveAttribute('data-node-id', id!)
    await page.getByRole('button', { name: '展开 [0]', exact: true }).click()
    await expect(row(page, 'x')).toBeVisible()
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await ready(page)
    await expect(row(page, 'a')).toHaveAttribute('data-node-id', id!)
  })
})

test('exact numeric sort keeps large numbers, and invalid text disables structural actions', async () => {
  await runEditor(async (page) => {
    await source(page, '[900719925474099312346,900719925474099312345,-0,1e999]')
    await page.getByRole('button', { name: '子节点升序', exact: true }).click()
    await ready(page)
    await row(page, '[0]').click()
    await expect(page.getByRole('textbox', { name: '节点 JSON 值', exact: true })).toHaveValue('-0')
    await row(page, '[1]').click()
    await expect(page.getByRole('textbox', { name: '节点 JSON 值', exact: true })).toHaveValue(
      '900719925474099312345',
    )
    await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.insertText('{')
    await expect(page.getByTestId('tree-status')).toContainText('树已过期')
    await expect(page.getByRole('button', { name: '上移节点', exact: true })).toBeDisabled()
    await expect(page.locator('.tree-drag-handle')).toHaveCount(0)
  })
})
