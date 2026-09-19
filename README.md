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
