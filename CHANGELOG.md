# Changelog

## 2.1.0

- Emit a Laravel `fonts-manifest.json` for every declared font family with `laravel: true`
- Normalize `format` to a canonical key and `mime` to the correct IANA type
- Expose a numeric `weightRange` and collapse faces whose weights or styles are spelled differently
- Skip the manifest update when `build.manifest` is disabled instead of warning
- Resolve font assets on path boundaries and keep per-output state in multi-output builds

## 2.0.0 - 2026-09-19

- Keep every face, per font and per stylesheet, instead of one arbitrary winner
- Emit correct preload hints for every font format, not just woff2
- Expose weights so faces can be matched without reimplementing the CSS rules
- Collapse equivalent faces spelled differently across stylesheets

## 1.2.0 - 2025-06-17

- Include original font-face declaration

## 1.1.2 - 2025-06-17

- Fix package json

## 1.1.1 - 2025-06-17

- Fix package json

## 1.1.0 - 2025-06-17

- Support hashes in query string

## 1.0.0 - 2025-06-16

- Initial release
