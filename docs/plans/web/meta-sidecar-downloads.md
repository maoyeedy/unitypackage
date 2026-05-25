# Web Meta Sidecar Downloads

## Context

The web app currently parses package entries into `PackageFileRecord` rows and
shows asset rows, `.meta` rows, and preview rows together in the middle pane.
`Selected ZIP` and `All ZIP` use `downloadZip.worker.ts`, which receives
records plus optional selected IDs and writes those records directly into the
ZIP. The preview pane has one download icon that currently saves the active
record as a raw file.

Users often want assets and metas together, but they do not need extra buttons
for every download action. The right behavior is one low-friction setting that
changes the existing downloads.

Core prerequisite is already available: `resolveMetaSidecarSelection` is
exported from `unitypackage-core`. The web record model now derives from core
component records, but `PackageFileRecord` still has no `kind` field.

## Scope

In:

- One default-off Extract setting in the existing sidebar.
- Hide `.meta` records from the middle explorer when the setting is on.
- Expand selected asset downloads through `resolveMetaSidecarSelection`.
- Keep existing `Selected ZIP`, `All ZIP`, and preview download controls.
- Unit and Playwright coverage for hidden metas and ZIP contents.

Out:

- No new download buttons.
- No Pack mode changes.
- No `.meta` generation.
- No change to package parsing or `PackageFileRecord` shape. Use a small
  adapter helper for the sidecar resolver.

## UX Contract

Add one checkbox near the existing "Preserve folders in ZIP downloads" setting:

```text
Include .meta with assets
```

Default: off.

When off:

- Current behavior remains unchanged.
- `.meta` rows are visible in the middle explorer.
- Selected ZIP includes exactly selected records.

When on:

- `.meta` rows are hidden from the middle explorer list.
- The visible record count and selected count count visible rows only.
- Folder selection, extension grouping, drag-sweep, and range selection operate
  only on visible rows.
- The metadata pane still shows GUID, meta byte count, and related metadata for
  the active asset. Users do not need to see a separate row to know the meta
  will be included.
- No extra `+meta`, "Download with meta", or alternate export button appears.

## Phases

| ID | Title | Goal | Depends on | Files |
|----|-------|------|------------|-------|
| P1 | Visible records model | Split internal records from visible explorer records when metas are hidden. | core runtime | `apps/web/src/App.tsx`, `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts` |
| P2 | ZIP selection expansion | Reuse existing ZIP buttons while adding implicit sidecars. | P1 | `apps/web/src/App.tsx`, `apps/web/src/downloadZip.worker.ts`, `apps/web/src/workerTypes.ts`, `apps/web/src/packageModel.test.ts` |
| P3 | Preview download behavior | Keep one preview download icon; save asset+meta ZIP only when needed. | P2 | `apps/web/src/App.tsx`, `apps/web/src/packageModel.ts` |
| P4 | Tests and polish | Cover UX and ZIP contents without adding controls. | P1-P3 | `apps/web/tests/explorer.spec.ts`, `apps/web/tests/smoke.spec.ts`, `apps/web/src/App.css` |

### P1 -- Visible records model

Add app state:

```ts
const [includeMetaSidecars, setIncludeMetaSidecars] = useState(false);
```

Use two record lists:

- `records`: all parsed records, unchanged.
- `visibleRecords`: filtered records with `extension === 'meta'` removed when
  `includeMetaSidecars` is true.

Wire `visibleRecords` into:

- `buildExtensionGroups`
- `buildTreeRows`
- `getTreeFileRecordIds`
- `getExtensionFileRecordIds`
- `Explorer`
- visible count text
- selection helpers and selection count

Keep `records` for:

- active record lookup fallback
- ZIP worker input
- metadata sibling lookup
- Stats totals unless explicitly displaying visible count

When the setting turns on:

- Remove hidden meta IDs from `selectedRecordIds`.
- If `activeRecordId` points at a hidden meta row, switch to the same-GUID asset
  record if present; otherwise choose the first visible record.

Exit criteria:

```text
- One sidebar checkbox controls `includeMetaSidecars`.
- When enabled, `.meta` rows do not render in tree or extension views.
- Selection counts ignore hidden meta records.
- Metadata pane for an asset still reports `Meta bytes` and `GUID`.
- Existing selection and preview tests pass with setting off.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
```

### P2 -- ZIP selection expansion

Adapt records to the core resolver using current web fields:

- `id`: `record.id`
- `guid`: `record.guid`
- `pathname`: `record.virtualPath`
- `kind`: `getRecordCategory(record)`

Put this adapter in `packageModel.ts` as a pure helper, for example
`toSidecarSelectableRecords(records)`. Do not add `kind` to
`PackageFileRecord`; the adapter is the only place that produces the
`SidecarSelectableRecord` shape.

Selected ZIP:

- If `includeMetaSidecars` is false, keep current call:
  `handleDownload(records, 'selected_files.zip', [...selectedRecordIds])`.
- If true, call `resolveMetaSidecarSelection(recordsAdapter, [...selectedRecordIds])`
  and pass `result.ids` to the existing ZIP path.
- If `result.missingMetaForAssetIds.length > 0`, set a status-bar warning after
  the ZIP is created. Do not block the download.

All ZIP:

- Keep the existing `All ZIP` button.
- With the setting on, all metas are still included because `records` is passed
  to the worker. Do not filter to `visibleRecords`.

Worker:

- Prefer leaving `downloadZip.worker.ts` mostly unchanged. It already zips the
  records whose IDs are provided. Only adjust `DownloadZipRequest` if the
  implementation needs a warning payload or better typing.

Exit criteria:

```text
- `Selected ZIP` uses the same button and includes implicit sidecars only when the setting is on.
- `All ZIP` continues to include all package records, including metas, even when metas are hidden.
- No duplicate ZIP entries are produced when a meta was selected before toggling or through another path.
- Missing sidecars create a non-blocking warning.
- `packageModel.test.ts` covers `toSidecarSelectableRecords` and the resolver path with asset, meta, and preview records.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
```

### P3 -- Preview download behavior

Keep the preview header's existing single icon button.

Behavior:

- If the active record is not an asset, keep current raw-file download.
- If `includeMetaSidecars` is false, keep current raw-file download.
- If active record is an asset and the setting is true:
  - Resolve that one asset through `resolveMetaSidecarSelection`.
  - If a meta exists, create a small ZIP named after the asset file, for
    example `texture_02.png.zip`, containing the asset and sidecar.
  - If no meta exists, download the raw asset and show a status-bar warning.

Do not add a second button or a dropdown. The setting defines the behavior.

Exit criteria:

```text
- The preview download icon remains the only active-record download control.
- Asset preview download creates asset+meta ZIP only when `includeMetaSidecars` is on and the sidecar exists.
- Non-asset preview downloads are unchanged.
- Missing sidecar falls back to raw asset download with a warning.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
```

### P4 -- Tests and polish

Unit tests:

- `packageModel.test.ts` covers the adapter/helper that derives sidecar
  selectable records from `PackageFileRecord`.
- Selection pruning keeps asset IDs and removes hidden meta IDs.
- Active-record fallback chooses the same-GUID asset when hiding a meta row.

Playwright tests:

- Setting off: `.meta` rows are visible and selected ZIP is unchanged.
- Setting on: `.meta` rows disappear from tree and extension grouping.
- Select two assets, click `Selected ZIP`, and assert the download ZIP contains
  two assets plus two metas.
- Active asset preview download with the setting on saves a ZIP containing the
  asset plus meta.

Visual polish:

- The checkbox sits with the existing ZIP folder toggle in the sidebar.
- Label remains short: `Include .meta with assets`.
- No extra toolbar buttons are added.

Exit criteria:

```text
- Playwright covers the primary sidecar download paths.
- The Extract toolbar still has the same buttons: Clear selection, Stage for pack, Selected ZIP, All ZIP.
- Text fits in the sidebar at current desktop and mobile breakpoints.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
- Run: bun run --filter @unitypackage-tools/web build
```

## Verification

```sh
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web typecheck
bunx eslint apps/web/src
bun run --filter @unitypackage-tools/web build
```
