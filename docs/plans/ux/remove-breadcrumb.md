# Move Breadcrumb Into Details Path Row

## Context

The header in `PreviewHeader.tsx` renders a `Breadcrumb` (segments of the file's
virtual path, each ancestor clickable to reveal in tree) above the file size.
On deeply nested paths (e.g.
`Assets/Plugins/Polytope Studio/Lowpoly_Demos/Environment_Free/Helpers/Ground_Layer_02.terrainlayer`)
it wraps onto 3-5 lines, making the right pane header height jitter as the
selection changes. The same path is also rendered as plain text in the `Details`
metadata table -- so the path is shown twice, and the more useful surface (the
clickable one) is the one causing the layout problem.

This plan **does not delete** the breadcrumb. It moves it from the header into
the `Path` row of `Details`, which is already in a scrollable region where
wrapping is expected and fine. The header becomes deterministic-height
(size + mode switch + Download). The clickable-ancestor affordance is preserved.

The `revealPathInTree` callback is shared with the Metadata "Reveal in tree"
button and Explorer extension-list "Reveal" buttons -- those are **out of
scope**, only the breadcrumb's placement changes.

## Scope

### In

- `apps/web/src/components/preview/PreviewHeader.tsx` -- drop `<Breadcrumb>` and
  the `onRevealInTree` prop (no longer used by header)
- `apps/web/src/components/preview/Metadata.tsx` -- replace plain-text `Path`
  `<dd>` with the `Breadcrumb` component
- `apps/web/src/components/preview/Breadcrumb.tsx` -- keep as-is (still used,
  now from Metadata)
- `apps/web/src/styles/preview.css` -- adjust `.breadcrumb*` rules to sit
  cleanly inside a `dd` (no top/bottom margin, inherit dd font-size, ensure
  buttons align with surrounding text baseline)

### Out

- `revealPathInTree` callback in `App.tsx` / `useExplorerSelection.ts`
- `Metadata` heading "Reveal in tree" icon button (the file-level locate
  affordance stays)
- Explorer extension-list "Reveal" buttons
- Any structural change to `Details` rows beyond the `Path` `<dd>`

## Phases

| Phase | Files | Net change |
|-------|-------|------------|
| P1 -- Remove breadcrumb from header | `PreviewHeader.tsx` | -1 import, -1 JSX line, -1 prop |
| P2 -- Render breadcrumb in `Details` Path row | `Metadata.tsx` | +1 import, +1 prop wired through, +breadcrumb in `<dd>` |
| P3 -- Adjust breadcrumb CSS for `dd` context | `preview.css` | minor rule tweaks |

### P1 -- Remove breadcrumb from header  [DONE 2026-05-27]

Shipped: removed `Breadcrumb` rendering and import from `PreviewHeader.tsx`. Stopped passing `onRevealInTree` to `PreviewHeader` in `PreviewPanel.tsx`.

### P2 -- Render breadcrumb in `Details` Path row  [DONE 2026-05-27]

Shipped: imported and rendered `Breadcrumb` in `Metadata.tsx` within the Path row's `<dd>` block. Excluded the Path row from the mapped rows list so it renders explicitly first.

### P3 -- Adjust breadcrumb CSS for `dd` context  [DONE 2026-05-27]

Shipped: adjusted `.breadcrumb` and `.breadcrumb button` rules in `preview.css` to inherit font-size and color from `<dd>`, and removed header-specific top/bottom margins.

## Verification

1. `bun run check` -- lint + typecheck + build + test + smoke
2. Manual: open `fixtures/static/archives/Polytope_URP.unitypackage` in the web
   app, select a deep file such as
   `Assets/Plugins/Polytope Studio/Lowpoly_Demos/Environment_Free/Helpers/Ground_Layer_02.terrainlayer`.
   Confirm:
   - Header shows only size, mode switch (if applicable), and Download -- one
     row, no wrapping, height stable across selections
   - `Details` `Path` row shows the full path as clickable segments; clicking an
     ancestor reveals that folder in the tree
   - Switching between `Asset` and `.meta` modes does not change header height
3. Manual: select a shallow file (e.g. `Assets/Test.cs` style) and a deep file
   in sequence; the header height does not jump
4. Manual: confirm the file-level `Reveal in tree` icon button next to
   `Details` still reveals the file, and Explorer extension-list `Reveal`
   buttons still work
