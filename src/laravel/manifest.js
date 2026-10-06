import fs from 'fs/promises'
import path from 'path'
import { normalizeFontFamily } from '../extract.js'
import { renderFace } from './css.js'
import { fail, list } from './errors.js'
import { resolvePreloadEntries } from './preloads.js'

const schemaVersion = 1

/** Build the Laravel fonts manifest (schema v1) from observed faces and configured policy. */
export function buildLaravelManifest({ faces, options, base }) {
  const rendered = new Map()
  const render = (face) => {
    if (! rendered.has(face.key)) rendered.set(face.key, renderFace(face, base))
    return rendered.get(face.key)
  }

  const facesByAlias = groupFacesByAlias(faces, options.families)
  const configured = faces.filter((face) =>
    options.families.some(({ alias }) => facesByAlias.get(alias).includes(face))
  )

  const familyStyles = {}
  const variables = {}
  for (const { alias, family, variable } of options.families) {
    familyStyles[alias] = facesByAlias.get(alias).map(render).join('\n')
    // The trailing semicolon is load-bearing: Laravel joins declarations with a
    // newline and adds nothing, so omitting it breaks any multi-alias @fonts call.
    variables[alias] = `${variable}: "${family}";`
  }

  const inline = [
    ...configured.map(render),
    `:root {\n${options.families.map(({ alias }) => `  ${variables[alias]}`).join('\n')}\n}`
  ].join('\n')

  return {
    version: schemaVersion,
    style: { inline, familyStyles, variables },
    preloads: resolvePreloadEntries(options.preload, options.families, facesByAlias),
    families: Object.fromEntries(
      options.families.map(({ alias, family, variable }) => [alias, { family, variable }])
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

function groupFacesByAlias(faces, families) {
  const grouped = new Map()

  for (const { alias, family } of families) {
    const wanted = normalizeFontFamily(family)
    const matched = faces.filter((face) => normalizeFontFamily(face.family) === wanted)

    if (! matched.length) {
      const observed = [...new Set(faces.map(({ family: name }) => name).filter(Boolean))]
      fail(
        `No @font-face rule declares family "${family}" configured for alias "${alias}". ` +
          `Observed families: ${list(observed)}`
      )
    }

    grouped.set(alias, matched)
  }

  return grouped
}
