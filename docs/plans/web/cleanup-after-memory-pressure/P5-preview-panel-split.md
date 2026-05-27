# P5 -- PreviewPanel split + `ContentContext` [DONE 2026-05-27]

Shipped:
- Introduced [ContentContext.tsx](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/contexts/ContentContext.tsx) to provide content-store getters to sub-components without prop-drilling.
- Split `PreviewPanel.tsx` into clean, modular files under [apps/web/src/components/preview/](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/components/preview/): [PreviewPanel.tsx](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/components/preview/PreviewPanel.tsx), [PreviewHeader.tsx](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/components/preview/PreviewHeader.tsx), [PreviewBody.tsx](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/components/preview/PreviewBody.tsx), [Metadata.tsx](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/components/preview/Metadata.tsx), and [Breadcrumb.tsx](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/components/preview/Breadcrumb.tsx).
- Relocated and updated [PreviewPanel.test.tsx](file:///C:/Users/jerkl/Repos/unitypackage/apps/web/src/components/preview/PreviewPanel.test.tsx) to use `<ContentProvider>`.
