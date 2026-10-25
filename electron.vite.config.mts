import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: { rolldownOptions: { input: resolve('src/renderer/index.html') } },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  },
})
