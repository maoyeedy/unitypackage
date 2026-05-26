# Workspace Additions

## Context

This plan follows `workspace-debloat.md`. Do not start it until the web
workspace has been split into smaller files, the left pane has been reduced,
preview rows are hidden by default, and the right pane is preview-first.

The goal here is restrained polish. Additions should support common workflows
without reintroducing the dashboard-style clutter that the debloat plan removes.

Carry forward these constraints:

- Keep the app English-only.
- Keep `PackageFileRecord` free of a `kind` field.
- Use existing project icons and controls.
- Keep controls near the action they affect.
- Do not add heavyweight viewers or new package-analysis systems.

## Scope

In scope:

- Small layout controls that help users work with large packages.
- Cleaner top-bar menus for open, recents, and settings.
- Better empty states and status feedback.
- Minor Pack-mode staging ergonomics.

Out of scope:

- Restoring removed filter chips, size filters, or Name / Path / GUID modes.
- Adding a second permanent stats dashboard.
- Multi-tab previews, compare mode, dependency graph, or new media viewers.
- Pack export API redesign.

## Phases

| ID | Title | Goal | Depends on | Files |
|----|-------|------|------------|-------|
| P1 | Pane controls | Add collapse and optional resize behavior without making the shell busier. | Debloat | shell/layout components, CSS |
| P2 | Open and settings menus | Move recents and defaults into compact top-bar menus. | Debloat | topbar/settings components, IndexedDB recents helpers |
| P3 | Details navigation | Add small related-record navigation around asset/meta/preview siblings. | Debloat | details components, model helpers |
| P4 | Status and toasts | Replace the overloaded footer status string with current operation plus toasts. | Debloat | status/toast components, worker hooks |
| P5 | Pack refinements | Make the staged list easier to scan without expanding Pack scope. | Debloat | pack components, tests |

### P1 -- Pane Controls

Goal: let users reclaim space without adding another dense toolbar.

Behavior changes:

- Add collapse toggles for the left controls pane and the right preview/details
  pane.
- Persist collapsed state in localStorage.
- If resize is added, constrain widths with clear min/max values and disable
  resize handles in stacked mobile layout.
- Keep collapse controls icon-first with tooltips or accessible labels.
- Do not make the panes look like nested cards.

Exit criteria:

- Collapsing the left pane gives the explorer more room.
- Collapsing the right pane gives the explorer or Pack panel more room.
- Reload restores collapsed state.
- Keyboard users can focus and activate the controls.
- Run:

```sh
bun run --filter @unitypackage-tools/web typecheck
bunx eslint apps/web/src
cd apps/web && bunx playwright test
```

### P2 -- Open And Settings Menus

Goal: put persistent app-level controls in predictable top-bar menus.

Behavior changes:

- Keep the primary "Open package" action visible.
- Add an adjacent recents menu that lists recent packages with file name, size,
  and last-opened time.
- Move default grouping, default sort, and preview-row default into settings
  only if those defaults exist after debloat.
- Add "Clear recents" and "Reset settings" commands in settings.
- Menus close on outside click and Escape.

Exit criteria:

- Recents are no longer always visible in the left pane.
- Existing recent-package reopen behavior still works, including the browser
  prompt path when file handles cannot be reused.
- Run:

```sh
bun run --filter @unitypackage-tools/web test
cd apps/web && bunx playwright test
```

### P3 -- Details Navigation

Goal: make the asset/meta/preview relationship easy to traverse without showing
all record types by default.

Behavior changes:

- Add a pure helper that returns same-GUID siblings grouped as asset, meta, and
  preview. The helper must not add a `kind` field to `PackageFileRecord`.
- In the details pane, show a compact "Related" row when siblings exist.
- Clicking a related sibling makes it the active record without changing
  selection or staging.
- If preview records are hidden in the explorer, related preview navigation may
  still open the preview record in the details pane.
- Add an "Open in list" action that switches visible options as needed, expands
  ancestors, and scrolls the active record into view.

Exit criteria:

- An asset with `.meta` and `.preview.png` siblings can jump to each sibling
  from Details.
- Selection and staged records are unchanged by related navigation.
- The helper has unit coverage.
- Run:

```sh
bun run --filter @unitypackage-tools/web test
```

### P4 -- Status And Toasts

Goal: make operation feedback clear without using the footer as a long log.

Behavior changes:

- Replace the freeform footer status string with a compact current-operation
  segment.
- Add non-blocking toasts for parse complete, ZIP download complete, pack export
  complete, draft saved, and settings reset.
- Error toasts persist until dismissed.
- Worker hooks may expose coarse progress where already available; do not
  redesign worker protocols unless needed for the current operation label.
- Keep diagnostics count visible as a compact button or chip.

Exit criteria:

- Successful actions give visible feedback without adding text to the left or
  right panes.
- Failed parse/export paths show persistent error feedback.
- Footer remains short in both desktop and mobile layouts.
- Run:

```sh
bun run --filter @unitypackage-tools/web typecheck
bunx eslint apps/web/src
cd apps/web && bunx playwright test
```

### P5 -- Pack Refinements

Goal: make Pack mode less sparse and easier to scan without expanding export
scope.

Behavior changes:

- Keep `.unitypackage` export disabled or enabled according to the existing Pack
  implementation state; do not alter core creation behavior in this plan.
- Show staged entries in a compact list with path, size, and validation state.
- Keep compression and output filename controls visible but not oversized.
- Move deterministic GUID-order messaging into a subtle note or tooltip.
- Add a compact empty state for "nothing staged" with only the drop/import affordance
  and one sentence of guidance.
- Keep validation diagnostics near the staged record they affect.

Exit criteria:

- Pack mode with staged entries does not look like an oversized form floating
  above empty space.
- Pack mode with no staged entries clearly invites import/drop without lengthy
  explanation.
- Existing pack Playwright tests pass or are updated to the new accessible
  labels.
- Run:

```sh
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web build
cd apps/web && bunx playwright test
```

## Verification

Full verification after the additions plan:

```sh
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web typecheck
bunx eslint apps/web/src
bun run --filter @unitypackage-tools/web build
cd apps/web && bunx playwright test
```

Manual smoke:

- Open `fixtures/static/archives/Polytope_URP.unitypackage`.
- Collapse and reopen both side panes; reload and confirm state persists.
- Reopen a package from the recents menu.
- Jump between an asset, its `.meta`, and its preview sibling from Details.
- Trigger selected ZIP and Pack export feedback and confirm toasts/status are
  concise.
- Stage records, remove one, clear the draft, and confirm Pack remains readable.
