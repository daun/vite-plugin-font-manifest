import valueParser from 'postcss-value-parser'
import { fail } from './errors.js'

const documentSafeBase = /^(?:\/|\/\/|[a-z][a-z\d+.-]*:\/\/)/i

/**
 * Render a face as CSS destined for an HTML `<style>` element.
 *
 * Bundled sources are rewritten from their stylesheet-relative form to
 * `base + emitted filename`, because the rule no longer resolves against the
 * stylesheet once it is inlined into the document. Data, protocol-relative and
 * absolute remote URLs are left alone, as are sources that never entered the
 * bundle.
 */
export function renderFace(face, base) {
  const rewrites = new Map()

  for (const source of face.sources) {
    if (! source.file || ! source.url) continue
    const rewritten = resolveAssetUrl(base, source.file, source.url, face)
    if (rewritten !== source.url) rewrites.set(source.url, rewritten)
  }

  if (! rewrites.size) return face.rule.toString()

  const rule = face.rule.clone()
  rule.walkDecls('src', (declaration) => {
    const parsed = valueParser(declaration.value)
    parsed.walk((node) => {
      if (node.type !== 'function' || node.value !== 'url') return
      const target = node.nodes.find(({ type }) => type === 'word' || type === 'string')
      if (target && rewrites.has(target.value)) target.value = rewrites.get(target.value)
    })
    declaration.value = parsed.toString()
  })

  return rule.toString()
}

function resolveAssetUrl(base, file, url, face) {
  if (! documentSafeBase.test(base || '')) {
    fail(
      `Cannot produce document-safe font URLs for "${face.family}" from base "${base}". ` +
        'Inlined CSS resolves against the document, so Vite needs an absolute `base` ' +
        'such as "/build/". Laravel sets this for you via laravel-vite-plugin.'
    )
  }

  const separator = base.endsWith('/') ? '' : '/'
  const suffix = url.slice(url.split(/[?#]/, 1)[0].length)

  return `${base}${separator}${file}${suffix}`
}
