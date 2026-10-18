import fs from 'fs/promises'
import path from 'path'
import { normalizeFontFamily } from '../extract.js'
import { renderFace } from './css.js'
import { fail, list } from './errors.js'
import { resolvePreloadEntries } from './preloads.js'

const schemaVersion = 1

/**
 * Build the Laravel fonts manifest (schema v1) from the observed faces.
 *
 * Every family declared in the bundled CSS is written, unless narrowed by
 * `include` or `exclude`. Aliases and variables follow laravel-vite-plugin's
 * conventions: `Brand Sans` becomes `@fonts(['brand-sans'])` and `--font-brand-sans`.
 */
export function buildLaravelManifest({ faces, options, base }) {
  const families = selectFamilies(groupFamilies(faces), options)

  const rendered = new Map()
  const render = (face) => {
    if (! rendered.has(face.key)) rendered.set(face.key, renderFace(face, base))
    return rendered.get(face.key)
  }

  const familyStyles = {}
  const variables = {}
  for (const { alias, family, variable, faces: familyFaces } of families) {
    familyStyles[alias] = familyFaces.map(render).join('\n')
    // The trailing semicolon is load-bearing: Laravel joins declarations with a
    // newline and adds nothing, so omitting it breaks any multi-alias @fonts call.
    variables[alias] = `${variable}: ${quote(family)};`
  }

  const inline = families.length
    ? [
        ...families.flatMap(({ faces: familyFaces }) => familyFaces.map(render)),
        `:root {\n${families.map(({ alias }) => `  ${variables[alias]}`).join('\n')}\n}`
      ].join('\n')
    : ''

  return {
    version: schemaVersion,
    style: { inline, familyStyles, variables },
    preloads: options.preload ? resolvePreloadEntries(families) : [],
    families: Object.fromEntries(
      families.map(({ alias, family, variable }) => [alias, { family, variable }])
    )
  }
}

export async function writeLaravelManifest(directory, filename, manifest) {
  const target = path.resolve(directory, filename)

  try {
    await fs.writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`)
  } catch (error) {
    fail(`Unable to write the Laravel fonts manifest to ${target}: ${error.message}`)
  }
}

/** Mirrors laravel-vite-plugin's alias slug, so both plugins name a family alike. */
export function familyAlias(family) {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

/** Group faces by family in first-observed order, keeping the first spelling seen. */
function groupFamilies(faces) {
  const groups = new Map()

  for (const face of faces) {
    if (! face.family?.trim()) continue
    const key = normalizeFontFamily(face.family)
    if (! groups.has(key)) groups.set(key, { family: face.family.trim(), faces: [] })
    groups.get(key).faces.push(face)
  }

  return [...groups.values()]
}

function selectFamilies(groups, { include, exclude }) {
  const observed = groups.map(({ family }) => family)
  const filter = include ?? exclude

  if (filter) {
    const known = new Set(groups.map(({ family }) => normalizeFontFamily(family)))
    const unknown = filter.filter((family) => ! known.has(normalizeFontFamily(family)))
    if (unknown.length) {
      fail(
        `\`laravel.${include ? 'include' : 'exclude'}\` names ${list(unknown)}, ` +
          `which no @font-face rule declares. Observed families: ${list(observed)}`
      )
    }
  }

  const wanted = (family) => {
    const listed = filter?.some((name) => normalizeFontFamily(name) === normalizeFontFamily(family))
    return include ? listed : ! listed
  }

  const aliases = new Map()
  return groups.filter(({ family }) => wanted(family)).map(({ family, faces }) => {
    const alias = familyAlias(family)

    if (! alias) {
      fail(
        `Cannot derive a Laravel alias from font family "${family}". ` +
          'Leave it out with `laravel.exclude`.'
      )
    }
    if (aliases.has(alias)) {
      fail(
        `Font families "${aliases.get(alias)}" and "${family}" both map to the Laravel alias ` +
          `"${alias}". Leave one out with \`laravel.exclude\`.`
      )
    }
    aliases.set(alias, family)

    return { alias, family, variable: `--font-${alias}`, faces }
  })
}

function quote(family) {
  return `"${family.replace(/["\\]/g, '\\$&')}"`
}
