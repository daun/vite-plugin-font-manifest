# Vite Font Manifest Plugin

A Vite plugin for adding font information to the build manifest.

Useful for optimizing font loading by generating preload hints or inlining the
font-face CSS declarations.

## Example

**Before**

```json
{
  "src/css/display.css": {
    "file": "assets/display.css"
  },
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

The plugin annotates Vite's build manifest, so `build.manifest` must be enabled. With the
manifest disabled, the plugin does nothing.

### Preloading fonts

To preload fonts, parse the build manifest and add `<link rel=preload>` tags for each font. This
example is written in Twig and limits preloading to `woff2` fonts for modern browsers.

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

## Laravel

Laravel 13 ships a `@fonts` Blade directive that reads its own `fonts-manifest.json`. Pass a
`laravel` option to emit one alongside the ordinary manifest. Without the option nothing changes.

```js
export default defineConfig({
    plugins: [
        laravel({ input: ['resources/css/app.css'] }),
        fontManifest({
            laravel: {
                families: {
                    sans: { family: 'Univers', variable: '--font-sans' },
                },
                preload: [
                    { alias: 'sans', weight: 400 },
                    { alias: 'sans', weight: 700 },
                ],
            },
        }),
    ]
})
```

```blade
{{-- every configured family --}}
@fonts

{{-- one family, with only its preloads and variables --}}
@fonts(['sans'])
```

The plugin does not author your `@font-face` rules. It observes the ones Vite already processed
and combines them with the alias and preload policy configured above.

### Families

`families` is keyed by the alias used in templates. Each entry needs the CSS `font-family` to
match against observed faces, and the custom property `@fonts` should expose:

```css
:root {
  --font-sans: "Univers";
}
```

Observed families you do not configure stay in the ordinary manifest and are left out of the
Laravel one. Several aliases may point at one CSS family; family-based preload selectors then
become ambiguous and have to name an alias instead.

### Preloads

A selector names a family by `alias` or `family`, never both, and always carries a `weight`.
An omitted `style` means `normal`. Weights are matched against the face's range, so a variable
font declared `font-weight: 100 900` satisfies `weight: 400`.

One source is preloaded per face, preferring `woff2`, then `woff`, `ttf`, `otf`, `eot`. The
`as`, `type` and `crossorigin` attributes default to `font`, the resolved MIME type and
`anonymous`; set any of them per selector, or pass `null` to omit `type`/`crossorigin`.

### Options

| Option | Default | Description |
|---|---|---|
| `families` | — | Required. Alias → `{ family, variable }`. |
| `preload` | `[]` | Selectors to emit preload entries for. |
| `manifestFilename` | `fonts-manifest.json` | Must match `Vite::useFontsManifestFilename()`. |
| `style` | `'inline'` | Only `inline` is supported so far. |

### Strictness

Laravel mode fails the build instead of warning, because a manifest Laravel rejects breaks
every page that renders `@fonts`. Invalid configuration, a configured family no stylesheet
declares, an ambiguous or unmatched preload selector, and a source that cannot be preloaded are
all build errors.

Inlined CSS is moved into a `<style>` element, so bundled font URLs are rewritten against Vite's
`base`. `laravel-vite-plugin` sets an absolute `base` for production builds; overriding it with a
relative value makes document-safe URLs underivable and fails the build.

### Development

Only production builds are supported. No `fonts-manifest.dev.json` is written, and Laravel
treats its absence as a no-op — `@fonts` renders nothing while the Vite dev server serves the
stylesheet that carries the same faces. Delete any stale `fonts-manifest.dev.json` left behind
by another setup, since Laravel will happily consume it.

## Options

The plugin accepts a single `laravel` option, documented above. Feel free to open an issue if
you need additional flags.

## License

[MIT](./LICENSE)
