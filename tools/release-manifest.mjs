import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Only this version's distributable files; never mix historical installers into a release.
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const platform = process.argv[2] ?? process.platform
if (!['win32', 'linux'].includes(platform)) throw new Error('Expected win32 or linux')
const names =
  platform === 'win32'
    ? [`JSONEditor-${version}-x64-setup.exe`, `JSONEditor-${version}-x64-setup.exe.blockmap`]
    : [`JSONEditor-${version}-x64.AppImage`, `JSONEditor-${version}-x64.deb`]
const available = await readdir('release')
const files = []
for (const name of names) {
  if (!available.includes(name)) throw new Error(`Missing release artifact: ${name}`)
  const path = resolve('release', name)
  if (!(await stat(path)).isFile()) throw new Error(`Not a file: ${name}`)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  files.push({ name, bytes: (await stat(path)).size, sha256: hash.digest('hex') })
}
const manifest = {
  version,
  platform,
  arch: 'x64',
  createdAtUtc: new Date().toISOString(),
  signed: false,
  files,
}
await writeFile(`release/manifest-${platform}.json`, JSON.stringify(manifest, null, 2) + '\n')
await writeFile(
  `release/SHA256SUMS-${platform}.txt`,
  files.map(({ name, sha256 }) => `${sha256}  ${name}`).join('\n') + '\n',
)
console.log(JSON.stringify(manifest, null, 2))
