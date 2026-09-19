import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import fontManifest from '../index.js'

const regularFace = `@font-face {
  font-family: "Inter";
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  src: url(/build/assets/Inter.woff2?v=abc) format("woff2"), url(/build/assets/Inter.woff?v=def) format("woff");
}`

const boldFace = `@font-face {
  font-family: "Inter";
  font-weight: 700;
  font-style: normal;
  font-display: swap;
  src: url(/build/assets/Inter.woff2?v=abc) format("woff2");
}`

const fontAssets = {
  woff2: {
    type: 'asset',
    fileName: 'assets/Inter.woff2',
    originalFileName: 'src/fonts/Inter.woff2',
    source: ''
  },
  woff: {
    type: 'asset',
    fileName: 'assets/Inter.woff',
    originalFileName: 'src/fonts/Inter.woff',
    source: ''
  }
}

function stylesheet(fileName, originalFileName, source) {
  return { type: 'asset', fileName, originalFileName, source }
}

async function buildManifest(bundle, manifest, { build = { manifest: true }, fileName = 'manifest.json', contents } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'font-manifest-'))
  const manifestPath = path.join(directory, fileName)
  await writeFile(manifestPath, contents ?? JSON.stringify(manifest))

  try {
    const plugin = fontManifest()
    plugin.configResolved({ build })
    plugin.generateBundle({ dir: directory }, bundle)
    await plugin.writeBundle({ dir: directory }, bundle)
    return await readFile(manifestPath, 'utf8')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function buildJsonManifest(bundle, manifest, options) {
  return JSON.parse(await buildManifest(bundle, manifest, options))
}

async function faceFor(css) {
  const bundle = { main: stylesheet('assets/main.css', 'src/main.css', css), ...fontAssets }
  const manifest = await buildJsonManifest(bundle, {
    'src/main.css': { file: 'assets/main.css', isEntry: true }
  })
  return manifest['src/main.css'].fontFaces[0]
}

test('models shared files and multiple sources without duplicates', async () => {
  const bundle = {
    main: stylesheet('assets/main.css', 'src/main.css', `${regularFace}\n${boldFace}\n${regularFace}`),
    ...fontAssets
  }
  const manifest = await buildJsonManifest(bundle, {
    'src/main.css': { file: 'assets/main.css', isEntry: true },
    'src/fonts/Inter.woff2': { file: 'assets/Inter.woff2' },
    'src/fonts/Inter.woff': { file: 'assets/Inter.woff' }
  })

  expect(manifest['src/main.css'].fonts).toEqual([
    'src/fonts/Inter.woff2',
    'src/fonts/Inter.woff'
  ])
  expect(manifest['src/main.css'].fontFaces).toHaveLength(2)
  expect(manifest['src/main.css'].fontFaces.map(({ weight }) => weight)).toEqual(['400', '700'])
  expect(manifest['src/main.css'].fontFaces[0].sources).toEqual([
    { asset: 'src/fonts/Inter.woff2', format: 'woff2', mime: 'font/woff2' },
    { asset: 'src/fonts/Inter.woff', format: 'woff', mime: 'font/woff' }
  ])
  expect(manifest['src/fonts/Inter.woff2'].fontFaces).toHaveLength(2)
  expect(manifest['src/fonts/Inter.woff'].fontFaces).toHaveLength(1)
  expect(manifest['src/fonts/Inter.woff2']).not.toHaveProperty('fontFace')
})

test('accumulates stylesheet back-references for equivalent faces', async () => {
  const css = `${regularFace}\n${boldFace}`
  const bundle = {
    main: stylesheet('assets/main.css', 'src/main.css', css),
    document: stylesheet('assets/document.css', 'src/document.css', css),
    ...fontAssets
  }
  const manifest = await buildJsonManifest(bundle, {
    'src/main.css': { file: 'assets/main.css', isEntry: true },
    'src/document.css': { file: 'assets/document.css', isEntry: true },
    'src/fonts/Inter.woff2': { file: 'assets/Inter.woff2' },
    'src/fonts/Inter.woff': { file: 'assets/Inter.woff' }
  })

  expect(manifest['src/main.css'].fontFaces).toHaveLength(2)
  expect(manifest['src/document.css'].fontFaces).toHaveLength(2)
  for (const fontFace of manifest['src/fonts/Inter.woff2'].fontFaces) {
    expect(fontFace.definedIn).toEqual(['src/main.css', 'src/document.css'])
  }
})

test('keeps non-bundle sources out of font asset lists', async () => {
  const dataFace = '@font-face{font-family:Icons;src:url(data:font/woff;base64,AAAA) format("woff")}'
  const remoteFace = '@font-face{font-family:Remote;src:url(https://cdn.example.com/remote.woff2) format("woff2")}'
  const bundle = {
    main: stylesheet('assets/main.css', 'src/main.css', `${dataFace}\n${remoteFace}`)
  }
  const manifest = await buildJsonManifest(bundle, {
    'src/main.css': { file: 'assets/main.css', isEntry: true }
  })

  expect(manifest['src/main.css'].fonts).toEqual([])
  expect(manifest['src/main.css'].fontFaces).toHaveLength(2)
  expect(manifest['src/main.css'].fontFaces[0].sources[0]).toMatchObject({
    asset: null,
    mime: 'font/woff'
  })
  expect(manifest['src/main.css'].fontFaces[1].sources[0].asset).toBeNull()
  expect(manifest).not.toHaveProperty('null')
})

test('warns and completes when a stylesheet cannot be parsed', async () => {
  const bundle = {
    broken: stylesheet('assets/broken.css', 'src/broken.css', '@font-face {')
  }
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const manifest = await buildJsonManifest(bundle, {
    'src/broken.css': { file: 'assets/broken.css', isEntry: true }
  })

  expect(manifest).toEqual({
    'src/broken.css': { file: 'assets/broken.css', isEntry: true }
  })
  expect(warn).toHaveBeenCalledTimes(1)
  expect(warn).toHaveBeenCalledWith('Error parsing CSS for font info:', expect.any(Error))
  warn.mockRestore()
})

test.each([
  ['format("woff2")', 'url(/assets/Inter.woff2) format("woff2")', 'woff2', 'font/woff2'],
  ['format("truetype")', 'url(/assets/Inter.ttf) format("truetype")', 'ttf', 'font/ttf'],
  ['format("opentype")', 'url(/assets/Inter.otf) format("opentype")', 'otf', 'font/otf'],
  [
    'format("embedded-opentype")',
    'url(/assets/Inter.eot) format("embedded-opentype")',
    'eot',
    'application/vnd.ms-fontobject'
  ],
  ['no format token', 'url(/assets/Inter.ttf)', 'ttf', 'font/ttf'],
  ['unknown format token', 'url(/assets/Inter.ttf) format("nonsense")', 'ttf', 'font/ttf'],
  ['unknown everything', 'url(/assets/Inter.bin) format("nonsense")', null, 'unknown']
])('normalizes format and mime for %s', async (_, src, format, mime) => {
  const face = await faceFor(`@font-face{font-family:Inter;src:${src}}`)
  expect(face.sources[0]).toMatchObject({ format, mime })
})

test('skips the manifest when Vite does not generate one', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const bundle = {
    main: stylesheet('assets/main.css', 'src/main.css', regularFace),
    ...fontAssets
  }
  const original = { 'src/main.css': { file: 'assets/main.css', isEntry: true } }
  const contents = await buildManifest(bundle, original, { build: { manifest: false } })

  expect(JSON.parse(contents)).toEqual(original)
  expect(warn).not.toHaveBeenCalled()
  warn.mockRestore()
})

test('resolves a custom manifest filename', async () => {
  const bundle = {
    main: stylesheet('assets/main.css', 'src/main.css', regularFace),
    ...fontAssets
  }
  const manifest = await buildJsonManifest(
    bundle,
    { 'src/main.css': { file: 'assets/main.css', isEntry: true } },
    { build: { manifest: 'custom.json' }, fileName: 'custom.json' }
  )

  expect(manifest['src/main.css'].fontFaces).toHaveLength(1)
})

test('warns without throwing on a malformed manifest', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const bundle = {
    main: stylesheet('assets/main.css', 'src/main.css', regularFace),
    ...fontAssets
  }
  const contents = await buildManifest(bundle, null, { contents: '{ not json' })

  expect(contents).toBe('{ not json')
  expect(warn).toHaveBeenCalledWith('Error reading font manifest:', expect.any(Error))
  warn.mockRestore()
})

test('warns when the expected manifest is missing', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const directory = await mkdtemp(path.join(os.tmpdir(), 'font-manifest-'))

  try {
    const plugin = fontManifest()
    plugin.configResolved({ build: { manifest: true } })
    plugin.generateBundle({ dir: directory }, {
      main: stylesheet('assets/main.css', 'src/main.css', regularFace),
      ...fontAssets
    })
    await expect(plugin.writeBundle({ dir: directory })).resolves.toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }

  expect(warn).toHaveBeenCalledWith('Font manifest not found:', expect.any(String))
  warn.mockRestore()
})

test('deduplicates faces whose weights are spelled differently', async () => {
  const keyword = regularFace.replace('font-weight: 400', 'font-weight: normal')
  const bundle = {
    main: stylesheet('assets/main.css', 'src/main.css', `${regularFace}\n${keyword}`),
    ...fontAssets
  }
  const manifest = await buildJsonManifest(bundle, {
    'src/main.css': { file: 'assets/main.css', isEntry: true },
    'src/fonts/Inter.woff2': { file: 'assets/Inter.woff2' },
    'src/fonts/Inter.woff': { file: 'assets/Inter.woff' }
  })

  expect(manifest['src/main.css'].fontFaces).toHaveLength(1)
  expect(manifest['src/fonts/Inter.woff2'].fontFaces).toHaveLength(1)
})

test('deduplicates faces whose styles are spelled differently', async () => {
  const oblique = regularFace.replace('font-style: normal', 'font-style: oblique')
  const angled = regularFace.replace('font-style: normal', 'font-style: oblique 14deg')
  const bundle = {
    main: stylesheet('assets/main.css', 'src/main.css', `${oblique}\n${angled}`),
    ...fontAssets
  }
  const manifest = await buildJsonManifest(bundle, {
    'src/main.css': { file: 'assets/main.css', isEntry: true }
  })

  expect(manifest['src/main.css'].fontFaces).toHaveLength(1)
})

test.each([
  [undefined, 'normal', [400, 400]],
  ['normal', 'normal', [400, 400]],
  ['bold', 'bold', [700, 700]],
  ['400', '400', [400, 400]],
  ['250', '250', [250, 250]],
  ['100 900', '100 900', [100, 900]],
  ['900 100', '900 100', [100, 900]],
  ['auto', 'auto', [400, 400]],
  ['412.5', '412.5', [412.5, 412.5]],
  ['lighter', 'lighter', [400, 400]],
  ['bolder', 'bolder', [400, 400]],
  ['0', '0', [400, 400]],
  ['5000', '5000', [400, 400]]
])('exposes a numeric weight range for %s', async (authored, weight, weightRange) => {
  const declaration = authored ? `font-weight:${authored};` : ''
  const face = await faceFor(
    `@font-face{font-family:Inter;${declaration}src:url(/assets/Inter.woff2) format("woff2")}`
  )

  expect(face.weight).toBe(weight)
  expect(face.weightRange).toEqual(weightRange)
})

test('resolves assets on path boundaries only', async () => {
  const css = `@font-face{font-family:A;src:url(/build/vendor/assets/Inter.woff2) format("woff2")}
@font-face{font-family:B;src:url(/build/assets/Inter.woff2) format("woff2")}`
  const bundle = {
    main: stylesheet('assets/main.css', 'src/main.css', css),
    vendor: {
      type: 'asset',
      fileName: 'vendor/assets/Inter.woff2',
      originalFileName: 'vendor/fonts/Inter.woff2',
      source: ''
    },
    local: fontAssets.woff2
  }
  const manifest = await buildJsonManifest(bundle, {
    'src/main.css': { file: 'assets/main.css', isEntry: true }
  })

  expect(manifest['src/main.css'].fontFaces.map(({ sources }) => sources[0].asset)).toEqual([
    'vendor/fonts/Inter.woff2',
    'src/fonts/Inter.woff2'
  ])
})

test('annotates each output of a multi-output build', async () => {
  const directories = await Promise.all([
    mkdtemp(path.join(os.tmpdir(), 'font-manifest-a-')),
    mkdtemp(path.join(os.tmpdir(), 'font-manifest-b-'))
  ])
  const bundles = [
    { main: stylesheet('assets/main.css', 'src/main.css', regularFace), ...fontAssets },
    { main: stylesheet('assets/main.css', 'src/main.css', boldFace), ...fontAssets }
  ]

  try {
    const plugin = fontManifest()
    plugin.configResolved({ build: { manifest: true } })

    for (const [index, directory] of directories.entries()) {
      await writeFile(
        path.join(directory, 'manifest.json'),
        JSON.stringify({ 'src/main.css': { file: 'assets/main.css', isEntry: true } })
      )
      plugin.generateBundle({ dir: directory }, bundles[index])
    }

    for (const directory of directories) {
      await plugin.writeBundle({ dir: directory })
    }

    const [first, second] = await Promise.all(
      directories.map(async (directory) =>
        JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
      )
    )

    expect(first['src/main.css'].fontFaces.map(({ weight }) => weight)).toEqual(['400'])
    expect(second['src/main.css'].fontFaces.map(({ weight }) => weight)).toEqual(['700'])
  } finally {
    await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })))
  }
})
