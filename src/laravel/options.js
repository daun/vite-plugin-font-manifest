import { fail, list } from './errors.js'

const defaultManifestFilename = 'fonts-manifest.json'
const supportedStyleModes = ['inline']
const knownOptions = ['include', 'exclude', 'preload', 'manifestFilename', 'style']

/**
 * Validate the `laravel` option eagerly, at plugin construction, so a malformed
 * configuration fails before the build starts rather than after it.
 *
 * `true` is the whole configuration: every observed family is written to the
 * manifest. The object form only narrows or tunes that default.
 */
export function resolveLaravelOptions(options) {
  if (options === undefined || options === null || options === false) return null
  if (options === true) options = {}
  if (! isPlainObject(options)) fail('`laravel` must be `true` or an object')

  const unknown = Object.keys(options).filter((key) => ! knownOptions.includes(key))
  if (unknown.length) {
    fail(`Unknown \`laravel\` option ${list(unknown)}. Supported options: ${list(knownOptions)}`)
  }

  const include = resolveFamilyFilter(options.include, 'include')
  const exclude = resolveFamilyFilter(options.exclude, 'exclude')
  if (include && exclude) fail('Set either `laravel.include` or `laravel.exclude`, not both')

  return {
    include,
    exclude,
    preload: resolvePreload(options.preload),
    manifestFilename: resolveManifestFilename(options.manifestFilename),
    style: resolveStyleMode(options.style)
  }
}

function resolveFamilyFilter(families, name) {
  if (families === undefined || families === null) return null
  if (typeof families === 'string') families = [families]
  if (! Array.isArray(families) || families.some((family) => typeof family !== 'string' || ! family.trim())) {
    fail(`\`laravel.${name}\` must be a list of font family names`)
  }

  return families.map((family) => family.trim())
}

function resolvePreload(preload) {
  if (preload === undefined || preload === null) return true
  if (typeof preload !== 'boolean') fail('`laravel.preload` must be `true` or `false`')
  return preload
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
