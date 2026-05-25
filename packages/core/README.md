# unitypackage-core

Browser-safe `.unitypackage` parser and writer.

## API

```ts
import { parseUnityPackage, parseUnityPackageEntries, createUnityPackage } from 'unitypackage-core';
```

See source for full type definitions. No Node.js or browser globals required beyond `Uint8Array` and `TextEncoder`/`TextDecoder`.

`parseUnityPackageEntries(data)` returns GUID-aware entries and preserves array
compatibility. The returned array also exposes a non-enumerable `diagnostics`
property with structured parser diagnostics.

`UnityPackageEntry.preview` contains optional `preview.png` thumbnail bytes when
present. Flat `parseUnityPackage(data)` output ignores previews.

`createUnityPackage(entries, options?)` rejects duplicate GUIDs before writing
the archive. Output is **reproducible**: entries are sorted by GUID (ascending,
lexicographic) before writing, and the GZIP header timestamp is fixed at epoch
zero, so two calls with identical inputs always produce byte-equal output
regardless of the order entries are supplied.

`tryCreateUnityPackage(entries, options?)` is the non-throwing variant. It
validates all entries and returns a discriminated result:

```ts
// success
{ bytes: Uint8Array; diagnostics: [] }

// failure -- one or more fatal diagnostics
{ bytes: null; diagnostics: CreateUnityPackageDiagnostic[] }
```

All diagnostics are collected before returning (the function does not stop at
the first problem). Fatal `CreateUnityPackageDiagnosticCode` values:

| Code | Meaning |
|------|---------|
| `empty-entries` | The entries array is empty. |
| `invalid-guid` | A GUID is not exactly 32 lowercase hexadecimal characters. |
| `duplicate-guid` | Two entries share the same GUID. |
| `missing-meta` | An entry's `meta` field is absent or zero-length. |
| `oversized-pathname` | A pathname exceeds 200 characters, or a tar entry name exceeds the 100-byte ustar header limit. |

`createUnityPackage` wraps `tryCreateUnityPackage` and throws an `Error` with
the first diagnostic's message when validation fails.

`estimateUnityPackageSize(entries)` returns the uncompressed tar byte size and
total member count without allocating the tar buffer:

```ts
const { tarBytes, entryCount } = estimateUnityPackageSize(entries);
```

Each entry contributes up to three tar members (`pathname`, `asset.meta`, and
optionally `asset`). The returned `tarBytes` matches the length of the
uncompressed tar stream produced by `createUnityPackage` for the same input.
