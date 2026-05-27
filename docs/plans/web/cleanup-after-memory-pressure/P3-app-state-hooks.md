# P3 -- App.tsx: extract `usePackageLoader` / `useExplorerSelection` / `useZipDownload` [DONE 2026-05-27]

Shipped:
- Created new hook [usePackageLoader.ts](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/hooks/usePackageLoader.ts) to manage package parsing, loading, status, and contents.
- Created new hook [useExplorerSelection.ts](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/hooks/useExplorerSelection.ts) to manage row selection, navigation, expansion, and virtual scroll tree syncing.
- Created new hook [useZipDownload.ts](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/hooks/useZipDownload.ts) to manage structural and plain ZIP generation.
- Refactored [App.tsx](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/App.tsx) down to a presentation shell of 238 lines.
