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

test('stays opt-in and writes nothing extra without laravel options', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { files, viteManifest } = await build(bundleFor(regularFace, universFiles))

  expect(files).toEqual(['manifest.json'])
  expect(viteManifest).toEqual({})
  expect(warn).not.toHaveBeenCalled()
  warn.mockRestore()
})

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
    const plugin = fontManifest({ laravel: true })
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

test('writes every observed family with derived aliases and variables', async () => {
  const { manifest } = await buildManifest(
    bundleFor(`${regularFace}\n${boldFace}\n${variableFace}`, [...universFiles, 'Literata.woff2']),
    { base: '/build/', laravel: true }
  )

  expect(manifest.version).toBe(1)
  expect(manifest.families).toEqual({
    univers: { family: 'Univers', variable: '--font-univers' },
    literata: { family: 'Literata', variable: '--font-literata' }
  })
  expect(manifest.style.inline.match(/@font-face/g)).toHaveLength(3)
  expect(manifest.style.inline).toContain(
    ':root {\n  --font-univers: "Univers";\n  --font-literata: "Literata";\n}'
  )
})

test('treats an empty object like true', async () => {
  const bundle = bundleFor(regularFace, universFiles)
  const fromTrue = await buildManifest(bundle, { base: '/build/', laravel: true })
  const fromObject = await buildManifest(bundle, { base: '/build/', laravel: {} })

  expect(fromObject.manifest).toEqual(fromTrue.manifest)
})

test('slugs multi-word families like laravel-vite-plugin does', async () => {
  const { manifest } = await buildManifest(
    bundleFor(regularFace.replace('"Univers"', '"Brand Sans Pro"'), universFiles),
    { base: '/build/', laravel: true }
  )

  expect(manifest.families).toEqual({
    'brand-sans-pro': { family: 'Brand Sans Pro', variable: '--font-brand-sans-pro' }
  })
})

test('keys family styles and variables by alias', async () => {
  const { manifest } = await buildManifest(
    bundleFor(`${regularFace}\n${variableFace}`, [...universFiles, 'Literata.woff2']),
    { base: '/build/', laravel: true }
  )

  expect(Object.keys(manifest.style.familyStyles)).toEqual(['univers', 'literata'])
  expect(manifest.style.familyStyles.univers).toContain('Univers')
  expect(manifest.style.familyStyles.univers).not.toContain('Literata')
  expect(manifest.style.familyStyles.literata).toContain('Literata')
  expect(manifest.style.variables).toEqual({
    univers: '--font-univers: "Univers";',
    literata: '--font-literata: "Literata";'
  })
})

test('groups families case-insensitively and keeps the first spelling', async () => {
  const css = `${regularFace}\n${boldFace.replace('"Univers"', 'univers')}`
  const { manifest } = await buildManifest(bundleFor(css, universFiles), {
    base: '/build/',
    laravel: true
  })

  expect(manifest.families).toEqual({ univers: { family: 'Univers', variable: '--font-univers' } })
  expect(manifest.style.familyStyles.univers.match(/@font-face/g)).toHaveLength(2)
})

test('includes only the listed families', async () => {
  const { manifest } = await buildManifest(
    bundleFor(`${regularFace}\n${variableFace}`, [...universFiles, 'Literata.woff2']),
    { base: '/build/', laravel: { include: ['literata'] } }
  )

  expect(Object.keys(manifest.families)).toEqual(['literata'])
  expect(manifest.style.inline).not.toContain('Univers')
  expect(manifest.preloads.map(({ alias }) => alias)).toEqual(['literata'])
})

test('excludes the listed families', async () => {
  const { manifest } = await buildManifest(
    bundleFor(`${regularFace}\n${variableFace}`, [...universFiles, 'Literata.woff2']),
    { base: '/build/', laravel: { exclude: 'Literata' } }
  )

  expect(Object.keys(manifest.families)).toEqual(['univers'])
  expect(manifest.style.inline).not.toContain('Literata')
})

test.each(['include', 'exclude'])('fails when %s names an undeclared family', async (name) => {
  const message = await errorFor(bundleFor(regularFace, universFiles), { [name]: ['Helvetica'] })

  expect(message).toContain(`\`laravel.${name}\` names "Helvetica"`)
  expect(message).toContain('Observed families: "Univers"')
})

test('fails when two families map to the same alias', async () => {
  const css = `${regularFace}\n${boldFace.replace('"Univers"', '"Univers!"')}`
  const message = await errorFor(bundleFor(css, universFiles), true)

  expect(message).toContain('"Univers" and "Univers!" both map to the Laravel alias "univers"')
  expect(message).toContain('laravel.exclude')
})

test('fails when a family yields no alias', async () => {
  const message = await errorFor(bundleFor(regularFace.replace('"Univers"', '"游ゴシック"'), universFiles), true)

  expect(message).toContain('Cannot derive a Laravel alias from font family "游ゴシック"')
})

test('writes a valid empty manifest when no fonts are declared', async () => {
  const { manifest } = await buildManifest(
    { main: asset('assets/main.css', 'src/main.css', '.a{color:red}') },
    { base: '/build/', laravel: true }
  )

  expect(manifest).toEqual({
    version: 1,
    style: { inline: '', familyStyles: {}, variables: {} },
    preloads: [],
    families: {}
  })
})

test('rewrites bundled font urls to document-safe urls', async () => {
  const css = `@font-face{font-family:Univers;font-weight:400;src:url(../assets/Univers-regular.woff2?v=1) format("woff2"),url(data:font/woff2;base64,AAAA) format("woff2")}`
  const bundle = {
    main: asset('nested/main.css', 'src/main.css', css),
    font: asset('assets/Univers-regular.woff2', 'src/fonts/Univers-regular.woff2')
  }
  const { manifest } = await buildManifest(bundle, { base: '/build/', laravel: true })

  expect(manifest.style.familyStyles.univers).toContain('url(/build/assets/Univers-regular.woff2?v=1)')
  expect(manifest.style.familyStyles.univers).toContain('url(data:font/woff2;base64,AAAA)')
  expect(manifest.style.familyStyles.univers).not.toContain('../assets')
})

test('leaves remote and public directory urls alone', async () => {
  const css = `@font-face{font-family:Univers;font-weight:400;src:url(/fonts/public.woff2) format("woff2"),url(https://cdn.example.com/x.woff2) format("woff2")}`
  const { manifest } = await buildManifest(
    { main: asset('assets/main.css', 'src/main.css', css) },
    { base: '/build/', laravel: true }
  )

  expect(manifest.style.familyStyles.univers).toContain('url(/fonts/public.woff2)')
  expect(manifest.style.familyStyles.univers).toContain('url(https://cdn.example.com/x.woff2)')
})

test('fails when a relative base cannot produce document-safe urls', async () => {
  const message = await errorFor(bundleFor(regularFace, universFiles), true, { base: './' })

  expect(message).toContain('document-safe')
  expect(message).toContain('absolute `base`')
})

test.each([
  ['default base', '/'],
  ['laravel base', '/build/'],
  ['asset url base', 'https://cdn.example.com/build/']
])('emits preload files without the base prefix under %s', async (_, base) => {
  const { manifest } = await buildManifest(bundleFor(regularFace, universFiles), {
    base,
    laravel: true
  })

  expect(manifest.preloads[0].file).toBe('assets/Univers-regular.woff2')
})

test('preloads every face once, preferring woff2', async () => {
  const { manifest } = await buildManifest(
    bundleFor(`${regularFace}\n${boldFace}\n${italicFace}`, universFiles),
    { base: '/build/', laravel: true }
  )

  expect(manifest.preloads).toEqual([
    {
      alias: 'univers',
      family: 'Univers',
      weight: 400,
      style: 'normal',
      file: 'assets/Univers-regular.woff2',
      as: 'font',
      type: 'font/woff2',
      crossorigin: 'anonymous'
    },
    expect.objectContaining({ weight: 700, style: 'normal', file: 'assets/Univers-bold.woff2' }),
    expect.objectContaining({ weight: 400, style: 'italic', file: 'assets/Univers-italic.woff2' })
  ])
})

test('describes a variable font weight range', async () => {
  const { manifest } = await buildManifest(bundleFor(variableFace, ['Literata.woff2']), {
    base: '/build/',
    laravel: true
  })

  expect(manifest.preloads).toEqual([
    expect.objectContaining({ weight: '100 900', file: 'assets/Literata.woff2' })
  ])
})

test('skips preloads when disabled', async () => {
  const { manifest } = await buildManifest(bundleFor(regularFace, universFiles), {
    base: '/build/',
    laravel: { preload: false }
  })

  expect(manifest.preloads).toEqual([])
  expect(manifest.style.inline).toContain('@font-face')
})

test('picks the first of equally preferred sources', async () => {
  const css = `@font-face{font-family:Univers;font-weight:400;src:url(/build/assets/a.woff2) format("woff2"),url(/build/assets/b.woff2) format("woff2")}`
  const bundle = {
    main: asset('assets/main.css', 'src/main.css', css),
    a: asset('assets/a.woff2', 'src/fonts/a.woff2'),
    b: asset('assets/b.woff2', 'src/fonts/b.woff2')
  }
  const { manifest } = await buildManifest(bundle, { base: '/build/', laravel: true })

  expect(manifest.preloads.map(({ file }) => file)).toEqual(['assets/a.woff2'])
})

test.each([
  ['data', 'url(data:font/woff2;base64,AAAA) format("woff2")'],
  ['remote', 'url(https://cdn.example.com/Univers.woff2) format("woff2")'],
  ['public directory', 'url(/fonts/Univers.woff2) format("woff2")']
])('does not preload %s sources but keeps their css', async (_, src) => {
  const css = `@font-face{font-family:Univers;font-weight:400;src:${src}}`
  const { manifest } = await buildManifest(
    { main: asset('assets/main.css', 'src/main.css', css) },
    { base: '/build/', laravel: true }
  )

  expect(manifest.preloads).toEqual([])
  expect(manifest.style.familyStyles.univers).toContain('@font-face')
})

test('does not preload a source with an unresolvable mime type', async () => {
  const css = `@font-face{font-family:Univers;font-weight:400;src:url(/build/assets/Univers.bin) format("nonsense")}`
  const bundle = {
    main: asset('assets/main.css', 'src/main.css', css),
    font: asset('assets/Univers.bin', 'src/fonts/Univers.bin')
  }
  const { manifest } = await buildManifest(bundle, { base: '/build/', laravel: true })

  expect(manifest.preloads).toEqual([])
})

test('respects a custom manifest filename', async () => {
  const { manifest, files } = await buildManifest(bundleFor(regularFace, universFiles), {
    base: '/build/',
    laravel: { manifestFilename: 'my-fonts.json' }
  })

  expect(files).toContain('my-fonts.json')
  expect(files).not.toContain('fonts-manifest.json')
  expect(manifest.version).toBe(1)
})

test.each([
  ['an ssr build', { manifest: true, ssr: 'src/ssr.js' }, undefined],
  ['a manifest-less build', { manifest: false }, undefined],
  ['a non-client environment', { manifest: true }, { environment: { name: 'ssr' } }]
])('skips %s', async (_, buildConfig, context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'laravel-fonts-'))

  try {
    const plugin = fontManifest({ laravel: true })
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
    laravel: true
  })

  expect(files).not.toContain('fonts-manifest.dev.json')
})

test.each([
  ['sans', '`laravel` must be `true` or an object'],
  [{ families: {} }, 'Unknown `laravel` option "families"'],
  [{ include: ['Univers'], exclude: ['Literata'] }, 'either `laravel.include` or `laravel.exclude`'],
  [{ include: [''] }, '`laravel.include` must be a list of font family names'],
  [{ exclude: [42] }, '`laravel.exclude` must be a list of font family names'],
  [{ preload: [{ weight: 400 }] }, '`laravel.preload` must be `true` or `false`'],
  [{ manifestFilename: 'nested/fonts.json' }, 'must be a filename, not a path'],
  [{ style: 'file' }, '`laravel.style` must be one of "inline"']
])('rejects invalid configuration at plugin construction (%#)', (laravel, expected) => {
  expect(() => fontManifest({ laravel })).toThrowError(expected)
})

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

  const { manifest } = await buildManifest(bundle, { base: '/build/', laravel: true })

  expect(manifest.families).toEqual({
    univers: { family: 'Univers', variable: '--font-univers' },
    'literata-variable': { family: 'Literata Variable', variable: '--font-literata-variable' },
    'legacy-mono': { family: 'Legacy Mono', variable: '--font-legacy-mono' }
  })
  expect(manifest.style.familyStyles.univers.match(/@font-face/g)).toHaveLength(4)
  expect(manifest.style.familyStyles['literata-variable'].match(/@font-face/g)).toHaveLength(1)
  expect(manifest.style.inline.match(/@font-face/g)).toHaveLength(6)
  expect(manifest.style.inline).not.toContain('.prose')
  expect(manifest.preloads.map(({ alias, weight, style, file, type }) => [alias, weight, style, file, type])).toEqual([
    ['univers', 300, 'normal', 'assets/Univers-light-a1b2c3.woff2', 'font/woff2'],
    ['univers', 400, 'normal', 'assets/Univers-regular-d4e5f6.woff2', 'font/woff2'],
    ['univers', 400, 'italic', 'assets/Univers-italic-091a2b.woff2', 'font/woff2'],
    ['univers', 700, 'normal', 'assets/Univers-bold-3c4d5e.woff2', 'font/woff2'],
    ['literata-variable', '100 900', 'normal', 'assets/Literata-6f7a8b.woff2', 'font/woff2'],
    ['legacy-mono', 400, 'normal', 'assets/LegacyMono-9c0d1e.ttf', 'font/ttf']
  ])
})
