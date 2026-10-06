import fs from 'fs/promises'
import path from 'path'
import { extractFontInfoFromBundle, hasFontFaces } from './src/extract.js'
import { buildLaravelManifest, writeLaravelManifest } from './src/laravel/manifest.js'
import { resolveLaravelOptions } from './src/laravel/options.js'

function fontManifestPlugin({ laravel } = {}) {
  const laravelOptions = resolveLaravelOptions(laravel)
  let config = {}
  const outputs = new Map()

  return {
    name: 'font-manifest',
    apply: 'build',

    // Load Vite's configuration to access the build options
    configResolved(resolvedConfig) {
      config = resolvedConfig
    },

    // Extract font information from the bundle, keyed by output directory
    generateBundle(output, bundle) {
      outputs.set(outputKey(output), extractFontInfoFromBundle(bundle))
    },

    // Write collected font information to the manifest
    async writeBundle(output) {
      const info = outputs.get(outputKey(output))
      outputs.delete(outputKey(output))

      // Skip if no font info was collected
      if (! info) return

      // Skip if Vite was not asked to generate a manifest. Laravel disables it
      // for the SSR pass only, so this doubles as the client-build gate.
      if (! config.build?.manifest) return

      // Laravel emission is strict: its errors must escape and fail the build
      if (laravelOptions && isClientOutput(this, config)) {
        await writeLaravelManifest(
          output.dir,
          laravelOptions.manifestFilename,
          buildLaravelManifest({
            faces: info.faces,
            options: laravelOptions,
            base: config.base ?? '/'
          })
        )
      }

      if (! Object.keys(info.fonts).length && ! hasFontFaces(info.stylesheets)) return

      // Get the manifest path from Vite's config
      const manifestFileName =
        typeof config.build.manifest === 'string' ? config.build.manifest : 'manifest.json'

      const manifestPath = path.resolve(output.dir, manifestFileName)

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

/** The client build is the only one that carries stylesheets, and so fonts. */
function isClientOutput(context, config) {
  if (config.build?.ssr) return false
  const environment = context?.environment
  return ! environment || environment.name === 'client'
}

function outputKey(output) {
  return output?.dir ?? ''
}

export default fontManifestPlugin
