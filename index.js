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
      if (! Object.keys(info.fonts).length && ! hasFontFaces(info.stylesheets)) return

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
  const fonts = {}
  const stylesheets = {}

  for (const asset of Object.values(bundle).filter((entry) => entryIsStylesheet(entry))) {
    const fontFaces = dedupeFontFaces(extractFontInfoFromStylesheet(asset))
    const stylesheetFonts = new Set()

    const stylesheetFontFaces = fontFaces.map((fontFace) => {
      const sources = fontFace.sources.map(({ url, format, mime }) => {
        const sourceAsset = getOriginalFilenameFromBundle(bundle, url)
        if (sourceAsset) stylesheetFonts.add(sourceAsset)

        return { asset: sourceAsset, format, mime }
      })

      for (const source of fontFace.sources) {
        const sourceAsset = getOriginalFilenameFromBundle(bundle, source.url)
        if (! sourceAsset) continue

        const fileFontFace = {
          family: fontFace.family,
          weight: fontFace.weight,
          style: fontFace.style,
          display: fontFace.display,
          format: source.format,
          mime: source.mime,
          definedIn: [asset.originalFileName]
        }

        fonts[sourceAsset] ||= { fontFaces: [] }
        addFontFaceReference(fonts[sourceAsset].fontFaces, fileFontFace, fontFaceKey(fontFace))
      }

      return {
        family: fontFace.family,
        weight: fontFace.weight,
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

function getOriginalFilenameFromBundle(bundle, url) {
  if (! url || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) return null

  const pathname = url.split(/[?#]/, 1)[0]
  return Object.values(bundle)
    .find((entry) => entry.fileName && pathname.endsWith(entry.fileName.split(/[?#]/, 1)[0]))
    ?.originalFileName || null
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
    const format = source.format || getExtension(source.url)
    return {
      url: source.url,
      format,
      mime: getMimeType(format || source.url)
    }
  })

  return {
    family: declarations['font-family']?.replace(/['"]/g, ''),
    weight: declarations['font-weight'] || 'normal',
    style: declarations['font-style'] || 'normal',
    display: declarations['font-display'] || 'auto',
    css: rule.toString(),
    sources
  }
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
    fontFace.weight,
    fontFace.style,
    fontFace.display,
    sources
  ])
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

function entryIsStylesheet(entry) {
  return entry.type === 'asset' && entry.fileName && /\.css([?]|$)/i.test(entry.fileName)
}

function getExtension(filename) {
  if (! filename) return ''
  return path.extname(filename.split(/[?#]/, 1)[0]).toLowerCase().replace(/^\./, '')
}

function getMimeType(filenameOrFormat) {
  const mimes = {
    woff2: 'font/woff2',
    woff: 'font/woff',
    ttf: 'font/truetype',
    otf: 'font/opentype',
    eot: 'font/embedded-opentype'
  }
  return mimes[filenameOrFormat] || mimes[getExtension(filenameOrFormat)] || 'unknown'
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
