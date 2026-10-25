import { _electron as electron, expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { resolve } from 'node:path'
import { closeApp } from './close-app'

async function runEditor(run: (page: Page) => Promise<void>): Promise<void> {
  const executablePath = process.env.JSONEDITOR_EXECUTABLE
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve('.')],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await app.firstWindow()
    await ready(page)
    await run(page)
  } finally {
    await closeApp(app)
  }
}

async function ready(page: Page): Promise<void> {
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
}
async function setSource(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
  await ready(page)
}
function row(page: Page, label: string) {
  return page.locator('.json-tree-row').filter({
    has: page
      .locator('.tree-key')
      .filter({ hasText: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }),
  })
}
async function identities(page: Page): Promise<(string | null)[]> {
  return page
    .locator('.json-tree-row')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-node-id')))
}

test('text array insertion and deletion preserve selection and expanded descendant identities', async () => {
  await runEditor(async (page) => {
    await setSource(page, '[{"n":1},{"n":2}]')
    await page.getByRole('button', { name: '展开 [1]', exact: true }).click()
    await row(page, '[1]').click()
    const second = await row(page, '[1]').getAttribute('data-node-id')
    const descendant = await row(page, 'n').getAttribute('data-node-id')
    const input = page.getByRole('textbox', { name: 'JSON 文本编辑器' })
    await input.focus()
    await page.keyboard.press('ControlOrMeta+Home')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.insertText('{"n":0},')
    await ready(page)
    await expect(row(page, '[2]')).toHaveAttribute('data-node-id', second!)
    await expect(row(page, '[2]')).toHaveClass(/selected/)
    await expect(row(page, 'n')).toHaveAttribute('data-node-id', descendant!)
    await expect(page.getByRole('textbox', { name: '节点 JSON 值', exact: true })).toHaveValue(
      '{"n":2}',
    )
    // This is one text insertion transaction in Monaco's own history.
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await ready(page)
    await expect(row(page, '[1]')).toHaveAttribute('data-node-id', second!)
    await expect(row(page, '[1]')).toHaveClass(/selected/)
  })
})

test('tree deletion undo and redo restore historical IDs and text edits share the same history', async () => {
  await runEditor(async (page) => {
    await setSource(page, '[1,2,3]')
    const original = await identities(page)
    await row(page, '[0]').click()
    await page.getByRole('button', { name: '删除节点', exact: true }).click()
    await ready(page)
    const deleted = await identities(page)
    expect(deleted).toEqual([original[0], original[2], original[3]])
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await ready(page)
    expect(await identities(page)).toEqual(original)
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await ready(page)
    expect(await identities(page)).toEqual(deleted)
    await row(page, '[0]').click()
    await page
      .getByRole('textbox', { name: '节点 JSON 值', exact: true })
      .fill('900719925474099312345')
    await page.getByRole('button', { name: '应用节点修改', exact: true }).click()
    await ready(page)
    await page.getByRole('button', { name: '格式化', exact: true }).click()
    await ready(page)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await ready(page)
    await expect(page.locator('.view-lines')).toContainText('900719925474099312345')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await ready(page)
    expect(await identities(page)).toEqual(deleted)
    await expect(page.getByRole('textbox', { name: '节点 JSON 值', exact: true })).toHaveValue('2')
  })
})

test('rapid invalid intermediate input preserves the last tree until the latest source is valid', async () => {
  await runEditor(async (page) => {
    await setSource(page, '[1,2]')
    await row(page, '[1]').click()
    const second = await row(page, '[1]').getAttribute('data-node-id')
    await page.getByRole('textbox', { name: 'JSON 文本编辑器' }).focus()
    await page.keyboard.press('ControlOrMeta+Home')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.insertText('0')
    await expect(page.getByTestId('json-status')).toContainText('JSON 校验未通过')
    await expect(page.getByRole('button', { name: '应用节点修改', exact: true })).toBeDisabled()
    await page.keyboard.insertText(',')
    await ready(page)
    await expect(row(page, '[2]')).toHaveAttribute('data-node-id', second!)
    await expect(row(page, '[2]')).toHaveClass(/selected/)
    for (const digit of ['3', '4', '5', 'x']) await page.keyboard.insertText(digit)
    await expect(page.getByTestId('json-status')).toContainText('JSON 校验未通过')
    await page.keyboard.press('Backspace')
    await page.keyboard.insertText(',')
    await ready(page)
    await expect(page.getByTestId('tree-count')).toHaveText('5 个节点')
    await expect(row(page, '[3]')).toHaveAttribute('data-node-id', second!)
    await expect(page.locator('.view-lines')).toContainText('345')
  })
})

test('a real JSON Worker failure retains source and recovers with a new tree generation', async () => {
  await runEditor(async (page) => {
    await setSource(page, '{"kept":900719925474099312345}')
    await row(page, 'kept').click()
    const previous = await row(page, 'kept').getAttribute('data-node-id')
    const worker = page.workers().find((worker) => worker.url().includes('/json.worker-'))
    expect(worker).toBeDefined()
    await worker!.evaluate(() => {
      setTimeout(() => {
        throw new Error('Phase4 controlled worker fault')
      }, 0)
    })
    await expect(page.getByTestId('worker-status')).toHaveText('后台不可用')
    await expect(page.getByRole('button', { name: '应用节点修改', exact: true })).toBeDisabled()
    await expect(page.locator('.view-lines')).toContainText('900719925474099312345')
    await page.getByRole('button', { name: '重试后台', exact: true }).click()
    await ready(page)
    await expect(row(page, 'kept')).not.toHaveAttribute('data-node-id', previous!)
    await row(page, 'kept').click()
    await expect(page.getByRole('textbox', { name: '节点 JSON 值', exact: true })).toHaveValue(
      '900719925474099312345',
    )
  })
})

test('composition events suspend tree commands and resume validation without rewriting the source', async () => {
  await runEditor(async (page) => {
    await setSource(page, '{"text":"中文"}')
    await row(page, 'text').click()
    const input = page.getByRole('textbox', { name: 'JSON 文本编辑器' })
    await input.focus()
    await input.dispatchEvent('compositionstart', { data: '' })
    await expect(page.getByTestId('json-status')).toHaveText('输入中，暂停同步')
    await expect(page.getByRole('button', { name: '应用节点修改', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '格式化', exact: true })).toBeDisabled()
    await input.dispatchEvent('compositionend', { data: '' })
    await ready(page)
    await expect(page.getByRole('textbox', { name: '节点 JSON 值', exact: true })).toHaveValue(
      '"中文"',
    )
  })
})

test('a large format transaction and undo keep all source values and restore tree identities', async () => {
  await runEditor(async (page) => {
    const input = page.getByRole('textbox', { name: 'JSON 文本编辑器' })
    await input.focus()
    await page.keyboard.press('ControlOrMeta+A')
    await input.evaluate(
      (element, text) => {
        const data = new DataTransfer()
        data.setData('text/plain', text)
        element.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        )
      },
      '[' + Array.from({ length: 5000 }, (_, index) => index).join(',') + ']',
    )
    await ready(page)
    await expect(page.getByTestId('tree-count')).toHaveText('5,001 个节点')
    const before = await identities(page)
    await page.getByRole('button', { name: '格式化', exact: true }).click()
    await ready(page)
    expect(await identities(page)).toEqual(before)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await ready(page)
    expect(await identities(page)).toEqual(before)
    await row(page, '[0]').click()
    await expect(page.getByRole('textbox', { name: '节点 JSON 值', exact: true })).toHaveValue('0')
    await input.focus()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.insertText(',900719925474099312345')
    await ready(page)
    await expect(page.getByTestId('tree-count')).toHaveText('5,002 个节点')
  })
})
