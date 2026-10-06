// JavaScript port of Laravel's server-side font manifest consumer, used to verify the
// manifests this plugin emits. Ported from Illuminate\Foundation\ViteFonts (ca0263c7c5c753b4468628ecb656ceb5f6c610af)
// and the font parts of Illuminate\Foundation\Vite (0c322c2e3fcca3b49c97fdcb48be27c892c56196), branch 13.x.

const supportedVersion = 1

/**
 * Render the preload links and style block for a manifest.
 *
 * `aliases` of `null`/`undefined` renders everything (PHP: `fonts(null)`), a string or
 * array renders only the given families. An empty array is a filtered render and, like
 * PHP, therefore renders nothing.
 */
export function renderFonts(manifest, aliases = null, { buildDirectory = 'build', assetUrl = '' } = {}) {
  ensureValidManifest(manifest)

  let entries = (manifest.preloads ?? []).map((preload, index) => [index, preload])

  if (aliases !== null && aliases !== undefined) {
    aliases = typeof aliases === 'string' ? [aliases] : aliases

    ensureValidFamilies(manifest, aliases)

    entries = entries.filter(([, preload]) => aliases.includes(preload.alias ?? null))
  } else {
    aliases = null
  }

  ensureValidPreloadEntries(entries)

  const links = renderFontPreloads(entries, buildDirectory, assetUrl)
  const style = renderFontStyle(manifest, aliases)

  const linksHtml = links.join('\n')

  return {
    links,
    style,
    html: linksHtml !== '' && style !== '' ? `${linksHtml}\n${style}` : linksHtml + style
  }
}

export function ensureValidManifest(manifest) {
  if (! isset(manifest?.version)) {
    throw new Error('The font manifest is missing the [version] key.')
  }

  if (manifest.version !== supportedVersion) {
    throw new Error(`Unsupported font manifest version [${manifest.version}]. Supported versions: ${supportedVersion}.`)
  }

  if (! isset(manifest.families) || ! isPhpArray(manifest.families)) {
    throw new Error('The font manifest is missing the [families] key.')
  }
}

export function ensureValidFamilies(manifest, aliases) {
  const available = Object.keys(manifest?.families ?? {})

  for (const alias of aliases) {
    if (! available.includes(alias)) {
      throw new Error(`Font alias [${alias}] is not defined in the font manifest. Available aliases: ${available.join(', ')}.`)
    }
  }
}

export function ensureValidPreloads(manifest) {
  ensureValidPreloadEntries((manifest?.preloads ?? []).map((preload, index) => [index, preload]))
}

/**
 * Resolve the CSS content for a manifest.
 *
 * When `style.file` is selected the file is *not* read — reading from the public
 * directory is out of scope here — a `{ file }` sentinel is returned instead.
 */
export function resolveStyleContent(manifest, aliases = null) {
  const style = manifest?.style ?? null

  if (style === null) return ''
  if (aliases !== null && aliases !== undefined) return resolveFilteredStyleContent(style, aliases)
  if (isset(style.inline)) return style.inline
  if (isset(style.file)) return { file: style.file }

  return ''
}

export function filterVariables(variables, aliases) {
  const declarations = []

  for (const alias of aliases) {
    if (isset(variables[alias])) {
      declarations.push('  ' + variables[alias])
    }
  }

  if (declarations.length === 0) return ''

  return ':root {\n' + declarations.join('\n') + '\n}'
}

function resolveFilteredStyleContent(style, aliases) {
  const familyStyles = style.familyStyles ?? {}
  const variables = style.variables ?? {}

  if (! isPhpArray(familyStyles)) {
    throw new Error('The font manifest [style.familyStyles] must be an object keyed by alias; the manifest was likely produced by an incompatible plugin version.')
  }

  if (! isPhpArray(variables)) {
    throw new Error('The font manifest [style.variables] must be an object keyed by alias; the manifest was likely produced by an incompatible plugin version.')
  }

  const parts = []

  for (const alias of aliases) {
    if (isset(familyStyles[alias])) {
      parts.push(familyStyles[alias])
    }
  }

  if (Object.keys(variables).length !== 0) {
    parts.push(filterVariables(variables, aliases))
  }

  return parts.join('\n\n')
}

function ensureValidPreloadEntries(entries) {
  for (const [index, preload] of entries) {
    if (! isset(preload?.alias)) {
      throw new Error(`Font manifest preload entry [${index}] is missing the [alias] key.`)
    }

    if (! isset(preload.file)) {
      throw new Error(`Font manifest preload entry [${index}] for alias [${preload.alias}] is missing the [file] key.`)
    }
  }
}

function renderFontPreloads(entries, buildDirectory, assetUrl) {
  const preloadedAssets = new Set()
  const tags = []

  for (const [, preload] of entries) {
    const url = preload.url ?? assetPath(`${buildDirectory}/${preload.file}`, assetUrl)

    if (preloadedAssets.has(url)) continue

    preloadedAssets.add(url)

    const attributes = {
      rel: 'preload',
      as: preload.as ?? 'font',
      href: url,
      type: preload.type ?? false,
      crossorigin: preload.crossorigin ?? false
    }

    tags.push('<link ' + parseAttributes(attributes).join(' ') + ' />')
  }

  return tags
}

function renderFontStyle(manifest, aliases) {
  const css = resolveStyleContent(manifest, aliases)

  if (typeof css !== 'string') {
    throw new Error(`Reading font CSS from [style.file] is out of scope for this test helper: ${css.file}.`)
  }

  if (css === '') return ''

  return '<style>\n' + trimNewlines(css) + '\n</style>'
}

function parseAttributes(attributes) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== false && value !== null && value !== undefined)
    .map(([key, value]) => (value === true ? key : `${key}="${value}"`))
}

function assetPath(path, assetUrl) {
  return `${assetUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

function isset(value) {
  return value !== null && value !== undefined
}

function isPhpArray(value) {
  return typeof value === 'object' && value !== null
}

function trimNewlines(value) {
  return value.replace(/^\n+/, '').replace(/\n+$/, '')
}
