# Laravel font manifest emitter

## Status

Planned. Blocked on `plans/manifest-fixes.md`.

That patch corrects the format/MIME table, adds normalized weight ranges, and
anchors asset resolution. Laravel mode is strict — it fails the build rather
than warning — so on today's code a stylesheet written with
`format("truetype")` would resolve to `mime: "unknown"` and hard-fail a build
that is perfectly valid. Do not start this work until those fixes are on
`develop`.

What this plan assumes from that patch:

- `format` is a canonical key (`woff2`, `woff`, `ttf`, `otf`, `eot`);
- `mime` is a correct IANA type, or `"unknown"` only when genuinely unresolvable;
- every face carries `weightRange: [min, max]`;
- asset resolution matches on a path boundary and is unambiguous;
- per-output state is keyed by output directory.

The Laravel layer consumes those fields and does not reimplement them.

## Decision

Add an opt-in Laravel schema v1 emitter while retaining the framework-neutral
Vite manifest augmentation as the package's primary output.

This is intentionally not a migration to Laravel's data model. The two outputs
serve different purposes:

- the existing manifest records all observed font data and stylesheet
  relationships;
- Laravel's manifest combines observed CSS with configured alias and preload
  policy.

The first release supports production builds only. It does not create
`fonts-manifest.dev.json`. In hot mode Laravel treats an absent development font
manifest as a no-op, so `@fonts` renders nothing while the normal Vite
stylesheet supplies the font faces.

Do not create an empty-array development manifest. Laravel validates any file it
finds, and `[]` fails `ensureValidManifest()` because it lacks `version` and
`families`.

## Goals

- Preserve the current zero-config, framework-neutral output.
- Generate a Laravel-compatible `fonts-manifest.json` when explicitly configured.
- Derive font-face CSS and source files from CSS processed by Vite.
- Keep alias and preload selection as explicit build policy.
- Support Laravel 13's built-in `@fonts` and the downstream backport without PHP
  changes.
- Produce valid CSS for both unfiltered and alias-filtered `@fonts` calls.
- Fail the build when Laravel policy is invalid or cannot be resolved
  unambiguously.

## Non-goals

- Generating the project's source `@font-face` declarations.
- Replacing `laravel-vite-plugin` font providers.
- Generating Laravel's `.font-*` utility classes.
- Supporting hot mode in the first release.
- Replacing or reducing the existing framework-neutral manifest data.
- Inferring aliases or preload policy from CSS.

## Laravel contract

Verified against `laravel/framework` `13.x`. Everything the emitter must satisfy:

| Behavior | Source |
|---|---|
| Manifest path is `public_path(buildDirectory/fontsManifestFilename)` | `ViteFonts::manifest()` |
| Filename defaults to `fonts-manifest.json`, overridable via `Vite::useFontsManifestFilename()` | `Vite.php:112`, `Vite.php:1223` |
| A missing manifest returns `''` — no exception | `Vite::fonts()`, `Vite.php:1092` |
| `version` must be present and exactly `1` | `ViteFonts::ensureValidManifest()` |
| `families` must be present and an array, on **every** call including unfiltered | same |
| Requested aliases are checked against `families` keys | `ViteFonts::ensureValidFamilies()` |
| Preloads are filtered by `alias`, strict comparison | `Vite.php:1107` |
| **Every** preload entry must have `alias`; build entries must also have `file` | `ViteFonts::ensureValidPreloads()` |
| `file` is resolved as `assetPath(buildDirectory/file)` — bundle-relative, **no base** | `Vite.php:1132` |
| `as`, `type`, `crossorigin` are passed through verbatim; `type`/`crossorigin` omitted when absent | `Vite::resolveFontPreloadAttributes()` |
| Preload links are deduplicated by resolved URL at render time | `Vite.php:1134` |
| A filtered call reads **only** `familyStyles` and `variables`; `style.inline` is ignored | `ViteFonts::resolveStyleContent()` |
| An unfiltered call reads `style.inline`, else `style.file`, else renders nothing | same |
| Laravel wraps `variables` in `:root { … }` itself and indents by two spaces | `ViteFonts::filterVariables()` |
| `style.file` is read from `public_path(buildDirectory/file)` | `ViteFonts::readStyleFile()` |
| Hot mode reads `dirname(hotFile)/fonts-manifest.dev.json` | `ViteFonts::manifest()` |

Two consequences worth stating explicitly, because both are easy to get backwards:

- **`alias` is mandatory on every preload entry**, including ones selected by
  `family`. An entry without one throws in `ensureValidPreloads()` even on an
  unfiltered call.
- **`file` carries no base prefix; CSS `url()`s do.** Laravel prepends the build
  directory to `file` itself, while inlined CSS is served from the document and
  needs the full resolved base.

## Proposed API

```js
fontManifest({
  laravel: {
    families: {
      sans: {
        family: 'Univers',
        variable: '--font-sans',
      },
    },
    preload: [
      { alias: 'sans', weight: 400 },
      { family: 'Univers', weight: 300, style: 'normal' },
    ],
    // optional
    manifestFilename: 'fonts-manifest.json',
    style: 'inline',
  },
})
```

`laravel` remains optional. Omitting it preserves current behavior and output
exactly.

`manifestFilename` mirrors `Vite::useFontsManifestFilename()`. Projects that
rename the manifest in PHP must be able to match it here.

### Families

`families` is keyed by the alias Laravel templates use, such as `sans` in
`@fonts(['sans'])`.

Each family must contain:

- `family`: the CSS `font-family` value to match against observed faces;
- `variable`: the CSS custom property name exposed in the Laravel manifest.

The initial variable value is the configured family name:

```css
--font-sans: "Univers";
```

Fallback configuration can be added separately if the consuming project requires
it. It should not be inferred from unrelated CSS.

Multiple aliases may reference one CSS family. This is valid, but family-based
preload selectors become ambiguous and must use an alias instead.

Observed families that are not configured remain available in the
framework-neutral manifest and are omitted from the Laravel manifest.

### Preload selectors

A preload selector may identify a configured family by `alias` or by `family`.

Rules:

1. Exactly one of `alias` and `family` must be present.
2. An unknown alias or family is an error.
3. A family matching multiple aliases is ambiguous and is an error.
4. `weight` is required.
5. Omitted `style` means `normal`, not every style.
6. A selector matching no observed face is an error.
7. Weight matching uses `weightRange`: a face matches when
   `min <= weight <= max`. A non-variable face has `min === max`, so exact
   matching is the degenerate case and variable fonts work without special
   handling.
8. One source is selected per face, preferring `woff2`, then `woff`, `ttf`,
   `otf`, `eot` — comparing canonical `format` keys, never raw CSS tokens.
9. Multiple equal-priority local sources are ambiguous and produce an error.
10. Data and remote URLs may remain in CSS but cannot become build-file preload
    entries.
11. A source whose `mime` is `"unknown"` cannot be preloaded, and the error must
    name the face and the unresolved source.

Rule 7 replaces the previous "normalize `normal`/`bold`/numeric strings" rule.
That normalization now lives in the shared extraction layer and is not restated
here.

#### Deduplication

Deduplicate preload entries by **`(alias, file)`**, not by `file` alone.

Two aliases may legitimately share one CSS family. Collapsing their entries by
file drops one alias, and `Vite::fonts()` filters preloads with
`in_array($preload['alias'], $aliases, true)` — so `@fonts(['serif'])` would
silently render no preload link. Emitting both entries costs nothing: Laravel
already deduplicates the rendered `<link>` tags by resolved URL.

## Generated schema

Write `<outDir>/<manifestFilename>`:

```json
{
  "version": 1,
  "style": {
    "inline": "…all configured font faces and variables…",
    "familyStyles": {
      "sans": "…font-face CSS for Univers…"
    },
    "variables": {
      "sans": "--font-sans: \"Univers\";"
    }
  },
  "preloads": [
    {
      "alias": "sans",
      "family": "Univers",
      "weight": 400,
      "style": "normal",
      "file": "assets/Univers-regular.woff2",
      "as": "font",
      "type": "font/woff2",
      "crossorigin": "anonymous"
    }
  ],
  "families": {
    "sans": {
      "family": "Univers",
      "variable": "--font-sans"
    }
  }
}
```

### Style content

`style.inline` is required even though `familyStyles` is present. Laravel only
consults `familyStyles` and `variables` for filtered calls. An unfiltered
`@fonts` renders no CSS when both `style.inline` and `style.file` are absent.

Generate:

- `familyStyles[alias]`: globally deduplicated observed `@font-face` rules for
  that alias's CSS family;
- `variables[alias]`: one custom-property declaration, without a surrounding
  `:root` block, **with its trailing semicolon**;
- `style.inline`: all configured family styles followed by one `:root` block
  containing all configured variables.

The semicolon is an invariant, not a formatting preference. `filterVariables()`
joins declarations with a newline and adds nothing, so a missing semicolon
produces invalid CSS for any call requesting two or more aliases. Assert it.

Do not generate `.font-*` utility classes. This plugin observes user-authored
font CSS rather than taking ownership of typography utilities.

Face identity must remain structural, not whitespace-based, and must reuse the
shared face key rather than defining a second notion of identity:

```text
family | normalized weight range | style | display | sorted source URLs/formats
```

Preserve first-observed rule order after global deduplication.

### Inline duplication

Inlining means the `@font-face` rules ship twice: once in the Vite CSS bundle
that Laravel's normal `@vite` directive already loads, and again in the
`<style>` block `@fonts` renders. The two copies can also disagree about URLs
once rewriting is applied to only one of them.

This is a real cost and the plan accepts it for v1, because inline CSS is what
makes `@fonts` render without a second network round-trip — the whole point of
the directive.

`style: 'inline' | 'file'` in the options is the escape hatch. Under `'file'`
the emitter writes a CSS file into `outDir` and records `style.file` instead,
which Laravel reads via `readStyleFile()`. That mode also sidesteps URL
rewriting entirely, since the emitted file sits beside the other build assets.

Implement `'inline'` first. Ship `'file'` in the same release only if it falls
out cheaply; otherwise defer it and document the trade-off.

### URL rewriting

Inline CSS is moved from an emitted stylesheet into an HTML `<style>` element.
Relative URLs would therefore resolve against the document instead of the
original CSS file.

This matters only when Vite is configured with a relative `base` (`''` or
`'./'`). Under the default absolute base, Vite has already written
document-absolute URLs and rewriting is a no-op. Implement it unconditionally
anyway — detecting "already correct" is more fragile than normalizing.

Before adding a rule to `familyStyles` or `style.inline`:

1. Parse its `src` declaration.
2. Resolve each local bundled source to its emitted bundle filename.
3. Rewrite the CSS URL to a document-safe URL using Vite's resolved `base` and
   emitted filename.
4. Preserve query strings when relevant.
5. Leave `data:`, protocol-relative, and absolute remote URLs unchanged.

Do not rewrite CSS through string replacement; update parsed `url()` nodes so
quoting and multiple sources remain valid.

This rewriting is mandatory for the emitter. A manifest with syntactically valid
but document-relative font URLs is considered incorrect.

Note the asymmetry with `preloads[].file`, which must **not** receive the base
prefix. Same underlying asset, two different serializations.

## Validation and errors

Laravel mode is strict. Configuration or serialization failures must escape the
plugin hook and fail the build rather than pass through the existing
warning-only asset-manifest path.

Fail for:

- missing or malformed `families` configuration;
- invalid alias, family, or variable names;
- configured families with no observed faces;
- invalid or ambiguous preload selectors;
- selectors resolving only to non-bundle URLs;
- unresolvable or unknown source MIME types selected for preload;
- inability to produce document-safe CSS URLs;
- inability to write the Laravel manifest.

Error messages should identify the alias or preload index and list available
values where useful.

The existing malformed-CSS behavior remains tolerant for ordinary extraction:
warn and return no faces. If that causes configured Laravel policy not to
resolve, strict Laravel validation then fails with a policy-specific error.

### Where strictness must not apply

A hard failure on "configured families with no observed faces" breaks any build
that legitimately has no client CSS. Gate Laravel emission on the client build:

- set `apply: 'build'`;
- skip when `config.build.ssr` is set, or when the environment is not the client
  environment on Vite 6+;
- skip when the output has no stylesheet assets **and** the build is not the one
  that would carry them.

An SSR pass that never sees a stylesheet must not fail because the client pass
is where the fonts live.

## Build lifecycle

1. `configResolved` stores Vite's resolved build directory and base URL.
2. `generateBundle` extracts the complete framework-neutral model from emitted
   CSS and assets, keyed by output directory.
3. When `laravel` is enabled and the output is a client build, derive and
   validate the Laravel model from the same extracted data and Rollup bundle.
4. `writeBundle` continues augmenting Vite's ordinary manifest.
5. `writeBundle` writes the Laravel manifest directly under `outDir` after
   successful validation.

Two code paths in `index.js` need restructuring before this works:

- **`writeBundle`'s early return** (`index.js:27`) bails when no fonts were
  found. Laravel emission would be silently skipped instead of raising the
  configured-but-unobserved error. The guard must not cover the Laravel path.
- **The `catch` around the whole body** (`index.js:49`) downgrades everything to
  `console.warn`. That is exactly the behavior Laravel mode must not inherit.
  Narrow it to the ordinary manifest update.

The Laravel emitter uses Rollup bundle metadata for emitted filenames rather
than reparsing the written Vite manifest. Its output must not lose information
because the ordinary manifest has a different key layout.

The build emitter does not create, truncate, or overwrite
`fonts-manifest.dev.json`. Document that a stale development manifest from
another plugin or previous setup may still be consumed by Laravel and should be
removed.

## Compatibility and release policy

- Keep `fontManifest()` behavior unchanged.
- Treat `fontManifest({ laravel: … })` as an additive feature suitable for a
  minor release after `2.1.0`.
- Identify the emitted format as Laravel fonts manifest schema version 1.
- Isolate Laravel serialization from the internal observed-data model so a
  future Laravel schema does not force a redesign of the primary manifest.
- Test against Laravel's observable contract rather than undocumented
  implementation assumptions.

## Test plan

Add to the suite established by `plans/manifest-fixes.md`:

1. Laravel mode is opt-in and does not change the ordinary Vite manifest.
2. No `laravel` config and no fonts present leaves the build entirely
   untouched — no writes, no warnings.
3. Unfiltered output contains `style.inline` with all configured faces and a
   `:root` variables block.
4. Filtered data contains alias-keyed `familyStyles` and `variables`.
5. Every `variables` value ends in a semicolon.
6. Relative bundled URLs are rewritten to document-safe Vite-base URLs.
7. `preloads[].file` carries no base prefix, under both default and relative
   `base`.
8. A face with WOFF2 and WOFF emits one preload using WOFF2.
9. Alias and unambiguous family selectors resolve to the same preload.
10. Every emitted preload entry has an `alias`, including family-selected ones.
11. Two aliases sharing one family each keep their own preload entry.
12. Duplicate selectors resolving to the same `(alias, file)` produce one entry.
13. Omitted style selects the normal face.
14. A variable font with `font-weight: 100 900` matches a `weight: 400`
    selector.
15. Unknown aliases and families fail with useful errors.
16. Family selectors matching multiple aliases fail as ambiguous.
17. Configured families with no observed faces fail.
18. Selectors matching no face fail.
19. Equal-priority source ambiguity fails.
20. Data-only and remote-only faces cannot be selected for preload.
21. A source with unresolvable MIME cannot be preloaded, and the error names it.
22. `manifestFilename` is respected.
23. No `fonts-manifest.dev.json` is generated.
24. An SSR build with Laravel configured and no CSS does not throw.
25. Real Vite 6, 7, and 8 builds produce the same Laravel schema — compare after
    normalizing content hashes out of filenames, or compare structure only.
26. A vendored real-CSS fixture reproduces the target output. Copy the fixture
    into this repo; do not reference `plans/font-loading-laravel.md` in the
    consuming project from a CI assertion.
27. A JS port of `ViteFonts::resolveStyleContent()`, `ensureValidManifest()`,
    `ensureValidFamilies()`, and `ensureValidPreloads()` accepts the emitted
    manifest and renders both preload links and a non-empty `<style>` block for
    an unfiltered call.

Test 27 replaces the previously proposed PHP fixture. `ViteFonts` is ~200 lines
of pure logic with no framework dependencies beyond `public_path()`; porting the
four methods gives the same contract signal without adding PHP to CI. Keep the
port in `test/` next to the fixture it validates, and note the upstream commit
it was ported from.

## Implementation sequence

1. Land `plans/manifest-fixes.md`.
2. Add option parsing and validation without changing the default path.
3. Restructure the `writeBundle` guard and `catch` so Laravel errors escape.
4. Add client-build gating.
5. Retain emitted `fileName` alongside `originalFileName` in the extracted model.
6. Implement alias resolution and global face grouping.
7. Implement preload selection, source preference, and `(alias, file)` dedup.
8. Implement CSS URL rewriting.
9. Serialize and write Laravel schema v1.
10. Add unit tests for policy and CSS rewriting.
11. Add the `ViteFonts` contract port and vendored fixture.
12. Add real-build compatibility tests for Vite 6-8.
13. Document usage, build-only hot-mode behavior, strict errors, and schema
    ownership.

## Deferred work

A later hot-mode release would need to:

- discover or explicitly configure Laravel's hot-file location;
- observe transformed CSS during Vite development;
- write `fonts-manifest.dev.json` beside the hot file;
- use `url` instead of `file` in preloads;
- update the manifest during CSS/HMR changes;
- remove only development manifests owned by this plugin;
- test custom hot-file paths and dev-server origins.

Until then, absence of `fonts-manifest.dev.json` is the supported development
behavior.

Also deferred: `style: 'file'` if it does not land in v1, and per-family
fallback stacks in `variables`.

## References

- Laravel `ViteFonts`: <https://github.com/laravel/framework/blob/13.x/src/Illuminate/Foundation/ViteFonts.php>
- Laravel `Vite::fonts()`: <https://github.com/laravel/framework/blob/13.x/src/Illuminate/Foundation/Vite.php>
- Laravel framework font runtime PR: <https://github.com/laravel/framework/pull/59584>
