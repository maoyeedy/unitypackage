# spec-web.md -- Visual / UX Spec for `apps/web`

Frozen description of the web app's UI/UX as currently shipped. Pair with `docs/product/product-web.md` (scope) and `docs/reference/unity-dark-theme.md` (visual reference).

The visual system is a deliberate adaptation of Unity Foundations dark theme (https://www.foundations.unity.com). We are not building a Unity Editor replica -- we are building a web tool that feels visually at home next to Unity. Where this spec deviates from Foundations, the deviation is intentional and called out.

---

## 1. Product identity

A local-first, browser-only `.unitypackage` viewer and extractor.

- **What it is:** open a package, browse its files, preview supported content, select files, download a ZIP.
- **What it is not:** a package authoring tool, a forensic inspector, a diff tool, a diagnostics console, or a PWA. See `product-web.md` for the full out-of-scope list.
- **Local-first:** zero network calls, zero telemetry, zero accounts. Everything happens in a Web Worker on the user's machine.
- **English only.** No language selector. No translations.

The interface should disappear in the same way the Unity Inspector window disappears -- the user thinks about the package, not about the chrome around it.

---

## 2. Design philosophy

Adapted from Unity Foundations sections 3 (Interactions) and 5 (Flat Design Principles).

- **Flat, not skeuomorphic.** Depth comes from base-layer surface colors and 1 px hairline borders, never drop shadows on chrome.
- **Quiet by default.** Color is reserved for selection, focus, and file-kind accents. Neutral grays carry 95% of the surface area. Blue (`#4C7EFF` family) is reserved for focusable, pressable, selectable controls -- it must not appear on decoration.
- **Dense over spacious.** Inter at 12 px body, 22-28 px control heights, 2/4/8/12 px gap rhythm. This mirrors Unity's Inspector spacing (sec 7.3 of the reference).
- **One affordance per action.** No redundant buttons. After the toolbar cleanup, "Zip Selected" replaces both "Selected ZIP" and "All ZIP" (select-all-in-tree + Zip Selected covers the All-ZIP case); sort dropdowns are gone (default name-ascending); "Select by extension" is gone (extension view grouping covers it).
- **Dark theme only.** No light mode, no theme toggle, no `prefers-color-scheme` branching. `color-scheme: dark` is declared once in `:root`.

---

## 3. Layout rules

Three horizontal bands, top to bottom:

```
+--------------------------------------------------+
| App bar (38 px, #191919) -- title + open + search|
+----------------------+---------------------------+
| Explorer panel       | Inspector panel           |
| (#282828)            | (#282828)                 |
|  panel-toolbar       |  preview-header titlebar  |
|   [Tree|Ext] [Clear] |   filename + size + DL    |
|   [opts][Zip Sel.]   |   [Asset|.meta] toggle    |
|  virtualized rows    |  preview-frame            |
|                      |  Details metadata         |
+----------------------+---------------------------+
| Statusbar (24 px, #3C3C3C) -- op + stats + error |
+--------------------------------------------------+
```

- **App bar** owns: package title (h1 + filename), Open button (compact drop zone), search field.
- **Workspace** is a CSS grid: `minmax(280px, 1fr) minmax(360px, 1.2fr)`, separated by a 1 px hairline gutter (`background: var(--border-default)` on the grid container).
- **Explorer panel** owns: grouping mode tabs (Tree/Extension), Clear selection icon, ZIP options + Zip Selected utility group, virtualized file list.
- **Inspector panel** owns: titlebar (filename, extension, size, single-file download, Asset/.meta switch), preview frame (stable outer height across kinds), Details metadata list.
- **Statusbar** owns: current op text (left, ellipsizing), inline file count / asset count / total bytes (right), error chip (when present).

All panel surfaces sit flush against the workspace gutter; no panel padding or rounded corners on the outer edge. Inner content is padded by the spacing scale.

**Surface depth hierarchy** (mirrors reference sec 1.1):

| Layer | Token | Use |
|---|---|---|
| Deepest | `--bg-deepest` `#0D0D0D` | inset accents (input border top edge) |
| App bar | `--bg-app-bar` `#191919` | top bar background |
| Panel | `--bg-panel` `#282828` | explorer + inspector content background |
| Input | `--bg-input` `#2A2A2A` | preview frame background |
| Tab | `--bg-tab` `#353535` | unselected tab face |
| Surface | `--bg-surface` `#383838` | workspace gutter, body fallback |
| Elevated | `--bg-elevated` `#3C3C3C` | toolbars, statusbar |
| Titlebar | `--bg-titlebar` `#3E3E3E` | inspector titlebar |
| Control | `--bg-control` `#515151` | button face |

Controls sit one or two layers above the surface they live on; inputs sit one layer below. This is the "outsets are clickable, insets are editable" cue from reference sec 5.

---

## 4. Tokens

Source of truth: `apps/web/src/styles/tokens.css`. Roughly 50 named tokens; never inline raw hex outside that file (exception: the hljs syntax palette in `inspector.css`, kept as a documented allowlist).

### 4.1 Spacing

Unity-aligned: 2 / 8 / 15 base extended for web density.

| Token | Value | Typical use |
|---|---|---|
| `--space-1` | 2 px | between properties in metadata list |
| `--space-2` | 4 px | adjacent button gap inside groups |
| `--space-3` | 8 px | between unrelated controls in a row |
| `--space-4` | 12 px | toolbar padding, panel inner padding |
| `--space-5` | 16 px | section spacing |
| `--space-6` | 24 px | empty-state padding |
| `--indent-level` | 15 px | tree nesting per depth level (reference sec 7.3) |

### 4.2 Typography

| Token | Value | Use |
|---|---|---|
| `--font-sans` | `"Inter Variable", "Inter", "Verdana", system-ui, sans-serif` | all UI text |
| `--font-mono` | `ui-monospace, SFMono-Regular, Consolas, ...` | preview body, metadata values |
| `--fs-9` | 9 px | reserved (do not introduce new uses) |
| `--fs-10` | 10 px | sparing -- small dense labels |
| `--fs-11` | 11 px | secondary text, statusbar, metadata values |
| `--fs-12` | 12 px | **default body, buttons, inputs, tree rows** |
| `--fs-14` | 14 px | empty-state headings |
| `--fs-19` | 19 px | error-boundary fallback heading only |

Inter Variable is self-hosted via `@fontsource-variable/inter` and imported once from `index.css`. The reference sec 2.2 lists Inter as the Unity Foundations primary; we adopt it without modification. Weights used: 400 (body), 500 (button labels), 600 (panel headings).

### 4.3 Color

Surfaces and borders are listed in section 3 above. Remaining semantic groups:

**Text** (reference sec 1.3):

| Token | Value | Use |
|---|---|---|
| `--text-primary` | `#D2D2D2` | body text |
| `--text-secondary` | `#C4C4C4` | section headings, mid-emphasis |
| `--text-tertiary` | `#BDBDBD` | labels, captions, dim text |
| `--text-button` | `#EEEEEE` | button label |
| `--text-on-selection` | `#FFFFFF` | text on selected row |
| `--text-link` | `#4C7EFF` | breadcrumb links |
| `--text-error` | `#D32222` | error chip |
| `--text-warning` | `#F4BC02` | reserved |
| `--text-focus` | `#81B4FF` | label of focused field (reserved) |

**Selection / focus** (reference sec 1.4-1.5):

| Token | Value | Use |
|---|---|---|
| `--selection-bg` | `#2C5D87` | active selected tree row |
| `--selection-bg-inactive` | `#4D4D4D` | active row when viewport unfocused |
| `--selection-bg-hover` | `rgba(255,255,255,0.06)` | row hover overlay |
| `--focus-ring` | `#3A79BB` | input focus border |
| `--focus-ring-bright` | `#7BAEFA` | universal `:focus-visible` outline |

**File-kind accents** (reference sec 4.2, Unity product-area palette):

| Token | Value | Domain mapping |
|---|---|---|
| `--kind-image` | `#80D8FF` | textures, sprites, PNG/JPG |
| `--kind-audio` | `#AF91F4` | wav, mp3, ogg |
| `--kind-video` | `#FF6E40` | mp4, mov |
| `--kind-document` | `#4C7EFF` | text, md, pdf |
| `--kind-shader` | `#E78DDC` | shader, compute, hlsl |
| `--kind-code` | `#B2FF59` | cs, ts, js |
| `--kind-data` | `#FFC107` | json, yaml |
| `--kind-unity` | `#57AEFF` | .unity, .prefab, .meta |

### 4.4 Radius

| Token | Value | Use |
|---|---|---|
| `--radius-control` | 3 px | buttons, inputs, sort selects |
| `--radius-panel` | 4 px | dropdown menus, preview frame |
| `--radius-pill` | 22 px | search field (reference sec 6.7) |

Per reference sec 3.5, rounded corners are reserved for interactive elements. Panels and the workspace itself have square corners.

### 4.5 Shadow

| Token | Value | Use |
|---|---|---|
| `--shadow-overlay` | `0 8px 24px rgba(0,0,0,0.5)` | popover menus only |

No shadows on panels, toolbars, or buttons. This matches reference sec 5 ("no excessive shadows -- depth via accented borders").

### 4.6 Motion

| Token | Value | Use |
|---|---|---|
| `--transition-fast` | `120ms ease` | hover/active background and border transitions |

No keyframed animations except `@keyframes spin` (loading spinner).

---

## 5. Core components

Class primitives in `apps/web/src/styles/components.css`. Use these directly in JSX -- do not introduce new bespoke component classes for variants of these.

### 5.1 `.btn` -- Button (reference sec 6.1)

- Default: 28 px height, `--bg-control` face, top border lighter (raised look), `--text-button` label.
- Variants: `.btn--icon` (28x28 square), `.btn--sm` (22 px), `.btn--toolbar` (matches container surface), `.btn--primary` (blue-tinted face for the primary action).
- States: hover -> `--bg-hover-control`; active / `aria-pressed="true"` -> `--bg-pressed` (blue) with `--border-deepest`; hover+pressed -> `--bg-hover-pressed`; disabled -> opacity 0.4.

### 5.2 `.input` and `.input--search` (reference sec 6.5, 6.7)

- Inset look: darker top border (`--border-deepest`), lighter bottom border (`--border-default`).
- Hover border -> `--border-input-hover`; focus border -> `--focus-ring`.
- `.input--search` adds `border-radius: --radius-pill` and minimum 180 px width.

### 5.3 `.tabs` -- Segmented control (reference sec 6.3)

- Container: `--bg-tab` with 1 px outer border, 1 px inner padding.
- Buttons: transparent fill default; `.active` -> `--bg-elevated` face, `--text-secondary` label.
- Used for: Tree/Extension grouping mode in explorer, Asset/.meta switch in inspector (as `.preview-mode-switch`).

### 5.4 `.toggle-row` -- Checkbox row (reference sec 6.4)

- Label + native checkbox sized to 18 px with `accent-color: --focus-ring`.
- Used only inside the ZIP options popover.

### 5.5 `.dropdown` + `.dropdown-menu` (reference sec 6.2)

- `<details><summary>` pattern. Summary is styled as a `.btn`; the marker is hidden via `::-webkit-details-marker { display: none }` and `::marker { content: '' }`.
- Menu is absolutely positioned, `top: 100% + 2px`, anchored by a positioned ancestor (`.zip-group`).
- `<details>` does the open/close logic -- no JS state. This is the only place the app departs from Foundations' button-with-popover pattern.

### 5.6 `.tree-row` / `.file-row` / `.folder-row`

- Virtualized via `@tanstack/react-virtual` (38 px estimated row height).
- Default text `--text-primary`; hover -> `--selection-bg-hover` overlay; active (no selection) -> `--selection-bg-inactive`; selected -> `--selection-bg` with `--text-on-selection`.
- File-kind icon tint via `.file-kind-*` modifier; selected/active rows force the icon to `--text-on-selection`.
- Folder rows show ChevronDown/ChevronRight glyph + Folder/FolderOpen.
- Depth indent is hard-coded as `12 + depth * 18` pixels for now; spec target is `--indent-level` (15 px) -- migrate when convenient.

### 5.7 `.selection-toggle`

- 28x28 transparent button with an inline custom SVG checkbox.
- States: `none` (empty box), `partial` (dash overlay), `all` (check inside box).
- Acts as a `role="checkbox"` with `aria-checked` of `"true"` | `"false"` | `"mixed"`.

### 5.8 `.preview-frame`

- Fixed outer dimensions: `flex: 0 0 min(360px, 46vh)` -- **must stay stable across image / text / no-preview kinds** (E2E asserts this).
- `scrollbar-width: none` plus `::-webkit-scrollbar { display: none }` -- scroll works without visible bar.
- Modifier classes set the body type: `.image-frame`, `.text-frame`, `.no-preview-frame`.

### 5.9 `.zip-group` (this app's only bespoke composition)

- Visually joins the ZIP options gear and the Zip Selected primary button into one unit, with shared borders and zero gap. Communicates "these two controls operate on the same thing."
- `position: relative` so the menu inside the inner `<details>` anchors to the group's right edge (menu opens leftward, covering both buttons).

---

## 6. Page inventory

Single-page application. No routing, no deep links, no URL state. One screen, three regions:

| Region | Element | aria-label |
|---|---|---|
| App bar | `<header className="app-bar">` | `Package toolbar` |
| Workspace | `<section className="workspace">` | `Unity package workspace` |
| Explorer (left pane) | `<section className="explorer-panel">` | `Package explorer` |
| Inspector (right pane) | `<aside className="inspector-panel">` | `Preview and metadata` |
| Statusbar | `<footer className="statusbar">` | `aria-live="polite"` |

A separate error-boundary screen (`.app-error`) renders if `AppContent` throws.

---

## 7. UX states

Every interactive control occupies the state set below. Apply these as `:hover`, `:focus-visible`, `[aria-pressed="true"]`, `:disabled`, and `.active` / `.selected` data classes. This list maps 1:1 to reference sec 3.1.

| State | Treatment |
|---|---|
| Default | base token (e.g. `.btn` uses `--bg-control`) |
| Hover | lighter fill (`--bg-hover-control`) or lighter border on inputs |
| Focus | 1 px `--focus-ring-bright` outline, 1 px offset (universal `:focus-visible` rule in `index.css`) |
| Pressed | blue-tinted fill (`--bg-pressed`) + `--border-deepest` border |
| Checked / active | `.tabs .active`, `.btn--toolbar.active` -> elevated face + `--text-secondary` |
| Disabled | `opacity: 0.4` uniformly on the entire control (reference sec 3.2). No tint changes. |
| Selected (rows) | `--selection-bg` background + `--text-on-selection` text. Inactive viewport -> `--selection-bg-inactive`. |
| Loading | spinner-only on the drop zone (`.spin` keyframe). The rest of the UI does not gray out during parse. |
| Empty (no package) | Explorer shows "No records loaded" empty-state card; Inspector shows "No file selected" card. The app bar and statusbar remain fully visible. |
| Empty (no selection) | "Zip Selected" button disabled (opacity 0.4); Clear selection button disabled. |

Drag-and-drop on the compact drop zone shows `.drag-active` (blue focus ring tint).

---

## 8. Responsive rules

The app is sized for a desktop browser. We target two breakpoints:

| Breakpoint | Behavior |
|---|---|
| `>= 900 px` (default) | 2-pane grid: explorer + inspector side by side |
| `< 900 px` | Workspace collapses to single column; explorer above, inspector below; statusbar and app bar stay full-width |
| `< 760 px` | Metadata list collapses from 2-column to 1-column grid (label above value) |

Minimum supported width is 320 px (browser default body min-width). Below that the toolbar wraps but does not stack. Mobile is not a first-class target.

---

## 9. Accessibility rules

Aligned with reference sec 7.1 (WCAG 2.1 AA).

- **Contrast:** body text against panel surface must be >= 4.5:1; icons and form controls >= 3:1; focus ring against any background >= 3:1. `--text-primary` `#D2D2D2` on `--bg-panel` `#282828` = 9.7:1, well above target.
- **Focus ring:** universal `:focus-visible { outline: 1px solid var(--focus-ring-bright); outline-offset: 1px }` rule in `index.css`. Never remove with `outline: none` without replacing.
- **Keyboard nav:**
  - Tab / Shift+Tab: standard focus order.
  - Inside the explorer viewport: arrow keys move focused row, Space toggles selection, Enter activates (preview), Shift+arrows extend range, Ctrl/Cmd+A selects all, Home/End jump.
  - ArrowLeft on a folder collapses; ArrowRight expands; on a file ArrowLeft jumps to parent folder.
- **ARIA:**
  - Workspace regions use `aria-label` (see section 6).
  - The virtualized list root is `role="tree"` with `aria-activedescendant`; rows are `role="treeitem"`.
  - Selection checkboxes are `role="checkbox"` with `aria-checked={"true" | "false" | "mixed"}`.
  - Statusbar is `aria-live="polite"`.
- **Labels:** every icon-only button (Clear, ZIP options gear, Download) has both `aria-label` and `title`. The file input retains `aria-label="Open Unity package"` -- this is a contract surface that the E2E suite drives via `getByLabel`.

---

## 10. Agent implementation rules

For any agent (Claude, Codex, Cursor, etc.) editing this app:

1. **Consume tokens. Do not inline raw hex or px outside the spacing scale.** The only files allowed to contain raw color hex are `styles/tokens.css` and the documented hljs allowlist in `styles/inspector.css`.
2. **Do not introduce a light theme** or `prefers-color-scheme` branching. `color-scheme: dark` is permanent.
3. **Do not add features outside `product-web.md` scope** (no pack, verify, diff, diagnostics, find-in-preview, audio/video preview, PWA).
4. **Keep aria-labels and key class names stable.** The E2E suite depends on: `Open Unity package`, `Preview and metadata`, `Package explorer`, `Package file tree`, `Package file extensions`, `Preview source`, button names `Tree` / `Extension` / `Asset` / `.meta` / `Zip Selected` / `Clear selection`, class names `.tree-row` / `.file-row` / `.preview-frame` / `.preview-frame.text-frame` / `.preview-frame.image-frame` / `.preview-frame.no-preview-frame` / `.statusbar` / `.statusbar-op` / `.package-title p` / `.button-row`.
5. **One affordance per action.** When tempted to add a second button that does the same thing differently (e.g. "All ZIP" alongside "Zip Selected"), prefer adding affordances in the data view (select-all-in-tree, extension grouping) instead of adding more toolbar buttons.
6. **Rebuild core after editing `packages/core/src/`** (per project CLAUDE.md). Web does not see core source edits until `bun run --filter unitypackage-core build` runs.
7. **Reference `docs/reference/unity-dark-theme.md` whenever introducing a new control.** Do not invent component states; map them to the table in sec 6 of that doc.

---

## 11. Acceptance checklist

Use to gate any PR that changes UI surfaces.

**Visual:**
- [ ] No raw hex outside `tokens.css` + hljs allowlist (`rg "#[0-9a-fA-F]{6}" apps/web/src/styles`).
- [ ] No raw spacing values outside `--space-*` and documented exceptions.
- [ ] All controls have visible `:focus-visible` rings at 3:1 contrast.
- [ ] All controls have a `:disabled` opacity-0.4 treatment when relevant.
- [ ] `.preview-frame` outer height is identical across `text` / `image` / `no-preview` kinds (E2E asserts).

**Functional:**
- [ ] Open Polytope_URP fixture, browse tree, search, select, preview text + image, switch to Asset/.meta on a sidecar file.
- [ ] Click "Zip Selected" with at least one selection; verify download named `selected_files.zip`.
- [ ] ZIP options popover toggles via summary click; checkboxes update; selecting "Include .meta sidecars in ZIP" still works.
- [ ] `.meta` rows hidden from the tree (search `.meta` returns 0 visible files).
- [ ] `preview.png` records hidden from the tree (search `.preview.png` returns 0).

**Scope:**
- [ ] No Pack / Verify / Diff / Diagnostics / Settings / language-selector UI present.
- [ ] No light-mode toggle, no theme switch, no PWA install prompt.
- [ ] No find-in-preview, code folding, or text-preview chunking UI.

**Build / tests:**
- [ ] `bun run typecheck` clean.
- [ ] `bun run test:web` -- 38/38 passing.
- [ ] `bun run build` clean; Inter subsets emit under `dist/assets/inter-*.woff2`.
- [ ] `cd apps/web && bunx playwright test` -- known pre-existing failure on `meta sidecar renders immediate text preview` (Details visibility) is tolerated; all other tests pass.
- [ ] `bun run knip` -- no new unused files / exports introduced by the change.

**Foundations alignment cross-check:**
- [ ] Surface depth hierarchy matches `unity-dark-theme.md` sec 1.1.
- [ ] Text colors match sec 1.3.
- [ ] Selection color (`#2C5D87`) matches sec 1.4.
- [ ] Focus ring (`#7BAEFA` / `#3A79BB`) matches sec 1.5.
- [ ] Inter is the lead font (sec 2.1).
- [ ] Disabled treatment is uniform 40% opacity (sec 3.2).
- [ ] Component states map to sec 6 (Button, Dropdown, Tabs, Toggle, Text Field, Search Field, Toolbar).
- [ ] No light theme assets present; `color-scheme: dark` only.

---

## Appendix A: Alternative 3-column layout (considered, not adopted)

**TLDR.** Before the current top-bar + 2-pane shape was chosen, the app shipped a 3-column workspace with no app bar. We document it here as a reference point -- it is the pre-rewrite state, and a reasonable fallback if the inspector ever needs to shed the right-pane workload.

```
+----------------------------------------------------------+
| Sidebar       | Explorer (center)  | Preview (right)     |
| 245-300px     | 1fr (>=380px)      | 320-420px           |
+----------------------------------------------------------+
| Statusbar                                                |
+----------------------------------------------------------+
```

### What each pane does

- **Left -- Sidebar (`#282828`, ~270 px).** Vertical stack of every "secondary" control: full-size drop zone (~132 px tall) at the top, package title block (h1 + filename), search input, grouping-mode segmented control (Tree | Extension), a `<details>` disclosure for ZIP options (preserve folders / include `.meta` sidecars), and a second `<details>` for package summary stats (Visible / Total / Assets / Meta / Bytes).
- **Center -- Explorer (`#282828`, flexible).** Panel toolbar at top with the "Extract" heading + visible-files count, sort dropdown + asc/desc toggle, Clear selection, Invert selection, Select by extension, Selected ZIP, All ZIP. Below the toolbar: the virtualized tree or extension list (same component, two render modes).
- **Right -- Preview (`#282828`, ~360 px).** Identical content to the current inspector pane: preview header (file size + optional Asset/.meta toggle + Download), `.preview-frame` body (image / text / no-preview), Details metadata list with Path breadcrumb and "Reveal in tree" affordance.
- **Bottom -- Statusbar (`#3C3C3C`, 38 px).** Current operation text on the left, error chip on the right. Stats are *not* duplicated here -- they live inside the sidebar disclosure.

### Affordances unique to this layout

- **Pane collapse toggles.** Each side pane has a small 20x44 px collapse button that appears on hover at the inner edge (`.pane-collapse-toggle--left` / `--right`). Collapsing shrinks the column to 28 px and hides all children except the toggle, letting the explorer expand to fill the freed width.
- **Full-bleed drop zone.** Because the sidebar always exists, the drop zone is always visible (no empty-state escalation needed). Drag-drop works against the visible sidebar zone.
- **Disclosures over popovers.** ZIP options and package stats are inline `<details>` accordions rather than overlay menus -- they push sidebar content down when expanded.

### Why this layout was dropped

- The sidebar competed with the explorer for attention. Three vertical stripes of similar weight created visual noise.
- "Open package" and search are rare/high-level actions; burying them in a column alongside grouping toggles and stats hides them.
- The disclosure-heavy sidebar made the chrome feel heavier than the content (the actual file list).
- Pane collapse toggles added a control vocabulary the user must learn just to reclaim space; the 2-pane shape simply gives more horizontal room by default.

### When this layout might come back

If a future scope expansion legitimately needs a *third* persistent surface (e.g. a depgraph visualizer alongside file browsing and preview), restoring the 3-column shape is preferable to introducing tabs. Until then, the 2-pane shape is the canonical layout.
