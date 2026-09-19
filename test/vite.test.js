import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'
import fontManifest from '../index.js'

const viteVersions = [
  ['5', 'vite-5'],
  ['6', 'vite-6'],
  ['7', 'vite-7'],
  ['8', 'vite']
]

async function createFixture() {
  const root = await mkdtemp(path.join(process.cwd(), '.vite-test-'))
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(root, 'index.html'), '<link rel="stylesheet" href="/src/style.css">')
  await writeFile(path.join(root, 'src/shared.woff2'), 'font')
  await writeFile(
    path.join(root, 'src/style.css'),
    [
      '@font-face{font-family:Inter;font-weight:400;src:url(./shared.woff2) format("woff2")}',
      '@font-face{font-family:Inter;font-weight:700;src:url(./shared.woff2) format("woff2")}'
    ].join('')
  )
  return root
}

test.each(viteVersions)('builds a font manifest with Vite %s', async (_, packageName) => {
  const { build } = await import(packageName)
  const root = await createFixture()

  try {
    await build({
      root,
      logLevel: 'silent',
      plugins: [fontManifest()],
      build: {
        assetsInlineLimit: 0,
        emptyOutDir: true,
        manifest: 'manifest.json',
        outDir: 'dist'
      }
    })

    const manifest = JSON.parse(await readFile(path.join(root, 'dist/manifest.json'), 'utf8'))
    const stylesheet = manifest['index.html']
    const font = manifest['src/shared.woff2']

    expect(stylesheet.fonts).toEqual(['src/shared.woff2'])
    expect(stylesheet.fontFaces.map(({ weight }) => weight)).toEqual(['400', '700'])
    expect(font.file).toMatch(/^assets\/shared-[\w-]+\.woff2$/)
    expect(font.fontFaces.map(({ weight }) => weight)).toEqual(['400', '700'])
    expect(font.fontFaces.map(({ definedIn }) => definedIn)).toEqual([
      ['index.html'],
      ['index.html']
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
