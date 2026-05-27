# apps/web -- memory-pressure freeze on file click

## Context

Clicking a file in the explorer (after the initial parse of a non-trivial package such as `fixtures/static/archives/Polytope_URP.unitypackage`) causes a 2-5 s main-thread freeze. Renderer-process RSS spikes from ~200 MB to 1.1-1.5 GB on the first click and grows progressively on subsequent clicks. The package itself is 55 MB compressed / ~110 MB decompressed.

Root cause is **not** preview rendering. Classification routes Unity-generated `.asset` files (TerrainData, fonts, lightmaps) to `previewKind: 'unsupported'` in `apps/web/src/packageModel.ts:40-50`, so `PreviewBody` returns `null` (`apps/web/src/components/PreviewPanel.tsx:151-155`). No `TextDecoder.decode`, no `hljs.highlight`, no Blob construction runs on the click path for these files.

The real cause is **`apps/web/src/parsePackage.worker.ts:15`** posting the parsed records to the main thread without a transferable list:

```ts
self.postMessage({ type: 'success', records } satisfies ParsePackageResponse);
```

Per the HTML structured-clone algorithm, every `Uint8Array` in `records[].content` is deep-copied. After `worker.terminate()`, the main thread owns ~110 MB of cloned `ArrayBuffer` backing stores held by `useState<PackageFileRecord[]>` in `apps/web/src/App.tsx:162`. That much external memory tied to live JS objects pushes V8 into Major GC mark-sweep on every commit, which is the freeze.

Two downstream amplifiers compound the freeze:

- **`apps/web/src/App.tsx:230-233`** -- `activeMetaSidecar` memo calls `getMetaSidecarForAsset(records, activeRecord)`, which internally re-runs `toSidecarSelectableRecords(records)` (309-record map) on every click, even though `apps/web/src/App.tsx:244` already memoizes the same array as `sidecarSelectableRecords`.
- **`apps/web/src/components/PreviewPanel.tsx:55`** -- `<PreviewPanelContent key={record.id}>` unmounts and remounts the entire preview subtree on every click. Fiber teardown + DOM teardown + GC pressure on a hot path.

`apps/web/src/downloadZip.worker.ts` is sent `records` without transferables on every "Download ZIP" click (`apps/web/src/App.tsx:120`), repeating the 110 MB clone for that path.

## Scope

### In

- `apps/web/src/parsePackage.worker.ts` -- transfer asset content buffers.
- `apps/web/src/downloadZip.worker.ts` and `apps/web/src/App.tsx` (`createDownloadZipInWorker`) -- slim ZIP request payload and transfer buffers; preserve main-thread access to records for subsequent use.
- `apps/web/src/App.tsx` -- pass `sidecarSelectableRecords` through to `getMetaSidecarForAsset`; reduce per-click state churn.
- `apps/web/src/packageModel.ts` -- accept an optional pre-computed `selectableRecords` arg on `getMetaSidecarForAsset` and `getDeclaredMetaInfoForRecord` so the caller's memoized array can be reused.
- `apps/web/src/components/PreviewPanel.tsx` -- reconcile in place instead of keyed remount; reset `previewMode` deterministically when the record changes.
- Production-build manual smoke procedure on Polytope (P6).

### Out

- Splitting `Uint8Array content` out of React state into a sibling ref (covered by `memory-pressure-freeze-state-split.md` as a follow-up if these four phases do not fully resolve).
- Any change to `packages/core/src/parse.ts` content layout (still `data.slice(...)` per tar member -- already produces unique transferable buffers, which is what this plan relies on).
- Lazy/streamed parsing.
- CLI / fixtures / docs reorganization.

## Phases

| #  | Title                                                          | Files                                                                                                |
|----|----------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| P1 | Transfer asset content from parse worker                       | `apps/web/src/parsePackage.worker.ts`                                                                |
| P2 | Slim and transfer ZIP worker request                           | `apps/web/src/App.tsx`, `apps/web/src/downloadZip.worker.ts`, `apps/web/src/workerTypes.ts`          |
| P3 | Reuse `sidecarSelectableRecords` inside `getMetaSidecarForAsset` | `apps/web/src/App.tsx`, `apps/web/src/packageModel.ts`                                              |
| P4 | Reconcile `PreviewPanelContent` in place (drop key remount)    | `apps/web/src/components/PreviewPanel.tsx`, `apps/web/src/components/PreviewPanel.test.tsx`          |
| P6 | Production-build manual smoke on Polytope                      | none (manual procedure)                                                                              |

### P1 -- Transfer asset content from parse worker  [DONE 2026-05-27]

Shipped: updated `apps/web/src/parsePackage.worker.ts` to build and pass a transferable list of `ArrayBuffer` objects for record contents.

### P2 -- Slim and transfer ZIP worker request  [DONE 2026-05-27]

Shipped: updated `apps/web/src/App.tsx`, `apps/web/src/downloadZip.worker.ts`, `apps/web/src/workerTypes.ts`, and created a new shared `zipPath.ts` file to copy and transfer array buffers rather than cloning the full record list.

### P3 -- Reuse `sidecarSelectableRecords` inside `getMetaSidecarForAsset`  [DONE 2026-05-27]

Shipped: updated `apps/web/src/App.tsx`, `apps/web/src/packageModel.ts`, and `apps/web/src/components/PreviewPanel.tsx` to pass and reuse `sidecarSelectableRecords` rather than mapping all records on every file click.

### P4 -- Reconcile `PreviewPanelContent` in place  [DONE 2026-05-27]

Shipped: updated `apps/web/src/components/PreviewPanel.tsx` and `apps/web/src/components/PreviewPanel.test.tsx` to remove the keyed remount on `PreviewPanelContent`, tracking prop-derived ID changes to reset the preview mode in place.

**Pass thresholds.**

| Criterion                            | Pass threshold |
|--------------------------------------|----------------|
| Post-parse RSS                       | <= 180 MB      |
| Per-click visible response           | < 200 ms       |
| RSS delta across 5 clicks            | < 100 MB       |
| RSS after rapid cycle + 10 s settle  | near baseline  |
| Playwright timing assertions         | pass           |

## Verification

- `bun run check` is green after each of P1-P4.
- `cd apps/web && bunx playwright test` is green after each of P1-P4.
- P6 pass / fail summary table records the manual measurement; attach the numbers to the ship note for the PR.
- Knip is unaffected (no public-API additions on `packages/core`).
