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

test.each(viteVersions)('builds a laravel font manifest with Vite %s', async (_, packageName) => {
  const { build } = await import(packageName)
  const root = await createFixture()

  try {
    await build({
      root,
      base: '/build/',
      logLevel: 'silent',
      plugins: [
        fontManifest({
          laravel: {
            families: {
              sans: { family: 'Inter', variable: '--font-sans' },
              mono: { family: 'Legacy', variable: '--font-mono' }
            },
            preload: [
              { alias: 'sans', weight: 400 },
              { family: 'Legacy', weight: 400 }
            ]
          }
        })
      ],
      build: {
        assetsInlineLimit: 0,
        emptyOutDir: true,
        manifest: 'manifest.json',
        outDir: 'dist'
      }
    })

    const manifest = JSON.parse(
      await readFile(path.join(root, 'dist/fonts-manifest.json'), 'utf8')
    )

    expect(manifest.version).toBe(1)
    expect(manifest.families).toEqual({
      sans: { family: 'Inter', variable: '--font-sans' },
      mono: { family: 'Legacy', variable: '--font-mono' }
    })
    expect(manifest.style.variables).toEqual({
      sans: '--font-sans: "Inter";',
      mono: '--font-mono: "Legacy";'
    })
    expect(manifest.style.inline).toContain(':root {')
    expect(manifest.style.inline.match(/@font-face/g)).toHaveLength(3)
    expect(manifest.style.familyStyles.sans).toContain('url(/build/assets/shared-')
    expect(withoutHashes(manifest.preloads)).toEqual([
      {
        alias: 'sans',
        family: 'Inter',
        weight: 400,
        style: 'normal',
        file: 'assets/shared.woff2',
        as: 'font',
        type: 'font/woff2',
        crossorigin: 'anonymous'
      },
      {
        alias: 'mono',
        family: 'Legacy',
        weight: 400,
        style: 'normal',
        file: 'assets/legacy.ttf',
        as: 'font',
        type: 'font/ttf',
        crossorigin: 'anonymous'
      }
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function withoutHashes(preloads) {
  return preloads.map((preload) => ({
    ...preload,
    file: preload.file.replace(/-[\w-]+(\.\w+)$/, '$1')
  }))
}
