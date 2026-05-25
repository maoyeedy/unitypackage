# Meta type robustness improvements

## Context

Our core library (`packages/core/src/index.ts`) currently generates only `DefaultImporter` meta files via `createMinimalMeta(guid)`. DeNA/unity-meta-check uses 4 importer types based on file extension (folders, `.cs`, text-based data files, generic). We should match this so packages produced by our CLI carry correct meta types — avoiding Unity importer warnings and ensuring proper asset handling.

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

### P1 -- Importer type definitions and templates

Add `MetaImporterType` and per-type YAML template functions. Each template mirrors what Unity Editor produces for that asset kind.

Files: `packages/core/src/index.ts`

New exports:
```ts
export type MetaImporterType =
  | 'DefaultImporter'
  | 'DefaultImporterFolder'
  | 'TextScriptImporter'
  | 'MonoImporter';
```

New internal template functions:
- `defaultImporterFolderTemplate(guid)` — adds `folderAsset: yes`
- `textScriptImporterTemplate(guid)` — uses `TextScriptImporter` header
- `monoImporterTemplate(guid)` — uses `MonoImporter` with `serializedVersion`, `defaultReferences`, `executionOrder`, `icon`

Exit criteria: Templates can be called directly and produce valid YAML strings.

### P2 -- Extension-based detection

Add `detectMetaImporterType(pathname, isDir?)` that maps file extensions to importer types, mirroring DeNA's rules.

Files: `packages/core/src/index.ts`

Detection rules:
- Directory / no extension → `DefaultImporterFolder`
- `.cs` → `MonoImporter`
- `.json`, `.bytes`, `.csv`, `.pb`, `.txt`, `.xml`, `.proto`, `.md`, `.asmdef` → `TextScriptImporter`
- `.yaml`, `.yml` → `DefaultImporter`
- Everything else → `DefaultImporter` (unchanged fallback)
- Special-cased pathname basename `LICENSE` → `TextScriptImporter`

Exit criteria: Known extensions map to expected types; unknown extensions fall back to `DefaultImporter`; absent `isDir` defaults to file.

### P3 -- Public convenience API and tests

Add `createMinimalMetaFor(guid, pathname, isDir?)` and `createMinimalFolderMeta(guid)` as exported functions, then write tests for everything.

Files: `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

- `createMinimalMetaFor` calls `detectMetaImporterType` + the corresponding template, keeping the `createMinimalMeta` single-call DX.
- `createMinimalFolderMeta` wraps `defaultImporterFolderTemplate` with GUID validation.
- Tests cover: each importer type renders correct YAML, detection rules map correctly, edge cases (empty pathname, dir vs file, extensionless files, `LICENSE`), backward compat of `createMinimalMeta`.

Exit criteria: `npm test` passes in `packages/core/`.

## Verification

```sh
cd packages/core
npm test
```

All existing tests must pass unchanged. New tests must cover all 4 importer types, all extension-to-type mappings, folder flag, and edge cases.
