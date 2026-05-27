# P4 -- ZIP payload helper: extract from `createDownloadZipInWorker` [DONE 2026-05-27]

Shipped:
- Extended [zipPath.ts](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/zipPath.ts) with `buildZipPayload` to handle duplicate path resolution and payload structure assembly outside the worker.
- Updated [useZipDownload.ts](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/hooks/useZipDownload.ts) to use the new payload helper.
- Added comprehensive unit tests in [zipPath.test.ts](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/zipPath.test.ts).
