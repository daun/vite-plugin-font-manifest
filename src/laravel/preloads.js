import { normalizeFontFamily } from '../extract.js'
import { fail, list } from './errors.js'

/** Preferred source formats, best first. Compared as canonical keys, not CSS tokens. */
const formatPriority = ['woff2', 'woff', 'ttf', 'otf', 'eot', 'ttc', 'svg']

/**
 * Resolve configured selectors into Laravel preload entries.
 *
 * Deduplication is by `(alias, file)` rather than by `file`: two aliases may
 * share one CSS family, and `Vite::fonts()` filters preloads by alias, so
 * collapsing them would render no link for the alias that lost.
 */
export function resolvePreloadEntries(selectors, families, facesByAlias) {
  const entries = []
  const seen = new Set()

  for (const selector of selectors) {
    const alias = resolveSelectorAlias(selector, families)
    const family = families.find((candidate) => candidate.alias === alias)
    const faces = matchFaces(facesByAlias.get(alias) ?? [], selector)

    if (! faces.length) {
      fail(
        `${selector.label} matches no observed face for alias "${alias}": ` +
          `no "${family.family}" face covers weight ${selector.weight} in style "${selector.style}"`
      )
    }

    for (const face of faces) {
      const source = selectSource(face, selector)
      const key = `${alias}|${source.file}`
      if (seen.has(key)) continue
      seen.add(key)

      entries.push({
        alias,
        family: family.family,
        weight: selector.weight,
        style: selector.style,
        file: source.file,
        ...preloadAttributes(source, selector.attributes)
      })
    }
  }

  return entries
}

function resolveSelectorAlias(selector, families) {
  if (selector.alias) return selector.alias

  const wanted = normalizeFontFamily(selector.family)
  const matches = families.filter(({ family }) => normalizeFontFamily(family) === wanted)

  if (! matches.length) {
    fail(
      `${selector.label} names unconfigured family "${selector.family}". ` +
        `Configured families: ${list(families.map(({ family }) => family))}`
    )
  }
  if (matches.length > 1) {
    fail(
      `${selector.label} is ambiguous: family "${selector.family}" is configured under ` +
        `${list(matches.map(({ alias }) => alias))}. Select it by alias instead.`
    )
  }

  return matches[0].alias
}

function matchFaces(faces, selector) {
  return faces.filter(
    (face) =>
      face.style === selector.style &&
      face.weightRange[0] <= selector.weight &&
      selector.weight <= face.weightRange[1]
  )
}

function selectSource(face, selector) {
  const bundled = face.sources.filter((source) => source.file)

  if (! bundled.length) {
    fail(
      `${selector.label} resolves to ${describeFace(face)}, which has no bundled source. ` +
        'Data and remote URLs cannot be preloaded; import the font through Vite instead.'
    )
  }

  const ranked = bundled.map((source) => ({ source, rank: rankFormat(source.format) }))
  const best = Math.min(...ranked.map(({ rank }) => rank))
  const winners = ranked.filter(({ rank }) => rank === best).map(({ source }) => source)

  if (winners.length > 1) {
    fail(
      `${selector.label} is ambiguous: ${describeFace(face)} has ${winners.length} equally ` +
        `preferred sources (${list(winners.map(({ file }) => file))})`
    )
  }

  const [source] = winners
  if (! source.format || source.mime === 'unknown') {
    fail(
      `${selector.label} cannot preload ${describeFace(face)}: the format of "${source.url}" ` +
        'is unknown, so no `type` attribute can be emitted'
    )
  }

  return source
}

function preloadAttributes(source, overrides) {
  const attributes = { as: 'font', type: source.mime, crossorigin: 'anonymous', ...overrides }

  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== null && value !== undefined)
  )
}

function rankFormat(format) {
  const rank = formatPriority.indexOf(format)
  return rank === -1 ? formatPriority.length : rank
}

function describeFace(face) {
  const [min, max] = face.weightRange
  const weight = min === max ? `${min}` : `${min}-${max}`
  return `"${face.family}" ${weight} ${face.style}`
}
