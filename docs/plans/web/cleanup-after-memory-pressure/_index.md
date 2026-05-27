# apps/web cleanup + refactor after memory-pressure fix

## Context

After the [memory-pressure freeze plans](../memory-pressure-freeze-on-file-click.md) and [follow-up state split](../memory-pressure-freeze-state-split.md) shipped (P1-P5, all DONE 2026-05-27), the freeze is gone and per-click memory delta is ~200 KB. The fix landed in a hurry: the code now works but is full of seams from the bisection -- intermediate `WorkerHeavyRecord` types, `as unknown as` casts, prop-drilled `getContent` through four component levels, a 730-line `App.tsx`, an inline ZIP-payload assembler living inside `createDownloadZipInWorker`, and a dead `getSiblingMetaRecord` wrapper.

This plan sweeps the resulting mess. **No behavior change.** Every phase preserves: zero-copy transfer of content from parse worker, the content store living outside React state, the keyless `PreviewPanelContent` reconcile, and the existing manual smoke results (60 MB baseline, 200 MB post-parse, instant click response, +200 KB per click).

## Scope

### In

- `packages/core/src/component.ts` and `packages/core/src/index.ts` -- export a `ContentlessRecord` projection so `apps/web` stops doing `Omit<UnityPackageComponentRecord, 'content'>` inline.
- `apps/web/src/parsePackage.worker.ts`, `apps/web/src/packageModel.ts`, `apps/web/src/workerTypes.ts` -- delete the `WorkerHeavyRecord` intermediate and the `as unknown as` casts; switch `entriesToRecords` to return `{ records, contents }`; use a `Set` for transfer dedup (currently `transfer.includes(buffer)` is O(n^2)).
- `apps/web/src/App.tsx` -- extract `usePackageLoader`, `useExplorerSelection`, `useZipDownload` hooks; trim from ~730 lines to roughly 250.
- `apps/web/src/zipPath.ts` (or a new `zipPayload.ts`) -- absorb the inline file/transfer assembly from `createDownloadZipInWorker`.
- `apps/web/src/components/preview/` -- split `PreviewPanel.tsx` into `PreviewPanel.tsx`, `PreviewHeader.tsx`, `PreviewBody.tsx`, `Metadata.tsx`; introduce a `ContentContext` so `getContent` is read via hook instead of prop-drilled.
- `apps/web/src/components/PreviewPanel.test.tsx` -- update imports and remove `getContent` props from test renders.
- Dead-code sweep: `getSiblingMetaRecord` wrapper in `packageModel.ts`, unused CSS rules (`.preview-truncated`, `.unsupported-frame`), any orphaned types surfaced by `knip`.

### Out

- Behavior changes to preview classification, MIME handling, or the preview "No Preview" rework. That is a separate plan ([`preview-feature-tailoring`](../preview-feature-tailoring/_index.md)).
- Replacing the `useState`-based prev-id reset in `PreviewPanelContent` -- it is correct and supported by React's render-phase setState pattern; do not regress to keyed remount.
- CLI changes beyond what `knip` flags as transitively dead.
- Performance work. The memory pressure is fixed; do not chase further micro-wins here.

## Phase overview

| #  | Title                                                              | Depends on | File                                                       |
|----|--------------------------------------------------------------------|------------|------------------------------------------------------------|
| P1 | core: export `ContentlessRecord` projection                        | --         | [P1-core-contentless-record.md](P1-core-contentless-record.md) |
| P2 | parse worker: drop `WorkerHeavyRecord` + casts; Set-based transfer | P1         | [P2-parse-worker-types.md](P2-parse-worker-types.md)       |
| P3 | App.tsx: extract `usePackageLoader` / `useExplorerSelection` / `useZipDownload` [DONE 2026-05-27] | P2 | [P3-app-state-hooks.md](P3-app-state-hooks.md) |
| P4 | ZIP payload helper: extract from `createDownloadZipInWorker` [DONE 2026-05-27] | P3         | [P4-zip-payload-helper.md](P4-zip-payload-helper.md)       |
| P5 | PreviewPanel split + `ContentContext` [DONE 2026-05-27]             | P3         | [P5-preview-panel-split.md](P5-preview-panel-split.md)     |
| P6 | Dead-code sweep + final verification [DONE 2026-05-27]              | P1-P5      | [P6-dead-code-sweep.md](P6-dead-code-sweep.md)             |

P4 and P5 are independent and may ship in either order after P3.

## Verification

- `bun run check` is green after each phase (lint + typecheck + build + test + smoke).
- `cd apps/web && bunx playwright test` is green after each phase.
- `bun run knip` flags nothing new after P6; ideally fewer hits than before P1.
- Manual smoke on `fixtures/static/archives/Polytope_URP.unitypackage` retains the post-P5 numbers: ~60 MB baseline, ~200 MB post-parse, instant click response, ~+200 KB per click. No regression in the 10-click rapid cycle or All-ZIP download.
- `Grep "as unknown as"` over `apps/web/src` and `packages/core/src` returns zero hits.
- `Grep "WorkerHeavyRecord"` over the repo returns zero hits.

## Shipped [DONE 2026-05-27]

All phases P3-P6 have been successfully completed, verified, and committed:
- **Refactoring & Hook Extraction (P3)**: Trimmed `App.tsx` down to 238 lines.
- **ZIP Payload Isolation (P4)**: Moved file/transfer packaging out of worker helper into a dedicated, unit-tested helper.
- **Component Splitting & Content Context (P5)**: Replaced `getContent` prop drilling with `ContentContext`, splitting the preview pane into 5 lightweight files.
- **Dead Code Cleanup (P6)**: Swept unreachable helpers, unused CSS styles, and knip warnings.

All verification steps, unit/E2E tests (`bun run check`, `playwright test`, `knip`), and manual smoke criteria passed without regressions.
