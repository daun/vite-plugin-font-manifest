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

async function buildManifest(bundle, manifest) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'font-manifest-'))
  const manifestPath = path.join(directory, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest))

  try {
    const plugin = fontManifest()
    plugin.configResolved({ build: { manifest: true } })
    plugin.generateBundle({ dir: directory }, bundle)
    await plugin.writeBundle({ dir: directory }, bundle)
    return JSON.parse(await readFile(manifestPath, 'utf8'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('models shared files and multiple sources without duplicates', async () => {
  const bundle = {
    main: stylesheet('assets/main.css', 'src/main.css', `${regularFace}\n${boldFace}\n${regularFace}`),
    ...fontAssets
  }
  const manifest = await buildManifest(bundle, {
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
  const manifest = await buildManifest(bundle, {
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
  const manifest = await buildManifest(bundle, {
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
  const manifest = await buildManifest(bundle, {
    'src/broken.css': { file: 'assets/broken.css', isEntry: true }
  })

  expect(manifest).toEqual({
    'src/broken.css': { file: 'assets/broken.css', isEntry: true }
  })
  expect(warn).toHaveBeenCalledTimes(1)
  expect(warn).toHaveBeenCalledWith('Error parsing CSS for font info:', expect.any(Error))
})
