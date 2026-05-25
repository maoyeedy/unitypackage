# unitypackage-core

Browser-safe `.unitypackage` parser, writer, validator, and helper runtime.

`unitypackage-core` is the low-level package behind the CLI and web app. It
works with bytes and plain JavaScript data structures: no filesystem access, no
`node:*` imports, no browser DOM dependency, and no YAML dependency. The only
runtime dependency is `fflate` for gzip compression and decompression.

## Install

```sh
npm install unitypackage-core
```

The package publishes CommonJS, ESM, and TypeScript declarations from the root
entry point only:

```ts
import {
  parseUnityPackageEntries,
  createUnityPackage,
  summarizePackage,
} from 'unitypackage-core';
```

There are no public subpath exports. Treat internal files such as
`dist/parse.js` or `src/parse.ts` as implementation details.

## Runtime Requirements

- JavaScript runtimes must provide `Uint8Array`, `TextEncoder`, and
  `TextDecoder`.
- `generateGuid()` additionally requires `globalThis.crypto.getRandomValues`.
- The published package declares Node.js `>=24`.
- Core itself is browser-safe. It does not read files, write files, inspect the
  current OS, or perform network requests.

## What This Package Does

- Parse gzip-compressed Unity `.unitypackage` files.
- Return either flat pathname-to-bytes output or GUID-aware Unity entries.
- Surface structured diagnostics for malformed or unusual archive content.
- Expose `preview.png` thumbnail bytes on GUID-aware entries.
- Write deterministic `.unitypackage` bytes from validated entries.
- Estimate uncompressed tar size before writing.
- Generate random or deterministic GUIDs.
- Generate minimal Unity `.meta` YAML text.
- Detect importer type from a pathname.
- Inspect existing `.meta` bytes for GUIDs and declared importer blocks.
- Analyze entries for shared format issues.
- Convert GUID-aware entries into asset/meta/preview component records.
- Classify package paths by extension, MIME type, preview kind, and syntax
  language.
- Validate package pathnames for extraction safety.
- Detect case-folded pathname collisions.
- Resolve selected assets to their matching `.meta` sidecars.
- Summarize parsed package contents.

## Core Types

```ts
export type ExtractedFileContent = Record<string, Uint8Array>;

export interface UnityPackageEntry {
  guid: string;
  pathname: string;
  asset?: Uint8Array;
  meta?: Uint8Array;
  preview?: Uint8Array;
}

export type UnityPackageDiagnosticSeverity = 'info' | 'warning' | 'error';
```

A `.unitypackage` is a gzipped tar archive. Unity stores each logical asset in a
GUID-named directory with members such as `pathname`, `asset`, `asset.meta`, and
sometimes `preview.png`. `UnityPackageEntry` is the GUID-aware representation of
that logical record.

Entries without `asset` are treated as folder-like records by helpers such as
`summarizePackage`. Entries may still have `meta` bytes.

## Parsing

### GUID-Aware Parse

```ts
import { parseUnityPackageEntries } from 'unitypackage-core';

const { entries, diagnostics } = parseUnityPackageEntries(bytes);
```

`parseUnityPackageEntries(data, options?)` returns:

```ts
{
  entries: UnityPackageEntry[];
  diagnostics: UnityPackageParseDiagnostic[];
}
```

Behavior:

- Decompresses gzip synchronously with `fflate`.
- Parses the tar archive into Unity GUID groups.
- Reads the first trimmed line of each `pathname` member.
- Uses `asset.meta` as metadata, falling back to legacy `metaData`.
- Preserves the archive prefix as `entry.guid`; non-standard GUIDs are reported
  but not normalized.
- Exposes `preview.png` as `entry.preview`.
- Skips orphan GUID directories that do not contain a `pathname`.
- Keeps duplicate pathnames as separate GUID-aware entries.

Options:

```ts
interface ParseUnityPackageOptions {
  maxOutputBytes?: number;
  maxEntries?: number;
}
```

Defaults:

```ts
import {
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_OUTPUT_BYTES,
} from 'unitypackage-core';
```

- `DEFAULT_MAX_OUTPUT_BYTES` is `4 * 1024 * 1024 * 1024`.
- `DEFAULT_MAX_ENTRIES` is `250_000`.

If a limit is exceeded, parsing throws `DecompressionBombError`:

```ts
try {
  parseUnityPackageEntries(bytes, { maxOutputBytes: 50_000_000 });
} catch (error) {
  if (error instanceof DecompressionBombError) {
    console.log(error.kind);     // 'output-bytes' or 'entry-count'
    console.log(error.observed); // observed byte or entry count
  }
}
```

Malformed gzip data is thrown by the decompressor.

### Flat Parse

```ts
import { parseUnityPackage } from 'unitypackage-core';

const files = parseUnityPackage(bytes);
const scriptBytes = files['Assets/Scripts/Player.cs'];
const metaBytes = files['Assets/Scripts/Player.cs.meta'];
```

`parseUnityPackage(data, options?)` is a convenience wrapper around
`parseUnityPackageEntries`. It returns a pathname-to-bytes object:

- `entry.asset` is stored at `entry.pathname`.
- `entry.meta` is stored at `${entry.pathname}.meta`.
- `preview.png` is ignored in flat output.
- If duplicate pathnames occur, the later assignment wins in the returned
  object.
- Diagnostics are not returned. Use `parseUnityPackageEntries` when diagnostics
  matter.

### Streaming Parse

```ts
import { parseUnityPackageStream } from 'unitypackage-core';

for (const item of parseUnityPackageStream(bytes, {
  onProgress(event) {
    console.log(event.entryCount, event.bytesRead, event.bytesTotal);
  },
})) {
  if (item._kind === 'entry') {
    console.log(item.pathname);
  } else {
    console.warn(item.code, item.message);
  }
}
```

`parseUnityPackageStream(bytes, options?)` is a synchronous generator. It still
decompresses the full gzip payload synchronously, then streams at the tar layer
and yields items as GUID groups complete.

Yielded items are discriminated unions:

```ts
type StreamedEntry = UnityPackageEntry & { _kind: 'entry' };
type StreamedDiagnostic = UnityPackageParseDiagnostic & { _kind: 'diagnostic' };
```

`StreamParseOptions` extends `ParseUnityPackageOptions` with:

```ts
interface StreamParseOptions extends ParseUnityPackageOptions {
  onProgress?: (event: StreamParseProgressEvent) => void;
}

interface StreamParseProgressEvent {
  bytesRead: number;
  bytesTotal: number;
  entryCount: number;
}
```

Progress callbacks are synchronous, rate-limited to about one call every 16 ms,
and always receive a final event when parsing completes.

### Streamed Gzip Parse

```ts
import { parseUnityPackageStreamed } from 'unitypackage-core';

const { entries, diagnostics } = parseUnityPackageStreamed(bytes, {
  maxOutputBytes: 50_000_000,
  chunkSize: 64 * 1024,
});
```

`parseUnityPackageStreamed(data, options?)` uses fflate's streaming `Gunzip`
API while decompressing. It still returns the same `{ entries, diagnostics }`
shape as `parseUnityPackageEntries`, but `maxOutputBytes` is checked while gzip
output chunks are produced, before retaining the full decompressed tar buffer.

Options extend `ParseUnityPackageOptions` with:

```ts
{
  chunkSize?: number;
}
```

`chunkSize` controls how many compressed bytes are pushed into `Gunzip` per
step. The default is `64 * 1024`.

## Parse Diagnostics

```ts
interface UnityPackageParseDiagnostic {
  code: UnityPackageParseDiagnosticCode;
  message: string;
  severity: UnityPackageDiagnosticSeverity;
  path?: string;
  guid?: string;
}
```

| Code | Severity | Meaning |
| --- | --- | --- |
| `asset-missing` | `warning` | An entry has pathname and meta bytes but no `asset` member. |
| `duplicate-guid` | `error` | The same GUID pathname member appears more than once. |
| `empty-pathname` | `error` | A `pathname` member decoded to an empty string. |
| `entries-outside-guid-directory` | `warning` | A tar member is not inside a single GUID directory. |
| `ignored-preview` | `info` | `preview.png` exists. It is exposed on entries but ignored by flat parsing. |
| `invalid-tar-checksum` | `warning` | A tar member checksum does not match its header. |
| `malformed-tar-entry` | `error` | A tar member has an empty name, invalid size field, or truncated content. |
| `meta-missing` | `warning` | An entry has asset bytes but no `asset.meta` or `metaData`. |
| `non-standard-guid` | `info` | A record prefix is not 32 hexadecimal characters. |
| `oversized-entry-name` | `warning` | The decoded pathname is longer than 200 characters. |
| `unexpected-guid-directory-file` | `warning` | A GUID directory contains a member other than `pathname`, `asset`, `asset.meta`, `metaData`, or `preview.png`. |
| `unsupported-tar-typeflag` | `warning` | A tar member uses an unsupported typeflag and is skipped. |
| `zero-byte-asset` | `warning` | An `asset` member exists but has zero bytes. |

## Creating Packages

```ts
import { createUnityPackage, tryCreateUnityPackage } from 'unitypackage-core';

const bytes = createUnityPackage([
  {
    guid: '0123456789abcdef0123456789abcdef',
    pathname: 'Assets/Scripts/Player.cs',
    asset: new TextEncoder().encode('public class Player {}'),
    meta: new TextEncoder().encode('fileFormatVersion: 2\n'),
  },
]);
```

Creation input:

```ts
interface CreateUnityPackageEntry {
  guid: string;
  pathname: string;
  meta: Uint8Array;
  asset?: Uint8Array;
}

interface CreateUnityPackageOptions {
  gzipLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}
```

`createUnityPackage(entries, options?)` validates input, writes a tar archive,
gzips it, and returns `.unitypackage` bytes.

Writer behavior:

- Requires at least one entry.
- Requires a non-empty `meta` payload for every entry.
- Allows folder-like entries by omitting `asset`.
- Allows GUIDs that are exactly 32 hexadecimal characters, case-insensitive.
- Rejects duplicate GUIDs.
- Rejects pathnames longer than 200 characters.
- Rejects tar member names that exceed the 100-byte ustar name field.
- Sorts entries by GUID before writing.
- Fixes gzip `mtime` to epoch zero.
- Produces byte-identical output for identical logical input, independent of
  input entry order.

`tryCreateUnityPackage(entries, options?)` is the non-throwing variant:

```ts
const result = tryCreateUnityPackage(entries);

if (result.bytes === null) {
  for (const diagnostic of result.diagnostics) {
    console.error(diagnostic.code, diagnostic.message);
  }
} else {
  upload(result.bytes);
}
```

It collects all validation diagnostics before returning.

`createUnityPackage` wraps `tryCreateUnityPackage` and throws an `Error` with
the first diagnostic message when validation fails.

## Create Diagnostics

```ts
interface CreateUnityPackageDiagnostic {
  code: CreateUnityPackageDiagnosticCode;
  message: string;
  severity: UnityPackageDiagnosticSeverity;
  guid?: string;
  path?: string;
}
```

All create diagnostics currently have `error` severity.

| Code | Meaning |
| --- | --- |
| `duplicate-guid` | Two entries share the same GUID string. |
| `empty-entries` | The entry array is empty. |
| `invalid-guid` | A GUID is not exactly 32 hexadecimal characters. |
| `missing-meta` | `meta` is absent or zero-length. |
| `oversized-pathname` | A pathname exceeds 200 characters, or a tar member name exceeds 100 bytes. |

## Size Estimation

```ts
import { estimateUnityPackageSize } from 'unitypackage-core';

const { tarBytes, entryCount } = estimateUnityPackageSize(entries);
```

`estimateUnityPackageSize(entries)` returns the uncompressed tar byte size and
tar member count that `createUnityPackage` would produce for the same entries:

- Each entry always contributes `pathname` and `asset.meta`.
- Entries with `asset` also contribute `asset`.
- Two final zero blocks are included in `tarBytes`.
- Gzip size is not estimated.

## GUID Helpers

```ts
import { generateGuid, guidFromPath, isValidGuid } from 'unitypackage-core';
```

`isValidGuid(value)` returns `true` only for exactly 32 lowercase hexadecimal
characters:

```ts
isValidGuid('0123456789abcdef0123456789abcdef'); // true
isValidGuid('0123456789ABCDEF0123456789ABCDEF'); // false
```

`generateGuid()` returns a random 32-character lowercase hexadecimal GUID using
`globalThis.crypto.getRandomValues`.

`guidFromPath(pathname)` returns a deterministic lowercase 32-hex GUID derived
from MD5 of the pathname encoded as UTF-16LE. The same pathname always produces
the same GUID.

```ts
const guid = guidFromPath('Assets/Scripts/Player.cs');
```

## Pathname Helpers

```ts
import {
  assetPathForMetaSidecar,
  detectPathnameCollisions,
  isMetaSidecarPath,
  metaSidecarPathForAsset,
  validatePathname,
} from 'unitypackage-core';
```

Meta sidecar helpers operate directly on path strings and do not normalize or
validate input:

```ts
isMetaSidecarPath('Assets/Texture.png.meta');       // true
assetPathForMetaSidecar('Assets/Texture.png.meta'); // 'Assets/Texture.png'
assetPathForMetaSidecar('Assets/Texture.png');      // null
metaSidecarPathForAsset('Assets/Texture.png');      // 'Assets/Texture.png.meta'
```

`validatePathname(pathname, options?)` checks extraction-safety rules and never
throws:

```ts
const ok = validatePathname('Assets/Scripts/Foo.cs');
// { ok: true }

const bad = validatePathname('../secrets.txt');
// { ok: false, reason: 'parent-traversal' }
```

Rejection reasons:

| Reason | Meaning |
| --- | --- |
| `empty` | The pathname is empty. |
| `absolute` | The pathname starts with `/`. |
| `drive-or-unc` | The pathname starts with a Windows drive prefix like `C:` or a forward-slash UNC-like `//` prefix. |
| `parent-traversal` | Any `/`-delimited segment is exactly `..`. |
| `backslash` | The pathname contains `\`. |
| `control-character` | A character has code point below `0x20`; `detail` includes the index and code point. |
| `oversized-tar-entry` | With `options.guid`, `<guid>/asset.meta` exceeds the 100-byte ustar name limit. |

`detectPathnameCollisions(entries)` groups parsed entries by lower-cased
pathname and returns only groups with more than one entry:

```ts
const collisions = detectPathnameCollisions([
  { guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', pathname: 'Assets/Foo.cs' },
  { guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', pathname: 'Assets/FOO.CS' },
]);

// [
//   {
//     pathname: 'Assets/Foo.cs',
//     caseFolded: 'assets/foo.cs',
//     guids: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
//     exactDuplicates: false,
//   },
// ]
```

Collision detection includes both file entries and folder-like entries. It is a
reporting helper only; callers decide whether a given collision is fatal.

## Meta Generation

```ts
import {
  createMinimalFolderMeta,
  createMinimalMeta,
  createMinimalMetaFor,
  detectMetaImporterType,
} from 'unitypackage-core';
```

`createMinimalMeta(guid)` returns a minimal `DefaultImporter` `.meta` YAML
string. It validates with `isValidGuid`, so the GUID must be lowercase 32-hex.

```ts
const metaText = createMinimalMeta('0123456789abcdef0123456789abcdef');
const metaBytes = new TextEncoder().encode(metaText);
```

`detectMetaImporterType(pathname, isDir?)` returns:

```ts
type MetaImporterType =
  | 'DefaultImporter'
  | 'DefaultImporterFolder'
  | 'TextScriptImporter'
  | 'MonoImporter';
```

Importer detection rules:

| Condition | Result |
| --- | --- |
| `isDir === true` | `DefaultImporterFolder` |
| `.cs` extension | `MonoImporter` |
| `.json`, `.bytes`, `.csv`, `.pb`, `.txt`, `.xml`, `.proto`, `.md`, `.asmdef` | `TextScriptImporter` |
| Basename `LICENSE` with no extension | `TextScriptImporter` |
| `.yaml` or `.yml` | `DefaultImporter` |
| No extension, except `LICENSE` | `DefaultImporterFolder` |
| Any other extension | `DefaultImporter` |

`createMinimalMetaFor(guid, pathname, isDir?)` generates minimal `.meta` YAML
using `detectMetaImporterType`.

`createMinimalFolderMeta(guid)` generates folder metadata with
`folderAsset: yes`.

These helpers emit YAML text only. They do not parse existing YAML, merge
importer settings, or infer Unity asset semantics beyond the rules above.

## Meta Inspection

```ts
import {
  readDeclaredMetaImporter,
  readMetaGuid,
} from 'unitypackage-core';

const guid = readMetaGuid(metaBytes);
const importer = readDeclaredMetaImporter(metaBytes);
```

`readMetaGuid(meta)` line-scans existing `.meta` text and returns the first
`guid:` value as lowercase 32-hex, or `null` when no GUID line is found.

`readDeclaredMetaImporter(meta)` line-scans for a top-level Unity importer block
without using a YAML parser:

```ts
type DeclaredMetaImporter =
  | { kind: 'known'; type: MetaImporterType }
  | { kind: 'unknown'; name: string };
```

Known generated/importer types are `DefaultImporter`,
`DefaultImporterFolder`, `TextScriptImporter`, and `MonoImporter`.
`DefaultImporter` plus `folderAsset: yes` is reported as
`DefaultImporterFolder`.

Other Unity importers, such as `TextureImporter`, are returned as
`{ kind: 'unknown', name: 'TextureImporter' }`. Unknown importers are preserved
as facts about the existing metadata; core does not treat them as invalid.

## Entry Analysis

```ts
import { analyzeUnityPackageEntries } from 'unitypackage-core';

const analysis = analyzeUnityPackageEntries(entries, diagnostics);
```

`analyzeUnityPackageEntries(entries, parseDiagnostics?)` performs shared
format-level checks and returns stable findings plus severity counts:

```ts
interface UnityPackageAnalysisResult {
  findings: UnityPackageAnalysisFinding[];
  summary: {
    info: number;
    warning: number;
    error: number;
  };
}
```

Finding codes:

| Code | Meaning |
| --- | --- |
| `parser-diagnostic` | A parse diagnostic was passed through into analysis. |
| `unsafe-pathname` | `validatePathname` rejected the entry pathname. |
| `duplicate-pathname` | Two or more entries have the exact same pathname. |
| `case-colliding-pathname` | Two or more entries collide after case-folding. |
| `duplicate-guid` | The same GUID appears on more than one parsed entry. |
| `meta-guid-mismatch` | The archive GUID and `.meta` GUID disagree. |
| `meta-missing` | Asset bytes are present but meta bytes are missing. |
| `meta-importer-mismatch` | A known declared importer does not match the generated importer type expected for the pathname. |

The analyzer does not validate full Unity YAML schemas. Unknown declared
importers are not reported as mismatches.

## Component Records

```ts
import { entriesToComponentRecords } from 'unitypackage-core';

const records = entriesToComponentRecords(entries, diagnostics);
```

`entriesToComponentRecords(entries, diagnostics?)` converts GUID-aware entries
into one record per present component: `asset`, `meta`, and `preview`.

```ts
interface UnityPackageComponentRecord {
  id: string;
  guid: string;
  pathname: string;
  virtualPath: string;
  component: 'asset' | 'meta' | 'preview';
  content: Uint8Array;
  byteLength: number;
  extension: string;
  mimeType: string;
  previewKind: PreviewKind;
  syntaxLanguage: SyntaxLanguage;
  diagnostics: UnityPackageParseDiagnostic[];
  hasAsset: boolean;
  hasMeta: boolean;
  hasPreview: boolean;
  assetSize?: number;
  metaSize?: number;
  previewSize?: number;
  duplicatePathCount: number;
}
```

Virtual paths are:

- Asset component: `entry.pathname`
- Meta component: `${entry.pathname}.meta`
- Preview component: `${entry.pathname}.preview.png`

Diagnostics are routed to the component they describe. For example,
`meta-missing` attaches to the asset record, and `asset-missing` attaches to the
meta record.

## File Classification

```ts
import {
  getMimeTypeForPath,
  getPathExtension,
  getPreviewKindForPath,
  getSyntaxLanguageForPath,
  getUnityFileCategory,
} from 'unitypackage-core';
```

Classification helpers are extension-based and browser-safe:

- `getPathExtension(pathname)` returns a lowercase extension without the dot, or
  `''` for extensionless paths.
- `getUnityFileCategory(pathname)` returns `image`, `audio`, `video`, `pdf`,
  `code`, `unity-yaml`, `meta`, `document`, or `binary`.
- `getMimeTypeForPath(pathname)` returns a display/download MIME type.
- `getPreviewKindForPath(pathname, bytes?)` returns `text`, `image`, `pdf`,
  `audio`, `video`, or `unsupported`. When the extension is unknown, a small
  byte sample is used to detect likely UTF-8 text.
- `getSyntaxLanguageForPath(pathname)` returns the Shiki-oriented syntax
  language used by the web app.

## Sidecar Selection

```ts
import { resolveMetaSidecarSelection } from 'unitypackage-core';
```

Sidecar selection expands selected asset IDs with matching existing meta record
IDs:

```ts
const result = resolveMetaSidecarSelection(records, ['asset-1']);

// {
//   ids: ['asset-1', 'meta-1'],
//   explicitIds: ['asset-1'],
//   implicitMetaIds: ['meta-1'],
//   missingMetaForAssetIds: [],
// }
```

Input records:

```ts
type SidecarSelectableKind = 'asset' | 'meta' | 'preview';

interface SidecarSelectableRecord {
  id: string;
  guid: string;
  pathname: string;
  kind: SidecarSelectableKind;
}
```

Resolution behavior:

- Explicit selected IDs are deduplicated and kept first.
- Only selected `asset` records cause expansion.
- Selected `meta` records remain selected but do not expand anything.
- Selected `preview` records are ignored for expansion.
- The resolver first looks for a meta record with the same GUID and pathname
  equal to `${asset.pathname}.meta`.
- If no same-GUID meta exists, it falls back to the first meta record with the
  matching pathname.
- Missing sidecars are reported in `missingMetaForAssetIds`.
- The helper only selects existing records. It never creates `.meta` bytes.

## Package Summaries

```ts
import { summarizePackage } from 'unitypackage-core';

const summary = summarizePackage(entries, diagnostics);
```

`summarizePackage(entries, diagnostics?)` returns:

```ts
interface UnityPackageSummary {
  entryCount: number;
  fileCount: number;
  folderCount: number;
  previewCount: number;
  uniqueGuidCount: number;
  duplicateGuidCount: number;
  totalAssetBytes: number;
  totalMetaBytes: number;
  totalPreviewBytes: number;
  byExtension: {
    extension: string;
    count: number;
    assetBytes: number;
  }[];
  diagnosticsBySeverity: Record<UnityPackageDiagnosticSeverity, number>;
}
```

Summary rules:

- Entries with `asset !== undefined` count as files.
- Entries without `asset` count as folders.
- Extensions are lower-cased and do not include the leading dot.
- Extensionless pathnames use `''`.
- `byExtension` is sorted by count descending, then extension ascending.
- `diagnosticsBySeverity` is zeroed when diagnostics are omitted.

## Typical Workflows

### Inspect a Package

```ts
import {
  analyzeUnityPackageEntries,
  detectPathnameCollisions,
  parseUnityPackageEntries,
  summarizePackage,
} from 'unitypackage-core';

const { entries, diagnostics } = parseUnityPackageEntries(bytes);
const summary = summarizePackage(entries, diagnostics);
const collisions = detectPathnameCollisions(entries);
const analysis = analyzeUnityPackageEntries(entries, diagnostics);

console.log(
  summary.entryCount,
  diagnostics.length,
  collisions.length,
  analysis.summary.error,
);
```

### Repack Selected Entries

```ts
import {
  createUnityPackage,
  parseUnityPackageEntries,
} from 'unitypackage-core';

const { entries } = parseUnityPackageEntries(sourceBytes);

const selected = entries
  .filter(entry => entry.pathname.startsWith('Assets/Shaders/'))
  .map(entry => {
    if (entry.meta === undefined) {
      throw new Error(`Missing meta for ${entry.pathname}`);
    }

    return {
      guid: entry.guid,
      pathname: entry.pathname,
      asset: entry.asset,
      meta: entry.meta,
    };
  });

const packageBytes = createUnityPackage(selected);
```

### Create a New Entry from Raw Bytes

```ts
import {
  createMinimalMetaFor,
  createUnityPackage,
  generateGuid,
} from 'unitypackage-core';

const encoder = new TextEncoder();
const guid = generateGuid();
const pathname = 'Assets/Data/config.json';

const bytes = createUnityPackage([
  {
    guid,
    pathname,
    asset: encoder.encode('{"enabled":true}\n'),
    meta: encoder.encode(createMinimalMetaFor(guid, pathname)),
  },
]);
```

## API Surface

Runtime exports:

- `DEFAULT_MAX_ENTRIES`
- `DEFAULT_MAX_OUTPUT_BYTES`
- `DecompressionBombError`
- `assetPathForMetaSidecar`
- `analyzeUnityPackageEntries`
- `createMinimalFolderMeta`
- `createMinimalMeta`
- `createMinimalMetaFor`
- `createUnityPackage`
- `detectMetaImporterType`
- `detectPathnameCollisions`
- `entriesToComponentRecords`
- `estimateUnityPackageSize`
- `generateGuid`
- `getMimeTypeForPath`
- `getPathExtension`
- `getPreviewKindForPath`
- `getSyntaxLanguageForPath`
- `getUnityFileCategory`
- `guidFromPath`
- `isMetaSidecarPath`
- `isValidGuid`
- `metaSidecarPathForAsset`
- `parseUnityPackage`
- `parseUnityPackageEntries`
- `parseUnityPackageStream`
- `parseUnityPackageStreamed`
- `readDeclaredMetaImporter`
- `readMetaGuid`
- `resolveMetaSidecarSelection`
- `summarizePackage`
- `tryCreateUnityPackage`
- `validatePathname`

Type exports:

- `CreateUnityPackageDiagnostic`
- `CreateUnityPackageDiagnosticCode`
- `CreateUnityPackageEntry`
- `CreateUnityPackageOptions`
- `DeclaredMetaImporter`
- `ExtractedFileContent`
- `MetaImporterType`
- `ParseUnityPackageOptions`
- `PathnameCollision`
- `PathnameRejectionReason`
- `PathnameValidationResult`
- `PreviewKind`
- `ResolveMetaSidecarsResult`
- `SidecarSelectableKind`
- `SidecarSelectableRecord`
- `StreamParseItemKind`
- `StreamParseOptions`
- `StreamParseProgressEvent`
- `StreamedDiagnostic`
- `StreamedEntry`
- `SyntaxLanguage`
- `UnityFileCategory`
- `UnityPackageAnalysisFinding`
- `UnityPackageAnalysisFindingCode`
- `UnityPackageAnalysisResult`
- `UnityPackageAnalysisSummary`
- `UnityPackageComponentRecord`
- `UnityPackageDiagnosticSeverity`
- `UnityPackageEntriesResult`
- `UnityPackageEntry`
- `UnityPackageEntryComponent`
- `UnityPackageParseDiagnostic`
- `UnityPackageParseDiagnosticCode`
- `UnityPackageSummary`

`UnityPackageEntriesResult` is deprecated. Prefer the current
`{ entries, diagnostics }` return shape from `parseUnityPackageEntries`.

## Scope Boundaries

This package intentionally does not:

- Validate Unity YAML schemas.
- Resolve Unity asset references.
- Read or write local files.
- Preserve every non-standard tar header field.
- Create missing sidecar records during selection.
- Expose public subpath imports.

Use the CLI package when you need filesystem commands such as inspect, extract,
verify, doctor, or diff.
