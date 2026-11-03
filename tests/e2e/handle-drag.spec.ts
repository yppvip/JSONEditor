import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { launchApp } from './launch-app'
import { closeApp } from './close-app'
import { treeRow, dragNode } from './tree-actions'

async function source(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
}
async function start(page: Page, from: string, to: string, inside = false) {
  await treeRow(page, from).locator('.tree-drag-handle').hover()
  await page.mouse.down({ button: 'right' })
  const box = (await treeRow(page, to).boundingBox())!
  await page.mouse.move(box.x + 100, box.y + (inside ? box.height / 2 : box.height - 2), {
    steps: 10,
  })
  await expect(page.locator('.tree-viewport')).toHaveAttribute('data-handle-dragging', 'true')
}
async function clean(page: Page) {
  await expect(
    page.locator(
      '.tree-drag-hint, .handle-drop-cursor, [data-pointer-drop], [data-handle-dragging], [data-dragging="true"]',
    ),
  ).toHaveCount(0)
  await expect(page.getByRole('menu', { name: '节点菜单', exact: true })).toHaveCount(0)
}

test('invalid right-button drops reject cycles, conflicting keys and array-to-object moves', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    const text = '{"branch":{"child":{}},"target":{"branch":2},"items":[1]}'
    await source(page, text)
    await page.getByRole('button', { name: '展开 branch', exact: true }).click()
    await page.getByRole('button', { name: '展开 items', exact: true }).click()
    const before = await page.locator('.tree-key').allTextContents()
    for (const [from, to] of [
      ['branch', 'child'],
      ['branch', 'target'],
      ['[0]', 'target'],
    ] as const) {
      await start(page, from, to, true)
      await expect(treeRow(page, to)).toHaveAttribute('data-pointer-drop', 'invalid')
      await expect(page.locator('.tree-drag-hint')).toHaveAttribute('data-valid', 'false')
      await page.screenshot({
        path: test.info().outputPath(`invalid-${from.replace(/\W/g, '')}.png`),
      })
      await page.mouse.up({ button: 'right' })
      await clean(page)
      expect(await page.locator('.tree-key').allTextContents()).toEqual(before)
    }
    await treeRow(page, '$').locator('.tree-drag-handle').hover()
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(200, 250, { steps: 10 })
    await page.mouse.up({ button: 'right' })
    await clean(page)
    expect(await page.locator('.tree-key').allTextContents()).toEqual(before)
  } finally {
    await closeApp(app)
  }
})

test('Esc, outside release, pointer cancellation, capture loss and window blur clean drag sessions', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await source(page, '{"a":1,"b":2,"c":3}')
    for (const cancel of ['escape', 'outside', 'pointercancel', 'capture', 'blur'] as const) {
      await start(page, 'a', 'c')
      if (cancel === 'escape') await page.keyboard.press('Escape')
      else if (cancel === 'outside') await page.mouse.move(600, 80)
      else if (cancel === 'pointercancel')
        await page.locator('.tree-viewport').dispatchEvent('pointercancel')
      else if (cancel === 'capture') {
        await page.locator('.tree-viewport').evaluate((area) => {
          // Actual pointer IDs vary between Chromium sessions; find the currently captured mouse.
          for (let id = 1; id < 10; id++)
            if (area.hasPointerCapture(id)) area.releasePointerCapture(id)
        })
      } else await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      await page.mouse.up({ button: 'right' })
      await clean(page)
      expect(await page.locator('.tree-key').allTextContents()).toEqual(['$', 'a', 'b', 'c'])
    }
    // Cancelled sessions must not interfere with the next real move or its history.
    await dragNode(page, 'a', 'c')
    await expect
      .poll(() => page.locator('.tree-key').allTextContents())
      .toEqual(['$', 'b', 'c', 'a'])
    await dragNode(page, 'a', 'a')
    await clean(page)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect
      .poll(() => page.locator('.tree-key').allTextContents())
      .toEqual(['$', 'a', 'b', 'c'])
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await expect
      .poll(() => page.locator('.tree-key').allTextContents())
      .toEqual(['$', 'b', 'c', 'a'])
  } finally {
    await closeApp(app)
  }
})

test('source revisions and read-only state cancel dragging without submitting stale moves', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await source(page, '{"a":1,"b":2,"c":3}')
    await dragNode(page, 'a', 'c')
    await expect
      .poll(() => page.locator('.tree-key').allTextContents())
      .toEqual(['$', 'b', 'c', 'a'])
    await start(page, 'b', 'a')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.send('desktop:action', 'undo'),
    )
    await expect
      .poll(() => page.locator('.tree-key').allTextContents())
      .toEqual(['$', 'a', 'b', 'c'])
    await page.mouse.up({ button: 'right' })
    await clean(page)
    await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.insertText('{')
    await expect(page.getByTestId('tree-status')).toContainText('树已过期')
    await expect(page.locator('.tree-drag-handle[data-can-drag="true"]')).toHaveCount(0)
    await treeRow(page, 'a').locator('.tree-drag-handle').hover()
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(200, 200, { steps: 10 })
    await page.mouse.up({ button: 'right' })
    await clean(page)
    await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.insertText('{"a":1,"a":2}')
    await expect(page.getByTestId('tree-status')).toContainText('重复属性名')
    await expect(page.locator('.tree-drag-handle[data-can-drag="true"]')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('right-button scrolling keeps capture after the source row unmounts and commits one undoable move', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await source(page, JSON.stringify(Array.from({ length: 1000 }, (_, i) => i)))
    const id = await treeRow(page, '[0]').getAttribute('data-node-id')
    await treeRow(page, '[0]').locator('.tree-drag-handle').hover()
    await page.mouse.down({ button: 'right' })
    const box = (await page.locator('.tree-viewport').boundingBox())!
    await page.mouse.move(box.x + 100, box.y + box.height - 25, { steps: 10 })
    await expect(treeRow(page, '[0]')).toHaveCount(0)
    // Freeze edge scrolling at a visible row, then release using its current coordinates.
    const rows = page.locator('.json-tree-row')
    const target = rows.nth(5)
    const rect = (await target.boundingBox())!
    await page.mouse.move(rect.x + 100, rect.y + rect.height - 2)
    await expect(page.locator('.tree-drag-hint')).toHaveAttribute('data-valid', 'true')
    await page.mouse.up({ button: 'right' })
    await clean(page)
    const moved = page.locator(`[data-node-id="${id}"]`)
    await expect(moved.locator('.tree-preview')).toHaveText('0')
    await expect(moved.locator('.tree-key')).not.toHaveText('[0]')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await page.getByRole('tree').evaluate((element) => {
      const scroll = [...element.querySelectorAll<HTMLElement>('*')].find(
        (child) =>
          getComputedStyle(child).overflowY === 'auto' && child.scrollHeight > child.clientHeight,
      )!
      scroll.scrollTop = 0
    })
    await expect(treeRow(page, '[0]')).toHaveAttribute('data-node-id', id!)
    await expect(treeRow(page, '[0]').locator('.tree-preview')).toHaveText('0')
  } finally {
    await closeApp(app)
  }
})

for (const scale of [1, 1.25, 1.5]) {
  test(`right-button drop feedback stays usable at ${scale * 100}% device scale`, async () => {
    const app = await launchApp({ deviceScaleFactor: scale })
    try {
      const page = await app.firstWindow()
      await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBeCloseTo(scale, 2)
      for (const [width, height] of [
        [1100, 760],
        [640, 480],
      ] as const) {
        await app.evaluate(
          ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(...size),
          [width, height] as [number, number],
        )
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
        await source(page, '{"a":1,"b":2,"c":3}')
        await start(page, 'a', 'c')
        await expect(page.locator('.handle-drop-cursor')).toBeVisible()
        const hint = (await page.locator('.tree-drag-hint').boundingBox())!
        expect(hint.x).toBeGreaterThanOrEqual(0)
        expect(hint.x + hint.width).toBeLessThanOrEqual(width)
        expect(hint.y + hint.height).toBeLessThanOrEqual(height)
        await page.screenshot({ path: test.info().outputPath(`drag-${width}.png`) })
        await page.mouse.up({ button: 'right' })
        await expect
          .poll(() => page.locator('.tree-key').allTextContents())
          .toEqual(['$', 'b', 'c', 'a'])
        await clean(page)
      }
    } finally {
      await closeApp(app)
    }
  })
}
