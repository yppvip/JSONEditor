import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { arch, cpus, release, totalmem } from 'node:os'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { _electron as electron } from '@playwright/test'

const server = await createServer({
  configFile: false,
  root: resolve('tests/performance'),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5180, strictPort: true, fs: { allow: [resolve('.')] } },
  optimizeDeps: {
    include: ['react-arborist', 'react-dom/client', 'monaco-editor/editor/editor.api'],
  },
})
let application
try {
  await server.listen()
  application = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, ELECTRON_RENDERER_URL: 'http://127.0.0.1:5180/' },
  })
  const page = await application.firstWindow()
  page.on('pageerror', (error) => console.error(error.message))
  await page.waitForFunction(() => typeof window.runPhase1Probe === 'function', undefined, {
    timeout: 60_000,
  })
  const results = []
  for (const count of [10_000, 100_000, 300_000]) {
    const result = await page.evaluate(async (size) => window.runPhase1Probe(size), count)
    const memory = await application.evaluate(({ app }) =>
      app.getAppMetrics().map(({ type, memory }) => ({ type, memory })),
    )
    results.push({ ...result, processMemory: memory })
    console.log(JSON.stringify(result))
  }
  await mkdir('docs', { recursive: true })
  await writeFile(
    'docs/phase1-performance.json',
    JSON.stringify(
      {
        capturedAtUtc: new Date().toISOString(),
        platform: process.platform,
        node: process.version,
        environment: {
          arch: arch(),
          osRelease: release(),
          cpu: cpus()[0]?.model,
          logicalProcessors: cpus().length,
          systemMemoryBytes: totalmem(),
        },
        results,
        limitations: [
          'Single run per size; warm caches',
          'Synthetic flat rows, not a complete JSON tree model',
          'Monaco plaintext baseline, not JSON language validation',
          'Native JSON.parse/stringify benchmark, not a lossless production parser',
          'Task Manager-style process metrics include benchmark/dev overhead',
        ],
      },
      null,
      2,
    ) + '\n',
  )
} finally {
  await application?.close()
  await server.close()
}
