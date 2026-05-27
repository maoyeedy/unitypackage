# Non-native Image Format Preview

## Context

The web app (`apps/web`) previews image files via `<img>` tags with blob URLs. This only works for browser-native formats (`png`, `jpg`, `gif`, `bmp`, `webp`, `avif`, `svg`). Unity packages commonly contain **TGA** and **TIFF** textures that fall through to `NoPreview`, since browsers cannot decode them natively. Goal: decode and render TGA/TIFF to `<canvas>` so users can preview these files.

Decision record:
- **Libraries**: `tiff` (image-js, v7.1.3) for TIFF, `@lunapaint/tga-codec` (v0.2.0) for TGA
- **Decode thread**: Web Worker (separate from parse worker, on-demand per record)
- **Icons**: Show image icon for TGA/TIFF in file list
- **No core type changes**: Keep `previewKind` as `'image'`, route to decoder in `PreviewBody`

## Scope

### Pitfalls (all phases)

- **React Compiler stale closures**: Do not create temporal resources (blob URLs, worker channels, `ImageData`) during **render** (i.e. in `useMemo`, `useState` lazy initializer, or inline computation). The React Compiler's `useMemoCache` can return stale values if the component's render is discarded and re-rendered (e.g. by a parent's render-phase state update). Always create resources in `useEffect` (post-commit) and store them in state. See `ImagePreview` in `PreviewBody.tsx` for the canonical pattern: `useEffect` → create → `setState` → cleanup revokes on teardown.

- **The `'use no memo'` directive must be on the same function component as the temporal resource**: putting it on a parent wrapper (e.g. `PreviewBody`) does not protect child components. Apply it directly to the component that manages the resource if you need to opt out of compiler memoization.

- **Zero-byte content guard**: `!bytes` does not catch `Uint8Array(0)` (which is truthy). Use `!bytes || bytes.byteLength === 0`.

### In

- Classify `tga`, `tif`, `tiff` as image types across all layers (core MIME, web preview kind, file icons)
- Install `tiff` and `@lunapaint/tga-codec` in `apps/web`
- Create dedicated `decode-image.worker.ts` for on-demand decode requests
- Create `DecodedImagePreview` component rendering decoded pixels to `<canvas>`
- Wire into `PreviewBody.tsx` route
- Update `docs/reference/extension-map.md`
- Unit tests for decode worker and component; E2E test for TGA/TIFF preview

### Out

- EXR, HDR, PSD, PICT, IFF, or any other non-native formats (future work)
- Server-side or main-thread decode
- Image manipulation (resize, rotate, color convert) — raw decode only
- Progressive/streaming decode
- Multi-page TIFF navigation (show first page only)

## Phases

| Phase | Description | Depends on |
|-------|------------|------------|
| P1 | Classify extensions (core + web) | — |
| P2 | Install deps + create decode worker (apps/web) | P1 |
| P3 | DecodedImagePreview component + PreviewBody wiring | P2 |
| P4 | Docs + Tests | P3 |

### P1 -- Classify extensions

**Goal**: `tga`, `tif`, `tiff` are recognized as image types with correct MIME types, preview kinds, and file icons.

**Files**:
- `packages/core/src/classify.ts`
- `apps/web/src/packageModel.ts`
- `apps/web/src/fileIcons.ts`

**Surface**:
- `classify.ts`: Add `tga`, `tif`, `tiff` to `imageMimeTypes` map (`image/x-tga`, `image/tiff`)
- `packageModel.ts`: Add `tga`, `tif`, `tiff` to `imageExtensions` Set
- `fileIcons.ts`: Add `tga`, `tif`, `tiff` to `imageExtensions` Set

**Exit criteria**:
- `getMimeTypeForPath('tex.tga')` returns `'image/x-tga'`
- `getMimeTypeForPath('tex.tif')` returns `'image/tiff'`
- `getPreviewKindForPath('tex.tga')` returns `'image'`
- `getFileIconDescriptor({ extension: 'tga' })` returns image descriptor
- Existing tests still pass (`bun run test:core`, `bun run test:web`)

### P2 -- Install deps + decode worker

**Goal**: Decoder libraries installed, Web Worker accepts decode requests and returns RGBA pixel data.

**Files**:
- `apps/web/package.json`
- `apps/web/src/workerTypes.ts`
- `apps/web/src/decode-image.worker.ts`
- `apps/web/tsconfig.app.json` (if worker needs type inclusion)

**Surface**:
- Add `tiff` and `@lunapaint/tga-codec` to `apps/web` dependencies
- Add worker types to `workerTypes.ts`:
  - `DecodeImageRequest`: `{ id: string; bytes: Uint8Array; extension: string }`
  - `DecodeImageResponse`: `{ type: 'success'; id: string; width: number; height: number; rgba: Uint8Array } | { type: 'error'; id: string }`
- Create `decode-image.worker.ts`:
  - `self.onmessage` handler switches on `extension`
  - Lazy-imports decoder per format (`import('tiff')`, `import('@lunapaint/tga-codec')`)
  - Decodes bytes → RGBA `Uint8Array`, posts back `{ id, width, height, rgba }`
  - Transfer the rgba buffer for zero-copy

**Exit criteria**:
- `bun run build:web` succeeds
- Worker type-checks (VS Code / `tsc` has no errors)
- Manual smoke: TGA/TIFF bytes posted to worker return valid RGBA data

### P3 -- DecodedImagePreview component + wiring

**Goal**: Users clicking a TGA/TIFF file see a rendered preview on a `<canvas>` element.

**Files**:
- `apps/web/src/components/preview/DecodedImagePreview.tsx`
- `apps/web/src/components/preview/PreviewBody.tsx`
- `apps/web/src/components/preview/PreviewPanel.tsx` (if state changes needed)

**Surface**:
- Create `DecodedImagePreview.tsx`:
  - Receives `record: PackageFileRecord`
  - Spawns/kills `decode-image` worker instance in `useEffect` (not during render — see Pitfalls above)
  - Fetch content bytes via `getContent(record.id)` inside the same effect, not in a `useMemo` or render-phase expression
  - Worker posts `{ id, bytes, extension: record.extension }`
  - On response: creates `ImageData` from `rgba`, puts on `<canvas ref>` — all in the same effect handler
  - Set loading/loaded state via `setState` in the effect (suppress `set-state-in-effect` with inline comment — this is a legitimate sync of external state)
  - Ensure worker termination and pending-response cleanup in the effect teardown function
  - Handle errors → render `NoPreview` fallback
  - Show loading state during decode
- Update `PreviewBody.tsx`:
  - Check: if `record.previewKind === 'image' && (extension === 'tga' || 'tif' || 'tiff')` → `<DecodedImagePreview>`
  - Otherwise → `<ImagePreview>` (existing path using `key={record.id}` + effect-based blob URLs; do not revert to render-phase `useMemo` pattern)

**Exit criteria**:
- Clicking a `.tga` file shows decoded image on canvas
- Clicking a `.tif` file shows decoded image on canvas
- Clicking a `.png` file still uses `<img>` (existing path, no regression)
- Loading state visible during decode
- Unsupported extensions still show `NoPreview`
- Swapping to a different record cancels pending decode

### P4 -- Docs + Tests

**Goal**: Behavior documented, test coverage for the new feature.

**Files**:
- `docs/reference/extension-map.md`
- `apps/web/src/components/preview/PreviewPanel.test.tsx` (existing)
- `apps/web/tests/preview.spec.ts` (new E2E)

**Surface**:
- Update `extension-map.md`:
  - Add TGA/TIFF to the image table with a note about canvas-based decode
  - Mention `@lunapaint/tga-codec` and `tiff` as decoder libraries
- Unit test (`PreviewPanel.test.tsx`): verify `PreviewBody` routes `.tga`/`.tif` to decoded path
- E2E test (`preview.spec.ts`):
  - Use a fixture `.tga` file (add to `fixtures/static/` or use generated fixture)
  - Upload → select file → assert `.preview-frame` contains `<canvas>`
  - Similar for `.tif`
  - Regression: `.png` still renders `<img>` inside `.preview-frame`

**Exit criteria**:
- `bun run test:web` passes
- `bun run build && cd apps/web && bunx playwright test` passes
- `extension-map.md` reflects TGA/TIFF image support

## Verification

```
bun run check                    # lint + typecheck + build + test + smoke
cd apps/web && bunx playwright test  # E2E: TGA/TIFF preview, PNG regression
```
