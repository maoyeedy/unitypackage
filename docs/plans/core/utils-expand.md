# Core Utils Expansion

## Context

`packages/core` today exposes a small surface: `parseUnityPackageEntries`,
`parseUnityPackage`, `createUnityPackage`, plus the diagnostic types. Several
format-level concerns from `docs/reference/format.md` are either implemented
privately inside the parser/creator or duplicated by downstream consumers
(`packages/cli`, `apps/web`). This plan lifts those concerns into shared,
browser-safe helpers so the CLI and the web workspace can build richer
features without re-implementing format rules.

This plan is a follow-on to:

- `docs/plans/core/done.md` (phases 0-1: parser diagnostics, preview.png
  surfacing, duplicate-GUID rejection on create).
- `docs/plans/core/diagnostics-expand.md` (5 new parse diagnostic codes:
  `duplicate-guid`, `asset-missing`, `meta-missing`, `zero-byte-asset`,
  `oversized-entry-name`). Treat that plan as a soft prerequisite -- the
  severity work in P5 here assumes the union has already been expanded
  with those codes.
- `docs/plans/web/pack-export.md` P1-P2 (deterministic creation,
  `estimateUnityPackageSize`, `tryCreateUnityPackage`,
  `CreateUnityPackageDiagnostic`). Several phases here cross-reference
  that surface.

Constraints carried forward:

- `packages/core` stays browser-safe. No `node:*`, no `fs`, no `path`,
  no `crypto` (use `globalThis.crypto`), no `os`, no `yaml` parser,
  no HTTP. Only runtime dep is `fflate`.
- `parseUnityPackageEntries` remains the GUID-aware primary surface.
  `parseUnityPackage` remains the flat alias.
- Asset and meta payloads stay byte-for-byte. No re-encoding of bytes.
- `apps/web` keeps `PackageFileRecord` with no `kind` field; the helpers
  here must not depend on or introduce one.
- 100-byte tar entry name limit holds. GUIDs remain 32 hex.

## Scope

**In:**

- 7 new exported surfaces in `packages/core`:
  - GUID utilities (`isValidGuid`, `generateGuid`, `guidFromPath`).
  - Path safety helpers (`validatePathname`, structured rejection result).
  - Pathname collision detection (`detectPathnameCollisions`).
  - Minimal meta YAML generator (`createMinimalMeta`).
  - Package summary helper (`summarizePackage`).
  - Diagnostic severity levels on both `UnityPackageParseDiagnostic`
    and `CreateUnityPackageDiagnostic`.
  - Configurable decompression bomb guard option on
    `parseUnityPackageEntries` / `parseUnityPackage`.
- Streaming parse API as a final phase, replacing the "fully buffered"
  caveat in `docs/reference/format.md`.

**Out:**

- Any new parse diagnostic codes beyond those in
  `docs/plans/core/diagnostics-expand.md`. That plan owns the union
  expansion.
- Deterministic creation ordering, size estimation, and
  `tryCreateUnityPackage`. `docs/plans/web/pack-export.md` P1-P2 owns
  those.
- `sanitizeFilename` relocation from `packages/cli/src/util/path.ts`.
  Stays CLI-only until the web app writes to OS via File System Access.
- Structural `diffPackages` as a core export. CLI `diff` command still
  owns this; not motivated for web yet.
- Cross-package merge helpers. Belongs in a future CLI plan if pursued.
- Any UI, recents, IndexedDB, or PWA work. `apps/web` plans own those.
- Unity YAML / `.meta` schema validation. `doctor` remains
  format-scoped per `CLAUDE.md`.

## Phases

| ID | Title | Goal | Depends on | Parallel with |
|----|-------|------|------------|---------------|
| P1 | GUID utilities | Export `isValidGuid`, `generateGuid`, `guidFromPath`. | -- | P2, P3, P4 |
| P2 | Path safety helpers | Export `validatePathname` with structured rejection. | -- | P1, P3, P4 |
| P3 | Pathname collision detection | Export `detectPathnameCollisions` over parsed entries. | P2 | P1, P4 |
| P4 | Minimal meta YAML generator | Export `createMinimalMeta(guid)`. | P1 | P2, P3 |
| P5 | Diagnostic severity levels | Add `severity` to parse and create diagnostic types. | diagnostics-expand.md, pack-export.md P2 | -- |
| P6 | Configurable decompression bomb guard | Surface `maxOutputBytes` option on parse APIs. | -- | P1-P5 |
| P7 | Streaming parse API | Iterator-based parse replacing buffered model. | P5, P6 | -- |

### P1 -- GUID utilities

**Goal:** centralize GUID validation, random GUID generation, and the
existing MD5-of-UTF16LE path GUID derivation as exported helpers.

**Files:** `packages/core/src/index.ts`, `packages/core/src/index.test.ts`,
`packages/core/README.md`.

**Surface:**

```ts
export function isValidGuid(value: string): boolean;
export function generateGuid(): string;
export function guidFromPath(pathname: string): string;
```

- `isValidGuid` matches `^[0-9a-f]{32}$` (lowercase, exact length).
  Document that Unity exports are lowercase 32-hex; the parser still
  preserves any archive prefix as `guid` per `format.md`.
- `generateGuid` uses `globalThis.crypto.getRandomValues(new Uint8Array(16))`
  then hex-encodes lowercase. Browser-safe; no `node:crypto` import.
- `guidFromPath` exposes the algorithm that `createUnityPackage` uses
  internally today (MD5 of the UTF-16LE pathname bytes). If the existing
  internal MD5 implementation is private, export it without changing its
  bytes. Two calls with the same input produce identical output.

**Exit criteria:**

```text
- All three helpers are exported from `unitypackage-core`.
- `generateGuid` returns 32-char lowercase hex; 1000 sequential calls produce no duplicates.
- `guidFromPath` is byte-equal to whatever `createUnityPackage` produces internally for the same pathname (regression test against a known-good fixture).
- `isValidGuid` accepts lowercase 32-hex and rejects 31/33-char, uppercase, non-hex, and empty.
- Browser-safety: no `node:*` imports; `packages/core` build still passes.
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-core build
```

---

### P2 -- Path safety helpers

**Goal:** expose the pathname rejection rules from `format.md` as a
structured validator usable by CLI extract and web pack inline editing.

**Files:** `packages/core/src/index.ts`, `packages/core/src/index.test.ts`,
`packages/core/README.md`.

**Surface:**

```ts
export type PathnameRejectionReason =
  | 'empty'
  | 'absolute'
  | 'drive-or-unc'
  | 'parent-traversal'
  | 'backslash'
  | 'control-character'
  | 'oversized-tar-entry';

export interface PathnameValidationResult {
  ok: boolean;
  reason?: PathnameRejectionReason;
  detail?: string;
}

export function validatePathname(
  pathname: string,
  options?: { guid?: string },
): PathnameValidationResult;
```

- Encodes the rejection rules listed under "Extraction security" in
  `format.md`: reject `..` segments, absolute paths, drive letters
  (`C:`), UNC prefixes (`\\`), backslashes, empty pathname, control
  characters.
- When `options.guid` is supplied, also validates that
  `<guid>/<pathname>.meta` fits within the 100-byte tar entry name
  budget (UTF-8). Emits `oversized-tar-entry` with the actual byte
  length in `detail` when over.
- Pure function. Does not throw.

**Exit criteria:**

```text
- `validatePathname` is exported and unit-tested against each `PathnameRejectionReason`.
- The 100-byte tar entry name check matches the existing internal check in `createUnityPackage` for the same input.
- The helper is consumed by no code yet in this phase; CLI and web wire it later (out of scope for this plan).
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-core build
```

---

### P3 -- Pathname collision detection

**Goal:** detect duplicate and case-colliding output paths across a set
of parsed entries, satisfying the "Detect duplicate/case-colliding output
paths" security requirement in `format.md`.

**Files:** `packages/core/src/index.ts`, `packages/core/src/index.test.ts`,
`packages/core/README.md`.

**Surface:**

```ts
export interface PathnameCollision {
  pathname: string;          // canonical (first-seen casing) pathname
  caseFolded: string;        // lower-cased pathname used for matching
  guids: string[];           // GUIDs of all entries that collide
  exactDuplicates: boolean;  // true when at least two entries share the exact pathname bytes
}

export function detectPathnameCollisions(
  entries: Pick<UnityPackageEntry, 'guid' | 'pathname'>[],
): PathnameCollision[];
```

- Groups by case-folded pathname (Unicode-aware lower-casing via
  `String.prototype.toLowerCase`; document that this matches typical
  Windows/macOS case-insensitive filesystem semantics, not the full
  Unicode casefold). Returns only groups with more than one entry.
- `exactDuplicates` is `true` when at least two entries share the same
  pathname bytes (not just case-folded equivalent). CLI / web can choose
  whether to warn vs error on each shape.
- Folder records (no asset payload) are included alongside files; the
  caller decides whether folder/file pathname overlap counts as a
  collision.

**Exit criteria:**

```text
- `detectPathnameCollisions` is exported with the documented shape.
- Unit tests cover: empty input, no collisions, exact-duplicate pair, case-only collision pair, three-way collision, mixed file + folder same-pathname.
- The helper is pure and does not depend on `node:*`.
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-core build
```

---

### P4 -- Minimal meta YAML generator

**Goal:** centralize the "loose asset gets a fallback `.meta`" generation
that `docs/plans/web/pack-export.md` P5 currently plans to inline in the
web app. Hosting it in core lets the CLI grow a `pack --auto-meta` flag
later without duplicating the template.

**Files:** `packages/core/src/index.ts`, `packages/core/src/index.test.ts`,
`packages/core/README.md`.

**Surface:**

```ts
export function createMinimalMeta(guid: string): string;
```

- Returns a Unity-compatible minimal `.meta` YAML text using the
  `DefaultImporter` shape documented in `docs/plans/web/pack-export.md`
  P5:

  ```yaml
  fileFormatVersion: 2
  guid: <guid>
  DefaultImporter:
    externalObjects: {}
    userData:
    assetBundleName:
    assetBundleVariant:
  ```
- Throws (or returns a clearly-documented sentinel; pick at
  implementation time) when `isValidGuid(guid)` is false. The error
  message names the offending value.
- Does not parse YAML; emits a literal template. Consistent with the
  "no `yaml` dep" constraint.
- Returns text; the caller encodes to bytes (UTF-8) when persisting.

**Exit criteria:**

```text
- `createMinimalMeta` is exported and produces byte-stable output for a given valid GUID across calls.
- Output starts with `fileFormatVersion: 2` and contains the supplied GUID on a `guid: ` line.
- Invalid GUIDs are rejected per `isValidGuid` from P1.
- `docs/plans/web/pack-export.md` P5 is updated (or noted in this plan's "Cross-plan updates" section below) to import `createMinimalMeta` instead of inlining the template.
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-core build
```

---

### P5 -- Diagnostic severity levels

**Goal:** add an explicit `severity` field to both parse-time and
create-time diagnostics so CLI `verify --strict`, CLI `doctor`, and the
web Diagnostics drawer can render or gate consistently without
re-deriving severity from the `code` string.

**Files:** `packages/core/src/index.ts`, `packages/core/src/index.test.ts`,
`packages/cli/src/commands.test.ts`,
`apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts`,
`packages/core/README.md`.

**Surface:**

```ts
export type UnityPackageDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface UnityPackageParseDiagnostic {
  code: UnityPackageParseDiagnosticCode;
  message: string;
  severity: UnityPackageDiagnosticSeverity;
  path?: string;
  guid?: string;
}

export interface CreateUnityPackageDiagnostic {
  code: CreateUnityPackageDiagnosticCode;
  message: string;
  severity: UnityPackageDiagnosticSeverity;
  guid?: string;
  path?: string;
}
```

- Severity defaults per code (initial mapping; revise during
  implementation if a code does not fit):

  | Code | Severity |
  |---|---|
  | `empty-pathname` | `error` |
  | `malformed-tar-entry` | `error` |
  | `non-standard-guid` | `info` |
  | `ignored-preview` | `info` |
  | `duplicate-guid` (parse) | `error` |
  | `asset-missing` | `warning` |
  | `meta-missing` | `warning` |
  | `zero-byte-asset` | `warning` |
  | `oversized-entry-name` (parse) | `warning` |
  | `duplicate-guid` (create) | `error` |
  | `missing-meta` (create) | `error` |
  | `oversized-pathname` (create) | `error` |
  | `empty-entries` (create) | `error` |
  | `invalid-guid` (create) | `error` |

- This phase is a refactor; no new codes are introduced here. It
  depends on `docs/plans/core/diagnostics-expand.md` having landed so
  the parse union is final, and on
  `docs/plans/web/pack-export.md` P2 having landed so the create union
  exists.
- Downstream wiring:
  - CLI `verify --strict` exits non-zero when any diagnostic has
    `severity === 'error'`. `verify` default exit behavior is
    unchanged.
  - CLI `doctor` keeps its existing format-scoped checks but groups
    output by severity.
  - `apps/web/src/packageModel.ts` exposes severity to the detail
    panel and the (future) Diagnostics drawer; UI styling is owned by
    `docs/plans/web/extract-enrich.md` P5.

**Exit criteria:**

```text
- `severity` is present and required on both diagnostic types in `packages/core`.
- Parse tests assert each known code emits the expected default severity.
- Create tests (from `pack-export.md` P2) assert each known code emits the expected default severity; new test cases added if needed.
- CLI `verify --strict` exits non-zero on `error`-severity diagnostics and zero otherwise; new test in `commands.test.ts`.
- `apps/web/src/packageModel.ts` carries severity through `getRecordDiagnostics`; existing tests are updated to include the field.
- No new diagnostic codes are introduced.
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bun run check
```

---

### P6 -- Package summary helper

**Goal:** provide a structured stats helper so CLI `inspect` and the web
sidebar `Stats` grid stop deriving the same counts independently.

**Files:** `packages/core/src/index.ts`, `packages/core/src/index.test.ts`,
`packages/core/README.md`.

**Surface:**

```ts
export interface UnityPackageSummary {
  entryCount: number;
  fileCount: number;            // entries with an `asset` payload
  folderCount: number;          // entries without an `asset` payload
  previewCount: number;         // entries with `preview` present
  uniqueGuidCount: number;
  duplicateGuidCount: number;   // total entries minus unique GUIDs
  totalAssetBytes: number;
  totalMetaBytes: number;
  totalPreviewBytes: number;
  byExtension: Array<{
    extension: string;          // lower-cased; '' for extensionless
    count: number;
    assetBytes: number;
  }>;
  diagnosticsBySeverity: Record<UnityPackageDiagnosticSeverity, number>;
}

export function summarizePackage(
  entries: UnityPackageEntry[],
  diagnostics?: UnityPackageParseDiagnostic[],
): UnityPackageSummary;
```

- Pure function. Stable ordering on `byExtension` (descending by `count`,
  ties broken by `extension` ascending).
- `diagnosticsBySeverity` is zeroed when `diagnostics` is omitted.
- Counts derive from the existing entry shape; no new fields on
  `UnityPackageEntry`.

**Exit criteria:**

```text
- `summarizePackage` is exported and unit-tested against a synthetic mixed-asset fixture.
- Counts agree with what `cli inspect --json` currently reports for the editor-packed fixture (verified via a temporary side-by-side run during implementation; not committed as a test against CLI output).
- `byExtension` ordering is stable and tested.
- Diagnostic severity counts respect the values introduced in P5.
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-core build
```

> Note: CLI and web adoption of `summarizePackage` is out of scope for
> this plan. Their consuming plans (a future CLI inspect enrichment, and
> `docs/plans/web/extract-enrich.md` P5 stats grid) opt in.

---

### P7 -- Configurable decompression bomb guard

**Goal:** surface the implicit "decompression bomb guard" listed in
`format.md` as a public, configurable option on the parse APIs so CLI
and web can pick limits appropriate to their environment.

**Files:** `packages/core/src/index.ts`, `packages/core/src/index.test.ts`,
`packages/core/README.md`.

**Surface:**

```ts
export interface ParseUnityPackageOptions {
  maxOutputBytes?: number;     // default: see below
  maxEntries?: number;         // default: see below
}

export function parseUnityPackageEntries(
  bytes: Uint8Array,
  options?: ParseUnityPackageOptions,
): { entries: UnityPackageEntry[]; diagnostics: UnityPackageParseDiagnostic[] };

export function parseUnityPackage(
  bytes: Uint8Array,
  options?: ParseUnityPackageOptions,
): { /* existing flat shape */ };
```

- Defaults: `maxOutputBytes = 4 * 1024 * 1024 * 1024` (4 GiB),
  `maxEntries = 250_000`. Pick precise values during implementation;
  document them in the README and call them out as security-relevant.
- When the limit is exceeded, the parser throws a descriptive error
  (e.g. `DecompressionBombError`) before allocating the rest of the
  output. The error carries `kind: 'output-bytes' | 'entry-count'` and
  the observed value at the trip point.
- Existing callers that omit options get the documented defaults; this
  is additive and backwards compatible.

**Exit criteria:**

```text
- `parseUnityPackageEntries` and `parseUnityPackage` accept `ParseUnityPackageOptions`.
- Defaults are documented in `packages/core/README.md` and exported as named constants for callers that want to inspect them (`DEFAULT_MAX_OUTPUT_BYTES`, `DEFAULT_MAX_ENTRIES`).
- Tests cover: under-limit parse succeeds, over-`maxOutputBytes` throws with `kind: 'output-bytes'`, over-`maxEntries` throws with `kind: 'entry-count'`.
- The editor-packed fixture continues to parse under the defaults.
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-tools test
- Run: bun run check
```

---

### P8 -- Streaming parse API

**Goal:** replace the "Archive model: Fully buffered (no streaming)" line
in `format.md` with an iterator-based parse so web and CLI can report
progress and free memory entry-by-entry on large packages.

**Files:** `packages/core/src/index.ts`, `packages/core/src/index.test.ts`,
`packages/core/README.md`, `docs/reference/format.md`.

**Surface:**

```ts
export interface StreamParseProgressEvent {
  bytesRead: number;
  bytesTotal: number;         // gzip-decompressed bytes when known; else 0
  entryCount: number;
}

export interface StreamParseOptions extends ParseUnityPackageOptions {
  onProgress?: (event: StreamParseProgressEvent) => void;
}

export function parseUnityPackageStream(
  bytes: Uint8Array,
  options?: StreamParseOptions,
): AsyncIterable<UnityPackageEntry | UnityPackageParseDiagnostic>;
```

- Yields a stream of records. Discriminate via a tag (e.g. a
  `_kind: 'entry' | 'diagnostic'` field) or by emitting two separate
  generators -- pick the cleaner shape at implementation time and
  document it.
- Gzip decompression remains synchronous through `fflate` for the
  first cut; chunked gzip is a future optimization. Streaming applies
  at the tar layer: parse one ustar block at a time and yield entries
  as they complete.
- `onProgress` fires after each completed entry, no more often than
  every ~16 ms (rate-limit inside the helper to keep main-thread
  callers cheap).
- Honors the `maxOutputBytes` / `maxEntries` guards from P7. The
  guards trip earlier in the stream than they would have under the
  buffered model.
- Buffered `parseUnityPackageEntries` remains exported. Internally it
  can be refactored to consume `parseUnityPackageStream` and collect
  the results, as long as observable output is unchanged. Whether to
  refactor is left to implementation.
- `docs/reference/format.md` is updated:
  - Remove or revise the "Archive model: Fully buffered (no
    streaming)" row in the Implementation table.
  - Add a one-line note documenting `parseUnityPackageStream` next to
    `parseUnityPackageEntries`.

**Exit criteria:**

```text
- `parseUnityPackageStream` is exported and produces the same entries as `parseUnityPackageEntries` for: empty fixture, minimal fixture, nested fixture, traversal fixture, truncated fixture (yields diagnostic before throwing where appropriate), and the editor-packed fixture.
- `onProgress` fires with monotonically non-decreasing `entryCount`; the rate-limit holds (no more than ~62 events per second).
- `maxOutputBytes` and `maxEntries` from P7 still trip; tested in the streaming path.
- Streaming yields the first entry before the entire tar payload has been walked (asserted by a test that consumes only the first iteration).
- `docs/reference/format.md` is updated; the "fully buffered" wording no longer appears as a hard constraint.
- No new runtime dependencies are added to `packages/core`.
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-core build
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run check
```

---

## Cross-plan updates

When P4 lands, update `docs/plans/web/pack-export.md` P5 so the loose-asset
meta template uses `createMinimalMeta` from core instead of an inline string.

When P7 lands, update `docs/plans/core/diagnostics-expand.md` if any of its
new codes interact with the new `maxOutputBytes` / `maxEntries` paths
(e.g. surfacing partial entry counts in the bomb-guard error).

When P8 lands, update `docs/plans/web/extract-enrich.md` P7 and
`docs/plans/web/workspace-polish.md` P3: both reference "streaming parse if
available". After P8, those references resolve to `parseUnityPackageStream`
and the conditional language can be removed.

## Critical files

- `packages/core/src/index.ts` -- all new exports.
- `packages/core/src/index.test.ts` -- unit coverage for each helper.
- `packages/core/README.md` -- document new surfaces.
- `docs/reference/format.md` -- updated by P8.
- `packages/cli/src/commands.test.ts` -- severity-aware exit test in P5.
- `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts` --
  severity propagation in P5.

## Verification

```sh
bun run --filter unitypackage-core test
bun run --filter unitypackage-core build
bun run --filter unitypackage-tools test
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web typecheck
bun run check
```

Manual smoke (after `bun run build`):

```sh
node packages/cli/dist/bin.js inspect "fixtures/static/editor-packed.unitypackage" --json
node packages/cli/dist/bin.js verify  "fixtures/static/editor-packed.unitypackage"
node packages/cli/dist/bin.js verify  "fixtures/static/editor-packed.unitypackage" --strict
node packages/cli/dist/bin.js doctor  "fixtures/static/editor-packed.unitypackage"
```

After P7: confirm `verify --strict` returns non-zero only when an
`error`-severity diagnostic is present and zero otherwise (the
editor-packed fixture should pass strict).

After P8: confirm `inspect` on the editor-packed fixture and on each
`fixtures/generated/*.unitypackage` continues to produce identical output
to the pre-streaming run.
