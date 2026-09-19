import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'
import fontManifest from '../index.js'

const viteVersions = [
  ['6', 'vite-6'],
  ['7', 'vite-7'],
  ['8', 'vite']
]

async function createFixture() {
  const root = await mkdtemp(path.join(process.cwd(), '.vite-test-'))
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(root, 'index.html'), '<link rel="stylesheet" href="/src/style.css">')
  await writeFile(path.join(root, 'src/shared.woff2'), 'font')
  // Distinct content: Vite deduplicates emitted assets by content hash
  await writeFile(path.join(root, 'src/legacy.ttf'), 'legacy font')
  await writeFile(
    path.join(root, 'src/style.css'),
    [
      '@font-face{font-family:Inter;font-weight:400;src:url(./shared.woff2) format("woff2")}',
      '@font-face{font-family:Inter;font-weight:700;src:url(./shared.woff2) format("woff2")}',
      '@font-face{font-family:Legacy;font-weight:normal;src:url(./legacy.ttf) format("truetype")}'
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

    expect(stylesheet.fonts).toEqual(['src/shared.woff2', 'src/legacy.ttf'])
    // The CSS minifier rewrites `normal` to `400` before the plugin sees it
    expect(stylesheet.fontFaces.map(({ weight }) => weight)).toEqual(['400', '700', '400'])
    expect(stylesheet.fontFaces.map(({ weightRange }) => weightRange)).toEqual([
      [400, 400],
      [700, 700],
      [400, 400]
    ])
    expect(stylesheet.fontFaces[2].sources[0]).toMatchObject({
      asset: 'src/legacy.ttf',
      format: 'ttf',
      mime: 'font/ttf'
    })
    expect(manifest['src/legacy.ttf'].fontFaces[0]).toMatchObject({
      format: 'ttf',
      mime: 'font/ttf'
    })
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
