# Extract Mode Enrichment

## Context

The web workspace already parses `.unitypackage` files in a worker, renders an
entry-aware tree (or extension grouping), supports drag-sweep + checkbox
selection, previews a single record on the right, and offers selected/all ZIP
downloads. This plan makes the Extract experience markedly more powerful and
pleasant: better search and filtering, sortable views, keyboard navigation,
richer previews, copyable metadata, a global diagnostics drawer, persistence
and recents, a manual theme toggle, and a final performance/a11y pass.

Constraints carried forward:

- `apps/web` stays English-only. No translation files, no language selector, no
  `language` URL state.
- `PackageFileRecord` keeps no `kind` field. Derive category with
  `getRecordCategory(record)` and use the primitive predicates (`extension ===
  'meta'`, `isUnityPreview`, `!isUnityPreview && extension !== 'meta'`).
- Core now owns component records and file classification. Keep web helpers as
  UI adapters over `entriesToComponentRecords`, `getPathExtension`,
  `getMimeTypeForPath`, `getPreviewKindForPath`, and
  `getSyntaxLanguageForPath`; do not reintroduce local extension tables.
- Use `analyzeUnityPackageEntries` for global diagnostics and analysis
  findings. Parser diagnostics are not the only diagnostic source anymore.
- Selection logic and pure helpers live in `apps/web/src/App.tsx` and
  `apps/web/src/packageModel.ts`. Selection stays scoped to filtered visible
  records. Do not reintroduce Shift-click range selection; any new range
  behavior extends the existing drag-sweep range model via keyboard.
- Drag-sweep and any new keyboard range-selection stay constrained to the
  middle explorer pane and its file rows.
- ZIP downloads stay in Extract mode in `downloadZip.worker.ts` with the
  `maintainStructure` toggle intact.
- `packages/core` stays browser-safe (only dep is `fflate`); no `node:*` from
  the web side.
- PWA setup remains `vite-plugin-pwa`, `virtual:pwa-register`,
  `workbox-window`, with service worker registration in the app entrypoint.
- Pack mode export remains disabled and is out of scope for this plan.

## Phases

| ID | Title | Goal | Parallel with | Depends on | Files | Subagent |
|----|-------|------|---------------|------------|-------|----------|
| P1 | Search, filter, and sort | Extend the filter pipeline with match modes, category and diagnostic chips, size range, glob, sort keys, and pure helpers covered by Vitest. | P2 | - | `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts`, `apps/web/src/App.tsx`, `apps/web/src/App.css` | worker |
| P2 | Explorer ergonomics | Add expand/collapse all, virtualize the extension list, add a breadcrumb above the preview, and a "Reveal in tree" action from the extension grouping. | P1 | - | `apps/web/src/App.tsx`, `apps/web/src/App.css`, `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts` | worker |
| P3 | Keyboard navigation and selection power | Arrow-key traversal of visible rows, `Shift+Arrow` extending the drag-sweep range, `Ctrl/Cmd+A` for visible, Invert and Select-by-extension actions, focus ring and tree a11y polish. | - | P1, P2 | `apps/web/src/App.tsx`, `apps/web/src/App.css`, `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts`, `apps/web/tests/explorer.spec.ts` | worker |
| P4 | Preview enrichment | Larger virtualized text preview with chunked load, find-in-preview, hex view for binary, image zoom toggle and dimensions, audio duration, copy preview text, download active record. | P3 | P1 | `apps/web/src/App.tsx`, `apps/web/src/App.css`, `apps/web/src/syntaxHighlight.ts`, `apps/web/src/syntaxHighlight.test.ts`, `apps/web/src/fileIcons.ts` | worker |
| P5 | Metadata, diagnostics drawer, copy affordances | Copy buttons for GUID and Path, collapsible global Diagnostics drawer fed by parser diagnostics plus core analysis findings, per-record meta sidecar quick view, per-extension breakdown in stats. | P4 | P1, P2 | `apps/web/src/App.tsx`, `apps/web/src/App.css`, `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts`, `apps/web/src/syntaxHighlight.ts`, `apps/web/src/parsePackage.worker.ts`, `apps/web/src/workerTypes.ts` | worker |
| P6 | Persistence, recents, theme, PWA file handlers | IndexedDB recents keyed by name+size+head-hash, localStorage for grouping/sort/filter/theme, manual auto/light/dark theme toggle, PWA File Handlers registration. | - | P1, P2 | `apps/web/src/App.tsx`, `apps/web/src/App.css`, `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts`, `apps/web/src/main.tsx`, `apps/web/vite.config.ts`, `apps/web/tests/package-load.spec.ts` | worker |
| P7 | Performance and accessibility polish | Memoization audit on the explorer, adopt core streamed gzip parsing in the parse worker, keyboard-only Playwright spec, final a11y pass. | - | P1, P2, P3, P4, P5, P6 | `apps/web/src/App.tsx`, `apps/web/src/packageModel.ts`, `apps/web/src/parsePackage.worker.ts`, `apps/web/src/workerTypes.ts`, `apps/web/tests/explorer.spec.ts`, `apps/web/tests/smoke.spec.ts` | worker |

### P1 - Search, filter, and sort

Replace the single substring search with a structured filter and add sorting.
Keep behavior in pure helpers in `packageModel.ts` so it stays unit-testable.

Scope:

- Match modes: filename (default), path, GUID. Segmented control in the
  sidebar.
- Case-sensitive toggle.
- Space-separated terms behave as AND across the active match field.
- Optional glob mode toggle that accepts `**/*.shader`-style patterns through a
  small browser-safe matcher (no new heavy deps; implement in
  `packageModel.ts`).
- Category chips: Assets, Meta, Previews. Use the `getRecordCategory` helper
  and the primitive predicates already in `packageModel.ts`. Do not reintroduce
  a `kind` field or depend on the core component field leaking into
  `PackageFileRecord`.
- Size range filter (min/max bytes; accept human shorthand like `100k`, `2m`).
- Diagnostic code chips that filter to records carrying any of the selected
  parser diagnostic codes or core analysis finding codes.
- Sort keys for the filtered list and the tree leaves: Name, Size, Extension,
  GUID. Stable secondary sort by path. Ascending/descending toggle.
- Filter state retains the existing 200 ms search debounce; new chips and
  toggles apply synchronously.

Exit criteria
```text
- `packageModel.ts` exports pure helpers for match-mode filtering, glob matching, size-range parsing, category filtering, diagnostic-code filtering, and sort comparators.
- `packageModel.test.ts` covers each helper, including glob edge cases (root-only vs nested), size shorthand parsing, AND-of-terms behavior, and stable secondary sort by path.
- `App.tsx` sidebar exposes the match-mode segmented control, case-sensitive toggle, glob toggle, category chips, size-range inputs, diagnostic-code chips, and a sort control above the explorer.
- Selection helpers continue to operate on the filtered visible record set; existing tests in `packageModel.test.ts` for folder and extension select-all still pass without modification of expectations.
- No translation files, no language selector, no `language` URL state added.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
```

### P2 - Explorer ergonomics

Improve the tree and extension grouping for larger packages.

Scope:

- "Expand all" and "Collapse all" actions for the tree view.
- Virtualize the extension grouping list with `@tanstack/react-virtual`
  (matching the tree's existing virtualization pattern).
- Breadcrumb header above the preview pane reflecting the active record's path.
  Each segment links into the tree, expanding ancestors and scrolling the row
  into view.
- "Reveal in tree" action on each extension-grouping row that switches the
  middle pane to tree mode, expands ancestors, scrolls to the row, and focuses
  it.
- Persist expand/collapse state in component memory for the active package
  (persistence to storage lands in P6).

Exit criteria
```text
- Extension grouping list uses `@tanstack/react-virtual` with the same row API used by the tree.
- "Expand all" and "Collapse all" buttons appear above the tree and operate only on currently filtered visible nodes.
- The preview pane shows a breadcrumb derived from the active record's path; clicking a segment expands ancestors and scrolls the row into view in tree mode.
- "Reveal in tree" from an extension-grouping row switches to tree mode and scrolls/focuses the matching row.
- Pure tree helpers (ancestor expansion, path-to-node lookup) live in `packageModel.ts` with tests.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
```

### P3 - Keyboard navigation and selection power

Make the explorer fully driveable from the keyboard without reintroducing
Shift-click. Constrain new keyboard range-selection to the active explorer
pane (tree or extension list).

Scope:

- Arrow Up/Down move focus through visible rows. Left collapses or moves to
  parent in tree mode; Right expands or moves to first child. Home/End jump to
  first/last visible row. PageUp/PageDown jump by virtualizer page.
- `Shift+ArrowUp`/`Shift+ArrowDown` extend the existing drag-sweep range model
  from the current anchor through the focused row. No Shift-click.
- `Ctrl/Cmd+A` selects all currently filtered visible records.
- `Ctrl/Cmd+Click` continues to toggle a single row's selection.
- New actions next to "Clear selection": "Invert selection" (toggles every
  filtered visible record) and "Select by extension" (opens a small picker of
  the extensions present in the current filtered view).
- Accessibility: explorer container is `role="tree"`, rows are
  `role="treeitem"`, focus is tracked with `aria-activedescendant`, a visible
  focus ring is added in `App.css`.
- Drag-sweep behavior is unchanged outside the explorer pane.

Exit criteria
```text
- Arrow, Home/End, PageUp/PageDown navigation works in both tree and extension list and is exercised by `explorer.spec.ts`.
- `Shift+ArrowUp`/`Shift+ArrowDown` extends a drag-sweep range without using Shift-click, anchored on the row where the user last clicked or pressed Space/Enter.
- `Ctrl/Cmd+A` selects only filtered visible records.
- Invert selection and Select-by-extension buttons appear next to Clear selection and operate on filtered visible records.
- Explorer carries `role="tree"`, rows carry `role="treeitem"`, and `aria-activedescendant` updates as focus moves.
- New keyboard range-selection helpers live in `packageModel.ts` with unit coverage in `packageModel.test.ts`.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
- Run: cd apps/web && bunx playwright test explorer.spec.ts
```

### P4 - Preview enrichment

Make the right-hand preview pane do more without adding heavy viewer
dependencies.

Scope:

- Replace the hard 20 KB Shiki cutoff with a chunked virtualized line renderer
  that defaults to the existing budget and exposes a "Load more" control up to
  a higher ceiling (for example 256 KB) with explicit memory-conscious
  truncation messaging.
- Find-in-preview: `Ctrl/Cmd+F` while the preview is focused opens an inline
  find bar with next/previous navigation and match count.
- Hex view fallback for binary records the syntax pipeline cannot render.
  Two-column hex + ASCII, virtualized rows.
- Image previews: show natural dimensions and add a "Fit" / "1:1" toggle.
- Audio previews: show duration once metadata loads.
- Copy buttons in the preview header: copy preview text (when textual) and
  copy raw bytes as base64 (small records only; gate by size with clear UI).
- Download icon button continues to work; add a keyboard shortcut hint.
- Shiki path is preserved. Do not add new heavy dependencies; use only
  `@tanstack/react-virtual` and small in-tree helpers.

Exit criteria
```text
- Text preview renders large records through a virtualized chunked path with explicit "Load more" controls and a documented ceiling.
- Find-in-preview works for text previews with match count and next/previous navigation; keybind is `Ctrl/Cmd+F` while the preview pane is focused.
- Binary records fall back to a virtualized hex + ASCII view rather than the unsupported message.
- Image previews show natural dimensions and a Fit/1:1 toggle.
- Audio previews show duration after `loadedmetadata`.
- Copy-as-text and copy-as-base64 buttons appear in the preview header and respect size gates.
- `syntaxHighlight.test.ts` covers the chunked highlight path and the find-match helper.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
```

### P5 - Metadata, diagnostics drawer, copy affordances

Expand the metadata pane and surface diagnostics globally.

Scope:

- Copy buttons next to GUID and Path in the metadata `<dl>`.
- Collapsible global Diagnostics drawer toggled from the status bar
  diagnostics count chip. The drawer lists parser diagnostics and
  `analyzeUnityPackageEntries` findings with code, severity, message, and
  affected record path where applicable. Clicking a diagnostic filters the
  explorer to that record and reveals it in the tree.
- The parse worker response includes `analysis` from
  `analyzeUnityPackageEntries(entries, diagnostics)`. Routing to records lives
  in pure helpers so `packageModel.test.ts` can cover `guid`, `pathname`, and
  tar-member `path` targets.
- Per-record meta sidecar quick view: when a non-meta record has a `.meta`
  sibling, render the sidecar's text content syntax-highlighted as YAML
  through the existing Shiki path. Use `readMetaGuid` and
  `readDeclaredMetaImporter` for facts displayed above the raw YAML. Do not
  introduce a YAML parser.
- Per-extension breakdown summary in the sidebar `Stats` grid: top extensions
  by record count and by byte size.

Exit criteria
```text
- Metadata pane has copy buttons for GUID and Path that write to `navigator.clipboard` with a transient confirmation.
- Status bar diagnostics chip toggles a global Diagnostics drawer that lists every parser diagnostic and core analysis finding and supports click-to-navigate (sets the filter and reveals the row in tree mode).
- Parse worker returns core analysis; tests cover routing of `meta-guid-mismatch`, `meta-importer-mismatch`, duplicate pathname, and unsafe pathname findings.
- The metadata pane renders the sibling meta file's text content as syntax-highlighted YAML when present; absence is handled silently.
- Sidebar `Stats` grid includes a Top Extensions section by record count and by byte size.
- Diagnostics drawer state survives mode switches within the same session.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
```

### P6 - Persistence, recents, theme, PWA file handlers

Make the app remember its state and feel like an installed tool.

Scope:

- IndexedDB store of recently opened packages, keyed by `${name}|${size}|${headHash}`
  where `headHash` is a short hash of the first 64 KB (browser-safe, e.g.
  `crypto.subtle`). Stored value contains display metadata only. Re-parsing on
  reopen is acceptable; do not cache parsed entries.
- A Recents list in the sidebar (or in the drop zone empty state) with up to
  10 entries. Clicking a recent prompts the user to drop the same file again
  if direct file handles are not available; if the OS-level File Handle is
  available (from PWA File Handlers or the File System Access API), reopen
  directly.
- localStorage persistence for grouping mode, sort key + direction, category
  chip selection, glob and case-sensitive toggles, "Preserve folders in ZIP
  downloads", and theme preference.
- Manual theme toggle: Auto (default), Light, Dark. Applied via a `data-theme`
  attribute on `<html>` and CSS variables in `App.css`. Auto continues to
  follow `prefers-color-scheme`.
- PWA File Handlers: register `.unitypackage` in `vite-plugin-pwa` manifest so
  the OS can open the app with a file where supported. Service worker
  registration stays in `main.tsx`.

Exit criteria
```text
- IndexedDB recents persist across reloads; the recents list appears in the sidebar with up to 10 entries.
- Filter, sort, grouping, ZIP folder-structure toggle, and theme preference persist to localStorage and rehydrate on reload.
- A theme toggle (Auto/Light/Dark) lives in the sidebar; Auto mirrors `prefers-color-scheme` via CSS variables.
- `vite-plugin-pwa` manifest registers a File Handler for `.unitypackage`; the app entrypoint reads `launchQueue` (if available) and opens the handed file.
- `package-load.spec.ts` covers reopen from a recents entry through file drop and the persistence of grouping/sort/theme.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
- Run: bun run --filter @unitypackage-tools/web build
```

### P7 - Performance and accessibility polish

Final pass: keep the app fast on large packages and verify keyboard-only
operation end-to-end.

Scope:

- Memoization audit on the explorer: stabilize row components, lift derived
  selectors into memoized helpers, and verify no unnecessary re-renders on
  selection toggles. Use the React DevTools profiler informally; capture
  before/after notes inline in the PR description, not in source.
- Wire `parsePackage.worker.ts` and `workerTypes.ts` to use
  `parseUnityPackageStreamed` for gzip decompression so `maxOutputBytes` is
  enforced before retaining the full decompressed tar buffer. Keep the existing
  `parseUnityPackageEntries` path only as a temporary fallback if needed for
  compatibility during rollout.
- Final a11y pass: visible focus ring on every interactive control, color
  contrast against current CSS variables, `aria-label`s on icon-only buttons,
  Esc dismisses the diagnostics drawer and the find-in-preview bar.
- Keyboard-only Playwright spec exercising: load package, navigate explorer
  with arrows, range-select with `Shift+Arrow`, open and dismiss the
  diagnostics drawer, use find-in-preview, trigger a Selected ZIP download.

Exit criteria
```text
- Explorer row components are memoized and selection toggles do not re-render unrelated rows (verified by an inline test or profiler note).
- Parse worker uses `parseUnityPackageStreamed` or has a narrowly scoped fallback comment explaining why it cannot yet do so.
- Every interactive control has a visible focus indicator and an accessible name.
- A keyboard-only Playwright spec passes against the built preview server.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
- Run: bun run --filter @unitypackage-tools/web build
- Run: cd apps/web && bunx playwright test
- Run: bun run check
```

## Verification

```sh
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web typecheck
bunx eslint apps/web/src
bun run --filter @unitypackage-tools/web build
bun run check
cd apps/web && bunx playwright test
```

Manual smoke:
- Open `fixtures/static/editor-packed.unitypackage` via drop zone.
- Toggle match mode between filename, path, and GUID; confirm space-separated AND, case-sensitive toggle, and glob toggle.
- Apply Assets/Meta/Previews chips, a size range, and a diagnostic-code chip; confirm selection counters and ZIP buttons operate on the filtered visible set.
- Sort by Name, Size, Extension, and GUID; toggle ascending/descending.
- Expand all / Collapse all in tree view; switch to extension grouping and confirm the list is virtualized.
- Click a breadcrumb segment in the preview header and confirm the tree row scrolls into view.
- Use "Reveal in tree" from an extension grouping row.
- Drive the explorer with arrow keys, Home/End, PageUp/PageDown; extend selection with `Shift+Arrow`; select all visible with `Ctrl/Cmd+A`; use Invert selection and Select-by-extension.
- Open a large text record and confirm the chunked preview + "Load more"; use `Ctrl/Cmd+F` find-in-preview.
- Open a binary record and confirm the hex fallback.
- Open an image and toggle Fit / 1:1; open an audio file and confirm duration.
- Copy GUID and Path from the metadata pane; open the global Diagnostics drawer from the status chip and click a diagnostic to navigate.
- Confirm the sibling meta sidecar quick view renders highlighted YAML when present.
- Download Selected ZIP and All ZIP with "Preserve folders in ZIP downloads" both on and off.
- Confirm Pack mode export button remains disabled and Pack staging continues to work as today.
- Reload the page and confirm grouping, sort, filters, ZIP folder toggle, and theme persist; reopen the package from the Recents list.
- Switch the theme toggle through Auto, Light, Dark and confirm CSS variables update via `data-theme`.
- Install the PWA and (where supported) open a `.unitypackage` from the OS via the File Handler; confirm the app launches and parses the file.
