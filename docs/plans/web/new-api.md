# Web API Integration

## Context

This phase evolves the core API for streaming, reproducible package creation,
large package sizing, diagnostics ergonomics, and browser-side repacking.
Changes should preserve compatibility for existing consumers while enabling the
modern workspace UI created in `docs/plans/web/modern-interface-rewrite.md`.

The web app is now an English-only PWA-style React workspace. It parses packages
in a worker into entry-aware `PackageFileRecord` values, shows a tree by
default, can group by extension, previews selected records on the right, and has
a Pack mode shell. This plan should wire the disabled Pack export path to the
new core creation API instead of rebuilding the interface.

## Phases

| ID | Title | Goal | Parallel with | Depends on | Files | Subagent |
|----|-------|------|---------------|------------|-------|----------|
| P1 | Streaming parse API | Add `parseUnityPackageStream(reader: ReadableStream)` yielding `AsyncIterable<UnityPackageEntry>`. | P2 | - | `packages/core/src/index.ts`, `packages/core/src/index.test.ts`, `packages/core/README.md` | worker |
| P2 | Deterministic and sized package creation | Make package creation deterministic and add a size-estimation path before allocation. | P1 | - | `packages/core/src/index.ts`, `packages/core/src/index.test.ts`, `packages/core/README.md` | worker |
| P3 | Parse diagnostics ergonomics | Formalize and extend diagnostics for streaming, options-bag ergonomics, and caller adoption. | - | P1, P2 | `packages/core/src/index.ts`, `packages/core/src/index.test.ts`, `packages/core/README.md`, `packages/cli/src/**/*.ts`, `apps/web/src/**/*.ts`, `apps/web/src/**/*.tsx` | worker |
| P4 | Browser-side pack export | Enable the existing Pack mode shell to download a staged selection as `.unitypackage`. | - | P3 | `apps/web/src/App.tsx`, `apps/web/src/packageModel.ts`, `apps/web/src/workerTypes.ts`, `apps/web/src/**/*.worker.ts`, `packages/core/src/index.ts` | worker |

### P1 - Streaming parse API

Add a browser-safe streaming parse API that can emit entries without requiring
callers to hold the entire package in memory. Keep the existing buffer-based
APIs intact.

Exit criteria
```text
- `parseUnityPackageStream(reader: ReadableStream)` is exported from `packages/core`.
- The API yields `UnityPackageEntry` values as an `AsyncIterable`.
- Tests cover normal packages and malformed/truncated stream behavior.
- README documents the new API at a high level.
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-core build
```

### P2 - Deterministic and sized package creation

Improve `createUnityPackage` output for reproducible builds and large package
planning while preserving the existing input model.

Exit criteria
```text
- `createUnityPackage` emits entries in stable GUID order.
- Tar metadata uses deterministic timestamps and gzip output settings where supported by current dependencies.
- A size-estimation API or option is available before allocation.
- Tests assert byte-stable round trips for identical input.
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-core build
```

### P3 - Parse diagnostics ergonomics

Formalize the Phase 1 parse diagnostics API for streaming and large-package
workflows without forcing existing callers to change. Keep the existing
array-compatible diagnostics access working while adding any options-bag or
streaming integration needed by the new APIs.

Exit criteria
```text
- Existing calls to `parseUnityPackageEntries(data)` continue to compile.
- Callers can use the structured diagnostics established in Phase 1 through the final compatibility-preserving API shape.
- Streaming parse diagnostics use the same codes and structure as buffer parsing.
- Core README documents diagnostics, `UnityPackageEntry.preview`, and duplicate GUID rejection.
- CLI and web typecheck against the final API.
- Web keeps displaying parser diagnostics in the workspace status and per-record metadata panes.
- Run: bun run --filter unitypackage-core test
- Run: bun run typecheck
```

### P4 - Browser-side pack export

Enable the existing Pack mode shell to export a staged selection as a new
`.unitypackage` using the core creation API. Keep ZIP downloads available in
Extract mode.

Exit criteria
```text
- Web users can stage extracted asset records and download a new `.unitypackage`.
- The browser flow uses `createUnityPackage` or the final worker-safe creation API from `packages/core`.
- Pack mode replaces the current disabled export state with an enabled export button when validation passes.
- Empty selections, missing metadata, duplicate GUIDs, unsupported preview records, and creation failures render clear UI states.
- Existing ZIP/download behavior remains available in Extract mode.
- Web tests cover pack validation and the enabled export worker path.
- Run: bun run --filter @unitypackage-tools/web build
- Run: bun run check
```

## Verification

```sh
bun run --filter unitypackage-core test
bun run --filter @unitypackage-tools/web build
bun run check
```

Manual smoke:
- Use the web app Pack mode to export a staged selection and verify the generated package with `node packages/cli/dist/bin.js verify`.
- Confirm Extract mode still shows the tree by default, extension grouping, native previews, metadata, and ZIP downloads.
- Compare two packages created from identical input and confirm deterministic output behavior.
