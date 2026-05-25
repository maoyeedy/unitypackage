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
the first problem). Every diagnostic carries a `severity` field
(`'info' | 'warning' | 'error'`). `CreateUnityPackageDiagnosticCode` values
(all `'error'` severity):

| Code | Meaning |
|------|---------|
| `empty-entries` | The entries array is empty. |
| `invalid-guid` | A GUID is not exactly 32 lowercase hexadecimal characters. |
| `duplicate-guid` | Two entries share the same GUID. |
| `missing-meta` | An entry's `meta` field is absent or zero-length. |
| `oversized-pathname` | A pathname exceeds 200 characters, or a tar entry name exceeds the 100-byte ustar header limit. |

`UnityPackageParseDiagnosticCode` values and their default severities:

| Code | Severity | Meaning |
|------|----------|---------|
| `empty-pathname` | `error` | A GUID directory's pathname file decoded to an empty string. |
| `malformed-tar-entry` | `error` | A tar entry has a missing or unparseable header field. |
| `duplicate-guid` | `error` | The same GUID prefix appears more than once in the archive. |
| `non-standard-guid` | `info` | A GUID directory prefix is not a 32-character hex string. |
| `ignored-preview` | `info` | A `preview.png` file is present; ignored by flat parsing. |
| `asset-missing` | `warning` | An entry has a meta file but no asset file. |
| `meta-missing` | `warning` | An entry has an asset file but no meta file. |
| `zero-byte-asset` | `warning` | An asset file is present but has zero bytes. |
| `oversized-entry-name` | `warning` | A pathname exceeds 200 characters. |

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

## GUID utilities

```ts
import { isValidGuid, generateGuid, guidFromPath } from 'unitypackage-core';
```

`isValidGuid(value)` returns `true` when `value` is exactly 32 lowercase
hexadecimal characters (`^[0-9a-f]{32}$`). Unity Editor exports use lowercase
32-hex GUIDs; the parser preserves whatever prefix appears in the archive as
`guid` without normalizing case.

`generateGuid()` returns a cryptographically random 32-character lowercase hex
string using `globalThis.crypto.getRandomValues`. Browser-safe; no
`node:crypto` import.

`guidFromPath(pathname)` derives a deterministic GUID from a pathname using
MD5 of the UTF-16LE-encoded bytes -- the same algorithm as the CLI's internal
`createGuid` helper. Two calls with the same input always return identical
output. The return value is lowercase 32-hex.

## Path safety helpers

```ts
import { validatePathname } from 'unitypackage-core';
```

`validatePathname(pathname, options?)` checks a pathname against the
extraction-security rules from the format spec. Returns a structured result;
never throws.

```ts
const result = validatePathname('Assets/Scripts/Foo.cs');
// { ok: true }

const bad = validatePathname('../etc/passwd');
// { ok: false, reason: 'parent-traversal' }
```

Rejection reasons:

| Reason | Condition |
|--------|-----------|
| `empty` | Pathname is an empty string. |
| `absolute` | Pathname starts with `/`. |
| `drive-or-unc` | Pathname starts with a Windows drive letter (`C:`). |
| `parent-traversal` | Any `/`-delimited segment is exactly `..`. |
| `backslash` | Pathname contains a backslash (`\`). |
| `control-character` | Any character has codepoint < `0x20`. `detail` names the offending index and codepoint. |
| `oversized-tar-entry` | When `options.guid` is supplied: `<guid>/asset.meta` exceeds 100 UTF-8 bytes (ustar header limit). `detail` is the actual byte length as a decimal string. |

When `options.guid` is omitted, the `oversized-tar-entry` check is skipped.
The 100-byte limit check matches the internal check in `tryCreateUnityPackage`
for the same `guid` input.

## Streaming parse

```ts
import { parseUnityPackageStream } from 'unitypackage-core';
```

`parseUnityPackageStream(bytes, options?)` is an `AsyncGenerator` that yields
entries and diagnostics as each GUID group completes. Gzip decompression
remains synchronous (fflate); streaming applies at the tar layer.

Each yielded item carries a `_kind` discriminator:

```ts
for await (const item of parseUnityPackageStream(bytes)) {
  if (item._kind === 'entry') {
    // item is UnityPackageEntry & { _kind: 'entry' }
  } else {
    // item is UnityPackageParseDiagnostic & { _kind: 'diagnostic' }
  }
}
```

Options (`StreamParseOptions`) extend `ParseUnityPackageOptions` with:

| Option | Type | Description |
|--------|------|-------------|
| `onProgress` | `(ev: StreamParseProgressEvent) => void` | Called after each completed entry, rate-limited to ~62 events/second (~16 ms minimum interval). `ev.bytesTotal` is the full decompressed tar length (known after synchronous gzip decompression). |
| `maxOutputBytes` | `number` | Bomb guard: throw `DecompressionBombError` when total decompressed entry bytes exceed this limit. Default: 4 GiB. |
| `maxEntries` | `number` | Bomb guard: throw `DecompressionBombError` when the entry count exceeds this limit. Default: 250 000. |

`parseUnityPackageEntries` remains the buffered alternative and returns
`{ entries, diagnostics }` after consuming the full archive.

## Minimal meta generator

```ts
import { createMinimalMeta } from 'unitypackage-core';
```

`createMinimalMeta(guid)` returns a Unity-compatible minimal `.meta` YAML
string using the `DefaultImporter` shape. The caller is responsible for
encoding the returned text to UTF-8 bytes when persisting.

```ts
const meta = createMinimalMeta('006f7fc78b046e2408cecc07a80417b5');
// fileFormatVersion: 2
// guid: 006f7fc78b046e2408cecc07a80417b5
// DefaultImporter:
//   externalObjects: {}
//   userData:
//   assetBundleName:
//   assetBundleVariant:
```

Throws when `isValidGuid(guid)` is false; the error message names the
offending value. Does not parse YAML; emits a literal template string.
Browser-safe; no `node:*` imports.
