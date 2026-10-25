import { _electron as electron, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { arch, cpus, release, totalmem } from 'node:os'
import { resolve } from 'node:path'

const application = await electron.launch({
  args: [resolve('.')],
  env: { ...process.env, ELECTRON_RENDERER_URL: '' },
})
try {
  const page = await application.firstWindow()
  await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
  const samples = []
  const paste = async (text) => {
    const input = page.getByRole('textbox', { name: 'JSON 文本编辑器' })
    await input.focus()
    await page.keyboard.press('ControlOrMeta+A')
    await input.evaluate((element, value) => {
      const data = new DataTransfer()
      data.setData('text/plain', value)
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      )
    }, text)
  }
  for (const elements of [1_000, 10_000, 50_000]) {
    const text = JSON.stringify(Array.from({ length: elements }, (_, index) => index))
    const started = performance.now()
    await paste(text)
    await expect(page.getByTestId('tree-count')).toHaveText(
      `${(elements + 1).toLocaleString('en-US')} 个节点`,
      { timeout: 20_000 },
    )
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑')
    const pasteToTreeMs = performance.now() - started
    const mountedRows = await page.getByRole('treeitem').count()
    await page
      .locator('.tree-key')
      .filter({ hasText: /^\[0\]$/ })
      .click()
    await page
      .getByRole('textbox', { name: '节点 JSON 值', exact: true })
      .fill('900719925474099312345')
    const editStarted = performance.now()
    await page.getByRole('button', { name: '应用节点修改' }).click()
    await expect(page.getByTestId('tree-status')).toHaveText('树可编辑', { timeout: 20_000 })
    await expect(page.getByRole('textbox', { name: '节点 JSON 值', exact: true })).toHaveValue(
      '900719925474099312345',
    )
    const editToTreeMs = performance.now() - editStarted
    const memory = await application.evaluate(({ app }) =>
      app.getAppMetrics().map(({ type, memory }) => ({ type, memory })),
    )
    const sample = {
      elements,
      nodes: elements + 1,
      bytes: Buffer.byteLength(text),
      pasteToTreeMs,
      editToTreeMs,
      mountedRows,
      processMemory: memory,
    }
    samples.push(sample)
    console.log(
      JSON.stringify({ elements, nodes: elements + 1, pasteToTreeMs, editToTreeMs, mountedRows }),
    )
  }
  await paste(JSON.stringify(Array.from({ length: 100_000 }, () => 0)))
  await expect(page.getByTestId('tree-status')).toContainText('节点超过 100,000', {
    timeout: 20_000,
  })
  await expect(page.getByTestId('json-status')).toHaveText(/^JSON 有效/)
  await writeFile(
    'docs/phase4-performance.json',
    JSON.stringify(
      {
        capturedAtUtc: new Date().toISOString(),
        environment: {
          platform: process.platform,
          arch: arch(),
          osRelease: release(),
          cpu: cpus()[0]?.model,
          logicalProcessors: cpus().length,
          totalMemoryBytes: totalmem(),
        },
        samples,
        limitDegradationPassed: true,
        limitations: [
          'One run per size on synthetic flat arrays',
          'Wall-clock timings include paste, debounce, Worker transfer, full model rebuild, React and automation overhead',
          'Full metadata/index rebuild remains linear; no incremental parser or index',
          'No deep/mixed structures or long-running memory regression claim',
        ],
      },
      null,
      2,
    ) + '\n',
  )
} finally {
  await application.close()
}
