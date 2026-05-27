# Remove Breadcrumb UI

## Context

The breadcrumb in `PreviewPanel` displays the virtual path of the currently previewed file (e.g. `Assets/Scripts/Player.cs`) with clickable ancestor segments that reveal the file's location in the tree explorer. It was judged **KEEP** in a prior feature-bloat analysis, but the owner has decided to remove it regardless.

The breadcrumb shares the `revealPathInTree` callback with two other surfaces (Metadata panel "Reveal in Tree" links, Explorer extension-list group header "Reveal" buttons). Those are **out of scope** — only the breadcrumb UI is removed.

## Scope

### In

- `Breadcrumb` component definition in `PreviewPanel.tsx`
- `<Breadcrumb>` JSX usage in `PreviewPanelContent`
- Breadcrumb CSS classes (`.breadcrumb`, `.breadcrumb-part`, `.breadcrumb-separator`, `.breadcrumb button`, `.breadcrumb button:hover`)
- `onRevealInTree` prop on Breadcrumb (not on PreviewPanel)

### Out

- `revealPathInTree` callback in `App.tsx`
- `expandAncestors` / `getAncestorFolderPaths` in `packageModel.ts`
- Metadata panel "Reveal in Tree" links
- Explorer extension-list "Reveal" buttons
- Any test changes (breadcrumb has no tests)

## Phases

| Phase | Files | Lines removed |
|-------|-------|---------------|
| P1 -- Remove Breadcrumb component + JSX | `PreviewPanel.tsx` | ~29 (component) + 1 (JSX call site) |
| P2 -- Remove breadcrumb CSS | `preview.css` | ~36 |

### P1 -- Remove Breadcrumb component + JSX

**Goal**: Delete the `Breadcrumb` function component and its single usage in `PreviewPanelContent`.

**Files**: `apps/web/src/components/PreviewPanel.tsx`

**Changes**:
- Remove `Breadcrumb` component definition (lines 144--172)
- Remove `<Breadcrumb virtualPath={...} onRevealInTree={...} />` JSX call (line 99)
- Do NOT remove `onRevealInTree` from `PreviewPanelProps` — Metadata still uses it at line 135

**Exit criteria**:
- `Breadcrumb` identifier no longer exists in any file
- PreviewPanel renders without a breadcrumb element above the file size `<p>`
- All other reveal-in-tree functionality (Metadata, ExtensionList) unaffected

### P2 -- Remove breadcrumb CSS

**Goal**: Delete all breadcrumb-related CSS rules.

**Files**: `apps/web/src/styles/preview.css`

**Changes**:
- Remove ruleset `.breadcrumb { ... }` (lines 164--172)
- Remove ruleset `.breadcrumb-part { ... }` (lines 174--177)
- Remove ruleset `.breadcrumb-separator { ... }` (lines 179--182)
- Remove ruleset `.breadcrumb button { ... }` (lines 184--195)
- Remove ruleset `.breadcrumb button:hover { ... }` (lines 197--199)

**Exit criteria**:
- Grep for `.breadcrumb` in `apps/web/src/styles/preview.css` returns no matches
- No unused CSS classes remain

## Verification

1. `bun run check` (lint + typecheck + build + test + smoke)
2. Manual: open a package in the web app, select a file — preview panel header should show only file size, Download button, and (if applicable) Asset/.meta toggle. No path breadcrumb visible.
3. Manual: confirm Metadata panel "Reveal in Tree" still works, Explorer extension group "Reveal" buttons still work.
