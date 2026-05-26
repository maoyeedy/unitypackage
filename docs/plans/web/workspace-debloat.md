# Workspace Debloat

## Context

The current web workspace is functionally rich but visually overloaded. The
left pane mixes package opening, search, advanced filters, grouping, ZIP
settings, stats, top extensions, and recents. The right pane
mixes preview, metadata, diagnostics, and raw sidecar detail in one long
surface. The implementation mirrors this concentration: `apps/web/src/App.tsx`
is over 4000 lines, `App.css` is over 1700 lines, and `packageModel.ts`
contains both package-domain helpers and UI-specific filtering/state helpers.

This plan is the first pass. Its purpose is not to add more polish. It reduces
the visible surface area, establishes smaller implementation boundaries, and
keeps the app robust enough to continue iterating.

Carry forward these constraints:

- `apps/web` is English-only.
- Do not add `PackageFileRecord.kind`; keep using `extension`,
  `isUnityPreview`, and `getRecordCategory(record)`.
- `packages/core` stays browser-safe and remains the source for package format,
  component-record, sidecar, analysis, and creation behavior.
- Extract selection stays scoped to filtered visible records.
- ZIP downloads stay in Extract mode. Pack export stays in Pack mode.
- Do not hand-edit `packages/cli/assets/web/`.

## Scope

In scope:

- Split the large web files before changing behavior.
- Remove confusing or low-value filter UI from the default workspace.
- Make preview records hidden by default in Extract.
- Simplify the details pane into a readable preview-first panel.
- Keep advanced information available through tabs, disclosure, or diagnostics
  drawer instead of showing it all at once.

Out of scope:

- New visual identity, marketing surface, or icon system.
- Multi-package compare, pinned previews, dependency graph, heavy media
  viewers, or other new product surfaces.
- Pack export capability changes beyond preserving current behavior.

## Phases

| ID | Title | Goal | Depends on | Files |
|----|-------|------|------------|-------|
| P1 | Split web shell | Move App subtrees, hooks, and CSS into smaller files with no behavior change. | - | `apps/web/src/App.tsx`, `apps/web/src/App.css`, new `components/`, `hooks/`, `styles/` |
| P2 | Simplify search and filters | Remove confusing filter controls and make search behave as one obvious path/name search. | P1 | `apps/web/src/components/`, `apps/web/src/packageModel.ts`, tests |
| P3 | Hide preview rows by default | Make synthetic Unity preview records opt-in in the Extract list. | P2 | model helpers, explorer components, tests |
| P4 | Reduce left pane chrome | Move stats, recents, and secondary settings out of the always-visible sidebar. | P2, P3 | sidebar/topbar/settings components, CSS |
| P5 | Rebuild details pane hierarchy | Make the right pane preview-first with compact details and expandable diagnostics. | P1 | preview/details components, CSS |

### P1 -- Split web shell

Goal: make the implementation editable before removing UI. This phase should
not intentionally change behavior or copy text.

Files in scope:

- `apps/web/src/App.tsx`
- `apps/web/src/App.css`
- New files under `apps/web/src/components/`
- New files under `apps/web/src/hooks/`
- New files under `apps/web/src/styles/`

Required structure:

- Keep `App.tsx` as composition, top-level mode/state wiring, and persistence
  orchestration only.
- Move top bar, mode tabs, sidebar, extract toolbar, explorer, preview panel,
  metadata/details, diagnostics drawer, pack panel, status bar, and dialogs into
  component files.
- Move worker lifecycles into hooks: parse package, ZIP download, and pack
  export.
- Move explorer selection and drag-sweep logic into an explorer hook while
  keeping pure selection helpers in model modules.
- Split CSS by surface, for example shell, sidebar, explorer, preview, pack,
  diagnostics, and controls. Preserve existing class names where Playwright
  tests or semantics depend on them.
- Keep imports using existing project style and relative `.ts`/`.tsx` paths
  that work with Vite.

Exit criteria:

- No behavior changes are expected from this phase.
- `App.tsx` is reduced to a small composition file, not a component dump.
- All existing Vitest and Playwright tests still target user-facing roles/text,
  not component internals.
- Run:

```sh
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web typecheck
bunx eslint apps/web/src
bun run --filter @unitypackage-tools/web build
cd apps/web && bunx playwright test
```

### P2 -- Simplify search and filters

Goal: replace the overloaded search area with one search input that works the
way users expect.

Behavior changes:

- Remove the Name / Path / GUID match-mode segmented control from the UI.
- Remove size min/max filter UI and its persisted state.
- Remove Assets / Metas / Previews category chips from the UI.
- Search should match filename and full package path by default.
- GUID search should not be a primary visible mode. If retained, it should be
  implicit only when the query resembles a GUID fragment, or left to a future
  advanced-search design.
- Keep case-sensitive and glob behavior only if they are placed behind a compact
  "Search options" disclosure or menu. Default state must be simple.
- Keep diagnostic-code filtering out of the left pane. Diagnostics navigation
  belongs in the diagnostics drawer.

Model cleanup:

- Replace `FilterMatchMode` usage in the app with a simpler search model.
- Remove size-range filtering from default filtering code if no remaining UI or
  tests need it.
- Remove category-chip filtering from default filtering code if no remaining UI
  or tests need it.
- Update unit tests so they cover the new simple search behavior and do not
  preserve removed UI just for compatibility.

Exit criteria:

- The sidebar has one clearly labeled package search input.
- The input finds records by file name and path without requiring a mode switch.
- Removed filters no longer appear in screenshots, keyboard order, or tests.
- Run:

```sh
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web typecheck
bunx eslint apps/web/src
cd apps/web && bunx playwright test
```

### P3 -- Hide Preview Rows By Default

Goal: reduce Extract list noise from synthetic Unity preview records while
keeping them accessible when needed.

Behavior changes:

- Extract list hides `isUnityPreview` records by default.
- `.meta` sidecars remain controlled by the existing `.meta with assets`
  behavior; do not conflate meta sidecars with preview records.
- Add a compact "Show previews" toggle in an options menu or disclosure, not as
  a primary chip row.
- When previews are hidden, selection, stage-for-pack, selected ZIP, folder
  select-all, extension select-all, and drag-sweep operate only on visible
  filtered records.
- If the active record becomes hidden after toggling previews off, move focus to
  the same-GUID asset when present, otherwise the first visible record.

Exit criteria:

- Opening `fixtures/static/editor-packed.unitypackage` shows assets and
  allowed sidecars without synthetic `.preview.png` rows by default.
- Users can opt in to preview rows and see them in both tree and extension
  grouping.
- No preview record can be staged for pack.
- Run:

```sh
bun run --filter @unitypackage-tools/web test
cd apps/web && bunx playwright test
```

### P4 -- Reduce Left Pane Chrome

Goal: make the left pane a quiet navigation and package-open surface instead of
a dashboard.

Behavior changes:

- Keep package drop/open and the simplified search in the left pane.
- Keep grouping control only if it remains useful in daily navigation; otherwise
  move it to the explorer toolbar.
- Keep ZIP sidecar/folder options near ZIP actions or behind an Extract options
  disclosure, not as always-visible sidebar rows.
- Remove the large stats grid from the default sidebar.
- Move package stats and top extensions to a compact "Package summary"
  disclosure, details tab, or diagnostics drawer section.
- Move recent packages to the top bar open menu or a small dialog.
Exit criteria:

- The left pane fits in a short viewport without becoming a long stack of
  unrelated controls.
- The first visible elements are package open/drop, search, and only one small
  navigation/options group.
- Package counts and extension stats remain available but are not always
  visible.
- Run:

```sh
bun run --filter @unitypackage-tools/web typecheck
bunx eslint apps/web/src
cd apps/web && bunx playwright test
```

### P5 -- Rebuild Details Pane Hierarchy

Goal: make the right pane readable by default and robust for diagnostics-heavy
packages.

Behavior changes:

- Rename or structure the right pane around "Preview" and "Details" rather than
  a single preview-plus-metadata wall.
- The default view shows preview content first, with a compact details summary:
  path, size, GUID, importer, and diagnostic count.
- Move verbose metadata into an expandable "Technical details" section.
- Move raw record diagnostics into an expandable section that shows count and
  severity summary before the full list.
- Keep copy actions for path and GUID, but avoid repeating long values in
  multiple places.
- Keep meta sidecar quick view available only when it helps the active asset,
  and place it behind disclosure if it is long.
- Ensure long paths, GUIDs, and diagnostic messages wrap without breaking the
  panel layout.

Exit criteria:

- A selected text asset shows readable preview content without metadata
  dominating the pane.
- A selected record with many diagnostics does not create an unreadable wall by
  default.
- The right pane remains usable on desktop and stacked mobile layouts.
- Run:

```sh
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web build
cd apps/web && bunx playwright test
```

## Verification

Full verification after the debloat plan:

```sh
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web typecheck
bunx eslint apps/web/src
bun run --filter @unitypackage-tools/web build
cd apps/web && bunx playwright test
```

Manual smoke:

- Open `fixtures/static/editor-packed.unitypackage`.
- Confirm the initial screen is focused on Extract navigation, not stats.
- Confirm search finds `Changelog.md` by name and by part of its path.
- Confirm preview records are hidden by default and can be shown with the new
  option.
- Select several visible records, stage them, and confirm Pack receives only
  stageable assets.
- Select a diagnostic-heavy record and confirm details remain readable until
  the diagnostics section is expanded.
- Reopen a recent package from its new location in the top bar.
