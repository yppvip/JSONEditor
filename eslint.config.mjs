import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'node_modules/**',
      '.phase1-staging/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{mjs,ts,tsx}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        window: 'readonly',
        document: 'readonly',
        URL: 'readonly',
        Worker: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        performance: 'readonly',
        Response: 'readonly',
        self: 'readonly',
        requestAnimationFrame: 'readonly',
        TextEncoder: 'readonly',
        fetch: 'readonly',
        queueMicrotask: 'readonly',
        DataTransfer: 'readonly',
        ClipboardEvent: 'readonly',
      },
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      'no-restricted-imports': [
        'error',
        { patterns: ['node:*', 'electron', '**/main/*', '**/preload/*'] },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['electron', 'react', 'react-dom', '**/renderer/*', '**/main/*'] },
      ],
    },
  },
  prettier,
)
