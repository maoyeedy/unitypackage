# Web Product Spec

## TLDR

The web app is a simple, local-first `.unitypackage` viewer and extractor. It is for opening a package in the browser, understanding what files are inside, selecting useful files, previewing basic content, and downloading extracted ZIPs.

## Product Goal

Make the web UI the easiest path for a Unity user to answer three questions:

1. What is inside this `.unitypackage`?
2. Which files do I want to extract?
3. Can I download those files with the right `.meta` sidecars?

The web app should avoid teaching users package internals unless that knowledge directly helps view or extract files.

## In Scope

- Open one `.unitypackage` from the browser through the sidebar drop zone or file picker.
- Parse locally in the browser. No upload, account, server storage, or telemetry requirement.
- Browse package contents as a tree or by extension.
- Search by file name or full package path.
- Select files with checkboxes, keyboard range selection, invert selection, and select by extension.
- Preview basic content:
  - Images render inline.
  - Text renders as plain decoded text via synchronous `TextDecoder.decode` + `hljs.highlight` (no size cap).
  - Unsupported binaries show a "No preview" message, metadata, and a download action.
- Download the current file.
- Download Selected ZIP and All ZIP.
- Include matching `.meta` sidecars in ZIP output by default for selected assets and all-assets extraction.
- Keep `.meta` rows hidden from browsing. Let users inspect a selected file's `.meta` sidecar from the preview pane when one exists.
  - The **Asset/.meta** switch only toggles preview content. Filesize, download, and the Details section always reflect the asset, never the sidecar.
- Hide Unity-generated `preview.png` package records from the web UI and ZIP extraction.
- Show simple statusbar progress, completion, and fatal errors.
- Keep UI dense, quiet, and utility-focused for repeated package inspection.

## Out Of Scope

- Pack mode or `.unitypackage` creation in the web app.
- Editing paths, GUIDs, metadata, importers, or package contents.
- Dragging loose project files into the web app to create package drafts.
- Format diagnostics, warning lists, finding counts, or diagnostic-code filters.
- Verify, strict verify, schema validation, or health scoring.
- Diffing packages.
- Inspect JSON/tree reports intended for automation.
- Rich editor-grade source-code viewer features such as find-in-preview, line virtualization, code folding, or heavyweight multi-language grammars.
- Audio/video/PDF embedded preview quality work.
- Base64 copy, GUID copy helpers, or advanced metadata sidecar inspector UI.
- PWA installability, service worker precache, file handlers, or offline app shell behavior.
- Localization, language selection, user accounts, cloud import/export, or telemetry.

## ZIP Semantics

- All ZIP means all asset files plus matching `.meta` sidecars.
- Selected ZIP means selected files plus matching `.meta` sidecars for selected assets.
- Unity preview thumbnails are always excluded.
- `.meta` sidecars are not selectable as normal rows. The ZIP sidecar option controls whether matching sidecars are included in ZIP output.
- Preserve folder structure by default. The flatten option may remain, but duplicate output names must stay deterministic.

## Dropped Dependencies

| Dependency | Drop reason |
| --- | --- |
| `fflate` in web | Web no longer creates compressed ZIPs through a dependency. Extraction ZIPs use a tiny stored-ZIP worker. Core still uses `fflate` for `.unitypackage` gzip parsing/writing. |
| `shiki` | Replaced by `highlight.js` to avoid large lazy WASM/grammar chunks. |
| `@shikijs/langs` | Only needed by Shiki language bundles. Removed with rich code preview. |
| `@shikijs/themes` | Only needed by Shiki theme bundles. Removed with rich code preview. |
| `workbox-window` | Service worker registration is out of scope after removing PWA behavior. |
| `vite-plugin-pwa` | PWA manifest, precache, and file handlers are out of scope. |
| `@testing-library/user-event` in web | No current web component test needs it after removing mode-tab component tests. |

## Retained Dependencies

| Dependency | Why it stays |
| --- | --- |
| `unitypackage-core` | The web app depends on the shared parser, component-record conversion, classification, and sidecar-selection logic. This keeps browser behavior aligned with core format rules. |
| `react` and `react-dom` | The app is a stateful interactive browser UI with selection, filtering, preview panes, and worker-backed parsing. React remains the UI foundation. |
| `@tanstack/react-virtual` | Large Unity packages can contain many files. Virtualized explorer rows keep browsing responsive without rendering the full tree at once. |
| `highlight.js` | Provides lightweight, tree-shaken syntax highlighting for `.cs`, `.yaml`, and `.json` previews without heavy WASM or lazy chunks. |
| `lucide-react` | Provides consistent, tree-shakeable icons for dense utility controls and file categories. |
| `vite` | Fast app build/dev server and worker bundling for the web package. |
| `@vitejs/plugin-react`, React Compiler, and Babel bridge | Preserve the current React build path and compiler setup used by the app. |
| `@playwright/test` | Covers real browser workflows: load package, browse, select, and download ZIP. |
| `vitest`, RTL, and jsdom | Cover fast component/model tests without launching a browser. |

## Product Constraints

- Browser-only implementation must remain local and privacy-preserving.
- Web UI should not surface parser warnings unless parsing fails in a way that blocks viewing.
- User-facing terms should favor Unity user language: files, folders, extract, ZIP, `.meta`.
- Avoid new dependency classes unless they directly improve open, browse, preview, select, or extract.
- Bundle size matters. Any new heavy preview feature needs a clear user value case and should stay lazy-loaded.

## Acceptance Checks

- A user can open `Polytope_URP.unitypackage`, browse the tree, search for `Ground_Layer_01.terrainlayer`, select it, and download `selected_files.zip`.
- `selected_files.zip` contains the selected asset and its `.meta` sidecar.
- Searching `.preview.png` returns no visible files.
- `.meta` files are hidden from browsing, and a selected asset with a sidecar exposes a `.meta` preview switch that toggles preview content only (filesize, download, and Details stay asset-side).
- No Pack, Diagnostics, or PWA install UI is visible.
