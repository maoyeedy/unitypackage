# Phase 5 - Core API Evolution

## Context

This phase evolves the core API for streaming, reproducible package creation,
large package sizing, parse warnings, and browser-side repacking. Changes should
preserve compatibility for existing consumers while enabling new workflows.

## Phases

| ID | Title | Goal | Parallel with | Depends on | Files | Subagent |
|----|-------|------|---------------|------------|-------|----------|
| P1 | Streaming parse API | Add `parseUnityPackageStream(reader: ReadableStream)` yielding `AsyncIterable<UnityPackageEntry>`. | P2 | - | `packages/core/src/index.ts`, `packages/core/src/index.test.ts`, `packages/core/README.md` | worker |
| P2 | Deterministic and sized package creation | Make package creation deterministic and add a size-estimation path before allocation. | P1 | - | `packages/core/src/index.ts`, `packages/core/src/index.test.ts`, `packages/core/README.md` | worker |
| P3 | Parse warnings compatibility | Export parse warnings from `parseUnityPackageEntries` through a compatibility-preserving overload or options bag. | - | P1, P2 | `packages/core/src/index.ts`, `packages/core/src/index.test.ts`, `packages/core/README.md`, `packages/cli/src/**/*.ts`, `apps/web/src/**/*.tsx` | worker |
| P4 | Browser-side repack | Expose `createUnityPackage` through the web app as a repack-selection download flow. | - | P3 | `apps/web/src/App.tsx`, `apps/web/src/components/*.tsx`, `apps/web/src/App.css`, `packages/core/src/index.ts` | worker |

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

### P3 - Parse warnings compatibility

Expose warnings in a way that does not force existing callers to change. Update
CLI and web call sites only where the new API shape requires it.

Exit criteria
```text
- Existing calls to `parseUnityPackageEntries(data)` continue to compile.
- Callers can opt into structured warnings through an overload or `{ collectWarnings: true }` options bag.
- Core tests cover warning collection and default compatibility.
- CLI and web typecheck against the final API.
- Run: bun run --filter unitypackage-core test
- Run: bun run typecheck
```

### P4 - Browser-side repack

Add a web workflow for downloading a filtered selection as a new `.unitypackage`
using the core creation API. Keep ZIP download behavior unless explicitly
replaced by the implementation.

Exit criteria
```text
- Web users can repack the current selection into a new `.unitypackage`.
- The flow uses `createUnityPackage` from `packages/core`.
- Empty selections and creation failures render clear UI states.
- Existing ZIP/download behavior remains available unless deliberately superseded in UI copy and tests.
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
- Use the web app to repack a selection and verify the generated package with `node packages/cli/dist/bin.js verify`.
- Compare two packages created from identical input and confirm deterministic output behavior.
