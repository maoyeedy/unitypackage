# P6 -- Dead-code sweep + final verification [DONE 2026-05-27]

Shipped:
- Removed dead `getSiblingMetaRecord` wrapper from [packageModel.ts](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/packageModel.ts) and inlined it into `getDeclaredMetaInfoForRecord`.
- Removed unused `.preview-truncated` and `.unsupported-frame` rules from [preview.css](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/styles/preview.css).
- Fixed unused exports flagged by `knip` in [zipPath.ts](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/zipPath.ts).
- Cleaned up type assertions in [create.test.ts](file:///C:/Users/jerkl/Repos/unitypackage/packages/core/src/create.test.ts) to resolve build compiler issues.
