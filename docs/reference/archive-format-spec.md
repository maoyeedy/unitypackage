# `.unitypackage` Format

Unofficial spec derived from Unity exports, UnityCsReference, and tooling. Unity exports = source of truth.

## Structure

```
package.unitypackage
└── gzip (fflate)
    └── tar (custom ustar, 512B blocks)
        ├── <32-hex-guid>/
        │   ├── pathname       # text, first line = asset path e.g. `Assets/Foo.cs`
        │   ├── asset.meta     # raw .meta file bytes
        │   ├── asset          # raw payload; absent for folders
        │   └── preview.png    # optional thumbnail
        └── ...
```

Not zip, AssetBundle, Addressables, or UPM.

## Records

Each tar dir = one Unity asset record. Dir name must match `^[0-9a-fA-F]{32}$`.
The core parser preserves the archive prefix as `guid` and does not validate this shape.

| Entry | Required | Notes |
|---|---|---|
| `pathname` | Yes | Forward slashes, `Assets/...`. First line only. Reject absolute, `..`, empty, drive/UNC. UTF-8. |
| `asset.meta` | Yes (files + folders) | Written to `<pathname>.meta`. Preserve byte-for-byte — GUID + import settings. Checks `metaData` as legacy fallback. |
| `asset` | Files only | Written to `<pathname>`. Copy byte-for-byte. |
| `preview.png` | No | Optional thumbnail, surfaced as `UnityPackageEntry.preview`. Flat extraction ignores it. |

Folder detection: `asset` present → file (create + write asset). No `asset` → folder (create dir + write `<pathname>.meta`).

## GUID reference model

```yaml
m_Script: {fileID: 11500000, guid: f5ee4a4c1e4c3b448a97448840cdf0f41, type: 3}
```

- References survive import because `.meta` GUIDs are preserved byte-for-byte.
- Archive does **not** remap references by path.
- Regenerating GUIDs requires rewriting YAML references.

## Extraction security

- Reject `..`, absolute paths, drive/UNC, symlinks, hardlinks, device files, FIFOs.
- Decompression bomb guard.
- Detect duplicate/case-colliding output paths.
- Default: error on overwrite (flags: `--force`, `--skip-existing`).

## Implementation

- **`packages/core`** (browser-safe, no `node:*`): `parseUnityPackageEntries` (GUID-aware, preferred, buffered, includes structured diagnostics, supports `chunkSize`), `iterUnityPackageEntries` (iterator-based; yields entries and diagnostics; supports `onProgress` and bomb guards), `parseUnityPackage` (flat alias), `createUnityPackage` (gzip 0–9, default 6, rejects duplicate input GUIDs). Deps: `fflate` only.
- `packages/core/src/index.ts` is the public barrel. Implementation lives in domain modules (`guid`, `pathname`, `meta`, `parse`, `create`, `summary`) plus shared `model` types and private `tar` helpers. Public consumers should import from `unitypackage-core`, not internal files.
- **`packages/cli`**: extract, pack, inspect, verify, diff, web.

| Aspect | Detail |
|---|---|
| Gzip | `fflate`, sync in-memory |
| Tar parser | Custom ~30-line ustar, no ext lib |
| Entry name limit | 100 bytes (ustar) |
| pathname read | First line, trimmed |
| Legacy fallback | `asset.meta` → `metaData` |
| GUID validation | Unity exports use 32 hex; core preserves any archive prefix as `guid` |
| GUID generation | MD5 of UTF-16LE path |
| Archive model | Gzip decompressed synchronously (fflate); tar parsed and iterated via `iterUnityPackageEntries`; buffered collection via `parseUnityPackageEntries` |

```ts
interface UnityPackageEntry {
  guid: string;
  pathname: string;
  asset?: Uint8Array;
  meta?: Uint8Array;
  preview?: Uint8Array;
}

interface UnityPackageParseDiagnostic {
  code:
    | 'asset-missing'
    | 'duplicate-guid'
    | 'empty-pathname'
    | 'ignored-preview'
    | 'malformed-tar-entry'
    | 'meta-missing'
    | 'non-standard-guid'
    | 'oversized-entry-name'
    | 'zero-byte-asset';
  message: string;
  severity: 'info' | 'warning' | 'error';
  path?: string;
  guid?: string;
}
```

```sh
unitypackage-tools extract <package> [out-dir] [--force] [--skip-existing] [--merge] [--filter <glob>]
unitypackage-tools pack    <output> <src> <dest>... [--manifest <file.json>] [--gzip-level <0-9>]
unitypackage-tools inspect <package> [--json] [--format tree] [--filter <ext>]
unitypackage-tools verify  <package> [--json] [--strict]
unitypackage-tools diff    <before> <after> [--json]
unitypackage-tools web     [--port <n>]
```

CLI glob filters match full package pathnames. For nested shader assets, use
`**/*.shader`; `*.shader` only matches root-level package paths.

`verify` reports structural health checks scoped to this format reference. It
does not validate Unity YAML schemas.

## Compatibility

- Old exports: `metaData` instead of `asset.meta`, multi-line `pathname` (use first line only).
- `preview.png` surfaced by `parseUnityPackageEntries`; flat `parseUnityPackage` ignores it.
- Streaming: `iterUnityPackageEntries` is a synchronous generator and yields entries as each GUID group completes; gzip decompression remains synchronous (fflate). Use `parseUnityPackageEntries` for a fully buffered result.

## References

`docs/` root — search "Unity Asset Packages" manual, UnityCsReference `AssetDatabase.bindings.cs`, [Autarkis unity-pack-rs](https://github.com/Autarkis/unity-pack-rs).
