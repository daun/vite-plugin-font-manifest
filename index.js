import fs from 'fs/promises'
import path from 'path'
import postcss from 'postcss'
import valueParser from 'postcss-value-parser'

/** Canonical format key → mime type. Keys are the values emitted as `format`. */
const fontMimeTypes = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  ttc: 'font/collection',
  svg: 'image/svg+xml'
}

/** CSS `format()` tokens and file extensions → canonical format key. */
const fontFormats = {
  woff2: 'woff2',
  woff: 'woff',
  truetype: 'ttf',
  ttf: 'ttf',
  opentype: 'otf',
  otf: 'otf',
  'embedded-opentype': 'eot',
  eot: 'eot',
  collection: 'ttc',
  ttc: 'ttc',
  svg: 'svg',
  svgz: 'svg'
}

// `auto` is the initial value of the @font-face descriptor and selects as `normal`
const fontWeightKeywords = { auto: 400, normal: 400, bold: 700 }

const fontWeightRange = [1, 1000]

const defaultObliqueAngle = '14deg'

function fontManifestPlugin() {
  let config = {}
  const outputs = new Map()

  return {
    name: 'font-manifest',

    // Load Vite's configuration to access the build options
    configResolved(resolvedConfig) {
      config = resolvedConfig
    },

    // Extract font information from the bundle, keyed by output directory
    generateBundle(options, bundle) {
      outputs.set(outputKey(options), extractFontInfoFromBundle(bundle))
    },

    // Write collected font information to the manifest
    async writeBundle(options) {
      const info = outputs.get(outputKey(options))
      outputs.delete(outputKey(options))

      // Skip if no font info was collected
      if (! info) return
      if (! Object.keys(info.fonts).length && ! hasFontFaces(info.stylesheets)) return

      // Skip if Vite was not asked to generate a manifest
      if (! config.build?.manifest) return

      // Get the manifest path from Vite's config
      const manifestFileName =
        typeof config.build.manifest === 'string' ? config.build.manifest : 'manifest.json'

      const manifestPath = path.resolve(options.dir, manifestFileName)

      // Read the generated manifest
      let manifest
      try {
        manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
      } catch (error) {
        if (error.code === 'ENOENT') {
          console.warn('Font manifest not found:', manifestPath)
        } else {
          console.warn('Error reading font manifest:', error)
        }
        return
      }

      // Update manifest entries with collected data about fonts and stylesheets
      const updatedManifest = Object.entries({ ...info.stylesheets, ...info.fonts })
        .reduce((contents, [filename, data]) => {
          if (contents[filename]) {
            contents[filename] = { ...contents[filename], ...data }
          }
          return contents
        }, manifest)

      // Write the updated manifest back to disk
      try {
        await fs.writeFile(manifestPath, JSON.stringify(updatedManifest, null, 2))
      } catch (error) {
        console.warn('Error writing font manifest:', error)
      }
    }
  }
}

function outputKey(options) {
  return options?.dir ?? ''
}

function extractFontInfoFromBundle(bundle) {
  const fonts = {}
  const stylesheets = {}
  const assets = createBundleAssetLookup(bundle)

  for (const asset of Object.values(bundle).filter((entry) => entryIsStylesheet(entry))) {
    const fontFaces = dedupeFontFaces(extractFontInfoFromStylesheet(asset))
    const stylesheetFonts = new Set()

    const stylesheetFontFaces = fontFaces.map((fontFace) => {
      const sources = fontFace.sources.map(({ url, format, mime }) => {
        const sourceAsset = getOriginalFilenameFromBundle(assets, url)
        if (sourceAsset) stylesheetFonts.add(sourceAsset)

        return { asset: sourceAsset, format, mime }
      })

      for (const { asset: sourceAsset, format, mime } of sources) {
        if (! sourceAsset) continue

        const fileFontFace = {
          family: fontFace.family,
          weight: fontFace.weight,
          weightRange: fontFace.weightRange,
          style: fontFace.style,
          display: fontFace.display,
          format,
          mime,
          definedIn: [asset.originalFileName]
        }

        fonts[sourceAsset] ||= { fontFaces: [] }
        addFontFaceReference(fonts[sourceAsset].fontFaces, fileFontFace, fontFaceKey(fontFace))
      }

      return {
        family: fontFace.family,
        weight: fontFace.weight,
        weightRange: fontFace.weightRange,
        style: fontFace.style,
        display: fontFace.display,
        css: fontFace.css,
        sources
      }
    })

    stylesheets[asset.originalFileName] = {
      fonts: [...stylesheetFonts],
      fontFaces: stylesheetFontFaces
    }
  }

  for (const font of Object.values(fonts)) {
    font.fontFaces = font.fontFaces.map(({ fontFace }) => fontFace)
  }

  return { fonts, stylesheets }
}

function createBundleAssetLookup(bundle) {
  const assets = new Map()
  for (const entry of Object.values(bundle)) {
    if (! entry.fileName) continue
    const fileName = entry.fileName.split(/[?#]/, 1)[0]
    if (! assets.has(fileName)) assets.set(fileName, entry.originalFileName || null)
  }
  return assets
}

function getOriginalFilenameFromBundle(assets, url) {
  if (! url || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) return null

  const pathname = url.split(/[?#]/, 1)[0]
  if (assets.has(pathname)) return assets.get(pathname)

  // Match only on path boundaries, longest suffix first
  const segments = pathname.split('/')
  for (let i = 1; i < segments.length; i++) {
    const candidate = segments.slice(i).join('/')
    if (candidate && assets.has(candidate)) return assets.get(candidate)
  }

  return null
}

function extractFontInfoFromStylesheet(asset) {
  try {
    const root = postcss.parse(asset.source)
    const rules = getAllAtRules(root, 'font-face')
    return rules.map((rule) => extractFontFaceInfo(rule))
  } catch (error) {
    console.warn('Error parsing CSS for font info:', error)
    return []
  }
}

function extractFontFaceInfo(rule) {
  const declarations = getAllDeclarations(rule)
  const sources = parseFontFaceSrcDeclaration(declarations['src']).map((source) => {
    const format = resolveFontFormat(source.format, source.url)
    return {
      url: source.url,
      format,
      mime: getMimeType(format)
    }
  })

  const weight = declarations['font-weight'] || 'normal'

  return {
    family: declarations['font-family']?.replace(/['"]/g, ''),
    weight,
    weightRange: normalizeFontWeight(weight),
    style: declarations['font-style'] || 'normal',
    display: declarations['font-display'] || 'auto',
    css: rule.toString(),
    sources
  }
}

/** Prefer the CSS format() token, fall back to the file extension. */
function resolveFontFormat(token, url) {
  return normalizeFontFormat(token) || normalizeFontFormat(getExtension(url)) || null
}

function normalizeFontFormat(value) {
  if (! value) return null
  return fontFormats[String(value).trim().toLowerCase().replace(/^['"]|['"]$/g, '')] || null
}

function getMimeType(format) {
  return fontMimeTypes[format] || 'unknown'
}

/**
 * Resolve an authored `font-weight` to a numeric [min, max] range.
 * Values the descriptor rejects fall back to its initial value, `auto` (400).
 */
function normalizeFontWeight(value) {
  const parts = String(value ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (! parts.length || parts.length > 2) return [400, 400]

  const weights = parts.map((part) => {
    if (part in fontWeightKeywords) return fontWeightKeywords[part]
    if (! /^\d+(\.\d+)?$/.test(part)) return null
    const weight = Number(part)
    const [min, max] = fontWeightRange
    return weight >= min && weight <= max ? weight : null
  })
  if (weights.some((weight) => weight === null)) return [400, 400]

  const [min, max = min] = weights
  return min <= max ? [min, max] : [max, min]
}

/** Collapse equivalent `font-style` spellings: `oblique 14deg` is plain `oblique`. */
function normalizeFontStyle(value) {
  const style = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (! style) return 'normal'
  return style === `oblique ${defaultObliqueAngle}` ? 'oblique' : style
}

function dedupeFontFaces(fontFaces) {
  const seen = new Set()
  return fontFaces.filter((fontFace) => {
    const key = fontFaceKey(fontFace)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function addFontFaceReference(fontFaces, fontFace, key) {
  const existing = fontFaces.find((candidate) => candidate.key === key)
  if (existing) {
    if (! existing.fontFace.definedIn.includes(fontFace.definedIn[0])) {
      existing.fontFace.definedIn.push(fontFace.definedIn[0])
    }
    return
  }

  fontFaces.push({ key, fontFace })
}

function fontFaceKey(fontFace) {
  const sources = fontFace.sources
    .map(({ url, format }) => `${url || ''}|${format || ''}`)
    .sort()

  return JSON.stringify([
    fontFace.family,
    fontFace.weightRange ?? normalizeFontWeight(fontFace.weight),
    normalizeFontStyle(fontFace.style),
    fontFace.display,
    sources
  ])
}

function parseFontFaceSrcDeclaration(declaration) {
  const nodes = []
  valueParser(declaration || '').walk((node) => nodes.push(node))

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

function entryIsStylesheet(entry) {
  return entry.type === 'asset' && entry.fileName && /\.css([?]|$)/i.test(entry.fileName)
}

function getExtension(filename) {
  if (! filename) return ''
  return path.extname(filename.split(/[?#]/, 1)[0]).toLowerCase().replace(/^\./, '')
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

function hasFontFaces(stylesheets) {
  return Object.values(stylesheets).some(({ fontFaces }) => fontFaces.length)
}

export default fontManifestPlugin
