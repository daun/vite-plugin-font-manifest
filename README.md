# Vite Font Manifest Plugin

A Vite plugin for adding font information to the build manifest.

Useful for optimizing font loading by generating preload hints or inlining the
font-face CSS declarations.

## Example

**Before**


```json
{
  "src/fonts/Inter-Regular.woff2": {
    "file": "assets/Inter-Regular-CnZ_CWUo.woff2",
    "src": "src/fonts/Inter-Regular.woff2"
  }
}
```

**After**

```json
{
  "src/css/display.css": {
    "file": "assets/display.css",
    "fonts": ["src/fonts/Inter-Regular.woff2"],
    "fontFaces": [{
      "family": "Inter",
      "weight": "400",
      "weightRange": [400, 400],
      "style": "normal",
      "display": "swap",
      "css": "@font-face { /* */ }",
      "sources": [{
        "asset": "src/fonts/Inter-Regular.woff2",
        "format": "woff2",
        "mime": "font/woff2"
      }]
    }]
  },
  "src/fonts/Inter-Regular.woff2": {
    "file": "assets/Inter-Regular-CnZ_CWUo.woff2",
    "src": "src/fonts/Inter-Regular.woff2",
    "fontFaces": [{
      "family": "Inter",
      "weight": "400",
      "weightRange": [400, 400],
      "style": "normal",
      "display": "swap",
      "format": "woff2",
      "mime": "font/woff2",
      "definedIn": ["src/css/display.css"]
    }]
  }
}
```

A stylesheet's `fontFaces` array preserves rule order and contains one entry per unique
`@font-face` rule. Its `fonts` array contains the deduplicated bundle assets referenced by
those rules. Data and remote URLs remain in `sources` with `asset: null`.

A font asset's `fontFaces` array contains every face that references the file. `definedIn`
contains every stylesheet where that face occurs.

### Field reference

`format` is always one of `woff2`, `woff`, `ttf`, `otf`, `eot`, `ttc`, `svg`, or `null` for
sources whose type cannot be determined. It is normalized from the CSS `format()` token when
present and from the file extension otherwise, so `format("truetype")` and a bare `url(x.ttf)`
both yield `ttf`. `mime` is derived from `format` and falls back to the string `"unknown"`.

| `format` | `mime` |
|---|---|
| `woff2` | `font/woff2` |
| `woff` | `font/woff` |
| `ttf` | `font/ttf` |
| `otf` | `font/otf` |
| `eot` | `application/vnd.ms-fontobject` |
| `ttc` | `font/collection` |
| `svg` | `image/svg+xml` |

`weight` is the authored `font-weight` value. `weightRange` is its numeric `[min, max]`
resolution: `normal`, `auto`, and an omitted declaration become `[400, 400]`, `bold` becomes
`[700, 700]`, and the variable-font range `100 900` becomes `[100, 900]`. Faces are
deduplicated by the normalized range, so `font-weight: normal` and `font-weight: 400` are one
face.

The `@font-face` descriptor accepts only `auto`, `normal`, `bold`, and numbers in `[1, 1000]`
— `bolder` and `lighter` are valid on the property but not the descriptor. Anything the
descriptor rejects resolves to `[400, 400]`, its initial value.

## Install

Using npm:

```console
npm install vite-plugin-font-manifest --save-dev
```

## Compatibility

The plugin supports Vite 6, 7, and 8. The test suite runs a real production build
against the latest release of each major version.

## Usage

### Generating the manifest

Add the plugin to your `vite.config.js` file.

```js
import { defineConfig } from 'vite'
import fontManifest from 'vite-plugin-font-manifest'

export default defineConfig({
    plugins: [
        fontManifest(),
    ]
})
```

The plugin annotates Vite's build manifest, so `build.manifest` must be enabled. With the
manifest disabled, the plugin does nothing.

### Preloading fonts

To preload fonts, parse the build manifest and add `<link rel=preload>` tags for each font. This
example is written in Twig and  limits preloading to `woff2` fonts for modern browsers.

```twig
{% for src in manifest['src/css/display.css'].fonts %}
  {% set font = manifest[src] %}
  {% set face = font.fontFaces|filter(face => face.format == 'woff2')|first %}
  <link rel="preload" href="/build/{{ font.file }}" as="font" type="{{ face.mime }}" crossorigin="anonymous" />
{% endfor %}
```

You can optionally inline the original font-face declarations from a stylesheet entry in a
`<style>` tag.

```twig
<style>
  {% for face in manifest['src/css/display.css'].fontFaces %}
    {{ face.css }}
  {% endfor %}
</style>
```

## Options

The plugin currently accepts no options. Feel free to open an issue if you need additional flags.

## License

[MIT](./LICENSE)
