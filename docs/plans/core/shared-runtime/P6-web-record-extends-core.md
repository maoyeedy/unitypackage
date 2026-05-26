# P6 -- `PackageFileRecord` extends `UnityPackageComponentRecord`

## Goal

Stop hand-mapping `UnityPackageComponentRecord` to `PackageFileRecord`
field by field. Make `PackageFileRecord` an extension of the core record
plus the small set of web-specific fields, so adding a core field does not
require touching `apps/web/src/packageModel.ts`.

## Files

- `apps/web/src/packageModel.ts` -- change `PackageFileRecord` to
  `extends UnityPackageComponentRecord`; replace the hand-written
  `entriesToRecords` mapping with a thin spread + 3-field augment.
- `apps/web/src/packageModel.test.ts` -- adapt to the new record shape;
  assert that previously-mapped fields still resolve via the structural
  inheritance.
- `apps/web/src/App.tsx`, `apps/web/src/components/*.tsx` -- typecheck
  for any code that depended on the exact mapping. Most should "just work"
  since the field names are unchanged.

## Surface

No public `packages/core` API change. Web-only refactor.

- `PackageFileRecord` becomes structurally compatible with
  `UnityPackageComponentRecord` plus the web-specific extras
  (`fileName`, `isUnityPreview`, `findings`, `meta?`, `isRawImported?`,
  `isDirectory?`).
- `entriesToRecords` shrinks from ~25 lines to ~10 and never needs to
  enumerate core fields again.

### Specifics

1. New shape (illustrative):

   ```ts
   export interface PackageFileRecord extends UnityPackageComponentRecord {
     fileName: string;
     isUnityPreview: boolean;
     findings: UnityPackageAnalysisFinding[];
     meta?: Uint8Array;
     isRawImported?: boolean;
     isDirectory?: boolean;
   }
   ```

2. New `entriesToRecords`:

   ```ts
   export function entriesToRecords(
     entries: UnityPackageEntry[],
     diagnostics: UnityPackageParseDiagnostic[],
   ): PackageFileRecord[] {
     return entriesToComponentRecords(entries, diagnostics).map(record => ({
       ...record,
       fileName: record.virtualPath.split('/').pop() ?? record.virtualPath,
       isUnityPreview: record.component === 'preview',
       findings: [],
     }));
   }
   ```

3. `getRecordCategory` and `canStageRecordForPack` continue to operate on
   `PackageFileRecord` unchanged -- the fields they read (`extension`,
   `isUnityPreview`) are still present.

4. Verify components that previously relied on the explicit field set
   still compile -- in particular any code that read `record.component`
   directly (now inherited from `UnityPackageComponentRecord`) and any
   code that destructured `record.byteLength` (also inherited).

## Exit criteria

- `bun run check` passes.
- `cd apps/web && bunx playwright test` passes.
- `apps/web/src/packageModel.ts` `entriesToRecords` no longer enumerates
  every core field by hand; the body is one `entriesToComponentRecords(...)`
  call plus a small `.map(...)` augment.
- A grep for `byteLength: record.byteLength`, `extension: record.extension`,
  `mimeType: record.mimeType`, etc. in `packageModel.ts` returns no hits.
- Adding a hypothetical new field to `UnityPackageComponentRecord` surfaces
  on `PackageFileRecord` automatically (verify by adding a `__probe`
  field locally, checking it shows up on `PackageFileRecord`, then reverting).
