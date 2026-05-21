# Phase 1 - Immediate Gaps

## Context

This phase fixes visibly incomplete behavior across the web app, CLI, and core
without taking on the larger roadmap. The work should make current surfaces more
correct and less surprising while preserving existing package boundaries.

## Phases

| ID | Title | Goal | Parallel with | Depends on | Files | Subagent |
|----|-------|------|---------------|------------|-------|----------|
| P1 | Core parser metadata and create guard | Surface parser diagnostics and previews through the GUID-aware API, and reject duplicate GUIDs during package creation. | P2, P3 | - | `packages/core/src/index.ts`, `packages/core/src/index.test.ts`, `docs/reference/format.md` | worker |
| P2 | CLI extract and pack gaps | Add the immediate extract and pack UX fixes: `--no-meta`, skipped traversal summary, `Assets/` validation or warning, and skipped `.meta` source logging. | P1, P3 | - | `packages/cli/src/commands/extract.ts`, `packages/cli/src/commands/pack.ts`, `packages/cli/src/commands.test.ts`, `packages/cli/src/util/*.ts` | worker |
| P3 | Web immediate robustness | Switch the app to GUID-aware parsing, resolve the hidden preview toggle, add an error boundary, and show drag-active drop-zone state. | P1, P2 | - | `apps/web/src/App.tsx`, `apps/web/src/App.css`, `apps/web/src/components/FileDropZone.tsx`, `apps/web/src/components/Controls.tsx`, `apps/web/package.json` | worker |
| P4 | Integration pass | Resolve integration issues between the core API changes and CLI/web callers, then run the full workspace gate. | - | P1, P2, P3 | `packages/core/src/index.ts`, `packages/cli/src/**/*.ts`, `apps/web/src/**/*.tsx`, `apps/web/src/**/*.css` | worker |

### P1 - Core parser metadata and create guard

Extend the core API only as needed for the roadmap items: structured parse
diagnostics, preview bytes on `UnityPackageEntry`, and duplicate GUID rejection
in `createUnityPackage`. Keep `packages/core` browser-safe and avoid Node-only
dependencies.

Exit criteria
```text
- `parseUnityPackageEntries` can expose structured warnings without breaking existing callers.
- `UnityPackageEntry` exposes `preview?` when a package contains `preview.png`.
- `createUnityPackage` throws on duplicate GUID input.
- Existing `parseUnityPackage` callers remain source-compatible.
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-core build
```

### P2 - CLI extract and pack gaps

Implement the immediate CLI gaps while keeping stdout/stderr behavior compatible
with JSON output. Use existing argument parsing and logger patterns.

Exit criteria
```text
- `extract --no-meta` skips writing `.meta` files.
- `extract` reports skipped traversal entry count in the summary.
- `pack` validates or warns when `pathInPackage` does not start with `Assets/`.
- `pack` logs skipped source `.meta` files explicitly.
- CLI tests cover the new flags and messages.
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
```

### P3 - Web immediate robustness

Move the web app to GUID-aware parsed entries and address the visible UI gaps.
Follow existing React component structure and avoid unrelated visual redesign.

Exit criteria
```text
- `App.tsx` uses `parseUnityPackageEntries` for package parsing.
- The preview setting is either visible and functional or removed with no dead UI state.
- Web errors render a fallback instead of a blank white page.
- `FileDropZone` displays a drag-active state while files are dragged over it.
- Run: bun run --filter @unitypackage-tools/web build
- Run: bun run typecheck
```

### P4 - Integration pass

After the parallel surfaces land, resolve import/type conflicts and verify the
workspace. Do not add new user-facing features in this phase.

Exit criteria
```text
- CLI and web compile against the final core API shape.
- No generated web assets under `packages/cli/assets/web/` are hand-edited.
- Run: bun run check
```

## Verification

```sh
bun run check
node packages/cli/dist/bin.js inspect "fixtures/static/editor-packed.unitypackage" --json
node packages/cli/dist/bin.js verify "fixtures/static/editor-packed.unitypackage"
node packages/cli/dist/bin.js extract "fixtures/static/editor-packed.unitypackage" /tmp/unitypackage-extract-test
```

Manual smoke:
- Open the web app with `bun run dev:web` and drop `fixtures/static/editor-packed.unitypackage`.
- Confirm the drop zone, preview behavior, and error fallback are visible in normal browser use.
