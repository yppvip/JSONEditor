import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { launchApp } from './launch-app'
import { closeApp } from './close-app'
import { menuAction, nodeMenu, treeRow, dragNode } from './tree-actions'

interface Sample {
  name: string
  opacity: string
  transform: string
  confirmation: boolean
}
async function observe(page: Page) {
  await page.evaluate(() => {
    const samples: { name: string; opacity: string; transform: string; confirmation: boolean }[] =
      []
    Object.assign(window, { motionSamples: samples })
    const observer = new MutationObserver((records) => {
      for (const { target } of records)
        if (
          target instanceof HTMLElement &&
          target.matches(
            '.tree-context-menu, .workspace-tree-slot, .workspace-code-slot, .tree-drop-feedback, .tree-type, .file-status',
          )
        ) {
          if (samples.length > 2000) samples.shift()
          samples.push({
            name: target.className,
            opacity: target.style.opacity,
            transform: target.style.transform,
            confirmation: target.classList.contains('feedback-confirmed'),
          })
        }
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
  })
}
async function samples(page: Page): Promise<Sample[]> {
  return page.evaluate(() => (window as unknown as { motionSamples: Sample[] }).motionSamples)
}
async function source(page: Page) {
  const input = page.getByRole('textbox', { name: 'JSON 文本编辑器' })
  await input.focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText('{"a":1,"b":2,"c":3}')
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
}
async function drag(page: Page) {
  await dragNode(page, 'a', 'c')
  await expect.poll(() => page.locator('.tree-key').allTextContents()).toEqual(['$', 'b', 'c', 'a'])
}
test('menu entrances clean inline styles and interrupted menus release detached elements', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await source(page)
    await observe(page)
    await nodeMenu(page, 'a')
    const menu = page.getByRole('menu', { name: '节点菜单', exact: true })
    await expect
      .poll(async () =>
        (await samples(page)).some(
          (sample) =>
            sample.name === 'tree-context-menu' &&
            Number(sample.opacity) > 0 &&
            Number(sample.opacity) < 1,
        ),
      )
      .toBe(true)
    await page.getByRole('menuitem', { name: '类型', exact: true }).press('ArrowRight')
    const sub = page.getByRole('menu', { name: '类型菜单', exact: true })
    await expect.poll(() => sub.evaluate((element) => element.style.transform)).toBe('')
    const old = (await menu.elementHandle())!
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    expect(
      await old.evaluate((element) => ({
        attached: element.isConnected,
        opacity: element.style.opacity,
        hint: element.style.willChange,
      })),
    ).toEqual({ attached: false, opacity: '', hint: '' })
    for (let i = 0; i < 8; i++) {
      await nodeMenu(page, 'a')
      await page.keyboard.press('Escape')
    }
    await expect(page.getByRole('menu', { name: '节点菜单', exact: true })).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
test('rapid swaps preserve live editors, and a confirmed drop only animates the visible overlay', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await source(page)
    await observe(page)
    const editor = (await page.locator('.monaco-editor').elementHandle())!,
      tree = (await page.getByRole('tree').elementHandle())!
    for (let i = 0; i < 6; i++) {
      await page
        .getByRole('button', { name: '交换左右位置', exact: true })
        .evaluate((element) => (element as HTMLButtonElement).click())
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      )
    }
    await expect
      .poll(() => page.locator('.workspace-code-slot').evaluate((element) => element.style.opacity))
      .toBe('')
    expect(await editor.evaluate((element) => element.isConnected)).toBe(true)
    expect(await tree.evaluate((element) => element.isConnected)).toBe(true)
    expect(
      (await samples(page)).some(
        (sample) =>
          sample.name === 'workspace-code-slot' &&
          Number(sample.opacity) > 0 &&
          Number(sample.opacity) < 1,
      ),
    ).toBe(true)
    await drag(page)
    await expect
      .poll(async () =>
        (await samples(page)).some(
          (sample) => sample.name === 'tree-drop-feedback' && Number(sample.opacity) > 0,
        ),
      )
      .toBe(true)
    await expect
      .poll(() =>
        page
          .locator('.tree-drop-feedback')
          .evaluate((element) => getComputedStyle(element).opacity),
      )
      .toBe('0')
    expect(
      await page
        .locator('.json-tree-row')
        .evaluateAll((rows) => rows.every((row) => !(row as HTMLElement).style.transform)),
    ).toBe(true)
  } finally {
    await closeApp(app)
  }
})
test('reduced motion and live preference changes keep menus, swap and drop in final states', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await source(page)
    await nodeMenu(page, 'a')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect
      .poll(() =>
        page
          .getByRole('menu', { name: '节点菜单', exact: true })
          .evaluate((element) => element.style.opacity),
      )
      .toBe('')
    await page.keyboard.press('Escape')
    await observe(page)
    await nodeMenu(page, 'a')
    await page.getByRole('menuitem', { name: '类型', exact: true }).press('ArrowRight')
    const sub = page.getByRole('menu', { name: '类型菜单', exact: true })
    expect(
      await sub.evaluate((element) => ({
        opacity: getComputedStyle(element).opacity,
        transform: getComputedStyle(element).transform,
      })),
    ).toEqual({ opacity: '1', transform: 'none' })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '交换左右位置', exact: true }).click()
    await page.getByRole('button', { name: '交换左右位置', exact: true }).click()
    await drag(page)
    expect(
      (await samples(page)).filter(
        (sample) => sample.opacity && Number(sample.opacity) > 0 && Number(sample.opacity) < 1,
      ),
    ).toEqual([])
    expect(
      await page
        .locator('.tree-drop-feedback')
        .evaluate((element) => getComputedStyle(element).opacity),
    ).toBe('0')
  } finally {
    await closeApp(app)
  }
})
test('type and successful-save feedback stays local and does not flash newly mounted rows', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await source(page)
    await observe(page)
    await menuAction(page, 'a', '字符串', '类型')
    await expect
      .poll(async () =>
        (await samples(page)).some(
          (sample) => sample.name.includes('tree-type') && sample.confirmation,
        ),
      )
      .toBe(true)
    const path = test.info().outputPath('feedback.json')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, path)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByTestId('document-name')).toHaveText('feedback.json')
    await expect
      .poll(async () =>
        (await samples(page)).some(
          (sample) => sample.name.includes('file-status') && sample.confirmation,
        ),
      )
      .toBe(true)
    await expect
      .poll(() =>
        treeRow(page, 'a')
          .locator('.tree-type')
          .evaluate((element) => element.classList.contains('feedback-confirmed')),
      )
      .toBe(false)
  } finally {
    await closeApp(app)
  }
})
