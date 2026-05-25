# Workspace Polish

## Context

This plan is the next-stage UX pass after `docs/plans/web/extract-enrich.md`
and `docs/plans/web/pack-export.md` land. Both are treated as prerequisites:
filter chips, sort, category filters, IndexedDB recents, theme override, find
in preview, hex view, structured meta sidecar quick view, pack worker, and
the rest exist by the time this plan starts.

The goal is intuitive, functional polish across the surrounding chrome that
was not reorganized by the previous two plans: status bar, top bar, left
pane, preview pane, and metadata pane. The work is behavior, structure, and
intra-app navigation only. It is not a visual redesign and adds no new color
tokens or icon families.

Out of scope (large enough to deserve their own plans if pursued):

- Multi-package compare mode.
- Pinned multi-tab previews.
- Heavyweight viewers (3D model, audio waveform, GUID dependency graph).
- New marketing surface, brand redesign, or icon system changes.

Constraints carried forward:

- `apps/web` is English-only.
- `PackageFileRecord` has no `kind` field; use `getRecordCategory`,
  `isUnityPreview`, and `extension === 'meta'`.
- `packages/core` stays browser-safe; only dep is `fflate`. Prefer shipped
  core helpers over web-local format logic: component records, classification,
  meta inspection, analysis findings, and streamed gzip parse are available.
- Selection/staging stays scoped to filtered visible records and uses the
  single `stagedRecordIds` model.
- ZIP downloads stay in Extract mode; pack export stays in Pack mode.
- PWA toolchain remains `vite-plugin-pwa`, `virtual:pwa-register`,
  `workbox-window`, with service worker registration in the app entrypoint.

## Phases

| ID | Title | Goal | Parallel with | Depends on | Files | Subagent |
|----|-------|------|---------------|------------|-------|----------|
| P1 | Resizable and hideable panes | Add resize handles and collapse toggles to the sidebar and preview pane; persist widths and collapsed state. | P2, P3, P4, P5 | - | `apps/web/src/App.tsx`, `apps/web/src/App.css`, `apps/web/src/packageModel.ts` | worker |
| P2 | Preview navigation flow | Prev/Next stepping through visible filtered records via buttons and keyboard, with a single-step back history and an "open parent folder" action. | P1, P3, P4, P5 | - | `apps/web/src/App.tsx`, `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts`, `apps/web/tests/explorer.spec.ts` | worker |
| P3 | Progress and toast system | Replace the overloaded single status line with a structured current-operation segment and a non-blocking toast stack fed by worker progress. | P1, P2, P4, P5 | - | `apps/web/src/App.tsx`, `apps/web/src/App.css`, `apps/web/src/parsePackage.worker.ts`, `apps/web/src/downloadZip.worker.ts`, `apps/web/src/createPackage.worker.ts`, `apps/web/src/workerTypes.ts` | worker |
| P4 | Top bar consolidation | Surface recents and settings the extract plan added: split Open package into a button plus recents dropdown, add a settings menu, keep Mode tabs primary. | P1, P2, P3, P5 | - | `apps/web/src/App.tsx`, `apps/web/src/App.css` | worker |
| P5 | Metadata cross-references | In the metadata pane, link related records in the asset/meta/preview triple and let the user jump between them without disturbing selection. | P1, P2, P3, P4 | - | `apps/web/src/App.tsx`, `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts` | worker |
| P6 | App.tsx componentization refactor | Split the monolithic App.tsx into `apps/web/src/components/` and `apps/web/src/hooks/` with no behavior change, locking in the surface the earlier phases produced. | - | P1, P2, P3, P4, P5 | `apps/web/src/App.tsx`, new files under `apps/web/src/components/`, new files under `apps/web/src/hooks/`, `apps/web/tests/*.spec.ts` | worker |

### P1 - Resizable and hideable panes

After extract enrichment lands, the sidebar carries search, match-mode
toggles, category chips, diagnostic-code chips, size range, sort, and
expand/collapse controls. The preview pane carries find-in-preview, hex
view, image zoom, and copy/download. The fixed three-column grid is no
longer adequate.

Exit criteria

```text
- The sidebar has a horizontal resize handle on its right edge with enforced
  min and max widths.
- The preview pane has a horizontal resize handle on its left edge with
  enforced min and max widths.
- Each pane has a collapse/expand toggle in its header; when collapsed it
  occupies a narrow strip with only the expand affordance visible.
- Pane widths and collapsed flags persist in localStorage and are restored
  on reload alongside the existing extract-enrich settings.
- Resize is keyboard accessible: arrow keys on a focused handle adjust width
  by a fixed step.
- The existing mobile breakpoints continue to stack panes vertically; resize
  handles are not rendered in that layout.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web build
```

### P2 - Preview navigation flow

Today the only way to advance to the next record is to click in the
explorer. After filtering, this is friction. Add Prev/Next plus a single
back step and a path-into-tree jump.

Exit criteria

```text
- The preview header gains Previous and Next icon buttons that step through
  the currently visible filtered records in current sort order.
- Keyboard: J/K and Up/Down arrows move active record when the preview pane
  is focused; the existing explorer keyboard nav from extract enrichment is
  unchanged.
- The preview header gains a Back button that returns to the previously
  active record (single-step history, cleared when the package is reloaded).
- The preview header gains an "Open in tree" action that switches grouping
  to tree (if needed), expands ancestors, and scrolls the active record into
  view.
- Selection is not touched by any of the above; only `activeRecordId`
  changes.
- A new pure helper `getAdjacentRecordId(orderedIds, currentId, direction)`
  lives in `packageModel.ts` with unit coverage.
- A Playwright spec exercises Prev, Next, Back, and Open in tree against
  `fixtures/static/editor-packed.unitypackage`.
- Run: bun run --filter @unitypackage-tools/web test
- Run: cd apps/web && bunx playwright test
```

### P3 - Progress and toast system

After pack export ships, parse, ZIP download, and pack export can all be in
flight or recently completed. The single status string in the footer cannot
carry that load and silently completed actions are invisible.

Exit criteria

```text
- The footer keeps the diagnostics-count chip and error chip but the status
  string is replaced by a structured current-operation segment that shows at
  most one in-flight operation with optional percentage.
- A toast stack renders in the top-right of the viewport with non-blocking
  notifications for completed operations: package parsed, ZIP downloaded,
  pack exported, draft saved, settings reset.
- Toasts auto-dismiss after a configurable timeout (default 4 seconds).
  Error toasts persist until dismissed.
- Workers post progress messages: parse posts byte-read progress through
  `parseUnityPackageStreamed` or its worker wrapper, ZIP posts entry-count
  progress, pack export posts the estimate-then-write boundary.
- Concurrent operations are tolerated; the current-operation segment shows
  the most recently started one and toasts arrive in completion order.
- The existing parse-error path renders as a persistent error toast and the
  error chip simultaneously.
- Run: bun run --filter @unitypackage-tools/web test
- Run: cd apps/web && bunx playwright test
```

### P4 - Top bar consolidation

Extract enrichment introduces IndexedDB recents, a manual theme override,
default-grouping and default-sort persistence, and PWA File Handlers. None
of them have an entry point in the current top bar.

Exit criteria

```text
- Open package becomes a button plus an adjacent dropdown that lists the
  IndexedDB recents from extract enrichment (file name, size, last-opened
  time, click to reopen). Empty state shows a hint to open the first
  package.
- A new Settings menu lives on the right of the top bar: theme override
  (auto/light/dark), default grouping, default sort, "Clear recents", and
  "Reset settings".
- The Mode tabs remain visually primary and sit next to the Open package
  button.
- An About entry in the Settings menu links to the project README in a new
  tab.
- Menus are keyboard accessible (Esc closes, arrow keys navigate, Enter
  activates) and close on outside click.
- Run: bun run --filter @unitypackage-tools/web test
- Run: cd apps/web && bunx playwright test
```

### P5 - Metadata cross-references

The asset/meta/preview triple is the fundamental unit of a Unity package
entry. Today, jumping from a meta record back to its asset means scrolling
or searching by `virtualPath`. Add explicit related-record navigation.

Exit criteria

```text
- A new `getRelatedRecords(records, record)` helper in `packageModel.ts`
  returns the sibling records sharing the same GUID, categorized as asset /
  meta / preview, with unit coverage. It should be a UI adapter over the
  component semantics already supplied by `entriesToComponentRecords`; do not
  add a `kind` field to `PackageFileRecord`.
- The metadata pane gains a Related section that lists the present
  siblings with their category labels. Clicking a sibling sets it as the
  active record without modifying selection or staging.
- The preview header gains an "Open meta" link when the active record is
  an asset that has a meta sibling, and an "Open asset" link when the
  active record is a meta or preview sibling that has an asset present.
- The structured meta sidecar quick view from extract enrichment is left
  intact; this phase only adds navigation around it.
- The cross-reference jump uses the existing active-record history from
  P2 so Back returns to the previously active record.
- Run: bun run --filter @unitypackage-tools/web test
```

### P6 - App.tsx componentization refactor

`apps/web/src/App.tsx` is already over 1300 lines and will be substantially
larger after P1-P5 plus extract enrichment and pack export. This phase is a
structural refactor with no behavior change: it makes the file maintainable
and locks in the surface the polish phases produced.

Exit criteria

```text
- App.tsx is reduced to top-level state, mode dispatch, and composition; all
  rendered subtrees move to `apps/web/src/components/` (one component per
  file).
- New components include at minimum: TopBar, RecentsMenu, SettingsMenu,
  Sidebar, FilterControls, Stats, Explorer (delegates to VirtualTree and
  ExtensionList), FileRow, FolderRow, PreviewPanel, PreviewHeader,
  PreviewBody (with image/pdf/audio/video/text/hex/unsupported
  subcomponents), MetadataPanel, RelatedRecords, PackPanel, StatusBar,
  Toasts, ResizablePane.
- Worker invocation moves to `apps/web/src/hooks/`: useParsePackage,
  useZipDownload, usePackExport, each owning its worker lifecycle and
  progress wiring.
- Explorer selection (drag-sweep + keyboard range + folder/extension
  select-all) moves to a `useExplorerSelection` hook backed by helpers
  already in `packageModel.ts`.
- No `kind` field is reintroduced; predicates continue to use the
  primitives.
- All existing Vitest and Playwright specs pass without modification; they
  target `getByRole` semantics, not component identity.
- ESLint passes on the new tree (`bunx eslint apps/web/src`).
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
- Run: bun run --filter @unitypackage-tools/web build
- Run: cd apps/web && bunx playwright test
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

- Open `fixtures/static/editor-packed.unitypackage`. Resize the sidebar and
  preview panes; reload and confirm widths and collapsed state persist.
- Collapse the sidebar; confirm the explorer expands. Collapse the preview;
  confirm the explorer expands. Reopen each.
- Filter to a subset, then step through it with Prev/Next and J/K; confirm
  visible-filter scoping and that Back returns to the previously active
  record.
- Trigger a parse, a selected ZIP, and a pack export in succession; confirm
  the current-operation segment shows the active one and toasts announce
  each completion.
- Open the recents dropdown after several different packages have been
  opened; reopen the most recent and confirm it parses.
- Open the Settings menu, toggle theme override, default grouping, and
  default sort; reload and confirm persistence; use Clear recents and
  Reset settings and confirm both behave.
- Select an asset that has both `.meta` and `.preview.png` siblings; jump
  between them via the Related links and the preview header buttons;
  confirm Back returns to the prior active record and selection is
  untouched.
- After P6 lands, scan `apps/web/src/App.tsx` for line count and confirm it
  is reduced to top-level composition only; run the full Vitest and
  Playwright suites and confirm zero behavioral regressions.
