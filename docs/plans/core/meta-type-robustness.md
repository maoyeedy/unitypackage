# Meta type robustness improvements

## Context

Our core library generated only `DefaultImporter` meta files via `createMinimalMeta(guid)`. DeNA/unity-meta-check uses 4 importer types based on file extension (folders, `.cs`, text-based data files, generic). We should match this so packages produced by our CLI carry correct meta types -- avoiding Unity importer warnings and ensuring proper asset handling.

## Scope

**In:**
- `MetaImporterType` union type export
- Internal YAML template for each importer type (folder, MonoImporter, TextScriptImporter, DefaultImporter)
- `detectMetaImporterType(pathname, isDir?)` — extension-based dispatch
- `createMinimalMetaFor(guid, pathname, isDir?)` — public convenience that combines detection + generation
- `createMinimalFolderMeta(guid)` — explicit folder meta generator
- Keep `createMinimalMeta(guid)` unchanged for backward compatibility
- Full test coverage for all types and detection rules

**Out:**
- No meta content parsing or validation (no YAML parser)
- No audit/dangling-meta detection (not applicable to archive context)
- No CLI changes (will be wired separately)
- No change to `CreateUnityPackageEntry` required types

## Phases

### P1 -- Importer type definitions and templates  [DONE 2026-05-25]

Shipped: Exported `MetaImporterType` union (`DefaultImporter | DefaultImporterFolder | TextScriptImporter | MonoImporter`) through `packages/core/src/index.ts`; implementation now lives in `packages/core/src/meta.ts`.
Each template mirrors Unity Editor YAML output for its asset kind. See git log for implementation detail.

### P2 -- Extension-based detection  [DONE 2026-05-25]

Shipped: Exported `detectMetaImporterType(pathname, isDir?)` through `packages/core/src/index.ts` using string-only extension extraction (no `node:path`).
Implements the full priority chain: `isDir` flag, `.cs`, text-script set, `LICENSE` basename, YAML set, extensionless fallback, and default. See git log for implementation detail.

### P3 -- Public convenience API and tests  [DONE 2026-05-25]

Shipped: Exported `createMinimalMetaFor(guid, pathname, isDir?)` and `createMinimalFolderMeta(guid)` through `packages/core/src/index.ts`.
Added 27 new tests across 4 describe blocks covering all 4 importer types, all detection rules, edge cases, and backward compat of `createMinimalMeta`; 157/157 pass. See git log for implementation detail.

## Verification

```sh
cd packages/core
npm test
```

All existing tests must pass unchanged. New tests must cover all 4 importer types, all extension-to-type mappings, folder flag, and edge cases.
