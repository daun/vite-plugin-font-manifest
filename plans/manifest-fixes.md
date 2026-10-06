# Manifest accuracy fixes

## Status

Ready for implementation on `develop`. Target release: `2.1.0`.

Prerequisite for `plans/laravel-font-manifest.md`. That plan turns several of the
fields corrected here into strict build-time policy, so shipping it on top of the
current behavior would convert these bugs into build failures.

This patch stands on its own. None of it depends on Laravel.

## Problem

Four defects in the shipped v2 output, plus two latent correctness issues. All
were reproduced against `index.js` at `112947b`.

### 1. Format tokens and MIME types are wrong

`README.md:103-104` documents the intended consumption pattern:

```twig
{% set face = font.fontFaces|filter(face => face.format == 'woff2')|first %}
<link rel="preload" href="/build/{{ font.file }}" as="font" type="{{ face.mime }}" crossorigin="anonymous" />
```

Both fields are unreliable.

`extractFontFaceInfo` (`index.js:131-137`) prefers the CSS `format()` token over
the file extension, and `getMimeType` (`index.js:216-224`) only has extension
keys. Actual output today for
`src: url(Inter.ttf) format("truetype"), url(Inter.otf) format("opentype")`:

```json
"sources": [
  { "asset": "src/fonts/Inter.ttf", "format": "truetype", "mime": "unknown" },
  { "asset": "src/fonts/Inter.otf", "format": "opentype", "mime": "unknown" }
]
```

Two distinct problems:

- **`mime` is `"unknown"`** for every face authored with a `truetype`,
  `opentype`, or `embedded-opentype` format token — which is the normal way to
  write them. It renders as `type="unknown"` in the documented snippet.
- **`format` is inconsistent.** It is the CSS token when one is present and a
  file extension when one is not, so the same font yields `"truetype"` from
  `format("truetype")` but `"ttf"` from a bare `url(Inter.ttf)`. Consumers
  filtering on `format` cannot write one correct predicate.

Where the lookup does succeed it returns non-standard types: `font/truetype`,
`font/opentype`, and `font/embedded-opentype` are not registered IANA media
types. The correct values are `font/ttf`, `font/otf`, and
`application/vnd.ms-fontobject`.

The existing tests use only `format("woff2")` and `format("woff")` — the two
tokens that happen to collide with their own extension keys — so the suite
cannot see any of this.

### 2. Builds warn when the Vite manifest is disabled

`writeBundle` (`index.js:29-50`) defaults `manifestFileName` to `manifest.json`
without checking whether Vite was asked to produce one. With
`build.manifest: false` and any font present, every build prints:

```
Error updating font manifest: ENOENT … /manifest.json
```

Reproduced. This hits library builds, SSR passes, and any plain `vite build`
that does not enable the manifest.

### 3. Weights are unnormalized, which also breaks deduplication

`font-weight` is stored as authored, defaulting to the string `"normal"`
(`index.js:140`). So `400`, `"400"`, and an omitted declaration produce three
different values for the same face.

`fontFaceKey` (`index.js:170-183`) uses that raw value, so a project that writes
`font-weight: normal` in one stylesheet and `font-weight: 400` in another gets
two manifest entries for one physical face — the exact duplication v2 set out to
eliminate.

### 4. Asset resolution matches on a bare suffix

`getOriginalFilenameFromBundle` (`index.js:114-120`) resolves a CSS URL with
`pathname.endsWith(entry.fileName)`, which is not anchored to a path boundary. A
bundle containing both `assets/x.woff2` and `vendor/assets/x.woff2` can resolve
the wrong entry depending on bundle iteration order. It also re-scans the whole
bundle for every source, which is O(sources × bundle entries).

### 5. Multi-output builds keep only the last output

`generateBundle` assigns to a single module-scoped `info` (`index.js:20-23`).
Rollup calls the hook once per output. With more than one output, the earlier
manifests are annotated with the later bundle's data.

## Decisions needed before implementation

These change user-visible manifest output. Resolve them before writing code.

### D1. Normalize the `format` field, or leave it as authored?

**Recommended: normalize** to the canonical short key — `woff2`, `woff`, `ttf`,
`otf`, `eot` — regardless of whether it came from a `format()` token or a file
extension. This makes `face.format == 'woff2'` a correct predicate for the first
time and gives the field one stable domain.

The alternative — preserving the authored token and fixing only `mime` — keeps
today's output byte-identical for existing users but leaves the field
unusable for filtering, which is the one thing the README tells people to do
with it.

Normalizing changes output for projects using non-`woff` formats. Given the
field is currently inconsistent in a way no consumer can work around, treat it
as a bug fix in a minor release and call it out in the changelog.

### D2. Keep `mime: "unknown"`, or switch to `null`?

**Recommended: keep `"unknown"`.** `null` reads better in a manifest, but it is
a type change for a field that is currently always a string, and after this
patch the value becomes rare. Revisit at the next major.

### D3. How should weight be exposed?

**Recommended: keep `weight` as authored, add `weightRange: [min, max]`.**

| authored | `weight` | `weightRange` |
|---|---|---|
| *(omitted)* | `"normal"` | `[400, 400]` |
| `400` | `"400"` | `[400, 400]` |
| `bold` | `"bold"` | `[700, 700]` |
| `100 900` | `"100 900"` | `[100, 900]` |

One uniform numeric type, lossless, no breaking change to `weight`, and it
handles variable fonts — which the simpler "normalize `weight` to a number"
approach cannot represent without a mixed `number | string` type.

Consumers get `weightRange[0] === 400` instead of reimplementing the CSS keyword
table. The Laravel plan's preload matching builds directly on this.

The minimal alternative is to normalize inside `fontFaceKey` only, fixing the
deduplication bug without adding a field. That leaves every consumer writing
their own normalization.

## Changes

### Format and MIME normalization

Introduce one canonical mapping used by both fields:

```
format token          canonical   mime
woff2                 woff2       font/woff2
woff                  woff        font/woff
truetype | ttf        ttf         font/ttf
opentype | otf        otf         font/otf
embedded-opentype     eot         application/vnd.ms-fontobject
collection | ttc      ttc         font/collection
svg                   svg         image/svg+xml
```

Resolution order for each source:

1. Normalize the `format()` token if present and recognized.
2. Otherwise normalize the URL's file extension.
3. Otherwise `format: null`, `mime: 'unknown'`.

An unrecognized `format()` token must fall through to the extension rather than
poisoning the result — that is the specific path that produces `"unknown"`
today.

`format` is emitted as the canonical key (per D1); `mime` is looked up from the
canonical key, never from a raw token.

### Manifest guard

Skip the write entirely when `config.build.manifest` is falsy. Resolve the
filename only when it is truthy.

Separately, narrow the `catch` in `writeBundle`. A missing manifest when one was
expected is a different condition from malformed JSON, and both are currently
flattened into one opaque warning.

### Weight normalization

Add a normalizer covering numeric values, numeric strings, `normal` → 400,
`bold` → 700, and two-value ranges. Unparseable values fall back to `[400, 400]`
and keep the authored string in `weight`.

Use the normalized range in `fontFaceKey` so `normal` and `400` collapse to one
face. This is the deduplication fix.

Apply the same treatment to `font-style`: `oblique 14deg` and `oblique` should
not be two faces. Lower priority — note it, fix it only if the normalizer falls
out naturally.

### Anchored asset resolution

Require the match to land on a path boundary:

```
pathname === fileName || pathname.endsWith('/' + fileName)
```

Build the lookup as a `Map` once per `generateBundle` call instead of re-scanning
`Object.values(bundle)` per source.

### Per-output state

Replace the module-scoped `info` with a `Map` keyed by `options.dir`, written in
`generateBundle` and read in `writeBundle`. Delete the entry after writing so
repeated builds in a watching process do not accumulate.

## Tests

Extend `test/index.test.js`. The existing four tests must keep passing unchanged
except where D1/D3 deliberately alter output.

1. `format("truetype")` yields `format: "ttf"` and `mime: "font/ttf"`.
2. `format("opentype")` yields `otf` / `font/otf`.
3. `format("embedded-opentype")` yields `eot` /
   `application/vnd.ms-fontobject`.
4. A bare `url(Inter.ttf)` with no `format()` yields the same pair as (1) —
   this is the consistency guarantee.
5. An unrecognized `format()` token falls back to the URL extension.
6. A source with neither a recognized token nor a known extension yields
   `format: null` and `mime: "unknown"`.
7. `build.manifest: false` writes nothing and warns nothing.
8. `build.manifest: 'custom.json'` still resolves the custom filename.
9. A malformed existing manifest still warns and does not throw.
10. `font-weight: normal` and `font-weight: 400` on otherwise identical faces
    deduplicate to one entry.
11. `weightRange` for `normal`, `bold`, `400`, `"400"`, and `100 900`.
12. Two bundle entries whose filenames share a non-boundary suffix resolve to
    the correct assets.
13. Two Rollup outputs each annotate their own manifest.

Add a MIME-token case to `test/vite.test.js` so the real-build path covers a
non-`woff` format at least once.

## Sequence

1. Resolve D1–D3.
2. Canonical format/MIME table + resolution order, with tests 1-6.
3. Manifest guard and narrowed `catch`, with tests 7-9.
4. Weight normalizer, wire into `fontFaceKey`, with tests 10-11.
5. Anchored resolution and `Map` lookup, with test 12.
6. Per-output state, with test 13.
7. Update `README.md` — the preload snippet at `README.md:103-104` and the
   example manifest at `README.md:31-51` both need the corrected field values.
8. Changelog entry for `2.1.0` noting the `format` domain change.

Steps 2-6 are independent and can land in any order.
