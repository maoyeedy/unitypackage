# Web Phase Handoff

## Current Status

The modern web interface rewrite has been implemented as the prerequisite for
`docs/plans/web/new-api.md`.

The old linear extractor page was replaced with an English-only React/Vite PWA
workspace. Extract is the default mode. The app parses `.unitypackage` files in
a module worker, preserves entry-aware records, shows a tree view by default,
can group records by extension, and displays the selected record in a right-side
preview and metadata pane. Extract selection supports row checkboxes,
drag-sweep selection inside the middle explorer pane, folder select-all, and
extension select-all. Search filters scope folder and extension select-all to
currently visible records.

## Done

- Added `docs/plans/web/modern-interface-rewrite.md` as the implementation plan.
- Updated `docs/plans/web/new-api.md` so future API work wires the existing Pack mode shell instead of rebuilding the web UI.
- Updated `README.md`, `CLAUDE.md`, `docs/reference/ctx7.md`, `docs/plans/phase-done.md`, and `docs/plans/ci/ci-release.md` to match the new web direction.
- Added `apps/web/src/packageModel.ts` for web-local records, grouping, preview detection, metadata derivation, and Pack draft validation.
- Updated the parse worker to return entry-aware `PackageFileRecord` values instead of flat extracted file content.
- Updated the ZIP worker to download all records or selected records while preserving folders when requested.
- Replaced the app UI with a workspace layout: top app bar, Extract and Pack tabs, left controls, central explorer, right preview/metadata pane, and status bar.
- Removed localization and old UI files: translations, language selector, legacy controls, legacy file list, legacy drop zone, old header, and React starter asset.
- Added native previews for text, image, PDF, audio, and video records, with metadata fallback for unsupported types.
- Added Shiki syntax highlighting for text previews, including Unity serialized YAML-ish, JSON, XML, and CSS file associations.
- Added enriched lucide file-tree icons with explicit per-extension mapping for Unity assets, code, media, documents, metadata, and unknown binary files. See `docs/reference/file-icons.md`.
- Added batch selection UX for tree and extension grouping: file checkboxes, drag-sweep selection, visible-filter folder select-all, visible-filter extension select-all, mixed selection state, selected row styling, and clear selection.
- Added PWA setup with `vite-plugin-pwa`, service worker registration, manifest metadata, and SVG app icons.
- Added `lucide-react`, `vite-plugin-pwa`, `workbox-window`, and web-local Vitest scripts.
- Added unit coverage for tree rows, extension groups, selection helpers, preview kind detection, file icon descriptors, pack validation, duplicate path metadata, and real PNG fixture behavior.

## Fixed During Followup

- `.png.meta` records are forced to metadata text preview behavior, not PNG/image preview behavior.
- `ignored-preview` diagnostics now attach to the synthetic preview record only, not the actual PNG asset record.
- Shift-click range selection was removed after Firefox manual testing; drag-sweep selection remains the range-select path and is constrained to file rows inside the middle explorer pane to avoid browser text selection.
- The regression test now reads the real fixture files:
  - `fixtures/static/texture_02.png`
  - `fixtures/static/texture_02.png.meta`

## Not Done Yet

- Browser-side `.unitypackage` export is not implemented. Pack mode is intentionally a disabled shell until `docs/plans/web/new-api.md` adds the final browser-safe creation API.
- Streaming parse is not implemented in core or web yet.
- Deterministic/sized package creation APIs are not implemented yet.
- Rich PDF navigation was intentionally left out; current PDF previews use browser-native rendering.
- Playwright/browser smoke coverage is not added yet. `docs/plans/ci/ci-release.md` now expects a smoke test against the workspace tree and preview pane.
- Manual browser smoke with `fixtures/static/editor-packed.unitypackage` should still be done after the next UI-affecting change.

## Validation Run

Latest successful validation:

```sh
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web typecheck
bunx eslint apps/web/src
bun run --filter @unitypackage-tools/web build
bun run check
```

The web test suite currently includes `packageModel` selection/grouping coverage and syntax highlighting tests.
It also includes file icon descriptor coverage for the documented extension mapping.

## Next Agent Notes

- Start from `docs/plans/web/new-api.md` for the next API integration phase.
- Keep `apps/web` English-only. Do not reintroduce translation files, language selectors, or `language` URL state.
- Keep `PackageFileRecord` as the web UI boundary unless the core API changes require a deliberate migration.
- Keep Extract selection behavior discoverable but scoped: plain row click previews, checkbox toggles selection, drag-sweep selects ranges only while over file rows in the active middle explorer pane, and folder/extension select-all applies to filtered visible records.
- Keep ZIP downloads in Extract mode when enabling Pack export.
- When adding Pack export, connect the existing staged-record validation and worker boundary instead of adding a second pack UI.
- PWA dev mode may create `apps/web/dev-dist/`; treat it as generated output and do not commit it.
