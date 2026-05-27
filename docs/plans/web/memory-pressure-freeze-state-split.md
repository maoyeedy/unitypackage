# apps/web -- split asset content out of React state (memory-pressure follow-up)

## Context

This plan **assumes [`memory-pressure-freeze-on-file-click.md`](./memory-pressure-freeze-on-file-click.md) (P1-P4 + P6) has already shipped and was insufficient**: the production-build smoke in P6 still shows a Major-GC-class freeze on click, or RSS still climbs unacceptably across the 5-click sweep. Apply this only after P6 fails its pass thresholds.

After the prior plan, the parse worker no longer clones content into the main heap, and the click path no longer triggers an unmount/remount. What remains: `apps/web/src/App.tsx:162` still holds `useState<PackageFileRecord[]>([])` where each `PackageFileRecord` carries a `content: Uint8Array` field (declared at `packages/core/src/component.ts:13`). For a 110 MB package that is 100+ MB of external `ArrayBuffer` backing stores referenced from React state -- so every React commit, every memo recompute, every diff walk participates in keeping that memory live and visible to V8's GC.

This plan separates the heavy field from the React-managed metadata so React's reconciliation surface shrinks back to small JS objects.

## Scope

### In

- `apps/web/src/App.tsx` -- introduce a sibling `useRef<Map<string, Uint8Array>>` (or equivalent module-scoped store) for content; thread access through to the few consumers that need it.
- `apps/web/src/packageModel.ts` -- introduce a lightweight `PackageFileRecord` shape that **omits** `content`; provide a helper to look up the bytes for a record id.
- `apps/web/src/parsePackage.worker.ts` -- split the success message into `{ records, contents }` so main can stash contents in the ref before setting React state.
- `apps/web/src/workerTypes.ts` -- new response shape.
- Every component prop or hook signature that currently passes `PackageFileRecord` and reaches into `.content` (`PreviewPanel.tsx`, the ZIP request path in `App.tsx`, `getDeclaredMetaInfoForRecord` in `packageModel.ts`).

### Out

- Lazy / streamed parsing (worker still produces all content up front; only main-thread ownership changes).
- IndexedDB persistence.
- Any change to `packages/core` aside from optionally adding a `ContentlessRecord` projection helper (avoid this -- web can project locally).

## Phases

| #  | Title                                                              | Files                                                                                                                  |
|----|--------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| P1 | Web-local `LightRecord` type + parse-worker response split          | `apps/web/src/workerTypes.ts`, `apps/web/src/parsePackage.worker.ts`, `apps/web/src/packageModel.ts`                   |
| P2 | Main-thread content store (`useRef<Map<id, Uint8Array>>`)           | `apps/web/src/App.tsx`                                                                                                  |
| P3 | Migrate consumers to read content via the store                     | `apps/web/src/components/PreviewPanel.tsx`, `apps/web/src/App.tsx` (download, ZIP request build), `apps/web/src/packageModel.ts` (`getDeclaredMetaInfoForRecord`) |
| P4 | Sweep + delete the old `.content` field from web-side `PackageFileRecord` | `apps/web/src/packageModel.ts`, all referencing call sites                                                              |
| P5 | Production-build manual smoke (re-run P6 from the prior plan)       | none (manual)                                                                                                          |

### P1 -- Web-local `LightRecord` + parse-worker response split

**Goal.** Have the parse worker post **two** parallel pieces of data: the lightweight record metadata (no `content`) and a separate `Map<recordId, Uint8Array>` of contents. Main can then stash the map in a ref before calling `setRecords`.

**Files.** `apps/web/src/workerTypes.ts`, `apps/web/src/parsePackage.worker.ts`, `apps/web/src/packageModel.ts`.

**Surface.**

1. In `apps/web/src/packageModel.ts`, add a new type:

   ```ts
   export type PackageFileLightRecord = Omit<PackageFileRecord, 'content'>;
   ```

   Do **not** delete `content` from `PackageFileRecord` yet -- P4 does that after every consumer migrates.

2. In `apps/web/src/workerTypes.ts`:

   ```ts
   export type ParsePackageResponse =
     | {
         type: 'success';
         records: PackageFileLightRecord[];
         contents: Record<string, Uint8Array>;
       }
     | { type: 'error'; message: string };
   ```

   (Use a plain object keyed by record id, not a `Map` -- `Map` is structured-clonable but the `Record` form is easier to type and equally cheap.)

3. In `apps/web/src/parsePackage.worker.ts`:

   ```ts
   const records = entriesToRecords(entries);
   const lightRecords: PackageFileLightRecord[] = [];
   const contents: Record<string, Uint8Array> = {};
   const transfer: ArrayBuffer[] = [];
   for (const record of records) {
     const { content, ...rest } = record;
     lightRecords.push(rest);
     contents[record.id] = content;
     const buffer = content.buffer;
     if (buffer instanceof ArrayBuffer && !transfer.includes(buffer)) {
       transfer.push(buffer);
     }
   }
   self.postMessage(
     { type: 'success', records: lightRecords, contents } satisfies ParsePackageResponse,
     transfer,
   );
   ```

   The `transfer` list is identical to the one P1 of the prior plan installed -- the buffers move zero-copy from worker to main, then are reached by `contents[id]` rather than by `records[i].content`.

**Exit criteria.**

- `PackageFileLightRecord` exported from `apps/web/src/packageModel.ts`.
- `ParsePackageResponse` `success` branch carries `{ records: PackageFileLightRecord[]; contents: Record<string, Uint8Array> }`.
- Parse worker no longer references `.content` after constructing the response.
- `bun run --filter @unitypackage-tools/web typecheck` is **expected to fail** in `App.tsx` and consumers -- that's what P2/P3 fix.

### P2 -- Main-thread content store

**Goal.** Add a sibling store in `AppContent` for the bytes; thread it through to anything that needs them. React state holds only the light records.

**Files.** `apps/web/src/App.tsx`.

**Surface.**

1. Replace `useState<PackageFileRecord[]>([])` (line 162) with `useState<PackageFileLightRecord[]>([])`.
2. Add a ref:

   ```ts
   const contentStoreRef = useRef<Map<string, Uint8Array>>(new Map());
   ```

3. In `handlePackageFile` (line 262):

   ```ts
   const result = await parsePackageInWorker(await file.arrayBuffer());
   contentStoreRef.current = new Map(Object.entries(result.contents));
   setRecords(result.records);
   ```

   (Reset the map first -- do not append to a stale map from the previous package.)

4. Update `parsePackageInWorker` return type to `Promise<{ records: PackageFileLightRecord[]; contents: Record<string, Uint8Array> }>`.

5. Provide a stable accessor for consumers:

   ```ts
   const getContent = useCallback((recordId: string): Uint8Array | undefined => {
     return contentStoreRef.current.get(recordId);
   }, []);
   ```

   Pass `getContent` as a prop to `PreviewPanel` (and into the ZIP request builder).

**Exit criteria.**

- `records` state is `PackageFileLightRecord[]`.
- `contentStoreRef` reset on each `handlePackageFile`.
- `getContent` is a stable callback (empty deps) reading from the ref.
- React DevTools (when run for debugging) shows `records` state size dropped from ~110 MB external to a few hundred KB of plain objects.

### P3 -- Migrate consumers

**Goal.** Move every `.content` access off the record object and through `getContent(id)` (or, inside the parse worker, the local `contents` map). After this phase, only the parse worker still constructs records with `content`; main-thread code never reads from `record.content`.

**Files.** `apps/web/src/components/PreviewPanel.tsx`, `apps/web/src/App.tsx`, `apps/web/src/packageModel.ts`.

**Surface.**

Touch each call site enumerated in the prior analysis:

1. **`apps/web/src/components/PreviewPanel.tsx:159`** (`ImagePreview`):

   ```tsx
   function ImagePreview({ record, getContent }: { record: PackageFileLightRecord; getContent: (id: string) => Uint8Array | undefined }) {
     const [blobUrl] = useState(() => {
       const bytes = getContent(record.id);
       if (!bytes) return '';
       return URL.createObjectURL(new Blob([bytes], { type: record.mimeType }));
     });
     useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);
     return blobUrl
       ? <div className="preview-frame image-frame"><img src={blobUrl} alt={record.fileName} /></div>
       : null;
   }
   ```

2. **`apps/web/src/components/PreviewPanel.tsx:177`** (`TextPreview`):

   ```tsx
   function TextPreview({ record, getContent }: { record: PackageFileLightRecord; getContent: (id: string) => Uint8Array | undefined }) {
     const bytes = getContent(record.id);
     if (!bytes) return null;
     const preview = textDecoder.decode(bytes);
     // ... unchanged hljs.highlight try/catch ...
   }
   ```

3. **`apps/web/src/App.tsx:669`** (download):

   ```tsx
   onDownload={(record) => {
     const bytes = getContent(record.id);
     if (!bytes) return;
     downloadBlob(new Blob([bytes], { type: record.mimeType }), record.fileName);
   }}
   ```

4. **`apps/web/src/App.tsx`** `createDownloadZipInWorker` -- use `getContent(record.id)` instead of `record.content` when building the `files: [{ path, content }]` payload (the P2 plan from the prior doc).

5. **`apps/web/src/packageModel.ts:389-398`** (`getDeclaredMetaInfoForRecord`) -- accept the bytes (or a getter) as a parameter:

   ```ts
   export function getDeclaredMetaInfoForRecord(
     records: PackageFileLightRecord[],
     record: PackageFileLightRecord,
     getContent: (id: string) => Uint8Array | undefined,
   ): DeclaredMetaInfo {
     let metaBytes: Uint8Array | undefined;
     if (record.extension === 'meta') metaBytes = getContent(record.id);
     else {
       const sibling = getMetaSidecarForAsset(records, record);
       if (sibling) metaBytes = getContent(sibling.id);
     }
     if (!metaBytes) return { guid: undefined, importer: undefined };
     // ... unchanged readMetaGuid / readDeclaredMetaImporter ...
   }
   ```

   Update its caller in `apps/web/src/components/PreviewPanel.tsx` (`Metadata` component, line 199) to thread `getContent` through.

6. **Drop the `as Uint8Array<ArrayBuffer>` casts** at `apps/web/src/components/PreviewPanel.tsx:159` and `apps/web/src/App.tsx:669`. They were workarounds for the `Uint8Array` type narrowing; now the bytes come from a `Map<string, Uint8Array>` and the cast is unnecessary if the map's value type is `Uint8Array<ArrayBuffer>` (declare it as such).

**Exit criteria.**

- No `record.content` access remains in `apps/web/src/` outside the parse worker (verify with `Grep "record\.content|\.content\b"` in `apps/web/src`; only `parsePackage.worker.ts` hits should remain).
- `getContent` is plumbed to `PreviewPanel` (and `Metadata` inside it).
- `bun run --filter @unitypackage-tools/web typecheck` passes.
- `bun run test:web` passes (component tests may need updates to provide a `getContent` mock).
- `cd apps/web && bunx playwright test` passes.

### P4 -- Delete `.content` from web-side `PackageFileRecord`

**Goal.** Make the web-side `PackageFileRecord` (or replace it entirely with `PackageFileLightRecord`) carry no `content` field. This is the load-bearing cleanup -- React state can no longer accidentally accept records with bytes attached.

**Files.** `apps/web/src/packageModel.ts`, any consumer still referencing `PackageFileRecord` from `apps/web/src/`.

**Surface.**

Two options:

- **Option A (recommended).** Rename `PackageFileLightRecord` -> `PackageFileRecord` (drop the alias), since the web app never needs the heavy form on the main thread. Delete the previous heavy alias.
- **Option B.** Keep both types; mark `PackageFileRecord` heavy as worker-internal only by colocating it in `parsePackage.worker.ts` or under an internal subpath. More boilerplate, no benefit.

Use Option A.

After the rename:

```ts
export interface PackageFileRecord extends Omit<UnityPackageComponentRecord, 'content'> {
  fileName: string;
  isUnityPreview: false;
  previewKind: PreviewKind;
  syntaxLanguage: SyntaxLanguage;
}
```

The worker's `entriesToRecords` builds an internal heavy shape (it has the bytes -- it needs them to split into the contents map), but the **exported** type from `packageModel.ts` is the contentless form. Inside the worker, type-cast or use a private local interface like `WorkerHeavyRecord` -- do not re-export it.

**Exit criteria.**

- `PackageFileRecord` exported from `apps/web/src/packageModel.ts` has no `content` field.
- TypeScript catches any new attempt to read `.content` from a record on the main thread.
- `bun run check` is green.

### P5 -- Re-run production-build manual smoke

**Goal.** Confirm the freeze and the RSS climb are both gone in the production build.

**Procedure.** Repeat the full P6 manual procedure from [`memory-pressure-freeze-on-file-click.md`](./memory-pressure-freeze-on-file-click.md) verbatim, with these tightened pass thresholds:

| Criterion                                                 | Pass threshold       |
|-----------------------------------------------------------|----------------------|
| Post-parse RSS                                            | <= 150 MB            |
| Per-click visible response                                | < 100 ms             |
| RSS delta across 5 sequential clicks                      | < 30 MB              |
| RSS after rapid 10-click cycle + 10 s settle              | <= post-parse RSS + 20 MB |
| `apps/web/tests/explorer.spec.ts` timing assertions       | passes with > 50% headroom |

If any of these still fails, the problem is not state-pressure; investigate (in order): (a) DevTools / extensions polluting the measurement, (b) bundler / dev mode confusion, (c) browser-version-specific GC pathology.

## Verification

- `bun run check` is green after each of P1-P4.
- `cd apps/web && bunx playwright test` is green after each of P1-P4.
- P5 manual smoke pass-table is attached to the PR ship note.
- `Grep "record\.content"` over `apps/web/src` returns hits **only** in `apps/web/src/parsePackage.worker.ts`.
