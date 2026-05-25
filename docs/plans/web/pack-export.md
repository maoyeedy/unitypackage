# Pack Mode Export and Enrichment

## Context

Pack mode in `apps/web` is a non-functional shell today: `<PackPanel>` renders a
literally `disabled` Export button labeled "Export .unitypackage", a yellow
"Export is prepared but blocked" status block, and `validatePackDraft` in
`apps/web/src/packageModel.ts` always returns `status: 'blocked'` with a
hard-coded "Unitypackage export is disabled until ..." message appended.
Staging from Extract works (records flow into `stagedRecordIds`), but nothing
downstream consumes them.

This plan turns Pack mode into a real browser-side `.unitypackage` author
tool. Core creation support is already available: deterministic output,
`estimateUnityPackageSize`, `tryCreateUnityPackage`, typed minimal meta
generation, and browser-safe validation helpers are exported from
`unitypackage-core`. The remaining work is web integration:

1. Wire a new `createPackage.worker.ts` into `apps/web` so the Export button
   enables when validation passes and produces a downloadable `.unitypackage`
   off the main thread.
2. Enrich the pack workflow: compression-level control, output filename,
   estimated size, per-record validation rows, raw OS-file drag-drop import
   with auto-generated meta sidecars, and draft persistence.

Constraints that must be preserved:

- `apps/web` is English-only.
- `PackageFileRecord` has no `kind` field; use `getRecordCategory`,
  `isUnityPreview`, and `extension === 'meta'`.
- Continue to consume the existing Extract selection / staging model
  (`stagedRecordIds`); do not introduce a parallel pack-only selection set.
- ZIP downloads remain Extract-mode behavior.
- 100-byte tar entry name limit applies. Entry names are
  `<guid>/pathname`, `<guid>/asset.meta`, `<guid>/asset`. GUID is 32 chars;
  budget for `pathname` content is tight.
- Existing `createUnityPackage(entries, options)` API shape must remain
  callable for current consumers; new diagnostics surface is additive.
- Use core helpers for all shared format logic: `tryCreateUnityPackage`,
  `estimateUnityPackageSize`, `createMinimalMetaFor`,
  `createMinimalFolderMeta`, `generateGuid`, and `validatePathname`.

Soft prerequisite: extract enrichment ships first. Pack mode benefits from
the richer staging UX but this plan is executable against the current code
if extract enrichment slips.

## Phases

| ID | Title | Goal | Parallel with | Depends on | Files | Subagent | Status |
|----|-------|------|---------------|------------|-------|----------|--------|
| P1 | Deterministic and sized creation | Stable GUID ordering, deterministic tar headers, and an `estimateUnityPackageSize` API. | P2 | - | `packages/core/src/create.ts`, `packages/core/src/tar.ts`, `packages/core/src/create.test.ts`, `packages/core/README.md` | worker | DONE 2026-05-25 |
| P2 | Structured creation diagnostics | Replace ad-hoc throws with a `CreateUnityPackageDiagnostic` surface; keep a throwing overload for legacy callers. | P1 | - | `packages/core/src/create.ts`, `packages/core/src/create.test.ts`, `packages/core/README.md` | worker | DONE 2026-05-25 |
| P3 | Pack worker and enabled export | Add `createPackage.worker.ts`, wire it into `App.tsx`, and enable the Export button when `validatePackDraft` succeeds. | - | core runtime | `apps/web/src/createPackage.worker.ts`, `apps/web/src/workerTypes.ts`, `apps/web/src/App.tsx`, `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts` | worker |
| P4 | Pack UX enrichment | Compression level, output filename, size estimate, per-record validation rows, success state, and inline creation diagnostics. | P5 | P3 | `apps/web/src/App.tsx`, `apps/web/src/App.css`, `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts` | worker |
| P5 | Raw file import and meta authoring | Drag-drop OS files into Pack mode, pair `<file>` + `<file>.meta`, auto-generate minimal meta for loose assets, fresh non-colliding GUIDs, inline `pathname` edit with byte-budget validation. | P4 | P3 | `apps/web/src/App.tsx`, `apps/web/src/App.css`, `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts`, `apps/web/tests/pack.spec.ts` | worker |
| P6 | Draft persistence and round-trip smoke | Persist pack draft (staged IDs + per-entry overrides) across reload and add an export -> re-parse round-trip spec. | - | P4, P5 | `apps/web/src/App.tsx`, `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts`, `apps/web/tests/pack.spec.ts` | worker |

### P1 - Deterministic and sized creation -- DONE 2026-05-25

Make `createUnityPackage` reproducible and addable to a size-aware UI without
allocating the full output.

- Sort entries by `guid` (ascending, lexicographic) before emitting tar
  blocks. The current insertion-order behavior is replaced; document the
  ordering guarantee in the core README.
- Set tar header fields deterministically where `fflate`'s tar emission
  allows: zero `mtime`, fixed `mode` (`0o644` for files), fixed `uid`/`gid`
  (`0`), fixed `uname`/`gname` (empty). Use the same gzip settings on every
  call for a given `gzipLevel`.
- Add `export function estimateUnityPackageSize(entries: CreateUnityPackageEntry[]): { tarBytes: number; entryCount: number }`
  that returns the uncompressed tar byte size (sum of per-entry header
  blocks plus padded body blocks plus the two trailing zero blocks) without
  allocating the tar buffer.
- Keep `createUnityPackage(entries, options)` signature compatible. The
  output is now deterministic for identical input.

Exit criteria
```text
- `createUnityPackage` emits entries sorted by GUID; two calls with the same input produce byte-equal output.
- Tar headers use deterministic timestamps, mode, uid/gid, and uname/gname.
- `estimateUnityPackageSize(entries)` is exported from `packages/core` and matches the actual tar byte length produced by `createUnityPackage` for the same input.
- New tests in `packages/core/src/create.test.ts` cover: byte-equality across two identical calls, GUID-order independence (shuffled input yields the same bytes), and estimate-vs-actual byte equality for both asset and asset-less entries.
- `packages/core/README.md` documents deterministic ordering and `estimateUnityPackageSize`.
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-core build
```

### P2 - Structured creation diagnostics -- DONE 2026-05-25

Replace the ad-hoc `throw new Error('Duplicate GUID ...')` flow with a
structured surface that mirrors `UnityPackageParseDiagnostic`.

- Introduce:
  ```ts
  export type CreateUnityPackageDiagnosticCode =
    | 'duplicate-guid'
    | 'missing-meta'
    | 'oversized-pathname'
    | 'empty-entries'
    | 'invalid-guid';

  export interface CreateUnityPackageDiagnostic {
    code: CreateUnityPackageDiagnosticCode;
    message: string;
    guid?: string;
    path?: string;
  }
  ```
- Add a non-throwing entry point. Preferred shape:
  ```ts
  export function tryCreateUnityPackage(
    entries: CreateUnityPackageEntry[],
    options?: CreateUnityPackageOptions,
  ): { bytes: Uint8Array; diagnostics: CreateUnityPackageDiagnostic[] } | { bytes: null; diagnostics: CreateUnityPackageDiagnostic[] };
  ```
  When any diagnostic has a fatal code (`duplicate-guid`, `missing-meta`,
  `oversized-pathname`, `empty-entries`, `invalid-guid`), return
  `{ bytes: null, diagnostics }`. Non-fatal codes can be added later
  without a breaking change.
- Keep the existing `createUnityPackage` overload throwing on the same fatal
  conditions so existing CLI/test callers do not break. Implement it on top
  of `tryCreateUnityPackage` (throw the first fatal diagnostic).
- `oversized-pathname` triggers when `<guid>/<pathname>.meta` or
  `<guid>/<pathname>` exceeds 100 bytes (UTF-8) for any tar header in the
  output.

Exit criteria
```text
- `CreateUnityPackageDiagnostic`, `CreateUnityPackageDiagnosticCode`, and `tryCreateUnityPackage` are exported from `packages/core`.
- Tests cover duplicate GUID, missing meta, empty entries, invalid GUID (non-32-hex), and oversized pathname (>100-byte tar entry name) — each produces the expected diagnostic and `bytes: null`.
- The legacy `createUnityPackage` throw path still throws for the same fatal cases and continues to satisfy existing CLI and core tests.
- `packages/core/README.md` documents `tryCreateUnityPackage` and the diagnostic codes.
- `bun run check` passes; CLI and web typecheck against the additive API.
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-core build
- Run: bun run check
```

### P3 - Pack worker and enabled export

Wire the core creation API into a worker and turn on the Export button.

- Add `apps/web/src/createPackage.worker.ts` that:
  - Accepts a list of staged `PackageFileRecord` values plus
    `{ gzipLevel?: number; filename?: string }`.
  - Derives `CreateUnityPackageEntry[]` by pulling `meta` from the record
    whose `extension === 'meta'` shares the same `guid` as a staged asset
    (the staged set may include or omit the sidecar; the worker must
    locate it). For records that originate from raw-file import (P5),
    `meta` is supplied directly on the staged record.
  - Calls `tryCreateUnityPackage` from `packages/core`.
  - Posts back `{ type: 'success'; bytes: Uint8Array; filename: string }`
    or `{ type: 'error'; diagnostics: CreateUnityPackageDiagnostic[] }`.
- Extend `apps/web/src/workerTypes.ts` with the request/response types.
- In `App.tsx`:
  - Remove the literal `disabled` on the Export button. Bind it to
    `validation.status === 'ready'` and `!packing`.
  - Add a small worker manager (mirror the pattern of
    `downloadZip.worker.ts`) that posts a request, sets `packing`, and on
    success builds a `Blob` (`application/octet-stream`) and triggers a
    download via an `<a download>` element.
  - On error, render the structured diagnostics in `PackPanel` (see P4).
- In `packageModel.ts`:
  - Remove the hard-coded "Unitypackage export is disabled until ..."
    message from `validatePackDraft`.
  - Build pack candidates by pairing asset records with same-GUID meta records
    from the full `records` set, not only from `stagedRecordIds`.
  - Use `validatePathname(pathname, { guid })` for pathname safety and tar
    entry budget checks before the worker runs.
  - Return `status: 'ready'` when `messages.length === 0` and there is at
    least one stageable asset; `'blocked'` otherwise.
  - Continue covering: empty selection, no asset records, missing meta
    per asset, duplicate GUIDs across staged assets, preview record
    staging.

Exit criteria
```text
- `apps/web/src/createPackage.worker.ts` exists, accepts staged records, and posts back bytes or diagnostics.
- `apps/web/src/workerTypes.ts` exports `CreatePackageRequest` and `CreatePackageResponse`.
- `App.tsx` Export button is enabled when `validatePackDraft` returns `status: 'ready'`, runs the worker, and triggers a browser download of the resulting `.unitypackage`.
- The "Export is prepared but blocked" status block is removed.
- The "Unitypackage export is disabled until ..." string is removed from `validatePackDraft`; `validatePackDraft` returns `'ready'` when no fatal conditions are present.
- `packageModel.test.ts` has new cases asserting `'ready'` for valid drafts and `'blocked'` for each failure mode (empty, missing meta, dup GUID, preview-only).
- Staging continues to consume `stagedRecordIds`; no second selection model is introduced.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
- Run: bun run --filter @unitypackage-tools/web build
```

### P4 - Pack UX enrichment

Make `PackPanel` a real authoring surface.

- Compression: a select bound to `CreateUnityPackageOptions.gzipLevel`
  with options `0, 1, 3, 6, 9` (default `6`). Label clearly: "Fastest"
  through "Smallest".
- Output filename: a text input with a sensible default
  (`unitypackage-<YYYYMMDD-HHMM>.unitypackage`). Validate non-empty and
  append `.unitypackage` if missing.
- Estimated output size: call `estimateUnityPackageSize(entries)` from P1
  whenever the staged set or overrides change, render via `formatBytes`.
  Render a soft warning when uncompressed tar size exceeds 1 GiB.
- Per-record validation rows: replace the flat
  `<ul className="validation-list">` with a per-record list that groups
  validation messages under the offending record id. Each row keeps the
  existing `Remove` button. Surface per-record codes: `missing-meta`,
  `duplicate-guid`, `oversized-pathname` (the latter requires P5 input
  but should already render when present).
- Success state: after a successful export, render a success block with
  the resolved filename, byte size, and a `Download again` button that
  re-saves the same blob without re-running the worker. Cleared when the
  staged set changes.
- Creation diagnostics: when the worker returns
  `{ type: 'error'; diagnostics }`, render each diagnostic inline with
  its `code` and `message`, plus a "Show in list" affordance that scrolls
  to / highlights the offending record when `guid` or `path` resolve to a
  staged record.
- Ordering: rely on stable GUID ordering from P1. Document next to the
  list: "Entries are written in deterministic GUID order." Do not add a
  manual reorder affordance.

Exit criteria
```text
- `PackPanel` renders compression-level select, filename input, estimated size, per-record validation rows, and a success block.
- `validatePackDraft` returns per-record diagnostic objects (not just flat messages); existing tests are updated to match, plus new cases for `oversized-pathname`.
- The success block re-downloads the same bytes without re-running the worker.
- Creation diagnostics returned from the worker render inline in `PackPanel`.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
- Run: bun run --filter @unitypackage-tools/web build
```

### P5 - Raw file import and meta authoring

Let users build a package from local files, not just from staged
Extract records.

> **Core runtime note -- current:**
> Generated metas must use `createMinimalMetaFor(guid, pathname, isDir?)`
> so `.cs`, `.json`, `.txt`, `LICENSE`, `.yaml`, and folder entries receive
> the correct importer block. Use `createMinimalFolderMeta(guid)` for explicit
> folder entries. Do not use legacy `createMinimalMeta(guid)` for loose file
> import except in tests that intentionally verify old DefaultImporter output.
> Example:
> ```ts
> import { createMinimalMetaFor, generateGuid } from 'unitypackage-core';
> const meta = new TextEncoder().encode(createMinimalMetaFor(freshGuid, pathname));
> ```

- Drag-drop target on `PackPanel`'s staged list area. Accept `DataTransfer`
  files; if a folder is dropped, walk it via `webkitGetAsEntry` /
  `FileSystemDirectoryHandle` where available, otherwise accept top-level
  files only.
- Sidecar pairing: for each pair where one file is `<X>` and another is
  `<X>.meta`, stage a single asset entry with both. For loose `<X>` with
  no sidecar, auto-generate a minimal Unity meta YAML using
  `createMinimalMetaFor(guid, pathname)` from `unitypackage-core` (see note
  above). Document that this is a minimal fallback and preserves core's
  extension-to-importer mapping, not Unity's full importer defaults.
- GUID generation: produce fresh 32-hex GUIDs via `generateGuid()` from
  `unitypackage-core` (which uses `globalThis.crypto.getRandomValues`).
  Reject any GUID that collides with already-staged entries; retry up to 4
  times before surfacing an error.
- Pathname editing: each raw-imported record gets an inline editable
  `pathname` (default: the dropped file's relative path with backslashes
  normalized to `/`). Validate on every change with
  `validatePathname(pathname, { guid })` and surface the
  `oversized-pathname` validation row from P4 when relevant.
- Storage: raw-imported records live in a separate `importedRecords`
  state alongside `stagedRecordIds`; they are merged into the worker
  request payload. They are not added to the parsed `records` set.

Exit criteria
```text
- Dropping a `<file>` + `<file>.meta` pair stages one entry with both halves.
- Dropping a loose `<file>` stages an entry with `createMinimalMetaFor` output and a fresh non-colliding 32-hex GUID.
- Inline `pathname` editing rejects values that would exceed the 100-byte tar entry name budget; the offending record renders `oversized-pathname` until corrected.
- New `packageModel.test.ts` cases cover: pair detection, loose-file meta generation shape, GUID collision retry, and pathname byte-budget validation.
- A new `apps/web/tests/pack.spec.ts` Playwright spec drags a fixture file into Pack mode, edits its pathname, and exports successfully.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
- Run: bun run --filter @unitypackage-tools/web build
- Run: cd apps/web && bunx playwright test pack.spec.ts
```

### P6 - Draft persistence and round-trip smoke

Persist a draft across reloads and prove the export round-trips through
the parser.

- Persist to `localStorage` under key `unitypackage:pack-draft:v1`:
  - The set of staged record ids (only meaningful if the same parsed
    package is re-loaded; tolerate missing ids on rehydration).
  - The list of raw-imported records (pathname, guid, meta bytes,
    asset bytes) base64-encoded.
  - Per-entry overrides: edited pathnames, compression level, output
    filename.
- On load: rehydrate; drop any staged ids that do not resolve in the
  current parsed records; keep imported records as-is.
- Add a `Clear draft` button next to the existing Clear control that
  also wipes the persisted draft.
- Round-trip smoke (unit): build a `CreateUnityPackageEntry[]` from
  fixture-derived records, call `createUnityPackage`, then
  `parseUnityPackageEntries` on the result, and assert each input
  appears with matching `guid`, `pathname`, and asset byte equality.
- Round-trip smoke (Playwright): in `apps/web/tests/pack.spec.ts`, load
  `fixtures/static/editor-packed.unitypackage`, stage at least 2
  records, export, and confirm the success block shows. Where the test
  framework allows, intercept the download blob and re-parse it via a
  helper page route or by calling `parseUnityPackageEntries` from the
  page context to verify the round trip.

Exit criteria
```text
- Reloading the page restores the staged ids (for the same package), raw-imported records, compression level, and filename input.
- `Clear draft` removes the persisted entry.
- A new `packageModel.test.ts` case round-trips a small entry set through `createUnityPackage` + `parseUnityPackageEntries` and asserts guid, pathname, and asset byte equality.
- `apps/web/tests/pack.spec.ts` covers the export flow end to end against the editor-packed fixture.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter unitypackage-core test
- Run: cd apps/web && bunx playwright test pack.spec.ts
- Run: bun run check
```

## Verification

```sh
bun run --filter unitypackage-core test
bun run --filter unitypackage-core build
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web typecheck
bunx eslint apps/web/src
bun run --filter @unitypackage-tools/web build
bun run check
```

Playwright (after `bun run build`):

```sh
cd apps/web && bunx playwright test
```

Manual smoke:
- Load `fixtures/static/editor-packed.unitypackage` in the web app, stage 3-5 records from Extract via `Stage for pack`, switch to Pack mode, and confirm the Export button is enabled.
- Export to `out.unitypackage`. Run `node packages/cli/dist/bin.js verify out.unitypackage` and `node packages/cli/dist/bin.js inspect out.unitypackage --json`; both must succeed and `inspect` output must include every staged asset.
- Export the same staged selection twice to `a.unitypackage` and `b.unitypackage` and confirm the files are byte-equal (`cmp a.unitypackage b.unitypackage` or equivalent).
- Confirm the estimated size shown in `PackPanel` matches the actual uncompressed tar size produced by the core API (within rounding for the gzipped output displayed elsewhere).
- Drag a loose `.png` from the OS into Pack mode; confirm a minimal meta sidecar is auto-generated, a fresh non-colliding GUID appears, and export produces a package that `verify` accepts.
- Edit a raw-imported record's `pathname` to exceed the 100-byte budget; confirm the `oversized-pathname` row appears and the Export button disables until corrected.
- Reload the page with a non-empty pack draft and confirm staged ids, imported records, compression level, and filename input are restored.
- After a successful export, confirm `Download again` re-saves the same bytes without re-running the worker.
