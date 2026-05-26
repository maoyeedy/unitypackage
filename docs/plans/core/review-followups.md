# core review followups

### P1 -- Bounded gunzip in sync parse path  [DONE 2026-05-26]

Shipped: extracted `gunzipBounded(data, maxOutputBytes)` private helper that
runs a chunk-driven `Gunzip` loop and throws `DecompressionBombError('output-bytes')`
before any tar work when the decompressed total exceeds the limit. All three
entry points (`parseUnityPackageEntries`, `parseUnityPackageStream`,
`parseUnityPackageStreamed`) now route through it. Tests cover a 64 KiB zero-block
bomb at a 1 KiB limit. See git log for implementation detail.

### P2 -- Normalize GUID case at create time  [DONE 2026-05-26]

Shipped: `tryCreateUnityPackage` now lowercases every GUID before writing it
into tar directory names and the returned entry identity; validation pattern
remains case-lenient. Sort comparator lowercases both sides for deterministic
ordering. Round-trip test added and green. See git log for implementation detail.

### P3 -- Tighten sidecar pathname fallback  [DONE 2026-05-26]

Shipped: `metaByPathname` changed from first-one-wins to collect-all; pathname
fallback now resolves only when exactly one candidate exists. Multiple candidates
with different GUIDs suppress the fallback and push the asset into
`missingMetaForAssetIds`. Two new tests cover the ambiguous and single-candidate
cases. See git log for implementation detail.

### P4 -- subarray in tar/gunzip hot paths  [DONE 2026-05-26]

Shipped: three `slice` -> `subarray` replacements in `parse.ts` -- header
inspection in `readTarMembers`, the `readTarString` sub-slice fed to
`TextDecoder`, and chunk pushes in `gunzipBounded`. Member content extraction
(`data.slice(offset, offset + size)`) left as an owned copy since it flows
into caller-owned entry fields. Smoke verified against editor-packed fixture.
See git log for implementation detail.

### P5 -- Exclude folders from byExtension  [DONE 2026-05-26]

Shipped: `summarizePackage` now skips the extension-map update for entries
where `entry.asset === undefined` (folder entries); `folderCount` and totals
are unaffected. Tests updated with explicit folder-exclusion expectations;
mixed-fixture integration test corrected to expect no empty-extension row.
See git log for implementation detail.

### P6 -- Document DecompressionBombError  [DONE 2026-05-26]

Shipped: TSDoc block added above `DecompressionBombError` documenting that
`observed > limit` always holds (post-increment semantics), and explaining
both `kind` values -- `'output-bytes'` reports cumulative decompressed bytes,
`'entry-count'` reports entry count at breach. Exported in `.d.ts`, build
clean, no runtime change. See git log for implementation detail.

## Cross-plan updates

- `docs/plans/cli/review-followups.md` assumes P1 is in place when it
  reuses the bomb guard for `verify` rather than re-decompressing.
- `docs/plans/cli/review-followups.md` assumes P2's lowercase normalization
  so the CLI does not need to re-lowercase user-supplied GUIDs in
  `pack.ts`.
