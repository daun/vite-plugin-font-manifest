import { fontWeightKeywords, fontWeightRange, normalizeFontStyle } from '../extract.js'
import { fail, list } from './errors.js'

const defaultManifestFilename = 'fonts-manifest.json'
const supportedStyleModes = ['inline']
const aliasPattern = /^[a-z0-9][a-z0-9_-]*$/i
const variablePattern = /^--[a-z0-9_-]+$/i
const supportedFontStyles = ['normal', 'italic', 'oblique']

/**
 * Validate the `laravel` option eagerly, at plugin construction, so a malformed
 * configuration fails before the build starts rather than after it.
 */
export function resolveLaravelOptions(options) {
  if (options === undefined || options === null || options === false) return null
  if (! isPlainObject(options)) fail('`laravel` must be an object')

  const families = resolveFamilies(options.families)
  const preload = resolvePreloads(options.preload, families)
  const manifestFilename = resolveManifestFilename(options.manifestFilename)
  const style = resolveStyleMode(options.style)

  return { families, preload, manifestFilename, style }
}

function resolveFamilies(families) {
  if (! isPlainObject(families) || ! Object.keys(families).length) {
    fail('`laravel.families` must be a non-empty object keyed by template alias')
  }

  return Object.entries(families).map(([alias, config]) => {
    if (! aliasPattern.test(alias)) {
      fail(`Invalid family alias "${alias}": expected letters, digits, "-" or "_"`)
    }
    if (! isPlainObject(config)) {
      fail(`Family "${alias}" must be an object with "family" and "variable"`)
    }

    const family = config.family
    if (typeof family !== 'string' || ! family.trim()) {
      fail(`Family "${alias}" is missing a "family" name`)
    }
    if (family.includes(',')) {
      fail(`Family "${alias}" must name one family; fallback stacks are not supported`)
    }
    if (/^['"]|['"]$/.test(family.trim())) {
      fail(`Family "${alias}" must be unquoted; quoting is applied when the variable is written`)
    }

    const variable = config.variable
    if (typeof variable !== 'string' || ! variablePattern.test(variable)) {
      fail(`Family "${alias}" needs a "variable" custom property, e.g. "--font-${alias}"`)
    }

    return { alias, family: family.trim(), variable }
  })
}

function resolvePreloads(preload, families) {
  if (preload === undefined || preload === null) return []
  if (! Array.isArray(preload)) fail('`laravel.preload` must be an array')

  const aliases = families.map(({ alias }) => alias)

  return preload.map((selector, index) => {
    const label = `preload[${index}]`
    if (! isPlainObject(selector)) fail(`${label} must be an object`)

    const hasAlias = selector.alias !== undefined
    const hasFamily = selector.family !== undefined
    if (hasAlias === hasFamily) {
      fail(`${label} must set exactly one of "alias" and "family"`)
    }
    if (hasAlias && (typeof selector.alias !== 'string' || ! aliases.includes(selector.alias))) {
      fail(`${label} has unknown alias "${selector.alias}". Configured aliases: ${list(aliases)}`)
    }
    if (hasFamily && (typeof selector.family !== 'string' || ! selector.family.trim())) {
      fail(`${label} has an invalid "family"`)
    }

    return {
      label,
      alias: hasAlias ? selector.alias : null,
      family: hasFamily ? selector.family.trim() : null,
      weight: resolveSelectorWeight(selector.weight, label),
      style: resolveSelectorStyle(selector.style, label),
      attributes: resolvePreloadAttributes(selector, label)
    }
  })
}

function resolveSelectorWeight(weight, label) {
  if (weight === undefined || weight === null) fail(`${label} is missing a "weight"`)

  if (typeof weight === 'string' && weight.trim().toLowerCase() in fontWeightKeywords) {
    return fontWeightKeywords[weight.trim().toLowerCase()]
  }

  const value = typeof weight === 'number' ? weight : Number(String(weight).trim())
  const [min, max] = fontWeightRange
  if (! Number.isFinite(value) || value < min || value > max) {
    fail(`${label} has an invalid weight "${weight}": expected ${min}-${max}, "normal" or "bold"`)
  }

  return value
}

function resolveSelectorStyle(style, label) {
  if (style === undefined || style === null) return 'normal'
  if (typeof style !== 'string') fail(`${label} has an invalid "style"`)

  const normalized = normalizeFontStyle(style)
  if (! supportedFontStyles.includes(normalized.split(' ')[0])) {
    fail(`${label} has an unknown style "${style}"`)
  }

  return normalized
}

/**
 * Laravel passes `as`, `type` and `crossorigin` through verbatim and omits the
 * latter two when absent, so `null` is a meaningful value here, not a default.
 */
function resolvePreloadAttributes(selector, label) {
  const attributes = {}

  if (selector.as !== undefined) {
    if (typeof selector.as !== 'string' || ! selector.as.trim()) {
      fail(`${label} has an invalid "as" attribute`)
    }
    attributes.as = selector.as.trim()
  }

  for (const name of ['type', 'crossorigin']) {
    if (selector[name] === undefined) continue
    if (selector[name] === null || selector[name] === false) {
      attributes[name] = null
      continue
    }
    if (typeof selector[name] !== 'string' || ! selector[name].trim()) {
      fail(`${label} has an invalid "${name}" attribute`)
    }
    attributes[name] = selector[name].trim()
  }

  return attributes
}

function resolveManifestFilename(filename) {
  if (filename === undefined || filename === null) return defaultManifestFilename
  if (typeof filename !== 'string' || ! filename.trim()) {
    fail('`laravel.manifestFilename` must be a non-empty string')
  }
  if (/[\\/]/.test(filename)) {
    fail('`laravel.manifestFilename` must be a filename, not a path')
  }

  return filename.trim()
}

function resolveStyleMode(style) {
  if (style === undefined || style === null) return 'inline'
  if (! supportedStyleModes.includes(style)) {
    fail(`\`laravel.style\` must be one of ${list(supportedStyleModes)}`)
  }

  return style
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && ! Array.isArray(value)
}
