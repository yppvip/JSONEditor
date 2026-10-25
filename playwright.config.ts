import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
})
