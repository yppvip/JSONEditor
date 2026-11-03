import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { closeApp } from './close-app'
import { inlineValue } from './tree-actions'

async function launch(directory: string): Promise<{ app: ElectronApplication; page: Page }> {
  await mkdir(directory, { recursive: true })
  const executablePath = process.env.JSONEDITOR_EXECUTABLE
  const args = [`--user-data-dir=${join(directory, 'profile')}`]
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? args : [resolve('.'), ...args],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  const page = await app.firstWindow()
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  })
  return { app, page }
}
async function openPath(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, path)
}
async function savePath(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, path)
}
async function source(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
}
test('native-file IPC preserves BOM/CRLF and number lexemes, dirty undo state and Ctrl+S', async () => {
  const directory = test.info().outputPath('fixtures'),
    path = join(directory, 'bom.json')
  const { app, page } = await launch(directory)
  try {
    const original = '{\r\n  "n": 900719925474099312345\r\n}\r\n'
    await writeFile(path, '\ufeff' + original, 'utf8')
    await openPath(app, path)
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await expect(page.getByTestId('document-name')).toHaveText('bom.json')
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await inlineValue(page, 'n', '900719925474099312346')
    await expect(page.getByTestId('document-name')).toContainText('已修改')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByTestId('document-name')).toHaveText('bom.json')
    expect(await readFile(path)).toEqual(
      Buffer.from('\ufeff' + original.replace('345', '346'), 'utf8'),
    )
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(page.getByTestId('document-name')).toContainText('已修改')
    await page.keyboard.press('ControlOrMeta+S')
    await expect(page.getByTestId('document-name')).toHaveText('bom.json')
    expect(await readFile(path)).toEqual(Buffer.from('\ufeff' + original, 'utf8'))
    await page.getByRole('button', { name: '更多操作' }).click()
    await expect(page.getByRole('combobox', { name: '最近文件' }).locator('option')).toHaveCount(2)
  } finally {
    await closeApp(app)
  }
})
test('saves invalid current JSON as raw text and reopens from persisted recent files', async () => {
  const directory = test.info().outputPath('fixtures'),
    path = join(directory, 'invalid.json')
  let { app, page } = await launch(directory)
  try {
    await source(page, '{"broken":')
    await savePath(app, path)
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('button', { name: '另存为', exact: true }).click()
    await expect(page.getByTestId('document-name')).toHaveText('invalid.json')
    expect(await readFile(path, 'utf8')).toBe('{"broken":')
    await closeApp(app)
    const next = await launch(directory)
    app = next.app
    page = next.page
    await page.getByRole('button', { name: '更多操作' }).click()
    const recent = page.getByRole('combobox', { name: '最近文件' })
    await expect(recent.locator('option')).toHaveCount(2)
    const id = await recent.locator('option').nth(1).getAttribute('value')
    await recent.selectOption(id!)
    await expect(page.getByTestId('document-name')).toHaveText('invalid.json')
    await expect(page.getByTestId('json-status')).toContainText('JSON 校验未通过')
    await expect(page.locator('.view-lines')).toContainText('"broken"')
  } finally {
    await closeApp(app)
  }
})
test('encoding failures and cancelled opens do not discard the current dirty document', async () => {
  const directory = test.info().outputPath('fixtures'),
    path = join(directory, 'utf16.json')
  const { app, page } = await launch(directory)
  try {
    await writeFile(path, Buffer.from([0xff, 0xfe, 0x7b, 0, 0x7d, 0]))
    await source(page, '{"kept":true}')
    await openPath(app, path)
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await expect(page.getByRole('alert', { name: '文件操作错误' })).toContainText('UTF-8')
    await expect(page.locator('.view-lines')).toContainText('"kept"')
    await expect(page.getByTestId('document-name')).toContainText('已修改')
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    })
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await expect(page.getByRole('button', { name: '打开', exact: true })).toBeEnabled()
    await expect(page.locator('.view-lines')).toContainText('"kept"')
  } finally {
    await closeApp(app)
  }
})
test('external modification blocks Save, while Save As retains both versions', async () => {
  const directory = test.info().outputPath('fixtures'),
    path = join(directory, 'original.json'),
    copy = join(directory, 'copy.json')
  const { app, page } = await launch(directory)
  try {
    await writeFile(path, '{"a":1}')
    await openPath(app, path)
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await expect(page.getByTestId('document-name')).toHaveText('original.json')
    await source(page, '{"a":2}')
    await writeFile(path, '{"external":true}')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('alert', { name: '文件操作错误' })).toContainText('磁盘文件已变化')
    expect(await readFile(path, 'utf8')).toBe('{"external":true}')
    await savePath(app, copy)
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('button', { name: '另存为', exact: true }).click()
    await expect(page.getByTestId('document-name')).toHaveText('copy.json')
    expect(await readFile(copy, 'utf8')).toBe('{"a":2}')
    expect(await readFile(path, 'utf8')).toBe('{"external":true}')
  } finally {
    await closeApp(app)
  }
})
test('clipboard IPC copies current raw/formatted/compact source and paste is one undoable transaction', async () => {
  const { app, page } = await launch(test.info().outputPath('fixtures'))
  try {
    await app.evaluate(({ clipboard }) => {
      const state = globalThis as unknown as { fixtureClipboard: string }
      state.fixtureClipboard = '[1,true,null]'
      clipboard.readText = async () => state.fixtureClipboard
      clipboard.writeText = async (text) => {
        state.fixtureClipboard = text
      }
    })
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('button', { name: '剪贴板替换全文', exact: true }).click()
    await expect(page.locator('.view-lines')).toContainText('[1,true,null]')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(page.locator('.view-lines')).toContainText('Hello, JSON')
    await source(page, '{ "n": 900719925474099312345, "s": "a b \\u0061" }')
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    await page.getByRole('button', { name: '复制选项', exact: true }).click()
    await page.getByRole('button', { name: '复制压缩', exact: true }).click()
    await expect(page.getByTestId('file-status')).toContainText('已复制')
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { fixtureClipboard: string }).fixtureClipboard,
      ),
    ).toBe('{"n":900719925474099312345,"s":"a b \\u0061"}')
    await page.getByRole('button', { name: '复制选项', exact: true }).click()
    await page.getByRole('button', { name: '复制格式化', exact: true }).click()
    await expect(page.getByTestId('file-status')).toContainText('已复制')
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { fixtureClipboard: string }).fixtureClipboard,
      ),
    ).toContain('\n')
    await source(page, '{"broken":')
    await expect(page.getByTestId('json-status')).toContainText('JSON 校验未通过')
    const previous = await app.evaluate(
      () => (globalThis as unknown as { fixtureClipboard: string }).fixtureClipboard,
    )
    await page.getByRole('button', { name: '复制选项', exact: true }).click()
    await page.getByRole('button', { name: '复制格式化', exact: true }).click()
    await expect(page.getByRole('alert', { name: '文件操作错误' })).toContainText('JSON 无效')
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { fixtureClipboard: string }).fixtureClipboard,
      ),
    ).toBe(previous)
    await page.getByRole('button', { name: '复制选项', exact: true }).click()
    await page.getByRole('button', { name: '复制原文', exact: true }).click()
    await expect(page.getByTestId('file-status')).toContainText('已复制')
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { fixtureClipboard: string }).fixtureClipboard,
      ),
    ).toBe('{"broken":')
  } finally {
    await closeApp(app)
  }
})
test('native close waits for cancellation, save-dialog cancellation and finally a successful raw save', async () => {
  const directory = test.info().outputPath('fixtures'),
    path = join(directory, 'close.json')
  const { app, page } = await launch(directory)
  try {
    await source(page, '{"broken":')
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false })
    })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
    await expect(page.getByTestId('document-name')).toContainText('已修改')
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
    })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
    await expect(page.locator('.view-lines')).toContainText('"broken"')
    await savePath(app, path)
    const closed = app.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
    await closed
    expect(await readFile(path, 'utf8')).toBe('{"broken":')
  } finally {
    await closeApp(app)
  }
})
test('desktop IPC rejects arbitrary paths, extra arguments and unknown file capabilities', async () => {
  const { app, page } = await launch(test.info().outputPath('fixtures'))
  try {
    const results = await page.evaluate(async () => [
      await window.desktop.saveFile({
        fileId: null,
        text: '{}',
        saveAs: false,
        path: 'C:\\unexpected.json',
      } as unknown as Parameters<typeof window.desktop.saveFile>[0]),
      await window.desktop.saveFile({
        fileId: '11111111-1111-4111-8111-111111111111',
        text: '{}',
        saveAs: false,
      }),
      await window.desktop.openRecent('11111111-1111-4111-8111-111111111111'),
    ])
    expect(results.map((result) => (result.ok ? 'ok' : result.code))).toEqual([
      'invalid-request',
      'unauthorized',
      'unauthorized',
    ])
  } finally {
    await closeApp(app)
  }
})
