# Modern Web Interface Rewrite

## Context

Phases 0-3 are complete: the parser and CLI have stronger diagnostics, the web app parses in a worker, ZIP creation runs in a worker, the list is virtualized, and URL settings are persisted. `docs/plans/web/new-api.md` will later add streaming APIs, deterministic creation, diagnostics ergonomics, and final browser-side repack.

This plan rewrites `apps/web` first so the interface is ready for that API work.

## Scope

In scope:
- Replace the current linear extractor page with an English-only one-page workspace.
- Keep Extract as the default mode and add a Pack mode shell for later `.unitypackage` export.
- Show a tree view by default, with an extension grouping option.
- Add a right preview pane for text, images, PDF, audio, and video using browser-native previews.
- Show derived metadata such as path, extension, size, GUID, record kind, meta and preview presence, duplicate path count, and related diagnostics.
- Add PWA app metadata and offline-ready Vite build support.

Out of scope:
- Do not implement final `.unitypackage` export before `docs/plans/web/new-api.md`.
- Do not add heavy PDF or syntax-highlighting viewer dependencies in the first pass.
- Do not add localization, server processing, or cloud upload.

## Phases

### Phase 1: Data Model And Workers

Goal: make app state entry-aware instead of flat-file-only.

Files in scope: `apps/web/src/workerTypes.ts`, web workers, new web model helpers.

Exit criteria:
- Parse worker returns entry-aware records plus diagnostics.
- Existing ZIP download still works from derived records.
- Helpers build tree nodes and extension groups deterministically.
- Tests cover grouping, metadata derivation, preview detection, and duplicate path handling.

### Phase 2: Workspace Shell

Goal: replace the current page with the one-page app layout.

Files in scope: `App.tsx`, workspace components, CSS.

Exit criteria:
- Extract mode is default.
- Tree view is visible by default after package load.
- Extension grouping toggle works without reparsing.
- Language UI, translation types, and `language` URL persistence are gone.
- Empty, loading, parsed, error, and diagnostics states are visible.

### Phase 3: Preview And Metadata Pane

Goal: make selection the core interaction.

Files in scope: preview components, metadata components, blob URL helpers.

Exit criteria:
- Clicking a file updates the right preview pane.
- Text previews are size-capped and binary-safe.
- Browser-native image, PDF, audio, and video previews work when supported.
- Unsupported files show metadata and download actions.
- Blob URLs are revoked on selection and package changes.

### Phase 4: Pack Mode Shell

Goal: prepare the UI contract for `docs/plans/web/new-api.md`.

Files in scope: mode tabs, pack panel, selection and staging helpers.

Exit criteria:
- Pack mode can stage selected extracted entries into a draft.
- Draft validation reports empty selection, missing meta, duplicate GUID, and unsupported source states.
- `.unitypackage` export is visibly disabled until the new API plan is implemented.
- The future integration point accepts staged `CreateUnityPackageEntry`-compatible data.

### Phase 5: PWA Polish And Validation

Goal: ship the rewritten app as an installable SPA.

Files in scope: `vite.config.ts`, `index.html`, public assets, package scripts, final CSS.

Exit criteria:
- Vite build emits manifest and service worker assets.
- App works in `vite preview` with installable manifest metadata.
- Desktop layout uses a stable split view; mobile layout stacks explorer and preview without overlap.
- Icon buttons have accessible visible or visually hidden labels.

## Verification

```sh
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web typecheck
bun run --filter @unitypackage-tools/web build
bun run check
```

Manual smoke:
- Load a real `.unitypackage`.
- Confirm tree view is default and extension grouping works.
- Select text, PNG, PDF, and unsupported files and verify previews or fallback metadata.
- Download one file, selected files, and all extracted files as ZIP.
- Confirm no language switch exists and no `language` URL parameter is written.
- Open Pack mode, stage entries, and confirm export is gated until `new-api.md`.
- Run `bun run --filter @unitypackage-tools/web preview` and verify manifest and service worker behavior in the browser.

## Assumptions

- First implementation uses native previews only.
- Pack mode is a prepared shell before `new-api.md`; final `.unitypackage` export belongs to that later plan.
- Metadata is derived from current parsed entries only. Tar timestamps or deeper archive metadata should not be displayed until core exposes them.
