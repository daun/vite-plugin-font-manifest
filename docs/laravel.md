# Laravel

Laravel 13 ships a `@fonts` Blade directive that renders preload links and inline font CSS
from a `fonts-manifest.json`. Set `laravel: true` and the plugin writes one from the
`@font-face` rules already in your stylesheets.

```js
export default defineConfig({
    plugins: [
        laravel({ input: ['resources/css/app.css'] }),
        fontManifest({ laravel: true }),
    ]
})
```

```blade
{{-- every family --}}
@fonts

{{-- one family, with only its preloads and variable --}}
@fonts(['brand-sans'])
```

## Compared to laravel-vite-plugin

`laravel-vite-plugin` can write the same manifest through its `fonts` option, but it generates
the `@font-face` rules itself from fonts you list in `vite.config.js`. This plugin goes the
other way: it reads the rules you have already written. Use it when your font CSS is the
source of truth. Descriptors like `unicode-range`, `font-stretch` or `size-adjust` pass
through unchanged.

## What gets written

Every family declared in the bundled CSS ends up in the manifest. Aliases and variables follow
`laravel-vite-plugin`'s conventions:

| CSS family | Alias | Variable |
|---|---|---|
| `Univers` | `univers` | `--font-univers: "Univers";` |
| `Brand Sans` | `brand-sans` | `--font-brand-sans: "Brand Sans";` |

Each face is preloaded once, using its best bundled source: `woff2`, then `woff`, `ttf`, `otf`,
`eot`. Faces whose sources are data URIs, remote URLs or files in `public/` keep their CSS but
are not preloaded.

## Options

Pass an object instead of `true` to narrow the default.

```js
fontManifest({
    laravel: {
        exclude: ['Font Awesome 6 Free'],
    },
})
```

| Option | Default | Description |
|---|---|---|
| `include` | all | Only write these families. |
| `exclude` | none | Write every family except these. |
| `preload` | `true` | Set to `false` to write no preload entries. |
| `manifestFilename` | `fonts-manifest.json` | Must match `Vite::useFontsManifestFilename()`. |

`include` and `exclude` take CSS family names, are case-insensitive, and cannot be combined.
Naming a family no stylesheet declares fails the build, which catches typos.

## Errors

The build fails when Laravel would reject the manifest or it would silently be wrong:

- `include` or `exclude` names an undeclared family;
- two families slug to the same alias, e.g. `Univers` and `Univers!`;
- a family name yields no alias, e.g. one written only in non-Latin characters.

The last two can be resolved by excluding one of the families.

Inlined CSS is moved into a `<style>` element, so bundled font URLs are rewritten against Vite's
`base`. `laravel-vite-plugin` sets an absolute `base` for production builds; overriding it with a
relative value makes document-safe URLs underivable and fails the build.

## Development

Only production builds are supported. No `fonts-manifest.dev.json` is written, and Laravel
treats its absence as a no-op: `@fonts` renders nothing while the Vite dev server serves the
stylesheet that carries the same faces. Delete any stale `fonts-manifest.dev.json` left behind
by another setup, since Laravel will happily consume it.
