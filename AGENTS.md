# Working on Still

Read PRODUCT.md, DESIGN.md, docs/features.md, and docs/testing.md before changing behavior. Application source is TypeScript in src/ and server/. Existing Cloudflare resources and single-owner Access enforcement must remain private.

## Themes

For theme creation, read docs/themes/THEME_AUTHORING.md. It contains the full schema, token semantics, complete built-in examples, accessibility requirements and import/export workflow. This document is intentionally agent-independent. A theme is data, not code. Do not add arbitrary CSS, JavaScript, HTML, remote fonts, URLs, or network asset loading to theme packages. Runtime validation is in src/themes/index.ts; keep the exported schema/examples/docs consistent with that contract. Never replace the built-in Light theme merely to add a new theme.

## Validation and deployment

Run npm run check after changes. Tests use Miniflare, fake IndexedDB, DOM interactions, mocked Web Audio, and service-worker routing. State exactly what was and was not verified. Do not call DOM tests real browser/Android testing. See docs/features.md for browser-specific behavior and limitations.

Deploy production through the Cloudflare GitHub connection, not directly from this workspace. A new D1 schema must be applied to the existing database before deploying dependent code. Preserve resource IDs, bindings and secrets; never commit production credentials or music. GitHub user-facing commits should use the owner's GitHub noreply address.
