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

### P1 -- Transfer asset content from parse worker

**Goal.** Eliminate the worker-to-main structured-clone copy of all `record.content` buffers. After the fix, peak heap during parse is approximately halved (worker holds buffers until transfer, then main holds them; no duplication).

**Files.** `apps/web/src/parsePackage.worker.ts`

**Surface.**

Replace:

```ts
const records = entriesToRecords(entries);
self.postMessage({ type: 'success', records } satisfies ParsePackageResponse);
```

with:

```ts
const records = entriesToRecords(entries);
const transfer: ArrayBuffer[] = [];
for (const record of records) {
  const buffer = record.content.buffer;
  if (buffer instanceof ArrayBuffer && !transfer.includes(buffer)) {
    transfer.push(buffer);
  }
}
self.postMessage(
  { type: 'success', records } satisfies ParsePackageResponse,
  transfer,
);
```

The `instanceof ArrayBuffer` guard excludes `SharedArrayBuffer`. The dedupe guard handles the (unlikely) case where two records' `Uint8Array` views share a backing buffer; transferring the same buffer twice throws `DataCloneError`. Each `record.content` is produced by `data.slice(...)` in `packages/core/src/parse.ts:274`, which always produces a unique backing `ArrayBuffer`, so the dedupe is defensive only.

**Exit criteria.**

- `apps/web/src/parsePackage.worker.ts` passes a non-empty transferable list on the success branch.
- The error branch is unchanged (`self.postMessage({ type: 'error', message })`).
- `bun run test:web` passes (no existing unit test asserts on transferables; this is a runtime behavior change).
- `cd apps/web && bunx playwright test` passes; the two timing assertions at `apps/web/tests/explorer.spec.ts:134` and `apps/web/tests/explorer.spec.ts:151` still pass with visible headroom.

### P2 -- Slim and transfer ZIP worker request

**Goal.** Stop sending the full `records[]` (with content) to the ZIP worker on every "Download ZIP" click. Send only the IDs + maintainStructure flag plus a compact `files: [{ path, content }]` array projected from the selection, and transfer the content buffers. Avoids a second 100+ MB clone.

**Files.** `apps/web/src/App.tsx`, `apps/web/src/downloadZip.worker.ts`, `apps/web/src/workerTypes.ts`.

**Constraint.** Transferring `content.buffer` to the ZIP worker **detaches it on the main thread**, so subsequent previews or downloads of the same file would fail. Two options:

- **Option A (recommended).** Copy each selected record's content into a fresh `Uint8Array(record.content)` before transferring. This costs an extra alloc per zipped file but keeps the originals intact and bounds the duplication to the selected subset only.
- **Option B.** Skip transferables for ZIP; keep the current structured clone. Lower complexity but doesn't fix the secondary spike on download.

Use **Option A**.

**Surface.**

1. In `apps/web/src/workerTypes.ts`, replace the `DownloadZipRequest` shape:

   ```ts
   export interface DownloadZipFileInput {
     path: string;
     content: Uint8Array;
   }

   export interface DownloadZipRequest {
     files: DownloadZipFileInput[];
     maintainStructure: boolean;
   }
   ```

   (`recordIds` is no longer needed -- selection resolution happens on main before send.)

2. In `apps/web/src/App.tsx`, replace `createDownloadZipInWorker`:

   ```ts
   function createDownloadZipInWorker(
     records: PackageFileRecord[],
     maintainStructure: boolean,
     recordIds: string[],
   ): Promise<Uint8Array | null> {
     return new Promise((resolve, reject) => {
       const worker = new Worker(new URL('./downloadZip.worker.ts', import.meta.url), { type: 'module' });
       worker.onmessage = ({ data }: MessageEvent<DownloadZipResponse>) => {
         worker.terminate();
         if (data.type === 'success') return resolve(data.data);
         if (data.type === 'empty') return resolve(null);
         reject(new Error(data.message));
       };
       worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message)); };
       worker.onmessageerror = () => { worker.terminate(); reject(new Error('Failed to receive ZIP data')); };

       const idSet = new Set(recordIds);
       const usedNames = new Map<string, number>();
       const files: DownloadZipFileInput[] = [];
       const transfer: ArrayBuffer[] = [];
       for (const record of records) {
         if (!idSet.has(record.id)) continue;
         const path = uniqueZipPath(
           maintainStructure ? record.virtualPath : record.fileName,
           usedNames,
         );
         const copy = new Uint8Array(record.content);
         files.push({ path, content: copy });
         transfer.push(copy.buffer);
       }

       worker.postMessage({ files, maintainStructure } satisfies DownloadZipRequest, transfer);
     });
   }
   ```

   Move `uniqueZipPath` out of the worker into a shared module (e.g. `apps/web/src/zipPath.ts`) and import it from both `apps/web/src/App.tsx` and `apps/web/src/downloadZip.worker.ts`. Alternatively, keep `uniqueZipPath` only in the worker and project to `{ pathnameOrFileName, fileName, ... }` instead -- but exporting is cleaner.

3. In `apps/web/src/downloadZip.worker.ts`, replace the `onmessage` body:

   ```ts
   self.onmessage = ({ data }: MessageEvent<DownloadZipRequest>) => {
     try {
       if (data.files.length === 0) {
         postResponse({ type: 'empty' });
         return;
       }
       const inputs = data.files.map(file => ({ path: file.path, bytes: file.content }));
       const zippedData = createStoredZip(inputs);
       postResponse({ type: 'success', data: zippedData }, [zippedData.buffer]);
     } catch (err) {
       const message = err instanceof Error ? err.message : 'Failed to create ZIP';
       postResponse({ type: 'error', message });
     }
   };
   ```

   (`uniqueZipPath` no longer needed in the worker if name resolution moves to main; otherwise re-import.)

**Exit criteria.**

- `DownloadZipRequest` no longer carries the full `records[]` field; only `files: { path, content }[]` plus `maintainStructure`.
- `createDownloadZipInWorker` posts the request with a transferable list containing every `files[].content.buffer`.
- "Selected ZIP" and "All ZIP" downloads on Polytope still produce valid ZIPs containing the expected files.
- `apps/web/tests/explorer.spec.ts` -- `'Selected ZIP download filename ...'` (line 94) and `'All ZIP download filename ...'` (line 113) tests pass unchanged.
- `bun run test:web` and `bun run --filter @unitypackage-tools/web typecheck` pass.

### P3 -- Reuse `sidecarSelectableRecords` inside `getMetaSidecarForAsset`

**Goal.** Stop re-mapping `records.length` items inside `getMetaSidecarForAsset` on every click. The caller (`App.tsx:244`) already memoizes the same array as `sidecarSelectableRecords` -- accept it as a parameter.

**Files.** `apps/web/src/packageModel.ts`, `apps/web/src/App.tsx`.

**Surface.**

In `apps/web/src/packageModel.ts`:

```ts
export function getMetaSidecarForAsset(
  records: readonly PackageFileRecord[],
  record: PackageFileRecord,
  selectableRecords?: readonly SidecarSelectableRecord[],
): PackageFileRecord | undefined {
  if (record.extension === 'meta') return undefined;

  const selectable = selectableRecords ?? toSidecarSelectableRecords(records);
  const selectableAsset = selectable.find(candidate => candidate.id === record.id);
  if (!selectableAsset) return undefined;

  const selectableMeta = findCoreMetaSidecarForAsset(selectable, selectableAsset);
  if (!selectableMeta) return undefined;

  return records.find(candidate => candidate.id === selectableMeta.id);
}
```

Apply the same parameter to `getDeclaredMetaInfoForRecord` so the `Metadata` component (`apps/web/src/components/PreviewPanel.tsx:199`) can pass it through (Metadata currently passes a 1- or 2-element array, so reuse is moot there -- leave as is unless the prop drilling is clean).

In `apps/web/src/App.tsx`, update the call site at line 232:

```ts
const activeMetaSidecar = useMemo(() => {
  if (!activeRecord) return undefined;
  return getMetaSidecarForAsset(records, activeRecord, sidecarSelectableRecords);
}, [activeRecord, records, sidecarSelectableRecords]);
```

**Exit criteria.**

- `getMetaSidecarForAsset` accepts an optional pre-computed selectable array and reuses it when supplied.
- `App.tsx`'s `activeMetaSidecar` memo passes `sidecarSelectableRecords` and lists it in the dep array.
- Existing `packageModel.test.ts` cases pass without modification (back-compat: arg is optional).
- `bun run test:web` passes.

### P4 -- Reconcile `PreviewPanelContent` in place

**Goal.** Stop unmounting and remounting the entire preview subtree on every file click. The `key={record.id}` at `apps/web/src/components/PreviewPanel.tsx:55` exists to reset internal state (`previewMode`) when the record changes -- replace with explicit prop-derived state.

**Files.** `apps/web/src/components/PreviewPanel.tsx`, `apps/web/src/components/PreviewPanel.test.tsx`.

**Surface.**

In `PreviewPanel`:

```tsx
export function PreviewPanel({
  record,
  metaSidecar,
  onDownload,
  onRevealInTree,
}: { ... }) {
  if (!record) {
    return <div className="preview-empty">...</div>;
  }
  return (
    <PreviewPanelContent
      record={record}
      metaSidecar={metaSidecar}
      onDownload={onDownload}
      onRevealInTree={onRevealInTree}
    />
  );
}
```

(No `key`.) Then in `PreviewPanelContent`, replace `useState` with a record-id-derived reset:

```tsx
function PreviewPanelContent({ record, metaSidecar, onDownload, onRevealInTree }: { ... }) {
  const [previewMode, setPreviewMode] = useState<'asset' | 'meta'>('asset');
  const previousIdRef = useRef(record.id);
  if (previousIdRef.current !== record.id) {
    previousIdRef.current = record.id;
    if (previewMode !== 'asset') setPreviewMode('asset');
  }
  ...
}
```

(The render-time `setState` follows React's "set-state-during-render" pattern, which React explicitly endorses for prop-derived resets. This avoids the project's `react-hooks/set-state-in-effect` lint rule; do **not** use a `useEffect`.)

Also confirm `ImagePreview` continues to use `key={record.id}` at `apps/web/src/components/PreviewPanel.tsx:152` -- it still needs the keyed remount to revoke its blob URL when the record changes. Leave the per-`ImagePreview` key.

**Exit criteria.**

- `<PreviewPanelContent key={record.id} ...>` is gone; `PreviewPanelContent` reconciles in place across record changes.
- `previewMode` resets to `'asset'` whenever `record.id` changes.
- `apps/web/src/components/PreviewPanel.test.tsx` covers the reset: render with record A in `'meta'` mode, swap to record B, assert preview body re-renders in `'asset'` mode.
- `apps/web/tests/explorer.spec.ts` `'meta sidecar renders immediate text preview'` (line 71) still passes.
- `bun run test:web` and `bun run --filter @unitypackage-tools/web typecheck` pass.
- `eslint-plugin-react-compiler` reports no new violations.

### P6 -- Production-build manual smoke on Polytope

See `memory-pressure-freeze-agentic-debug.md` for the full agentic debug procedure. This section documents only the simplified manual validation checklist.

**Procedure (brief).**

1. `bun run check` -- lint + typecheck + build + test + smoke green.
2. `cd apps/web && bunx vite preview --port 4173 --strictPort`
3. Open clean Chromium (no DevTools). Navigate to `http://localhost:4173/`.
4. Load `Polytope_URP.unitypackage`. Note post-parse RSS.
5. Click 5 files (`.cs`, `.shader`, `TerrainData_*.asset`, `.png`, `.fbx`). Each click < 200 ms. RSS delta < 100 MB total.
6. Rapid 10-click cycle. No freeze. RSS settles near baseline.
7. "All ZIP" download. ZIP contains 139+ entries. RSS settles in < 5 s.
8. `cd apps/web && bunx playwright test` -- all pass.

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
