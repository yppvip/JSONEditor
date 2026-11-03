import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchApp } from './launch-app'
import { closeApp } from './close-app'

const separator = (page: Page) => page.getByRole('separator', { name: '调整树与代码宽度' })

async function size(
  app: ElectronApplication,
  page: Page,
  width: number,
  height = 760,
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, value) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(value.width, value.height),
    { width, height },
  )
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
  // Native sizing can precede ResizeObserver and Monaco's next layout pass.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

async function widths(page: Page) {
  return page.evaluate(() => {
    const tree = document.querySelector('.tree-pane')!.getBoundingClientRect()
    const code = document.querySelector('.code-pane')!.getBoundingClientRect()
    return {
      tree: tree.width,
      code: code.width,
      treeX: tree.x,
      codeX: code.x,
      equalHeight: tree.height === code.height,
      sameTop: tree.y === code.y,
    }
  })
}

test('panes resize with pointer and keyboard, respect limits, cancel safely and reset to equal widths', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await size(app, page, 1100)
    const initial = await widths(page)
    expect(Math.abs(initial.tree - initial.code)).toBeLessThan(1)
    expect(initial.equalHeight && initial.sameTop).toBe(true)
    const split = separator(page)
    const box = (await split.boundingBox())!
    const x = box.x + box.width / 2,
      y = box.y + 70
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 100, y, { steps: 5 })
    await expect.poll(async () => (await widths(page)).tree).toBeCloseTo(initial.tree + 100, 0)
    await page.mouse.up()
    const committed = await split.getAttribute('aria-valuenow')
    const nextBox = (await split.boundingBox())!
    await page.mouse.move(nextBox.x + 4, y)
    await page.mouse.down()
    await page.mouse.move(nextBox.x - 100, y, { steps: 3 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(split).toHaveAttribute('aria-valuenow', committed!)
    await split.focus()
    await page.keyboard.press('Home')
    expect((await widths(page)).tree).toBeCloseTo(240, 0)
    await page.keyboard.press('End')
    expect((await widths(page)).code).toBeCloseTo(240, 0)
    await page.keyboard.press('Enter')
    await expect(split).toHaveAttribute('aria-valuenow', '50')
    await page.keyboard.press('ArrowRight')
    await expect(split).toHaveAttribute('aria-valuenow', '52')
    await page.keyboard.press('Shift+ArrowLeft')
    await expect(split).toHaveAttribute('aria-valuenow', '42')
    await split.dblclick()
    await expect(split).toHaveAttribute('aria-valuenow', '50')
    await page.keyboard.press('ArrowRight')
    await page.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('button', { name: '恢复均分' }).click()
    await expect(split).toHaveAttribute('aria-valuenow', '50')
    await size(app, page, 640, 480)
    await split.focus()
    await page.keyboard.press('End')
    expect((await widths(page)).code).toBeCloseTo(240, 0)
    expect((await widths(page)).equalHeight).toBe(true)
    await split.dblclick()
    await page.screenshot({ path: test.info().outputPath('split-640.png') })
  } finally {
    await closeApp(app)
  }
})

test('width preference follows the tree on swap, survives restart, and returns after a narrower window', async () => {
  let app = await launchApp()
  try {
    let page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await size(app, page, 1100)
    await separator(page).focus()
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await expect(separator(page)).toHaveAttribute('aria-valuenow', '70')
    const before = await widths(page)
    await page.getByRole('button', { name: '交换左右位置' }).click()
    await expect(page.locator('.editor-split')).toHaveAttribute('data-tree-side', 'right')
    await expect(separator(page)).toHaveAttribute('aria-valuenow', '30')
    const after = await widths(page)
    expect(after.tree).toBeCloseTo(before.tree, 0)
    expect(after.codeX).toBeLessThan(after.treeX)
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('jsoneditor.workspace-layout.v1')!).treeOnLeft,
        ),
      )
      .toBe(false)
    await closeApp(app)
    app = await launchApp()
    page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await size(app, page, 1100)
    await expect(page.locator('.editor-split')).toHaveAttribute('data-tree-side', 'right')
    await expect(separator(page)).toHaveAttribute('aria-valuenow', '30')
    await size(app, page, 640, 480)
    await expect.poll(async () => (await widths(page)).code).toBeCloseTo(240, 0)
    await size(app, page, 1100)
    await expect(separator(page)).toHaveAttribute('aria-valuenow', '30')
    await page.screenshot({ path: test.info().outputPath('split-reversed-1100.png') })
  } finally {
    await closeApp(app)
  }
})

test('swap preserves live editor DOM, caret, scroll, tree expansion and selection, and undo history', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    const input = page.getByRole('textbox', { name: 'JSON 文本编辑器' })
    await input.focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.insertText(
      JSON.stringify({ nested: { child: 1 }, rows: Array.from({ length: 150 }, (_, i) => i) }),
    )
    await expect(page.getByTestId('json-status')).toHaveText('JSON 有效')
    await page.getByRole('button', { name: '格式化', exact: true }).click()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await page.getByRole('button', { name: '展开 nested', exact: true }).click()
    await page.getByRole('button', { name: '展开 rows', exact: true }).click()
    const selected = page
      .locator('.json-tree-row')
      .filter({ has: page.locator('.tree-key').filter({ hasText: /^child$/ }) })
    await selected.click()
    const selectedId = await selected.getAttribute('data-node-id')
    const treeScroll = page.locator('.tree-viewport [role="tree"] > div').first()
    await treeScroll.evaluate((element) => {
      element.scrollTop = 140
    })
    await expect.poll(() => treeScroll.evaluate((element) => element.scrollTop)).toBe(140)
    await input.focus()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.press('ArrowLeft')
    const monaco = await page.locator('.monaco-editor').elementHandle()
    const tree = await page.getByRole('tree', { name: 'JSON 节点树' }).elementHandle()
    const visibleLines = await page.locator('.view-lines').innerText()
    await page.getByRole('button', { name: '交换左右位置' }).click()
    await expect(input).toBeFocused()
    expect(await monaco!.evaluate((element) => element.isConnected)).toBe(true)
    expect(await tree!.evaluate((element) => element.isConnected)).toBe(true)
    expect(await page.locator('.view-lines').innerText()).toBe(visibleLines)
    expect(await treeScroll.evaluate((element) => element.scrollTop)).toBe(140)
    await page.keyboard.insertText(' ')
    await expect(page.locator('.view-lines > .view-line').last()).toHaveText(/\s\}/)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await expect(page.locator('.view-lines > .view-line').last()).toHaveText(/\s\}/)
    await treeScroll.evaluate((element) => {
      element.scrollTop = 0
    })
    await expect(selected).toHaveClass(/selected/)
    await expect(selected).toHaveAttribute('data-node-id', selectedId!)
    await expect(page.getByRole('button', { name: '折叠 nested', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '折叠 rows', exact: true })).toBeVisible()
  } finally {
    await closeApp(app)
  }
})
