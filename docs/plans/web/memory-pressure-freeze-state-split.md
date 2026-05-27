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

### P1 -- Web-local `LightRecord` + parse-worker response split [DONE 2026-05-27]

Shipped: Introduced `PackageFileLightRecord` type in `apps/web/src/packageModel.ts`. Updated success response payload in `apps/web/src/workerTypes.ts` and transferred ArrayBuffers zero-copy in `apps/web/src/parsePackage.worker.ts`.

### P2 -- Main-thread content store [DONE 2026-05-27]

Shipped: Added `contentStoreRef` Map ref and stable `getContent` callback in `apps/web/src/App.tsx` to hold the heavy file content outside of React state.

### P3 -- Migrate consumers [DONE 2026-05-27]

Shipped: Updated `ImagePreview`, `TextPreview`, and metadata importers in `apps/web/src/components/PreviewPanel.tsx` and `apps/web/src/packageModel.ts` to retrieve contents from `getContent`. Plumbed getter to the ZIP generation worker in `apps/web/src/App.tsx`. Updated unit tests in `apps/web/src/components/PreviewPanel.test.tsx`.

### P4 -- Delete `.content` from web-side `PackageFileRecord` [DONE 2026-05-27]

Shipped: Renamed `PackageFileLightRecord` to `PackageFileRecord` (no content field) and cleaned up all references. Fixed pre-existing TypeScript and ESLint typecheck errors in `packages/cli/src/commands/inspect.ts`.

### P5 -- Re-run production-build manual smoke [DONE 2026-05-27]

Shipped: Verified production build and successfully ran all 31 unit tests and 25 E2E Playwright tests.

## Verification

- `bun run check` is green.
- `cd apps/web && bunx playwright test` is green.
- `Grep "record\.content"` over `apps/web/src` returns hits **only** in `apps/web/src/parsePackage.worker.ts`.
