import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, vi } from 'vitest'
import fontManifest from '../index.js'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

const regularFace = `@font-face {
  font-family: "Univers";
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  src: url(/build/assets/Univers-regular.woff2) format("woff2"), url(/build/assets/Univers-regular.woff) format("woff");
}`

const boldFace = `@font-face {
  font-family: "Univers";
  font-weight: 700;
  font-style: normal;
  src: url(/build/assets/Univers-bold.woff2) format("woff2");
}`

const italicFace = `@font-face {
  font-family: "Univers";
  font-weight: 400;
  font-style: italic;
  src: url(/build/assets/Univers-italic.woff2) format("woff2");
}`

const variableFace = `@font-face {
  font-family: "Literata";
  font-weight: 100 900;
  font-style: normal;
  src: url(/build/assets/Literata.woff2) format("woff2");
}`

function asset(fileName, originalFileName, source = '') {
  return { type: 'asset', fileName, originalFileName, source }
}

function bundleFor(css, files = []) {
  const bundle = { main: asset('assets/main.css', 'src/main.css', css) }
  for (const file of files) {
    bundle[file] = asset(`assets/${file}`, `src/fonts/${file}`)
  }
  return bundle
}

const universFiles = [
  'Univers-regular.woff2',
  'Univers-regular.woff',
  'Univers-bold.woff2',
  'Univers-italic.woff2'
]

const sansFamily = { sans: { family: 'Univers', variable: '--font-sans' } }

async function build(bundle, { laravel, base = '/', build = { manifest: true } } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'laravel-fonts-'))
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({}))

  try {
    const plugin = fontManifest({ laravel })
    plugin.configResolved({ base, build })
    plugin.generateBundle({ dir: directory }, bundle)
    await plugin.writeBundle({ dir: directory })

    return {
      files: await readdir(directory),
      viteManifest: JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function buildManifest(bundle, options) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'laravel-fonts-'))
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({}))

  const plugin = fontManifest({ laravel: options?.laravel })
  plugin.configResolved({ base: options?.base ?? '/', build: options?.build ?? { manifest: true } })
  plugin.generateBundle({ dir: directory }, bundle)

  try {
    await plugin.writeBundle.call({ ...plugin, ...options?.context }, { dir: directory })
    const filename = options?.laravel?.manifestFilename ?? 'fonts-manifest.json'
    return {
      manifest: JSON.parse(await readFile(path.join(directory, filename), 'utf8')),
      files: await readdir(directory),
      directory
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

async function errorFor(bundle, laravel, options) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'laravel-fonts-'))
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({}))

  try {
    const plugin = fontManifest({ laravel })
    plugin.configResolved({ base: options?.base ?? '/', build: { manifest: true } })
    plugin.generateBundle({ dir: directory }, bundle)
    await plugin.writeBundle({ dir: directory })
    return null
  } catch (error) {
    return error.message
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

// 1 + 23
test('stays opt-in and writes nothing extra without laravel options', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { files, viteManifest } = await build(bundleFor(regularFace, universFiles))

  expect(files).toEqual(['manifest.json'])
  expect(viteManifest).toEqual({})
  expect(warn).not.toHaveBeenCalled()
  warn.mockRestore()
})

// 2
test('leaves a build without fonts or laravel options untouched', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { files } = await build({ main: asset('assets/main.css', 'src/main.css', '.a{color:red}') })

  expect(files).toEqual(['manifest.json'])
  expect(warn).not.toHaveBeenCalled()
  warn.mockRestore()
})

test('leaves the ordinary vite manifest untouched in laravel mode', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'laravel-fonts-'))
  const original = { 'src/main.css': { file: 'assets/main.css', isEntry: true } }
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(original))

  try {
    const plugin = fontManifest({ laravel: { families: sansFamily } })
    plugin.configResolved({ base: '/build/', build: { manifest: true } })
    plugin.generateBundle({ dir: directory }, bundleFor(regularFace, universFiles))
    await plugin.writeBundle({ dir: directory })

    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
    expect(manifest['src/main.css'].fontFaces).toHaveLength(1)
    expect(await readdir(directory)).toEqual(['fonts-manifest.json', 'manifest.json'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// 3 + 5
test('emits inline styles with every configured face and a :root block', async () => {
  const { manifest } = await buildManifest(
    bundleFor(`${regularFace}\n${boldFace}\n${variableFace}`, [...universFiles, 'Literata.woff2']),
    {
      base: '/build/',
      laravel: {
        families: {
          sans: { family: 'Univers', variable: '--font-sans' },
          serif: { family: 'Literata', variable: '--font-serif' }
        }
      }
    }
  )

  expect(manifest.version).toBe(1)
  expect(manifest.style.inline).toContain('font-family: "Univers"')
  expect(manifest.style.inline).toContain('font-weight: 700')
  expect(manifest.style.inline).toContain('font-family: "Literata"')
  expect(manifest.style.inline).toContain(
    ':root {\n  --font-sans: "Univers";\n  --font-serif: "Literata";\n}'
  )
  expect(manifest.style.inline.match(/@font-face/g)).toHaveLength(3)
  expect(manifest.families).toEqual({
    sans: { family: 'Univers', variable: '--font-sans' },
    serif: { family: 'Literata', variable: '--font-serif' }
  })
})

// 4 + 5
test('keys family styles and variables by alias', async () => {
  const { manifest } = await buildManifest(
    bundleFor(`${regularFace}\n${variableFace}`, [...universFiles, 'Literata.woff2']),
    {
      base: '/build/',
      laravel: {
        families: {
          sans: { family: 'Univers', variable: '--font-sans' },
          serif: { family: 'Literata', variable: '--font-serif' }
        }
      }
    }
  )

  expect(Object.keys(manifest.style.familyStyles)).toEqual(['sans', 'serif'])
  expect(manifest.style.familyStyles.sans).toContain('Univers')
  expect(manifest.style.familyStyles.sans).not.toContain('Literata')
  expect(manifest.style.familyStyles.serif).toContain('Literata')
  expect(manifest.style.variables).toEqual({
    sans: '--font-sans: "Univers";',
    serif: '--font-serif: "Literata";'
  })
  for (const declaration of Object.values(manifest.style.variables)) {
    expect(declaration.endsWith(';')).toBe(true)
  }
})

// 6
test('rewrites bundled font urls to document-safe urls', async () => {
  const css = `@font-face{font-family:Univers;font-weight:400;src:url(../assets/Univers-regular.woff2?v=1) format("woff2"),url(data:font/woff2;base64,AAAA) format("woff2")}`
  const bundle = {
    main: asset('nested/main.css', 'src/main.css', css),
    font: asset('assets/Univers-regular.woff2', 'src/fonts/Univers-regular.woff2')
  }
  const { manifest } = await buildManifest(bundle, {
    base: '/build/',
    laravel: { families: sansFamily }
  })

  expect(manifest.style.familyStyles.sans).toContain('url(/build/assets/Univers-regular.woff2?v=1)')
  expect(manifest.style.familyStyles.sans).toContain('url(data:font/woff2;base64,AAAA)')
  expect(manifest.style.familyStyles.sans).not.toContain('../assets')
})

test('leaves remote and public directory urls alone', async () => {
  const css = `@font-face{font-family:Univers;font-weight:400;src:url(/fonts/public.woff2) format("woff2"),url(https://cdn.example.com/x.woff2) format("woff2")}`
  const { manifest } = await buildManifest(
    { main: asset('assets/main.css', 'src/main.css', css) },
    { base: '/build/', laravel: { families: sansFamily } }
  )

  expect(manifest.style.familyStyles.sans).toContain('url(/fonts/public.woff2)')
  expect(manifest.style.familyStyles.sans).toContain('url(https://cdn.example.com/x.woff2)')
})

test('fails when a relative base cannot produce document-safe urls', async () => {
  const message = await errorFor(
    bundleFor(regularFace, universFiles),
    { families: sansFamily },
    { base: './' }
  )

  expect(message).toContain('document-safe')
  expect(message).toContain('absolute `base`')
})

// 7
test.each([
  ['default base', '/'],
  ['laravel base', '/build/'],
  ['asset url base', 'https://cdn.example.com/build/']
])('emits preload files without the base prefix under %s', async (_, base) => {
  const { manifest } = await buildManifest(bundleFor(regularFace, universFiles), {
    base,
    laravel: { families: sansFamily, preload: [{ alias: 'sans', weight: 400 }] }
  })

  expect(manifest.preloads[0].file).toBe('assets/Univers-regular.woff2')
})

// 8 + 10
test('prefers woff2 over woff and always names the alias', async () => {
  const { manifest } = await buildManifest(bundleFor(regularFace, universFiles), {
    base: '/build/',
    laravel: { families: sansFamily, preload: [{ family: 'Univers', weight: 400 }] }
  })

  expect(manifest.preloads).toEqual([
    {
      alias: 'sans',
      family: 'Univers',
      weight: 400,
      style: 'normal',
      file: 'assets/Univers-regular.woff2',
      as: 'font',
      type: 'font/woff2',
      crossorigin: 'anonymous'
    }
  ])
})

// 9
test('resolves alias and family selectors identically', async () => {
  const options = { base: '/build/', laravel: { families: sansFamily } }
  const bundle = bundleFor(regularFace, universFiles)
  const byAlias = await buildManifest(bundle, {
    ...options,
    laravel: { ...options.laravel, preload: [{ alias: 'sans', weight: 400 }] }
  })
  const byFamily = await buildManifest(bundle, {
    ...options,
    laravel: { ...options.laravel, preload: [{ family: 'Univers', weight: 400 }] }
  })

  expect(byAlias.manifest.preloads).toEqual(byFamily.manifest.preloads)
})

// 11
test('keeps one preload entry per alias when two aliases share a family', async () => {
  const { manifest } = await buildManifest(bundleFor(regularFace, universFiles), {
    base: '/build/',
    laravel: {
      families: {
        sans: { family: 'Univers', variable: '--font-sans' },
        display: { family: 'Univers', variable: '--font-display' }
      },
      preload: [
        { alias: 'sans', weight: 400 },
        { alias: 'display', weight: 400 }
      ]
    }
  })

  expect(manifest.preloads.map(({ alias, file }) => [alias, file])).toEqual([
    ['sans', 'assets/Univers-regular.woff2'],
    ['display', 'assets/Univers-regular.woff2']
  ])
})

// 12
test('deduplicates selectors resolving to the same alias and file', async () => {
  const { manifest } = await buildManifest(bundleFor(regularFace, universFiles), {
    base: '/build/',
    laravel: {
      families: sansFamily,
      preload: [
        { alias: 'sans', weight: 400 },
        { family: 'Univers', weight: 400, style: 'normal' }
      ]
    }
  })

  expect(manifest.preloads).toHaveLength(1)
})

// 13
test('selects the normal face when style is omitted', async () => {
  const { manifest } = await buildManifest(
    bundleFor(`${regularFace}\n${italicFace}`, universFiles),
    {
      base: '/build/',
      laravel: {
        families: sansFamily,
        preload: [{ alias: 'sans', weight: 400 }, { alias: 'sans', weight: 400, style: 'italic' }]
      }
    }
  )

  expect(manifest.preloads.map(({ style, file }) => [style, file])).toEqual([
    ['normal', 'assets/Univers-regular.woff2'],
    ['italic', 'assets/Univers-italic.woff2']
  ])
})

// 14
test('matches a variable font weight range', async () => {
  const { manifest } = await buildManifest(bundleFor(variableFace, ['Literata.woff2']), {
    base: '/build/',
    laravel: {
      families: { serif: { family: 'Literata', variable: '--font-serif' } },
      preload: [{ alias: 'serif', weight: 400 }]
    }
  })

  expect(manifest.preloads).toHaveLength(1)
  expect(manifest.preloads[0].weight).toBe(400)
  expect(manifest.preloads[0].file).toBe('assets/Literata.woff2')
})

test('supports per-selector preload attribute overrides', async () => {
  const { manifest } = await buildManifest(bundleFor(regularFace, universFiles), {
    base: '/build/',
    laravel: {
      families: sansFamily,
      preload: [{ alias: 'sans', weight: 400, crossorigin: null, type: 'font/woff2' }]
    }
  })

  expect(manifest.preloads[0]).not.toHaveProperty('crossorigin')
  expect(manifest.preloads[0].type).toBe('font/woff2')
})

// 15
test.each([
  [{ alias: 'display', weight: 400 }, 'unknown alias "display"'],
  [{ family: 'Helvetica', weight: 400 }, 'unconfigured family "Helvetica"']
])('rejects unknown selectors (%#)', async (selector, expected) => {
  const laravel = { families: sansFamily, preload: [selector] }
  const message = selector.alias
    ? errorMessageFor(() => fontManifest({ laravel }))
    : await errorFor(bundleFor(regularFace, universFiles), laravel, { base: '/build/' })

  expect(message).toContain(expected)
})

function errorMessageFor(callback) {
  try {
    callback()
    return null
  } catch (error) {
    return error.message
  }
}

// 16
test('rejects a family selector matching several aliases', async () => {
  const message = await errorFor(
    bundleFor(regularFace, universFiles),
    {
      families: {
        sans: { family: 'Univers', variable: '--font-sans' },
        display: { family: 'Univers', variable: '--font-display' }
      },
      preload: [{ family: 'Univers', weight: 400 }]
    },
    { base: '/build/' }
  )

  expect(message).toContain('ambiguous')
  expect(message).toContain('"sans", "display"')
})

// 17
test('fails when a configured family is never declared', async () => {
  const message = await errorFor(
    bundleFor(regularFace, universFiles),
    { families: { serif: { family: 'Literata', variable: '--font-serif' } } },
    { base: '/build/' }
  )

  expect(message).toContain('No @font-face rule declares family "Literata"')
  expect(message).toContain('Observed families: "Univers"')
})

test('fails when a client build carries no stylesheets at all', async () => {
  const message = await errorFor({}, { families: sansFamily }, { base: '/build/' })

  expect(message).toContain('No @font-face rule declares family "Univers"')
})

// 18
test('fails when a selector matches no observed face', async () => {
  const message = await errorFor(
    bundleFor(regularFace, universFiles),
    { families: sansFamily, preload: [{ alias: 'sans', weight: 900 }] },
    { base: '/build/' }
  )

  expect(message).toContain('matches no observed face')
  expect(message).toContain('weight 900')
})

// 19
test('fails on equally preferred sources', async () => {
  const css = `@font-face{font-family:Univers;font-weight:400;src:url(/build/assets/a.woff2) format("woff2"),url(/build/assets/b.woff2) format("woff2")}`
  const bundle = {
    main: asset('assets/main.css', 'src/main.css', css),
    a: asset('assets/a.woff2', 'src/fonts/a.woff2'),
    b: asset('assets/b.woff2', 'src/fonts/b.woff2')
  }
  const message = await errorFor(
    bundle,
    { families: sansFamily, preload: [{ alias: 'sans', weight: 400 }] },
    { base: '/build/' }
  )

  expect(message).toContain('equally')
  expect(message).toContain('assets/a.woff2')
})

// 20
test.each([
  ['data', 'url(data:font/woff2;base64,AAAA) format("woff2")'],
  ['remote', 'url(https://cdn.example.com/Univers.woff2) format("woff2")'],
  ['public directory', 'url(/fonts/Univers.woff2) format("woff2")']
])('refuses to preload %s sources', async (_, src) => {
  const css = `@font-face{font-family:Univers;font-weight:400;src:${src}}`
  const message = await errorFor(
    { main: asset('assets/main.css', 'src/main.css', css) },
    { families: sansFamily, preload: [{ alias: 'sans', weight: 400 }] },
    { base: '/build/' }
  )

  expect(message).toContain('no bundled source')
})

// 21
test('refuses to preload a source with an unresolvable mime type', async () => {
  const css = `@font-face{font-family:Univers;font-weight:400;src:url(/build/assets/Univers.bin) format("nonsense")}`
  const bundle = {
    main: asset('assets/main.css', 'src/main.css', css),
    font: asset('assets/Univers.bin', 'src/fonts/Univers.bin')
  }
  const message = await errorFor(
    bundle,
    { families: sansFamily, preload: [{ alias: 'sans', weight: 400 }] },
    { base: '/build/' }
  )

  expect(message).toContain('Univers.bin')
  expect(message).toContain('unknown')
})

// 22
test('respects a custom manifest filename', async () => {
  const { manifest, files } = await buildManifest(bundleFor(regularFace, universFiles), {
    base: '/build/',
    laravel: { families: sansFamily, manifestFilename: 'my-fonts.json' }
  })

  expect(files).toContain('my-fonts.json')
  expect(files).not.toContain('fonts-manifest.json')
  expect(manifest.version).toBe(1)
})

// 23 + 24
test.each([
  ['an ssr build', { manifest: true, ssr: 'src/ssr.js' }, undefined],
  ['a manifest-less build', { manifest: false }, undefined],
  ['a non-client environment', { manifest: true }, { environment: { name: 'ssr' } }]
])('skips %s instead of failing', async (_, buildConfig, context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'laravel-fonts-'))

  try {
    const plugin = fontManifest({ laravel: { families: sansFamily } })
    plugin.configResolved({ base: '/build/', build: buildConfig })
    plugin.generateBundle({ dir: directory }, {})
    await expect(
      plugin.writeBundle.call({ ...plugin, ...context }, { dir: directory })
    ).resolves.toBeUndefined()

    expect(await readdir(directory)).toEqual([])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('never writes a development manifest', async () => {
  const { files } = await buildManifest(bundleFor(regularFace, universFiles), {
    base: '/build/',
    laravel: { families: sansFamily }
  })

  expect(files).not.toContain('fonts-manifest.dev.json')
})

test.each([
  [{}, '`laravel.families` must be a non-empty object'],
  [{ families: {} }, '`laravel.families` must be a non-empty object'],
  [{ families: [] }, '`laravel.families` must be a non-empty object'],
  [{ families: { sans: { variable: '--font-sans' } } }, 'missing a "family"'],
  [{ families: { sans: { family: 'Univers' } } }, 'needs a "variable"'],
  [{ families: { sans: { family: 'Univers', variable: 'font-sans' } } }, 'needs a "variable"'],
  [
    { families: { sans: { family: 'Univers, sans-serif', variable: '--font-sans' } } },
    'fallback stacks are not supported'
  ],
  [{ families: sansFamily, preload: [{ weight: 400 }] }, 'exactly one of "alias" and "family"'],
  [
    { families: sansFamily, preload: [{ alias: 'sans', family: 'Univers', weight: 400 }] },
    'exactly one of "alias" and "family"'
  ],
  [{ families: sansFamily, preload: [{ alias: 'sans' }] }, 'missing a "weight"'],
  [{ families: sansFamily, preload: [{ alias: 'sans', weight: 'heavy' }] }, 'invalid weight'],
  [
    { families: sansFamily, preload: [{ alias: 'sans', weight: 400, style: 'slanted' }] },
    'unknown style'
  ],
  [{ families: sansFamily, manifestFilename: 'nested/fonts.json' }, 'must be a filename, not a path'],
  [{ families: sansFamily, style: 'file' }, '`laravel.style` must be one of "inline"']
])('rejects invalid configuration at plugin construction (%#)', (laravel, expected) => {
  expect(() => fontManifest({ laravel })).toThrowError(expected)
})

test('reports the preload index in policy errors', async () => {
  const message = await errorFor(
    bundleFor(regularFace, universFiles),
    {
      families: sansFamily,
      preload: [{ alias: 'sans', weight: 400 }, { alias: 'sans', weight: 900 }]
    },
    { base: '/build/' }
  )

  expect(message).toContain('preload[1]')
})

// 26
test('reproduces the target output for a vendored stylesheet', async () => {
  const css = await readFile(path.join(fixtures, 'univers.css'), 'utf8')
  const bundle = {
    main: asset('assets/app-7f8e9d.css', 'src/app.css', css),
    light2: asset('assets/Univers-light-a1b2c3.woff2', 'src/fonts/Univers-light.woff2'),
    light: asset('assets/Univers-light-a1b2c3.woff', 'src/fonts/Univers-light.woff'),
    regular2: asset('assets/Univers-regular-d4e5f6.woff2', 'src/fonts/Univers-regular.woff2'),
    regular: asset('assets/Univers-regular-d4e5f6.woff', 'src/fonts/Univers-regular.woff'),
    italic: asset('assets/Univers-italic-091a2b.woff2', 'src/fonts/Univers-italic.woff2'),
    bold: asset('assets/Univers-bold-3c4d5e.woff2', 'src/fonts/Univers-bold.woff2'),
    literata: asset('assets/Literata-6f7a8b.woff2', 'src/fonts/Literata.woff2'),
    mono: asset('assets/LegacyMono-9c0d1e.ttf', 'src/fonts/LegacyMono.ttf')
  }

  const { manifest } = await buildManifest(bundle, {
    base: '/build/',
    laravel: {
      families: {
        sans: { family: 'Univers', variable: '--font-sans' },
        serif: { family: 'Literata Variable', variable: '--font-serif' },
        mono: { family: 'Legacy Mono', variable: '--font-mono' }
      },
      preload: [
        { alias: 'sans', weight: 400 },
        { alias: 'sans', weight: 700 },
        { family: 'Literata Variable', weight: 400 },
        { alias: 'mono', weight: 400 }
      ]
    }
  })

  expect(manifest.style.familyStyles.sans.match(/@font-face/g)).toHaveLength(4)
  expect(manifest.style.familyStyles.serif.match(/@font-face/g)).toHaveLength(1)
  expect(manifest.style.inline.match(/@font-face/g)).toHaveLength(6)
  expect(manifest.style.inline).not.toContain('.prose')
  expect(manifest.style.variables.serif).toBe('--font-serif: "Literata Variable";')
  expect(manifest.preloads).toEqual([
    {
      alias: 'sans',
      family: 'Univers',
      weight: 400,
      style: 'normal',
      file: 'assets/Univers-regular-d4e5f6.woff2',
      as: 'font',
      type: 'font/woff2',
      crossorigin: 'anonymous'
    },
    {
      alias: 'sans',
      family: 'Univers',
      weight: 700,
      style: 'normal',
      file: 'assets/Univers-bold-3c4d5e.woff2',
      as: 'font',
      type: 'font/woff2',
      crossorigin: 'anonymous'
    },
    {
      alias: 'serif',
      family: 'Literata Variable',
      weight: 400,
      style: 'normal',
      file: 'assets/Literata-6f7a8b.woff2',
      as: 'font',
      type: 'font/woff2',
      crossorigin: 'anonymous'
    },
    {
      alias: 'mono',
      family: 'Legacy Mono',
      weight: 400,
      style: 'normal',
      file: 'assets/LegacyMono-9c0d1e.ttf',
      as: 'font',
      type: 'font/ttf',
      crossorigin: 'anonymous'
    }
  ])
})

test('matches configured families case-insensitively but emits the configured spelling', async () => {
  const css = regularFace.replace('"Univers"', 'univers')
  const { manifest } = await buildManifest(bundleFor(css, universFiles), {
    base: '/build/',
    laravel: {
      families: { sans: { family: 'Univers', variable: '--font-sans' } },
      preload: [{ alias: 'sans', weight: 400 }]
    }
  })

  expect(manifest.families.sans.family).toBe('Univers')
  expect(manifest.preloads[0].family).toBe('Univers')
  expect(manifest.style.variables.sans).toBe('--font-sans: "Univers";')
})
