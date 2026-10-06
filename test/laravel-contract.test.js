import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import postcss from 'postcss'
import { expect, test } from 'vitest'
import fontManifest from '../index.js'
import { ensureValidManifest, ensureValidPreloads, renderFonts } from './laravel-vite-fonts.js'

const css = `@font-face {
  font-family: "Univers";
  font-weight: 400;
  font-style: normal;
  src: url(/build/assets/Univers-regular.woff2) format("woff2");
}
@font-face {
  font-family: "Literata";
  font-weight: 100 900;
  font-style: normal;
  src: url(/build/assets/Literata.woff2) format("woff2");
}`

const laravel = {
  families: {
    sans: { family: 'Univers', variable: '--font-sans' },
    serif: { family: 'Literata', variable: '--font-serif' }
  },
  preload: [
    { alias: 'sans', weight: 400 },
    { alias: 'serif', weight: 400 }
  ]
}

async function emitManifest() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'laravel-contract-'))
  await writeFile(path.join(directory, 'manifest.json'), '{}')

  try {
    const plugin = fontManifest({ laravel })
    plugin.configResolved({ base: '/build/', build: { manifest: true } })
    plugin.generateBundle({ dir: directory }, {
      main: { type: 'asset', fileName: 'assets/main.css', originalFileName: 'src/main.css', source: css },
      sans: {
        type: 'asset',
        fileName: 'assets/Univers-regular.woff2',
        originalFileName: 'src/fonts/Univers-regular.woff2',
        source: ''
      },
      serif: {
        type: 'asset',
        fileName: 'assets/Literata.woff2',
        originalFileName: 'src/fonts/Literata.woff2',
        source: ''
      }
    })
    await plugin.writeBundle({ dir: directory })

    return JSON.parse(await readFile(path.join(directory, 'fonts-manifest.json'), 'utf8'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('laravel accepts the emitted manifest', async () => {
  const manifest = await emitManifest()

  expect(() => ensureValidManifest(manifest)).not.toThrow()
  expect(() => ensureValidPreloads(manifest)).not.toThrow()
})

test('an unfiltered @fonts call renders preload links and a style block', async () => {
  const { links, style } = renderFonts(await emitManifest())

  expect(links).toEqual([
    '<link rel="preload" as="font" href="/build/assets/Univers-regular.woff2" type="font/woff2" crossorigin="anonymous" />',
    '<link rel="preload" as="font" href="/build/assets/Literata.woff2" type="font/woff2" crossorigin="anonymous" />'
  ])
  expect(style).toContain('<style>')
  expect(style).toContain('@font-face')
  expect(style).toContain('--font-sans: "Univers";')
})

test('a filtered @fonts call renders only the requested family', async () => {
  const { links, style } = renderFonts(await emitManifest(), ['sans'])

  expect(links).toHaveLength(1)
  expect(links[0]).toContain('Univers-regular.woff2')
  expect(style).toContain('Univers')
  expect(style).not.toContain('Literata')
  expect(style).toContain(':root {\n  --font-sans: "Univers";\n}')
})

// postcss does not reject a missing semicolon, it swallows the next declaration,
// so count the variables Laravel actually renders rather than asserting it parses.
test.each([[['sans'], 1], [['serif'], 1], [['sans', 'serif'], 2], [null, 2]])(
  'laravel renders one custom property per requested alias (%s)',
  async (aliases, expected) => {
    const { style } = renderFonts(await emitManifest(), aliases)
    const contents = style.replace(/^<style>\n/, '').replace(/\n<\/style>$/, '')

    const variables = []
    postcss.parse(contents).walkRules(':root', (rule) => {
      rule.walkDecls((declaration) => variables.push(declaration.prop))
    })

    expect(variables).toHaveLength(expected)
    expect(variables.every((name) => name.startsWith('--font-'))).toBe(true)
  }
)
