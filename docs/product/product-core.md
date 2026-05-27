# Core Library Product Spec

## TLDR

`unitypackage-core` is the browser-safe foundation library for parsing, creating, and manipulating `.unitypackage` archives. It is the single source of truth for the format's data model, GUID handling, pathname validation, meta sidecar management, and file classification -- all without Node.js built-in modules. The CLI and web app depend on it, but neither owns it.

## Product Goal

Provide a portable, reliable, minimal library that:

1. **Parse**: Decompress and iterate `.unitypackage` tar entries (asset, meta, preview per GUID) into structured `UnityPackageEntry` objects, with configurable decompression bomb limits.
2. **Create**: Build valid `.unitypackage` archives from entry data, with size estimation and memory-safe try-create.
3. **GUID**: Generate random GUIDs, validate them, and derive deterministic GUIDs from asset paths.
4. **Pathnames**: Validate Unity asset pathname constraints, detect pathname collisions (identical, case-only, normalized), and compute meta sidecar paths.
5. **Meta**: Create minimal `.meta` YAML for known Unity importer types, read/write GUIDs in existing meta YAML, and read the declared importer type.
6. **Classify**: Map file extensions to Unity file categories (image, audio, video, pdf, code, unity-yaml, meta, document, binary), MIME types, and detect Unity YAML files that embed binary payloads (Force-Text edge case).
7. **Zero Node.js**: All of the above works in browsers, Web Workers, and edge runtimes with only `fflate` as a runtime dependency.

## In Scope

- **Parsing**: Stream-oriented (`iterUnityPackageEntries`) and full-buffer (`parseUnityPackage`, `parseUnityPackageEntries`) modes. All produce typed `UnityPackageEntry` objects with GUID, pathname, asset, meta, and preview byte buffers.
- **Creation**: Synchronous full-buffer creation (`createUnityPackage`, `tryCreateUnityPackage`) with gzip level control. Size estimation (`estimateUnityPackageSize`) for pre-allocation.
- **GUID operations**: Random generation (`generateGuid`), validation (`isValidGuid`), and path-based deterministic derivation (`guidFromPath`).
- **Pathname operations**: Validation (`validatePathname`) with rejection reasons for unsafe or malformed paths. Collision detection (`detectPathnameCollisions`) for identical, case-only, and normalized-path duplicates. Meta sidecar path computation (`metaSidecarPathForAsset`).
- **Meta operations**: Create minimal `.meta` YAML for known importer types (`createMinimalMetaFor`). Read GUID from meta YAML (`readMetaGuid`). Write GUID into meta YAML preserving structure (`writeMetaGuid`). Read declared importer type from meta YAML (`readDeclaredMetaImporter`). Supported importer types: `MetaImporterType` enum (DefaultImporter, MonoImporter, TextScriptImporter, NativeFormatImporter, etc.).
- **Classification**: File category via `getUnityFileCategory`, extension via `getPathExtension`, MIME type via `getMimeTypeForPath`. The `yamlExtensions` set defines known Unity YAML extensions. Code extensions include C#, shader, HLSL, GLSL, CSS, JSON, XML, HTML, TS/JS.
- **YAML binary detection**: `isUnityYamlBinary` detects Unity YAML files that embed large binary payloads despite a valid `%YAML` header (Force-Text serialization). Combines magic-byte check with head+tail line-length scan.
- **Decompression bomb protection**: Configurable `DEFAULT_MAX_ENTRIES` and `DEFAULT_MAX_OUTPUT_BYTES` limits. `DecompressionBombError` thrown when exceeded. Also exposed as `ParseUnityPackageOptions`.
- **Diagnostic types**: Typed diagnostic codes and severity for parse and create operations (`UnityPackageParseDiagnosticCode`, `CreateUnityPackageDiagnosticCode`, `UnityPackageDiagnosticSeverity`). Iteration progress events (`IterEntriesProgressEvent`).
- **Dual format output**: CJS (`dist/index.js`) and ESM (`dist/esm/index.js`). Single barrel entry point. Tree-shakeable.
- **Browser-safe**: No Node.js built-in modules (`fs`, `path`, `crypto`, `os`, `yaml`, HTTP). Only dependency: `fflate`.

## Out Of Scope

- App-level view models (component records, sidecar resolution, analysis summaries, glob matching) -- removed from core; live as local copies in CLI or web as needed.
- Preview classification (PreviewKind, SyntaxLanguage) -- UI concerns belong in the web app.
- Glob or wildcard path matching -- ecosystem-solved; CLI has a local copy.
- Unity YAML schema or content validation (verify is format-scoped).
- File system I/O, network requests, or any Node/Deno/Bun-specific APIs.
- Cryptographic hashing or checksums beyond GUID needs.
- CLI argument parsing, command routing, or output formatting.
- Editing package contents in place, remapping GUIDs by path, or batch operations.
- Subpath exports or multi-entry-point distribution -- single barrel only.

## Public API Surface

All exports flow through `packages/core/src/index.ts`. Approximate count: ~37 named exports, ~1 class (`DecompressionBombError`).

| Category | Exports |
|----------|---------|
| **Types** | `UnityPackageEntry`, `ExtractedFileContent`, `UnityPackageDiagnosticSeverity` |
| **Parse types** | `ParseUnityPackageOptions`, `UnityPackageParseDiagnostic`, `UnityPackageParseDiagnosticCode`, `IterEntriesOptions`, `IterEntriesEntry`, `IterEntriesItemKind`, `IterEntriesDiagnostic`, `IterEntriesProgressEvent` |
| **Create types** | `CreateUnityPackageOptions`, `CreateUnityPackageDiagnostic`, `CreateUnityPackageDiagnosticCode`, `CreateUnityPackageEntry` |
| **Pathname types** | `PathnameValidationResult`, `PathnameRejectionReason`, `PathnameCollision` |
| **Meta types** | `MetaImporterType`, `DeclaredMetaImporter` |
| **Classification types** | `UnityFileCategory` |
| **Parse functions** | `parseUnityPackage`, `parseUnityPackageEntries`, `iterUnityPackageEntries` |
| **Parse constants** | `DEFAULT_MAX_ENTRIES`, `DEFAULT_MAX_OUTPUT_BYTES`, `DecompressionBombError` |
| **Create functions** | `createUnityPackage`, `tryCreateUnityPackage`, `estimateUnityPackageSize` |
| **GUID functions** | `generateGuid`, `isValidGuid`, `guidFromPath` |
| **Pathname functions** | `validatePathname`, `detectPathnameCollisions`, `metaSidecarPathForAsset` |
| **Meta functions** | `createMinimalMetaFor`, `readMetaGuid`, `writeMetaGuid`, `readDeclaredMetaImporter` |
| **Classification functions** | `getPathExtension`, `getUnityFileCategory`, `getMimeTypeForPath`, `isUnityYamlBinary` |
| **Classification constants** | `yamlExtensions` |

## Removed From Core

The following modules were part of earlier iterations but have been removed from core. They live as local copies in the CLI and/or web app:

- `glob.ts` -- `matchGlob` (ecosystem-solved)
- `sidecar.ts` -- meta sidebar resolution heuristics (web-owned)
- `component.ts` -- entry-to-component view model (app-level)
- `analyze.ts` -- structural analysis findings (CLI-owned)
- `summary.ts` -- package summary convenience (CLI-owned)
- `classify.ts` preview types (PreviewKind, SyntaxLanguage) -- web-owned preview types
- `pathname.ts` dead utils (`isMetaSidecarPath`, `assetPathForMetaSidecar`)
- `meta.ts` convenience wrappers (`createMinimalMeta`, `createMinimalFolderMeta`)

## Product Constraints

- Zero Node.js built-in modules. Core must work in browsers, Web Workers, and edge runtimes. Only `fflate` for gzip.
- Single barrel entry point. No public subpath exports. All consumers import from `unitypackage-core`.
- Every type used in a public function signature must be explicitly exported. No transitive/internal type leakage.
- Tree-shakeable. Dead-code elimination must be able to drop unused parse, create, classify, or meta functions.
- All parse and create logic must be synchronous or callback-driven (no promises needed in core) to keep the API simple and predictable.
- Decompression bomb limits must be configurable but have sensible defaults. No unbounded memory allocation from archive input.
- The library does not import or reference any UI types (PreviewKind, SyntaxLanguage, etc.).
- `isUnityYamlBinary` must remain in core -- both CLI and web need it.

## Acceptance Checks

- `parseUnityPackage(buffer)` returns a list of `UnityPackageEntry` with correct GUID, pathname, asset, meta, preview fields.
- `parseUnityPackageEntries(buffer)` returns a list of entries with parser diagnostics for malformed packages.
- `iterUnityPackageEntries(buffer)` yields entries without loading the full output into memory.
- `parseUnityPackage` on a truncated or corrupted archive throws or returns diagnostics rather than silent data loss.
- `createUnityPackage(entries)` produces a valid `.unitypackage` that round-trips through parse to equal original entries.
- `tryCreateUnityPackage(entries)` catches creation errors and returns them as diagnostics instead of throwing.
- `estimateUnityPackageSize(entries)` returns an upper bound that `createUnityPackage` output does not exceed.
- `generateGuid()` returns a 32-character hex string. `isValidGuid` rejects non-hex, wrong-length, and empty strings.
- `guidFromPath("Assets/Foo.cs")` returns a deterministic GUID that does not change across calls or platforms.
- `validatePathname("Assets/Foo.cs")` returns `{ valid: true }`. `validatePathname("../escape")` returns `{ valid: false, reason: 'path-traversal' }`.
- `detectPathnameCollisions` detects identical, case-only, and normalized-path duplicates.
- `metaSidecarPathForAsset("Assets/Foo.cs")` returns `"Assets/Foo.cs.meta"`.
- `createMinimalMetaFor("Assets/Foo.cs", { guid: "..." })` produces valid `.meta` YAML with a MonoImporter declaration.
- `readMetaGuid(metaBytes)` reads back the GUID written by `writeMetaGuid`.
- `readDeclaredMetaImporter(metaBytes)` returns the correct `MetaImporterType` for standard Unity metas.
- `getUnityFileCategory("file.cs")` returns `'code'`. `getUnityFileCategory("file.png")` returns `'image'`. `getUnityFileCategory("file.asset")` returns `'unity-yaml'`.
- `getMimeTypeForPath("file.cs")` returns `'text/plain;charset=utf-8'`. `getMimeTypeForPath("file.png")` returns `'image/png'`.
- `isUnityYamlBinary` returns `true` for files with long lines (embedded binary blobs) and `false` for clean YAML.
- `DecompressionBombError` is thrown when `DEFAULT_MAX_ENTRIES` or `DEFAULT_MAX_OUTPUT_BYTES` is exceeded.
- Importing `unitypackage-core` in a browser via ESM works without any bundler polyfills for Node built-ins.
