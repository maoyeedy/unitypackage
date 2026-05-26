# core review followups

Follow-up fixes for `packages/core` surfaced by the `refactor/cli` code review.
Apply before `docs/plans/cli/review-followups.md` so the CLI plan can assume
the bomb guard is sound and the sidecar resolver behaves predictably.

## Context

The CLI review uncovered six issues that live in `packages/core`. The high
item is a real defense-in-depth gap: `parseUnityPackageEntries` advertises
`maxOutputBytes` as a decompression-bomb limit but actually allocates the
full decompressed buffer first and only sums valid entry bytes afterwards. A
gzip that expands to many GB of zero blocks (or to tar entries whose names
do not match `<guid>/...`) defeats the guard while still consuming the full
output buffer. The other items are smaller correctness, perf, and clarity
fixes that round out the surface.

## Scope

In:
- `parseUnityPackageEntries` enforcement of `maxOutputBytes`.
- GUID case handling in `tryCreateUnityPackage`.
- Sidecar fallback semantics in `resolveMetaSidecarSelection`.
- `subarray` vs `slice` in tar/gunzip hot paths.
- Folder vs file accounting in `summarizePackage.byExtension`.
- `DecompressionBombError.observed` doc clarity.

Out:
- Any change to `parseUnityPackageStream` (the generator variant) beyond
  routing it through bounded decompression -- behavior preservation only.
- New analyze findings or new diagnostic codes.
- Public API additions beyond what each phase calls out.

## Phases

| Phase | Title                                | Files                                        | Depends on |
|-------|--------------------------------------|----------------------------------------------|------------|
| P1    | Bounded gunzip in sync parse path    | `parse.ts`, `parse.test.ts`                  | --         |
| P2    | Normalize GUID case at create time   | `create.ts`, `create.test.ts`                | --         |
| P3    | Tighten sidecar pathname fallback    | `sidecar.ts`, `sidecar.test.ts`              | --         |
| P4    | subarray in tar/gunzip hot paths     | `parse.ts`                                   | P1         |
| P5    | Exclude folders from byExtension     | `summary.ts`, `summary.test.ts`              | --         |
| P6    | Document DecompressionBombError       | `parse.ts`                                   | --         |

Phases P1, P2, P3, P5, P6 are independent and can land in any order. P4 is a
mechanical sweep best done after P1 settles the bounded-decompression code.

### P1 -- Bounded gunzip in sync parse path

Goal: `parseUnityPackageEntries` (and `parseUnityPackageStream`) must refuse
to allocate a decompressed buffer larger than `maxOutputBytes`, regardless of
whether the bytes end up in valid Unity records.

Files:
- `packages/core/src/parse.ts`
- `packages/core/src/parse.test.ts`

Approach: route the sync entry points through the same bounded gunzip that
`parseUnityPackageStreamed` already uses. Extract the chunk-driven gunzip
loop into a private helper (`gunzipBounded(data, maxOutputBytes)`) that
returns the concatenated tar bytes or throws `DecompressionBombError`. Have
all three entry points call it. Keep the `mapUnityEntries` per-entry sum
check as a secondary guard (it still catches the rare case where the tar
holds valid entries that sum past the limit but the gzip stream did not).

Exit criteria:
- `parseUnityPackageEntries(bytes, { maxOutputBytes: N })` throws
  `DecompressionBombError` with `kind: 'output-bytes'` for a gzip whose
  decompressed payload is `> N` bytes of zero blocks (no valid entries).
- `parseUnityPackageStream(bytes, { maxOutputBytes: N })` does the same.
- Existing test cases for `parseUnityPackageStreamed` continue to pass.
- New parse.test.ts case: a synthetic gzip that expands to ~64 KiB of
  zeroes with `maxOutputBytes: 1024` throws before any tar work runs.
- No public type or signature change beyond making this guard real.

### P2 -- Normalize GUID case at create time

Goal: Make `tryCreateUnityPackage` produce packages whose `entry.guid`
survives a round-trip without case flips.

Files:
- `packages/core/src/create.ts`
- `packages/core/src/create.test.ts`

Background: `VALID_GUID_PATTERN` in create.ts is `/^[0-9a-fA-F]{32}$/`
(case-insensitive), but `readMetaGuid` lowercases and `analyzeUnityPackage`
compares against `entry.guid.toLowerCase()`. Creating with uppercase GUIDs
silently flips identity on reparse.

Approach: keep the lenient validation pattern, but lowercase every GUID
before it is written into the tar directory name (`${guid}/pathname`,
`${guid}/asset.meta`, `${guid}/asset`) and into the returned entry
identity. Optionally update `entry.guid` to lowercase in the sorted copy so
sort order is deterministic regardless of input case.

Exit criteria:
- A package created with `guid: 'ABCDEF...'` (uppercase 32-hex) parses back
  with `entry.guid === 'abcdef...'`.
- Round-trip test: `parseUnityPackageEntries(tryCreateUnityPackage([
  { guid: UPPER, ... } ]).bytes).entries[0].guid === UPPER.toLowerCase()`.
- `isValidGuid(entry.guid)` is `true` for every entry in a created package.
- Sort order on the tar archive is unchanged for inputs that were already
  lowercase.

### P3 -- Tighten sidecar pathname fallback

Goal: `resolveMetaSidecarSelection` must not attach a mismatched-GUID meta
to a selected asset just because the pathname matches.

Files:
- `packages/core/src/sidecar.ts`
- `packages/core/src/sidecar.test.ts`

Background: today, when no `(guid, pathname)`-matched meta exists, the
resolver falls back to `metaByPathname` -- which can return a meta from a
different GUID under the same pathname (a malformed package, but possible).
That meta becomes an implicit sidecar, attaching the wrong identity.

Approach: keep the pathname fallback only when exactly one meta record has
that pathname. If two or more candidates exist with different GUIDs and
none match the selected asset's GUID, do not pick one -- treat the asset as
missing its sidecar and add it to `missingMetaForAssetIds`.

Exit criteria:
- Existing tests in sidecar.test.ts still pass unchanged.
- New test: two meta records (`guid-a`, `guid-b`) share pathname
  `Assets/X.meta`; selecting `asset-c` (`guid-c`, `Assets/X`) produces
  `missingMetaForAssetIds: ['asset-c']` and empty `implicitMetaIds`.
- New test: single meta record with a different GUID under the asset's meta
  pathname is still attached (single-candidate fallback preserved).

### P4 -- subarray in tar/gunzip hot paths

Goal: Reduce GC pressure when parsing large packages by replacing
defensive copies with views where ownership is not required.

Files:
- `packages/core/src/parse.ts`

Approach: in `readTarMembers`, replace `data.slice(offset, offset +
BLOCK_SIZE)` with `data.subarray(...)` for header inspection (the function
already uses `data.slice(offset, offset + size)` for member content where
ownership matters -- leave that alone unless content is also confirmed
view-safe). In the bounded gunzip helper introduced by P1, push slices
into `gunzip.push` via `subarray` since fflate's `Gunzip` does not retain
the chunk buffer.

Exit criteria:
- No allocation in `readTarMembers` header inspection beyond the
  diagnostics it pushes.
- `parse.test.ts` and `parse.bench` (if present) unchanged in outputs.
- Quick smoke: parsing `fixtures/static/editor-packed.unitypackage` returns
  identical entries and diagnostics before and after the change.

### P5 -- Exclude folders from byExtension

Goal: `summarizePackage.byExtension` should reflect asset files, not lump
folder entries with extensionless files.

Files:
- `packages/core/src/summary.ts`
- `packages/core/src/summary.test.ts`

Approach: in the per-entry loop, skip the extension-map update when
`entry.asset === undefined` (folder entries). The `entryCount`,
`folderCount`, and `fileCount` totals stay where they are.

Exit criteria:
- A package with one folder entry (`Assets/Editor`, no asset) and one
  asset entry (`Assets/Editor/Tool.cs`) produces
  `byExtension: [{ extension: 'cs', count: 1, assetBytes: ... }]` -- no
  `{ extension: '', count: 1, assetBytes: 0 }` row.
- `folderCount` for the same package is still 1.
- Existing summary.test.ts cases either continue to pass or are updated
  with explicit folder-exclusion expectations.

### P6 -- Document DecompressionBombError

Goal: Make the post-increment semantics of `observed` explicit in the
docstring so callers do not have to read parse.ts to understand it.

Files:
- `packages/core/src/parse.ts`

Approach: add a TSDoc block above `DecompressionBombError` stating that
`observed` reports the cumulative value *after* the offending entry or
chunk -- i.e., `observed > limit` always holds, never `observed === limit`.
Mention the two `kind` values and what their `observed` numbers mean
(decompressed bytes for `output-bytes`; entry count for `entry-count`).

Exit criteria:
- TSDoc block present, builds clean, and is exported in the rolled-up
  `.d.ts` (sanity-check by running `bun run build`).
- No runtime behavior change; existing tests untouched.

## Verification

After each phase:

```
bun run --filter unitypackage-core test
bun run --filter unitypackage-core lint
bun run --filter unitypackage-core build
```

After all phases land:

```
bun run check
```

Manual smoke (CLI consumes core; the CLI plan exercises this further):

```
bun packages/cli/dist/bin.js inspect "fixtures/static/editor-packed.unitypackage" --json
bun packages/cli/dist/bin.js verify  "fixtures/static/editor-packed.unitypackage"
node scripts/fixtures-build.ts
```

## Cross-plan updates

- `docs/plans/cli/review-followups.md` assumes P1 is in place when it
  reuses the bomb guard for `verify` rather than re-decompressing.
- `docs/plans/cli/review-followups.md` assumes P2's lowercase normalization
  so the CLI does not need to re-lowercase user-supplied GUIDs in
  `pack.ts`.
