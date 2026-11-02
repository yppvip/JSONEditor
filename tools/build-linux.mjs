import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// A deb requires a real project URL. Supply it without inventing public project metadata.
const metadata = JSON.parse(await readFile('package.json', 'utf8'))
const homepage = process.env.JSONEDITOR_PROJECT_URL || metadata.homepage
if (!homepage) {
  throw new Error(
    'Set JSONEDITOR_PROJECT_URL to the real HTTPS project homepage before Linux packaging',
  )
}
const url = new URL(homepage)
if (url.protocol !== 'https:' || url.username || url.password) {
  throw new Error('Project homepage must be an HTTPS URL without embedded credentials')
}
if (process.platform !== 'linux')
  throw new Error('Run Linux packaging on the Linux CI runner or host')
const child = spawn(
  process.execPath,
  [
    resolve('node_modules/electron-builder/cli.js'),
    '--linux',
    'AppImage',
    'deb',
    '--x64',
    '--publish',
    'never',
    `--config.extraMetadata.homepage=${url.href}`,
  ],
  { stdio: 'inherit', env: process.env },
)
child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
