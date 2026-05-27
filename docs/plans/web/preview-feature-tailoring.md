# apps/web preview feature tailoring

## Context

After the memory-pressure fix landed (see [`memory-pressure-freeze-on-file-click`](./memory-pressure-freeze-on-file-click.md) P1-P4 + P6 and [`memory-pressure-freeze-state-split`](./memory-pressure-freeze-state-split.md) P1-P5, all DONE 2026-05-27), clicking any file is instant and per-click memory delta is ~200 KB. With the perf problem solved, the preview UX still has three rough edges:

1. **Right pane collapses to nothing for unsupported records.** `PreviewBody` returns `null` (`apps/web/src/components/preview/PreviewBody.tsx`), so the preview frame area disappears and only header + metadata remain. The user sees a sudden vertical reflow on every click between previewable and non-previewable files.
2. **Classification is too coarse.** `getPreviewKindForPath` (`apps/web/src/packageModel.ts:40-50`) buckets every yaml extension other than `.yaml`/`.yml` into `'unsupported'`. That hides perfectly previewable `.mat`, `.anim`, `.controller`, `.terrainlayer`, `.mixer` etc. -- but it also lets `.unity` and `.prefab` through with the same blanket rule. Worse, `.asset` is uniformly hidden even though many `.asset` payloads are plain Force-Text YAML; the ones that are not are Force-Text-with-embedded-binary like Polytope's `LiberationSans SDF.asset` (text header, 2-million-char glyph atlas line) and `TerrainData_*` files (heightmap binary blobs).
3. **Visible scrollbar inside the preview frame.** `.preview-frame { overflow: auto }` (`apps/web/src/styles/preview.css:28`) renders a default chrome scrollbar that visually competes with the content.

This plan reshapes preview classification, makes the frame always-present with a "No Preview" state, and hides the scrollbar while preserving scroll behavior.

## Scope

### In

- `apps/web/src/packageModel.ts` -- split the `yamlExtensions` set into "always-skip" (`.unity`, `.prefab`) and "preview-as-text" (everything else, including `.asset` at the path-classification stage). Update `getPreviewKindForPath` accordingly.
- `apps/web/src/parsePackage.worker.ts` -- after path-based classification, for **only** `.asset` records run `isUnityYamlBinary` from `unitypackage-core`; if true, override `previewKind` to `'unsupported'`. This is the sole content-based check.
- `apps/web/src/components/preview/PreviewBody.tsx` -- `PreviewBody` returns a "No Preview" frame instead of `null`. No new state. No conditional surrounding components.
- `apps/web/src/styles/preview.css` -- add `.no-preview-frame` styles; hide the scrollbar on `.preview-frame` (Webkit + Firefox) while keeping wheel/touch/keyboard scroll intact.
- `apps/web/src/components/preview/PreviewPanel.test.tsx` -- update the two assertions that currently expect `.preview-frame` to be absent for unsupported records; add coverage for the new "No Preview" frame and the binary `.asset` path.
- `apps/web/src/packageModel.test.ts` -- update `getPreviewKindForPath` expectations for `.unity`, `.prefab`, `.mat`, `.anim`, `.controller`, `.terrainlayer`, `.asset`.
- Manual smoke matrix on Polytope.

### Out

- Cleanup/refactor work covered by [`cleanup-after-memory-pressure`](./cleanup-after-memory-pressure/_index.md), which has already landed. Keep new preview work on the split `apps/web/src/components/preview/` files.
- Async / chunked text decoding. `TextPreview` stays synchronous. The binary-`.asset` check is exactly what protects it from the LiberationSans-SDF-style multi-MB-line freeze.
- Reintroducing the deferred "Load preview" button. Preview is always immediate for supported kinds and always shows "No Preview" otherwise.
- Touching CLI, core preview kinds, or `isUnityYamlBinary`'s implementation. We only call the existing core export.
- Reorganizing the registered highlight.js language set. No new languages.

## Phases

| #  | Title                                                              | Files                                                                                                                      |
|----|--------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------|
| P1 | Classification rule update + `.asset` binary detection in worker    | `apps/web/src/packageModel.ts`, `apps/web/src/parsePackage.worker.ts`, `apps/web/src/packageModel.test.ts`                 |
| P2 | Always-on "No Preview" frame                                        | `apps/web/src/components/preview/PreviewBody.tsx`, `apps/web/src/components/preview/PreviewPanel.test.tsx`                 |
| P3 | Hide preview scrollbar                                              | `apps/web/src/styles/preview.css`                                                                                          |
| P4 | Manual smoke matrix on Polytope                                     | none (manual procedure)                                                                                                    |

### P1 -- Classification rule update + `.asset` binary detection in worker

**Goal.** `.unity` and `.prefab` always skip preview. All other yaml extensions (`.mat`, `.anim`, `.controller`, `.overridecontroller`, `.terrainlayer`, `.mixer`, `.spriteatlas`, `.shadervariants`, `.preset`, `.lighting`, etc.) classify as `'text'`. `.asset` classifies as `'text'` at the path stage, then the worker downgrades to `'unsupported'` when `isUnityYamlBinary` returns true.

**`apps/web/src/packageModel.ts` changes.**

Split the existing single `yamlExtensions` set:

```ts
const yamlSkipExtensions = new Set(['unity', 'prefab']);
const yamlTextExtensions = new Set([
  'asset', 'mat', 'anim', 'controller', 'overridecontroller',
  'physicmaterial', 'physicsmaterial2d', 'playable', 'mask', 'brush', 'flare',
  'fontsettings', 'guiskin', 'giparams', 'rendertexture', 'spriteatlas', 'spriteatlasv2',
  'terrainlayer', 'mixer', 'shadervariants', 'preset', 'lighting', 'dwlt', 'vfx',
  'vfxblock', 'vfxoperator', 'yaml', 'yml',
]);
const yamlExtensions = new Set([...yamlSkipExtensions, ...yamlTextExtensions]);
```

Retain the existing `yamlExtensions` aggregate -- `getSyntaxLanguageForPath` and `textExtensions` still need the union.

Rewrite `getPreviewKindForPath`:

```ts
function getPreviewKindForPath(pathname: string): PreviewKind {
  const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (imageExtensions.has(ext)) return 'image';
  if (audioExtensions.has(ext)) return 'audio';
  if (videoExtensions.has(ext)) return 'video';
  if (yamlSkipExtensions.has(ext)) return 'unsupported';
  if (yamlTextExtensions.has(ext)) return 'text';
  if (textExtensions.has(ext)) return 'text';
  return 'unsupported';
}
```

The `.yaml`/`.yml` early return is no longer needed -- they live in `yamlTextExtensions`.

**`apps/web/src/parsePackage.worker.ts` changes.**

Import `isUnityYamlBinary` from `unitypackage-core`. After `entriesToRecords` returns `{ records, contents }`, for **only** records whose `extension === 'asset'` and whose path-derived `previewKind === 'text'`, run the binary check against that record's content. If true, set `previewKind = 'unsupported'`.

```ts
import { isUnityYamlBinary, parseUnityPackageEntries } from 'unitypackage-core';
// ...
for (const record of records) {
  if (record.extension !== 'asset') continue;
  if (record.previewKind !== 'text') continue;
  const bytes = contents[record.id];
  if (bytes && isUnityYamlBinary(bytes)) {
    record.previewKind = 'unsupported';
  }
}
```

Two non-negotiables:

- **Run on the worker thread, not main.** The whole point is to keep the head+tail scan off the click hot path.
- **Do not detach or copy the content buffer.** The scan reads through `Uint8Array`; transfer of the underlying `ArrayBuffer` still happens at `postMessage` time after the loop completes.
- **Scope strictly to `.asset`.** Not `.controller`, not `.terrainlayer`. The user specified `.asset` only; broader application is out of scope for this plan.

**`apps/web/src/packageModel.test.ts` updates.**

Add or update cases:

- `.unity` -> `'unsupported'`
- `.prefab` -> `'unsupported'`
- `.mat`, `.anim`, `.controller`, `.terrainlayer`, `.mixer`, `.yaml`, `.yml` -> `'text'`
- `.asset` -> `'text'` (path classification only; binary-check is a worker concern, unit-tested separately if desired)

**Exit criteria.**

- `bun run check` green.
- `cd apps/web && bunx playwright test` green.
- `packageModel.test.ts` covers the bullet list above.
- `Grep "isUnityYamlBinary" apps/web/src` returns hits only in `parsePackage.worker.ts`.
- Manual on Polytope: `.unity` (if any) and `.prefab` files classify as unsupported; `.mat`, `.anim`, `.terrainlayer` show text preview; `LiberationSans SDF.asset` and `TerrainData_*.asset` classify as unsupported; small text `.asset` records (if any) show text preview.

### P2 -- Always-on "No Preview" frame

**Goal.** The preview frame slot is always present. For unsupported kinds it shows a "No Preview" message instead of disappearing. No layout shift between previewable and non-previewable records.

**Component change.**

`PreviewBody` in `apps/web/src/components/preview/PreviewBody.tsx` stops returning `null`:

```tsx
export function PreviewBody({ record }: PreviewBodyProps) {
  if (record.previewKind === 'image') return <ImagePreview key={record.id} record={record} />;
  if (record.previewKind === 'text') return <TextPreview record={record} />;
  return <NoPreview record={record} />;
}

function NoPreview({ record }: { record: PackageFileRecord }) {
  const extLabel = record.extension ? `.${record.extension}` : 'no extension';
  return (
    <div className="preview-frame no-preview-frame" role="status" aria-label="No preview available">
      <FileQuestion aria-hidden="true" size={28} />
      <p>No preview</p>
      <small>{extLabel}</small>
    </div>
  );
}
```

Import `FileQuestion` (or `FileX` -- pick one that exists in the current `lucide-react` version) at the top of `PreviewBody.tsx`.

**Constraints.**

- **No state.** `NoPreview` is a pure function component. No effects.
- The `<div>` carries both `.preview-frame` and `.no-preview-frame` classes so it inherits the shared sizing/border from `.preview-frame` and overlays its centered-message styling via `.no-preview-frame` (defined in P3).
- The `role="status"` + `aria-label` is for screen-reader parity with the previous "no body" state, which was silent.
- **Do not** add a deferred "Load anyway" button. Out of scope.
- **Do not** branch on whether the unsupported kind came from an extension match or from the binary `.asset` downgrade. The UI is identical for both reasons.

**Test updates.**

In `apps/web/src/components/preview/PreviewPanel.test.tsx`:

- The two tests `'collapses preview body for Unity-generated YAML extensions (now unsupported)'` and `'collapses preview body entirely (returns null) for unsupported preview kind'` currently assert `.preview-frame` is absent. Rewrite them to assert `.no-preview-frame` is present and contains the text `No preview`.
- Add one test: a record with `extension: 'asset'` and `previewKind: 'unsupported'` (simulating the worker's binary downgrade) renders the same `.no-preview-frame`.

**Exit criteria.**

- `bun run check` green.
- `bun run --filter @unitypackage-tools/web test` green.
- `Grep "preview-frame" apps/web/src` shows the new class is used.
- Visual check: clicking between a `.cs` and a `.unity` file produces no vertical reflow above the metadata section -- both have the same-height preview-frame slot.

### P3 -- Hide preview scrollbar

**Goal.** The visible scrollbar inside `.preview-frame` is gone. Scrolling via mouse wheel, trackpad, touch, and arrow keys still works. No content is clipped.

**`apps/web/src/styles/preview.css` changes.**

Augment `.preview-frame`:

```css
.preview-frame {
  min-height: 230px;
  max-height: 46vh;
  margin: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  overflow: auto;
  scrollbar-width: none;        /* Firefox */
  -ms-overflow-style: none;     /* legacy Edge / IE */
}

.preview-frame::-webkit-scrollbar {
  display: none;                /* Chromium / Safari */
}
```

Add the "No Preview" styles introduced in P2:

```css
.no-preview-frame {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--muted);
  text-align: center;
  padding: 20px;
}

.no-preview-frame p {
  margin: 0;
  font-size: 0.95rem;
  color: var(--text);
}

.no-preview-frame small {
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace;
  font-size: 0.78rem;
}
```

**Constraints.**

- **Do not remove `overflow: auto`** -- content larger than the frame still needs to scroll, the scrollbar is just invisible.
- **Do not apply scrollbar hiding globally** (do not touch `body` or `html`). The explorer pane's virtualized list still needs a visible scrollbar.
- Do not reintroduce the removed `.unsupported-frame` rule. Use `.no-preview-frame` for the new unsupported state.

**Exit criteria.**

- `bun run check` green.
- Visual: open Polytope in Chromium and Firefox; preview frame shows no scrollbar; wheel and keyboard arrow scrolling still works on a long text record (e.g. a multi-KB `.controller` or `.mat`).

### P4 -- Manual smoke matrix on Polytope

**Procedure.**

1. `bun run check` green.
2. `cd apps/web && bunx vite preview --port 4173 --strictPort`
3. Open clean Chromium tab. Navigate to `http://localhost:4173/`.
4. Load `fixtures/static/archives/Polytope_URP.unitypackage`.
5. Walk the matrix below.

**Matrix.**

| Click target                                  | Expected preview frame state                                      |
|-----------------------------------------------|-------------------------------------------------------------------|
| any `.cs` file                                | text preview with C# highlighting                                 |
| any `.shader` file                            | text preview, plain (shaderlab is not in registered set)           |
| any `.mat` file                               | text preview, yaml highlighting                                    |
| any `.anim` or `.controller` file              | text preview, yaml highlighting                                    |
| `Ground_Layer_01.terrainlayer`                | text preview, yaml highlighting                                    |
| any `.prefab` file (if present)                | "No preview" frame, `.prefab` label                                |
| any `.unity` scene file (if present)           | "No preview" frame, `.unity` label                                 |
| `LiberationSans SDF.asset`                    | "No preview" frame, `.asset` label (binary detection downgrade)    |
| any `TerrainData_*.asset`                     | "No preview" frame, `.asset` label                                 |
| any `.png` file                                | image preview                                                      |
| any `.fbx` or `.unitypackage` (non-supported) | "No preview" frame                                                 |

**Layout.**

- Click between previewable and unsupported records repeatedly: the preview-frame slot's vertical height stays constant; only the metadata grid moves naturally below.

**Scrollbar.**

- Hover and scroll inside a large `.controller` or `.mat` preview: no visible scrollbar, scrolling works.
- Repeat in Firefox.

**Performance regression check.**

- Post-parse RSS within ~10 MB of the pre-P1 baseline (~200 MB).
- Per-click memory delta within ~10x of the post-fix baseline (~200 KB).
- No click takes longer than 200 ms.

If the binary `.asset` detection materially regresses parse time (more than +500 ms on Polytope), bisect: either Polytope has more `.asset` records than expected (unlikely -- ~9) or `isUnityYamlBinary` is being called outside its intended scope. Fix the call site, not the threshold.

**Exit criteria.**

- Every matrix row passes.
- No vertical layout shift between previewable and unsupported clicks.
- Scrollbar invisible in both Chromium and Firefox; scroll behavior intact.
- Parse time and memory metrics within the regression bounds above.

## Verification

- `bun run check` green after each of P1-P3.
- `cd apps/web && bunx playwright test` green after each of P1-P3.
- `bun run --filter @unitypackage-tools/web test` green after P2.
- P4 manual matrix recorded in the ship note for the PR (pass/fail per row).
- `Grep "isUnityYamlBinary" apps/web/src` returns hits only in `parsePackage.worker.ts` after P1.
- Knip unchanged or improved (`isUnityYamlBinary` becomes a live import again).
