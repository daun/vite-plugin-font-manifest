/** Preferred source formats, best first. Compared as canonical keys, not CSS tokens. */
const formatPriority = ['woff2', 'woff', 'ttf', 'otf', 'eot', 'ttc', 'svg']

/**
 * One preload entry per face, using its best bundled source.
 *
 * Faces that cannot be preloaded are skipped rather than failing the build:
 * data and remote URLs never enter the bundle, and a source of unknown format
 * has no `type` to announce.
 */
export function resolvePreloadEntries(families) {
  const entries = []

  for (const { alias, family, faces } of families) {
    const seen = new Set()

    for (const face of faces) {
      const source = selectSource(face)
      if (! source || seen.has(source.file)) continue
      seen.add(source.file)

      entries.push({
        alias,
        family,
        weight: describeWeight(face.weightRange),
        style: face.style,
        file: source.file,
        as: 'font',
        type: source.mime,
        crossorigin: 'anonymous'
      })
    }
  }

  return entries
}

function selectSource(face) {
  const candidates = face.sources.filter(
    (source) => source.file && source.format && source.mime && source.mime !== 'unknown'
  )

  // Stable sort: equally preferred sources keep their declaration order
  return candidates.sort((a, b) => rankFormat(a.format) - rankFormat(b.format))[0] ?? null
}

function rankFormat(format) {
  const rank = formatPriority.indexOf(format)
  return rank === -1 ? formatPriority.length : rank
}

function describeWeight([min, max]) {
  return min === max ? min : `${min} ${max}`
}
