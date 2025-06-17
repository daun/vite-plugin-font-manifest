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
  "src/fonts/Inter-Regular.woff2": {
    "file": "assets/Inter-Regular-CnZ_CWUo.woff2",
    "src": "src/fonts/Inter-Regular.woff2",
    "fontFace": {
      "family": "Inter",
      "weight": "400",
      "style": "normal",
      "mime": "font/woff2",
      "css": "@font-face { /* */ }",
      "definedIn": ["src/css/display.css"]
    }
  }
}
```

## Install

Using npm:

```console
npm install vite-plugin-font-manifest --save-dev
```

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
{% for src, entry in manifest %}
  {% if entry.fontFace is defined and entry.fontFace.format == 'woff2' %}
    <link rel="preload" href="/build/{{ entry.file }}" as="font" type="{{ entry.fontFace.mime }}" crossorigin="anonymous" />
  {% endif %}
{% endfor %}
```

You can optionally also inline the original font-face declaration in a `<style>` tag as fallback for
browsers that do not support preloading.

```twig
{% for src, entry in manifest %}
  {% if entry.fontFace is defined %}
    <style>{{ entry.fontFace.css }}</style>
  {% endif %}
{% endfor %}
```

## Options

The plugin currently accepts no options. Feel free to open an issue if you need additional flags.

## License

[MIT](./LICENSE)
