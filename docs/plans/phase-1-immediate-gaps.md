# Phase 1 - Immediate Gaps - Ship Record

## What shipped

This phase fixed visibly incomplete behavior across the web app, CLI, and core
without taking on the larger roadmap. Current surfaces now expose more accurate
package metadata, handle common CLI workflows more clearly, and avoid blank or
inactive web UI states while preserving package boundaries.

- Core parsing now exposes structured diagnostics through the GUID-aware API,
  includes `preview.png` bytes on parsed entries, and rejects duplicate GUIDs
  during package creation.
- CLI extraction and packing now support `extract --no-meta`, report skipped
  traversal entries, warn for package paths outside `Assets/`, and log skipped
  source `.meta` files.
- The web app now parses packages with GUID-aware entries, shows a functional
  preview setting, renders an error fallback, and displays drag-active drop-zone
  state.
- The integration pass confirmed CLI and web compile against the final core API
  shape and that generated web assets were not hand-edited.

## Files changed

| File | Change |
|------|--------|
| `.apply-plan/checkpoints/P1.md` | Added checkpoint for the core parser phase. |
| `.apply-plan/checkpoints/P2.md` | Added checkpoint for the CLI extract and pack phase. |
| `.apply-plan/checkpoints/P3.md` | Added checkpoint for the web robustness phase. |
| `.apply-plan/checkpoints/P4.md` | Added checkpoint for the integration pass. |
| `apps/web/src/App.css` | Added styling for error fallback, preview controls, and drag-active drop-zone state. |
| `apps/web/src/App.tsx` | Switched package parsing to `parseUnityPackageEntries` and added error fallback behavior. |
| `apps/web/src/components/Controls.tsx` | Made the preview setting visible and functional. |
| `apps/web/src/components/FileDropZone.tsx` | Added drag-active state handling. |
| `docs/reference/format.md` | Documented parser diagnostics and preview handling. |
| `packages/cli/src/cli.ts` | Wired the `--no-meta` extract flag through command parsing and help text. |
| `packages/cli/src/commands.test.ts` | Added CLI coverage for no-meta extraction, traversal summaries, pack warnings, and skipped meta logging. |
| `packages/cli/src/commands/extract.ts` | Implemented no-meta extraction and skipped traversal summary reporting. |
| `packages/cli/src/commands/pack.ts` | Added non-`Assets/` package path warnings and skipped source `.meta` logging. |
| `packages/cli/src/util/args.ts` | Added argument support needed by the new extract flag. |
| `packages/core/src/index.test.ts` | Added core coverage for diagnostics, previews, and duplicate GUID rejection. |
| `packages/core/src/index.ts` | Added structured parse diagnostics, entry previews, and duplicate GUID validation. |

## Design notes

- **Diagnostics compatibility:** `parseUnityPackageEntries` exposes diagnostics
  without breaking existing array-style callers, so current CLI and web code can
  adopt the extra metadata incrementally.
- **CLI JSON compatibility:** New extract and pack messages follow existing
  logger patterns so human-readable summaries do not pollute JSON output.
