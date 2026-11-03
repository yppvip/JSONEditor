import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdir, readFile, rmdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp } from './launch-app'
import { closeApp } from './close-app'

const row = (page: Page, key: string) =>
  page.locator('.json-tree-row').filter({
    has: page.locator('.tree-key').filter({
      hasText: key === '[0]' ? /^\[0\]$/ : key === '[1]' ? /^\[1\]$/ : new RegExp('^' + key + '$'),
    }),
  })
async function openFile(app: ElectronApplication, page: Page, path: string) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  }, path)
  await page.getByRole('button', { name: '打开', exact: true }).click()
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
}
async function setMode(page: Page, mode: 'auto' | 'string') {
  await page.getByRole('combobox', { name: '输入模式' }).selectOption(mode)
  await page.getByRole('button', { name: '应用输入模式' }).click()
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
  await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue(mode)
}

test('metadata-only changes share native undo/redo with text and save without modifying JSON', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow(),
      path = test.info().outputPath('mode.json')
    await writeFile(path, '{"name":"hello"}')
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await openFile(app, page, path)
    await row(page, 'name').click()
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('string')
    const source = await page.locator('.view-lines').innerText()
    await setMode(page, 'auto')
    expect(await page.locator('.view-lines').innerText()).toBe(source)
    await expect(page.getByTestId('document-name')).toContainText('已修改')
    const input = page.getByRole('textbox', { name: 'JSON 文本编辑器' })
    await input.focus()
    await page.keyboard.press('ControlOrMeta+Z')
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('string')
    await expect(page.getByTestId('document-name')).toHaveText('mode.json')
    await page.keyboard.press('ControlOrMeta+Y')
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('auto')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByTestId('document-name')).toHaveText('mode.json')
    expect(await readFile(path, 'utf8')).toBe('{"name":"hello"}')
    await page.getByRole('button', { name: '格式化', exact: true }).click()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(page.getByTestId('document-name')).toHaveText('mode.json')
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('auto')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('string')
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('auto')
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await openFile(app, page, path)
    await row(page, 'name').click()
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('auto')
    // Metadata history must not depend on the Worker's eight identity checkpoints.
    for (let i = 0; i < 12; i++) await setMode(page, i % 2 === 0 ? 'string' : 'auto')
    for (let i = 0; i < 12; i++)
      await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('auto')
    expect(errors).toEqual([])
  } finally {
    await closeApp(app)
  }
})

test('modes follow rename and array move, survive Save As/restart, accept whitespace changes and reject external content changes', async () => {
  let app = await launchApp()
  try {
    let page = await app.firstWindow()
    const path = test.info().outputPath('original.json'),
      copy = test.info().outputPath('copy.json')
    await writeFile(path, '{"name":"hello","items":["first","second"]}')
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await openFile(app, page, path)
    await row(page, 'name').click()
    await setMode(page, 'auto')
    await page.getByRole('textbox', { name: '属性名', exact: true }).fill('renamed')
    await page.getByRole('button', { name: '应用节点修改' }).click()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('auto')
    await page.getByRole('button', { name: '展开 items', exact: true }).click()
    await row(page, '[1]').click()
    await setMode(page, 'auto')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByTestId('document-name')).toHaveText('original.json')
    await page.getByRole('button', { name: '上移节点', exact: true }).click()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('auto')
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
    })
    await page.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('button', { name: '另存为', exact: true }).click()
    await expect(page.getByTestId('document-name')).toContainText('original.json')
    await app.evaluate(({ dialog }, selected) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected })
    }, copy)
    await page.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('button', { name: '另存为', exact: true }).click()
    await expect(page.getByTestId('document-name')).toHaveText('copy.json')
    await closeApp(app)
    app = await launchApp()
    page = await app.firstWindow()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await openFile(app, page, copy)
    await row(page, 'renamed').click()
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('auto')
    await page.getByRole('button', { name: '展开 items', exact: true }).click()
    await row(page, '[0]').click()
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('auto')
    await row(page, '[1]').click()
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('string')
    await writeFile(copy, JSON.stringify(JSON.parse(await readFile(copy, 'utf8')), null, 4))
    await openFile(app, page, copy)
    await row(page, 'renamed').click()
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('auto')
    await writeFile(copy, '{"renamed":"changed","items":["second","first"]}')
    await openFile(app, page, copy)
    await row(page, 'renamed').click()
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('string')
    await expect(page.getByTestId('file-status')).toContainText('外部变化')
    await openFile(app, page, path)
    await row(page, 'renamed').click()
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('auto')
    await page.getByRole('button', { name: '展开 items', exact: true }).click()
    await row(page, '[1]').click()
    await expect(page.getByRole('combobox', { name: '输入模式' })).toHaveValue('auto')
  } finally {
    await closeApp(app)
  }
})

test('a mode-record write failure leaves JSON saved, keeps changes dirty and supports retry', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow(),
      path = test.info().outputPath('retry.json')
    await writeFile(path, '{"name":"hello"}')
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await openFile(app, page, path)
    await row(page, 'name').click()
    await setMode(page, 'auto')
    const profile = await app.evaluate(({ app }) => app.getPath('userData'))
    const metadataPath = join(profile, 'node-edit-modes.json')
    await mkdir(metadataPath)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByTestId('file-status')).toContainText('模式记录写入失败')
    await expect(page.getByTestId('document-name')).toContainText('已修改')
    expect(await readFile(path, 'utf8')).toBe('{"name":"hello"}')
    await rmdir(metadataPath)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByTestId('document-name')).toHaveText('retry.json')
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
    expect(metadata.records[0].modes).toEqual([{ pointer: '/name', mode: 'auto' }])
  } finally {
    await closeApp(app)
  }
})
