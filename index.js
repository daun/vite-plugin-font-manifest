import fs from 'fs/promises'
import path from 'path'
import postcss from 'postcss'
import valueParser from 'postcss-value-parser'

function fontManifestPlugin() {
  let config = {}
  let info = {}

  return {
    name: 'font-manifest',

    // Load Vite's configuration to access the build options
    configResolved(resolvedConfig) {
      config = resolvedConfig
    },

    // Extract font information from the bundle
    generateBundle(options, bundle) {
      info = extractFontInfoFromBundle(bundle)
    },

    // Write collected font information to the manifest
    async writeBundle(options, bundle) {
      // Skip if no font info was collected
      if (! Object.keys(info.fonts).length) return

      // Get the manifest path from Vite's config
      const manifestFileName =
        typeof config.build.manifest === 'string' ? config.build.manifest : 'manifest.json'

      const manifestPath = path.resolve(options.dir, manifestFileName)

      try {
        // Read the generated manifest
        const manifestContent = await fs.readFile(manifestPath, 'utf-8')
        const manifest = JSON.parse(manifestContent)

        // Update manifest entries with collected data about fonts and stylesheets
        const updatedManifest = Object.entries({ ...info.stylesheets, ...info.fonts })
          .reduce((contents, [filename, data]) => {
            if (contents[filename]) {
              contents[filename] = { ...contents[filename], ...data }
            }
            return contents
          }, manifest)

        // Write the updated manifest back to disk
        await fs.writeFile(manifestPath, JSON.stringify(updatedManifest, null, 2))
      } catch (error) {
        console.warn('Error updating font manifest:', error)
      }
    }
  }
}

function extractFontInfoFromBundle(bundle) {
  const name = (url) => getOriginalFilenameFromBundle(bundle, url)

  const info = Object.values(bundle)
    .filter((entry) => entryIsStylesheet(entry))
    .reduce(
      (entries, asset) => ({
        ...entries,
        [asset.originalFileName]: extractFontInfoFromStylesheet(asset)
      }),
      {}
    )

  const fonts = Object.fromEntries(
    Object.values(info).flat().map(({ url, ...font }) => [name(url), { fontFace: font }])
  )

  const stylesheets = Object.fromEntries(
    Object.entries(info).map(([key, fonts]) => [key, { fonts: fonts.map(({ url }) => name(url)) }])
  )

  return { fonts, stylesheets }
}

function getOriginalFilenameFromBundle(bundle, url) {
  return Object.values(bundle)
    .find((entry) => entry.fileName && url.endsWith(entry.fileName))
    ?.originalFileName || null
}

function extractFontInfoFromStylesheet(asset) {
  try {
    const root = postcss.parse(asset.source)
    const rules = getAllAtRules(root, 'font-face')
    return rules.flatMap((rule) => extractFontFaceInfo(rule, { definedIn: [asset.originalFileName] }))
  } catch (error) {
    console.warn('Error parsing CSS for font info:', error)
  }
}

function extractFontFaceInfo(rule, data = {}) {
  const declarations = getAllDeclarations(rule)
  const sources = parseFontFaceSrcDeclaration(declarations['src'])
  return sources.map((source) => ({
    url: source.url,
    format: source.format || getExtension(source.url),
    family: declarations['font-family']?.replace(/['"]/g, ''),
    weight: declarations['font-weight'] || 'normal',
    style: declarations['font-style'] || 'normal',
    display: declarations['font-display'] || 'auto',
    mime: getMimeType(source.url),
    ...data
  }))
}

function parseFontFaceSrcDeclaration(declaration) {
  const nodes = []
  valueParser(declaration).walk((node) => nodes.push(node))

  const sources = splitNodesByDividers(nodes).map((source) => ({
    url: getFunctionValue(source, 'url'),
    format: getFunctionValue(source, 'format')
  }))

  return sources
}

function getFunctionValue(nodes, fn) {
  const node = nodes.find(({ type, value }) => type === 'function' && value === fn)
  return node?.nodes.find(({ type }) => ['word', 'string'].includes(type))?.value
}

function getAllAtRules(root, type) {
  const rules = []
  root.walkAtRules(type, (rule) => rules.push(rule))
  return rules
}

function getAllDeclarations(rule) {
  const declarations = {}
  rule.walkDecls((decl) => {
    declarations[decl.prop] = decl.value
  })
  return declarations
}

function entryIsFontFile(entry) {
  return entry.type === 'asset' && entry.fileName && /\.(woff2?|ttf|otf|eot)$/i.test(entry.fileName)
}

function entryIsStylesheet(entry) {
  return entry.type === 'asset' && entry.fileName && /\.css$/i.test(entry.fileName)
}

function getExtension(filename) {
  return path.extname(filename).toLowerCase().replace(/^\./, '')
}

function getMimeType(filename) {
  const mimes = {
    woff2: 'font/woff2',
    woff: 'font/woff',
    ttf: 'font/truetype',
    otf: 'font/opentype',
    eot: 'font/embedded-opentype'
  }
  return mimes[getExtension(filename)] || 'unknown'
}

function splitNodesByDividers(nodes) {
  return splitArray(nodes, ({ type }) => type === 'div')
}

function splitArray(array, predicate) {
  return array.reduce(
    (acc, current) => {
      if (predicate(current)) {
        acc.push([])
      } else {
        acc[acc.length - 1].push(current)
      }
      return acc
    },
    [[]]
  )
}

function reverseRelation(obj) {
  return Object.entries(obj)
    .flatMap(([key, values]) => values.map(value => [value, key]))
    .reduce((acc, [value, key]) => {
      acc[value] = acc[value] || [];
      acc[value].push(key);
      return acc;
    }, {})
}

export default fontManifestPlugin
