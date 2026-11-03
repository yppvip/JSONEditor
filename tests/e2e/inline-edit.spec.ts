import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { launchApp } from './launch-app'
import { closeApp } from './close-app'

async function ready(page: Page) {
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
}
async function replace(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).evaluate((element, value) => {
    const data = new DataTransfer()
    data.setData('text/plain', value)
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  }, text)
  await ready(page)
}

async function clickCellEdge(cell: Locator) {
  const box = (await cell.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(48)
  expect(box.height).toBeGreaterThanOrEqual(24)
  // Click beyond the empty string's quotes, near the bottom-right of the actual button.
  await cell.click({ position: { x: box.width - 2, y: box.height - 2 } })
}

for (const [width, height] of [
  [1100, 760],
  [640, 480],
] as const) {
  test(`empty and whitespace cells accept edge clicks at ${width}x${height}`, async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await app.evaluate(
        ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(...size),
        [width, height] as [number, number],
      )
      await ready(page)
      await replace(page, '{"":"","name":"","spaces":"   ","items":[""]}')
      const key = page.getByRole('textbox', { name: '行内属性名' })
      const value = page.getByRole('textbox', { name: '行内值' })
      await clickCellEdge(page.getByRole('button', { name: '编辑属性名 ""', exact: true }))
      await expect(key).toHaveValue('')
      await key.fill('未提交')
      await key.press('Escape')
      await clickCellEdge(page.getByRole('button', { name: '编辑值 ""', exact: true }))
      await expect(value).toHaveValue('')
      await value.press('Escape')

      await clickCellEdge(page.getByRole('button', { name: '编辑属性名 ""', exact: true }))
      await key.fill('空属性')
      await key.press('Tab')
      await expect(value).toBeFocused()
      await expect(value).toHaveValue('')
      await value.fill('中文值')
      await value.press('Enter')
      await expect(value).toHaveCount(0)
      await expect(page.getByRole('button', { name: '编辑值 空属性', exact: true })).toHaveText(
        '"中文值"',
      )

      for (const [name, original] of [
        ['name', ''],
        ['spaces', '   '],
      ] as const) {
        const cell = page.getByRole('button', { name: `编辑值 ${name}`, exact: true })
        await clickCellEdge(cell)
        await expect(value).toHaveValue(original)
        await value.press('Escape')
      }
      await page.getByRole('button', { name: '展开 items', exact: true }).click()
      await clickCellEdge(page.getByRole('button', { name: '编辑值 [0]', exact: true }))
      await expect(value).toHaveValue('')
      await value.press('Escape')
      await expect(page.getByRole('menu', { name: '节点菜单', exact: true })).toHaveCount(0)
      await expect(page.locator('[data-dragging="true"]')).toHaveCount(0)
      await page.screenshot({ path: test.info().outputPath('empty-cells.png') })
    } finally {
      await closeApp(app)
    }
  })
}

test('inline key Tab opens value, locked strings retain quotes, Escape cancels and edits share undo', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await ready(page)
    await replace(page, '{"name":"hello","count":1}')
    await page.getByRole('button', { name: '编辑属性名 name', exact: true }).click()
    await page.getByRole('textbox', { name: '行内属性名' }).fill('renamed')
    await page.keyboard.press('Tab')
    const value = page.getByRole('textbox', { name: '行内值' })
    await expect(value).toBeFocused()
    await value.fill('123')
    await value.press('Enter')
    await expect(value).toHaveCount(0)
    await expect(page.getByRole('button', { name: '编辑值 renamed', exact: true })).toHaveText(
      '"123"',
    )
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await ready(page)
    await expect(page.getByRole('button', { name: '编辑值 renamed', exact: true })).toHaveText(
      '"hello"',
    )
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await ready(page)
    await expect(page.getByRole('button', { name: '编辑属性名 name', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '编辑值 count', exact: true }).click()
    await value.fill('900719925474099312345')
    await value.press('Escape')
    await expect(page.getByRole('button', { name: '编辑值 count', exact: true })).toHaveText('1')
    await page.getByRole('button', { name: '编辑值 count', exact: true }).click()
    await value.fill('900719925474099312345')
    await page.getByRole('button', { name: '展开根节点', exact: true }).click()
    await ready(page)
    await expect(page.getByRole('button', { name: '编辑值 count', exact: true })).toHaveText(
      '900719925474099312345',
    )
    await page.getByRole('button', { name: '编辑值 count', exact: true }).click()
    await value.fill(' 900719925474099312345 ')
    await value.press('Enter')
    await expect(value).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('duplicate keys keep the draft and IME Enter does not submit until composition ends', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await ready(page)
    await replace(page, '{"a":"first","b":2}')
    await page.getByRole('button', { name: '编辑属性名 a', exact: true }).click()
    const key = page.getByRole('textbox', { name: '行内属性名' })
    await key.fill('b')
    await key.press('Enter')
    await expect(page.locator('#inline-edit-error')).toContainText('已存在')
    await page.screenshot({ path: test.info().outputPath('inline-error.png') })
    await expect(key).toHaveValue('b')
    await key.fill('中文')
    await key.dispatchEvent('compositionstart')
    await key.press('Enter')
    await expect(key).toHaveValue('中文')
    await expect(page.getByRole('button', { name: '编辑属性名 a', exact: true })).toBeVisible()
    await key.dispatchEvent('compositionend')
    await key.press('Enter')
    await expect(key).toHaveCount(0)
    await expect(page.getByRole('button', { name: '编辑属性名 中文', exact: true })).toBeVisible()
  } finally {
    await closeApp(app)
  }
})

test('long values use their complete decoded source and multiline edits submit with Ctrl+Enter', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await ready(page)
    const original = 'a'.repeat(220) + '\nend "quoted"'
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(640, 480))
    await replace(page, JSON.stringify({ value: original }))
    await page.getByRole('button', { name: '编辑值 value', exact: true }).click()
    const input = page.getByRole('textbox', { name: '行内值' })
    await expect(input).toHaveValue(original)
    const box = (await page.getByRole('group', { name: '树行编辑' }).boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
    await page.screenshot({ path: test.info().outputPath('inline-long.png') })
    expect(await input.evaluate((element) => element.tagName)).toBe('TEXTAREA')
    await input.fill(original + '\n最后一行')
    await input.press('ControlOrMeta+Enter')
    await expect(input).toHaveCount(0)
    await page.getByRole('button', { name: '编辑值 value', exact: true }).click()
    await expect(input).toHaveValue(original + '\n最后一行')
    await input.press('Escape')
    await replace(page, JSON.stringify({ huge: 'x'.repeat(65_537) }))
    await page.getByRole('button', { name: '编辑值 huge', exact: true }).click()
    await expect(page.getByLabel('树行编辑')).toContainText('超过行内编辑限制')
    await expect(page.getByRole('button', { name: '转到代码', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '取消', exact: true }).click()
  } finally {
    await closeApp(app)
  }
})

test('virtualization retains an uncommitted draft and external source changes block stale submission', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await ready(page)
    await replace(page, JSON.stringify(Array.from({ length: 1000 }, (_, i) => i)))
    await page.getByRole('button', { name: '编辑值 [0]', exact: true }).click()
    const input = page.getByRole('textbox', { name: '行内值' })
    await input.fill('123456789')
    await page.getByRole('tree', { name: 'JSON 节点树' }).evaluate((element) => {
      const scroller = [...element.querySelectorAll<HTMLElement>('*')].find(
        (child) =>
          child.scrollHeight > child.clientHeight && getComputedStyle(child).overflowY === 'auto',
      )
      if (!scroller) throw new Error('Tree scroller missing')
      scroller.scrollTop = 20000
    })
    await expect(page.getByRole('button', { name: '编辑值 [0]', exact: true })).toHaveCount(0)
    await expect(input).toHaveValue('123456789')
    await expect(page.getByLabel('树行编辑')).toContainText('草稿仍保留')
    await input.press('Escape')
    await replace(page, '{"value":1}')
    await page.getByRole('button', { name: '编辑值 value', exact: true }).click()
    await input.fill('77')
    // Blur commits the first draft; an IPC undo changes source without blurring the next draft.
    await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus({ timeout: 1000 })
    await ready(page)
    await page.getByRole('button', { name: '编辑值 value', exact: true }).click()
    await input.fill('88')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.send('desktop:action', 'undo'),
    )
    await expect(page.locator('#inline-edit-error')).toContainText('文档已变化')
    await expect(input).toHaveValue('88')
    await input.press('Enter')
    await expect(input).toHaveValue('88')
    await input.press('Escape')
  } finally {
    await closeApp(app)
  }
})
