# Phase 3 - Web Robustness

## Context

This phase improves web performance, resilience, and state handling for larger
packages. The app should stay interactive while parsing, render large file
lists efficiently, support richer previews, and persist user-facing settings.

## Phases

| ID | Title | Goal | Parallel with | Depends on | Files | Subagent |
|----|-------|------|---------------|------------|-------|----------|
| P1 | Worker parsing and loading state | Move package parsing into a worker and show useful loading progress or file context. | P2 | - | `apps/web/src/App.tsx`, `apps/web/src/**/*.ts`, `apps/web/vite.config.ts`, `apps/web/package.json` | worker |
| P2 | File list performance | Virtualize the file list and memoize filtering/categorization work. | P1 | - | `apps/web/src/components/FileList.tsx`, `apps/web/src/components/FileListItem.tsx`, `apps/web/src/App.css`, `apps/web/package.json` | worker |
| P3 | Preview and settings UX | Add dark mode variables, text preview support, simpler image preview rendering, URL state for settings, and robust blob URL refresh. | - | P1, P2 | `apps/web/src/App.tsx`, `apps/web/src/App.css`, `apps/web/src/index.css`, `apps/web/src/components/*.tsx` | worker |
| P4 | Download worker and integration | Move zip creation off the main thread or to streaming, then run full web/workspace verification. | - | P3 | `apps/web/src/App.tsx`, `apps/web/src/**/*.ts`, `apps/web/src/**/*.tsx`, `apps/web/package.json` | worker |

### P1 - Worker parsing and loading state

Move the parse work off the main thread using the existing Vite/React setup.
Expose enough status for the app to show which file is being processed or a
meaningful loading state.

Exit criteria
```text
- Package parsing runs in a Web Worker rather than the main React render path.
- Large package parsing does not block basic UI updates.
- Loading UI includes the current file name or comparable processing context.
- Worker failures surface through the app error path.
- Run: bun run --filter @unitypackage-tools/web build
- Run: bun run typecheck
```

### P2 - File list performance

Reduce DOM and computation cost for large packages without changing existing
filtering semantics.

Exit criteria
```text
- File list rendering is virtualized with `react-window`, `tanstack/virtual`, or an equivalent existing dependency choice.
- `getFilteredAndCategorizedFiles` results are memoized so unrelated renders do not recompute the list.
- File list item layout remains stable at desktop and mobile widths.
- Run: bun run --filter @unitypackage-tools/web build
```

### P3 - Preview and settings UX

Add the remaining UX correctness items while following the existing component
style. Do not introduce a landing page or broad redesign.

Exit criteria
```text
- Dark mode uses `prefers-color-scheme` CSS variables at body/App scope.
- Text preview supports code/data file extensions from the roadmap with raw or highlighted content.
- Image preview conditionally renders only when needed; no hidden always-mounted image node remains.
- URL state persists `excludeMeta`, `categorize`, and `language`.
- `FileListItem` blob URLs update when `content` changes.
- Run: bun run --filter @unitypackage-tools/web build
```

### P4 - Download worker and integration

Move all expensive download-all archive creation work away from the main thread
or use a streaming approach. Then reconcile worker types and build behavior.

Exit criteria
```text
- `downloadAll` zip creation no longer blocks the main thread for large selections.
- Worker code is typed and bundled by the existing Vite setup.
- No hand edits are made to `packages/cli/assets/web/`.
- Run: bun run --filter @unitypackage-tools/web build
- Run: bun run check
```

## Verification

```sh
bun run --filter @unitypackage-tools/web build
bun run check
```

Manual smoke:
- Start `bun run dev:web`, load a large package if available, and confirm parsing, filtering, previews, settings URL state, and download-all behavior.
- Check both light and dark system color schemes.
