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

In your `vite.config.js` file:

```js
import { defineConfig } from 'vite'
import fontManifest from 'vite-plugin-font-manifest'

export default defineConfig({
    plugins: [
        fontManifest(),
    ]
})
```

## Options

The plugin currently accepts no options. Feel free to open an issue if you need additional flags.

## License

[MIT](./LICENSE)
