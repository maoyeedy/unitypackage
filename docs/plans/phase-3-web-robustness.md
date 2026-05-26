# Phase 3 - Web Robustness - Ship Record

## What shipped

Phase 3 improved the web app's performance, resilience, and state handling for
larger packages. Parsing and download-all archive creation now run off the main
thread, large file lists render through virtualization, richer previews and
parser diagnostics are visible in the UI, and user-facing settings persist in
the URL.

- Package parsing now runs in a Vite-bundled module worker, keeps the UI responsive, shows the active package name while loading, and routes worker failures through the app error path.
- Large package file lists now use virtualized rendering and memoized filtering/categorization while preserving existing filter behavior and stable desktop/mobile row layout.
- Preview and settings UX now includes light/dark system color variables, raw text previews for common code/data files, URL-persisted `excludeMeta`, `categorize`, and `language` settings, visible parse diagnostics, and blob URLs that refresh when file content changes.
- Download-all ZIP creation now runs in a Vite-bundled module worker so archive creation for large selections no longer blocks the main thread.

## Files changed

| File | Change |
|------|--------|
| `apps/web/src/App.tsx` | Delegates parsing and download-all ZIP creation to workers, stores diagnostics, persists selected settings in URL state, and surfaces loading/error/diagnostic UI. |
| `apps/web/src/parsePackage.worker.ts` | Added package parsing worker that returns extracted files and parser diagnostics. |
| `apps/web/src/downloadZip.worker.ts` | Added download-all ZIP worker using `fflate` async ZIP creation. |
| `apps/web/src/workerTypes.ts` | Added shared typed worker request/response contracts. |
| `apps/web/src/components/FileList.tsx` | Virtualized file list rows with `@tanstack/react-virtual` and memoized filtering/categorization. |
| `apps/web/src/components/FileListItem.tsx` | Supports virtual row measurement, text previews, and content-sensitive blob URL refresh. |
| `apps/web/src/App.css` | Added virtual list layout, diagnostics styling, preview styling, and dark-mode CSS variables. |
| `apps/web/src/index.css` | Reconciled root/global styling with the App-level theme variables. |
| `apps/web/package.json` | Added `@tanstack/react-virtual`. |
| `bun.lock` | Updated lockfile for the new virtualization dependency. |
| `.apply-plan/checkpoints/P1.md` | Recorded the worker parsing phase checkpoint. |
| `.apply-plan/checkpoints/P2.md` | Recorded the file list performance phase checkpoint. |
| `.apply-plan/checkpoints/P3.md` | Recorded the preview/settings/diagnostics phase checkpoint. |
| `.apply-plan/checkpoints/P4.md` | Recorded the download worker and integration phase checkpoint. |

## Design notes

- **Worker-first expensive operations:** Parsing and download-all ZIP creation use Vite module workers so CPU-heavy package work does not run in React render/event paths, while Blob creation and click-triggered downloads stay in the main thread where DOM APIs are available.
- **Headless virtualization:** The file list uses `@tanstack/react-virtual` instead of a prebuilt list component because it fits the existing list/category markup while limiting DOM nodes for large packages.
- **Diagnostics stay non-blocking:** Parser diagnostics are displayed after successful extraction because `parseUnityPackageEntries` can return useful files alongside warnings about package shape.
