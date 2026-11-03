import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { launchApp } from './launch-app'
import { closeApp } from './close-app'
import { treeRow } from './tree-actions'

async function source(page: Page, text: string) {
  const editor = page.getByRole('textbox', { name: 'JSON 文本编辑器' })
  await editor.focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
  await page.keyboard.press('ControlOrMeta+Home')
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
}

async function insideViewport(page: Page, selector: string) {
  const rect = (await page.locator(selector).boundingBox())!
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(rect.x).toBeGreaterThanOrEqual(0)
  expect(rect.y).toBeGreaterThanOrEqual(0)
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1)
}

// Chromium device scale is explicit and reproducible; this does not change Windows display settings.
for (const scale of [1, 1.25, 1.5]) {
  test(`acceptance: ${scale * 100}% device scale keeps desktop/minimum layout, menus and long-value editing usable`, async () => {
    const app = await launchApp({ deviceScaleFactor: scale })
    try {
      const page = await app.firstWindow()
      await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
      await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBeCloseTo(scale, 2)
      const longKey = '超长属性名_'.repeat(16)
      const longValue = '完整中文内容与标点 "quote" '.repeat(14) + '\n第二行'
      await source(
        page,
        JSON.stringify({ message: '中文输入', [longKey]: longValue, value: longValue }, null, 2),
      )
      const longKeyButton = page.getByRole('button', { name: /^编辑属性名 超长属性名_/ })
      await expect(longKeyButton).toBeVisible()
      await longKeyButton.click()
      const keyInput = page.getByRole('textbox', { name: '行内属性名' })
      await expect(keyInput).toHaveValue(longKey)
      await keyInput.press('Escape')
      for (const [width, height] of [
        [1100, 760],
        [640, 480],
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, size) => {
            BrowserWindow.getAllWindows()[0]!.setContentSize(size.width!, size.height!)
          },
          { width, height },
        )
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        )
        const geometry = await page.evaluate(() => {
          const tree = document.querySelector('.tree-pane')!.getBoundingClientRect()
          const code = document.querySelector('.code-pane')!.getBoundingClientRect()
          return {
            equalHeight: tree.height === code.height,
            sameTop: tree.top === code.top,
            difference: Math.abs(tree.width - code.width),
            noOverflow:
              document.documentElement.scrollWidth <= innerWidth &&
              document.documentElement.scrollHeight <= innerHeight,
          }
        })
        expect(geometry).toEqual({
          equalHeight: true,
          sameTop: true,
          difference: 0,
          noOverflow: true,
        })
        const innerHorizontalScrollers = await page
          .locator('.tree-viewport')
          .evaluate(
            (area) =>
              [...area.querySelectorAll<HTMLElement>('*')].filter(
                (element) =>
                  ['auto', 'scroll'].includes(getComputedStyle(element).overflowX) &&
                  element.scrollWidth > element.clientWidth,
              ).length,
          )
        expect(innerHorizontalScrollers).toBe(0)
        const buttons = await Promise.all(
          ['新建', '打开', '保存', '格式化', '校验'].map((name) =>
            page.getByRole('toolbar').getByRole('button', { name, exact: true }).boundingBox(),
          ),
        )
        expect(
          buttons.every(
            (box) => box && box.y === buttons[0]!.y && box.x >= 0 && box.x + box.width <= width!,
          ),
        ).toBe(true)
        await page.screenshot({ path: test.info().outputPath(`workspace-${width}.png`) })
        const handle = treeRow(page, 'message').locator('.tree-drag-handle')
        await handle.evaluate((element) =>
          element.dispatchEvent(
            new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              detail: 1,
              clientX: innerWidth - 2,
              clientY: innerHeight - 2,
            }),
          ),
        )
        await page.getByRole('menuitem', { name: '类型', exact: true }).press('ArrowRight')
        await expect
          .poll(() =>
            page
              .locator('.tree-context-menu')
              .evaluateAll((elements) =>
                elements.every(
                  (element) =>
                    !(element as HTMLElement).style.opacity &&
                    !(element as HTMLElement).style.transform,
                ),
              ),
          )
          .toBe(true)
        await insideViewport(page, '.tree-context-menu:not(.submenu)')
        await insideViewport(page, '.tree-context-menu.submenu')
        await page.screenshot({ path: test.info().outputPath(`menu-${width}.png`) })
        await page.keyboard.press('Escape')
        await page.keyboard.press('Escape')
        await expect(handle).toBeFocused()
        await treeRow(page, 'value').locator('[data-edit-field="value"]').click()
        const input = page.getByRole('textbox', { name: '行内值', exact: true })
        await expect(input).toHaveValue(longValue)
        await expect(input).toBeFocused()
        await insideViewport(page, '.inline-edit')
        await page.screenshot({ path: test.info().outputPath(`long-value-${width}.png`) })
        await input.press('Escape')
      }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const swap = page.getByRole('button', { name: '交换左右位置' })
      await swap.click()
      await expect(swap).toHaveAttribute('aria-pressed', 'true')
      await insideViewport(page, '.tree-pane')
      await insideViewport(page, '.code-pane')
      const shellOffsets = await page
        .locator('.workspace-tree-slot, .workspace-code-slot, .tree-pane, .code-pane')
        .evaluateAll((elements) =>
          elements.map((element) => ({ left: element.scrollLeft, top: element.scrollTop })),
        )
      expect(shellOffsets).toEqual(Array.from({ length: 4 }, () => ({ left: 0, top: 0 })))
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
      await page.screenshot({ path: test.info().outputPath('swapped-reduced-motion.png') })
    } finally {
      await closeApp(app)
    }
  })
}

test('acceptance: desktop color tokens and keyboard focus meet the documented contrast floor', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    const audit = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement)
      const color = (name: string) => styles.getPropertyValue(`--${name}`).trim()
      const luminance = (hex: string) => {
        const values = hex
          .slice(1)
          .match(/../g)!
          .map((s) => parseInt(s, 16) / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722
      }
      const pairs = [
        ['text', 'surface'],
        ['muted', 'surface'],
        ['muted', 'background'],
        ['on-accent', 'accent'],
        ['success', 'surface'],
        ['danger', 'danger-bg'],
        ['warning', 'warning-bg'],
        ['accent', 'surface'],
        ['text', 'selection'],
      ]
      return pairs.map(([fg, bg]) => {
        const a = luminance(color(fg!)),
          b = luminance(color(bg!))
        return {
          foreground: fg,
          background: bg,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        }
      })
    })
    for (const sample of audit)
      expect(sample.ratio, `${sample.foreground}/${sample.background}`).toBeGreaterThanOrEqual(4.5)
    const save = page.getByRole('button', { name: '保存', exact: true })
    await save.focus()
    await expect(save).toBeFocused()
    await expect(save).toHaveCSS('outline-style', 'solid')
    await expect(save).toHaveCSS('outline-width', '2px')
    await test.info().attach('contrast.json', {
      body: JSON.stringify(audit, null, 2),
      contentType: 'application/json',
    })
    const display = await app.evaluate(({ screen }) =>
      screen.getAllDisplays().map(({ scaleFactor, size }) => ({ scaleFactor, size })),
    )
    await test.info().attach('native-displays.json', {
      body: JSON.stringify(display, null, 2),
      contentType: 'application/json',
    })
  } finally {
    await closeApp(app)
  }
})
