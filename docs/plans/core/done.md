# Core — Shipped

## Phase 0 — Test Coverage Gaps
Audited real Unity-exported packages against the documented gzip tar record model. Backfilled parser and creator tests for edge cases (preview.png, multi-line pathnames, non-ASCII, malformed data, duplicates, folder-only records). Documented the GUID validation boundary (32-hex dir names preserved as-is).

## Phase 1 — Immediate Gaps
Exposed structured diagnostics from the core parser, added `preview.png` to parsed entries, and rejected duplicate GUIDs on creation.

## Meta Type Robustness (2026-05-25)
Added correct per-importer-type meta generation to `packages/core`. Exported `MetaImporterType` union and `detectMetaImporterType` (extension-based dispatch: `DefaultImporterFolder`, `MonoImporter`, `TextScriptImporter`, `DefaultImporter`). Added `createMinimalMetaFor` and `createMinimalFolderMeta` convenience APIs alongside the existing `createMinimalMeta`. 27 new tests; 157 total passing.

## Core Source Split (2026-05-25)
Split `packages/core/src/index.ts` into domain modules while preserving the root `unitypackage-core` public API. Runtime source now lives in `guid.ts`, `pathname.ts`, `meta.ts`, `parse.ts`, `create.ts`, `summary.ts`, `model.ts`, and private `tar.ts`; matching tests live in per-domain `*.test.ts` files. `index.ts` is now a public barrel and `index.test.ts` is a barrel smoke test. Validation: lint, typecheck, test, and build passed for `unitypackage-core`.
