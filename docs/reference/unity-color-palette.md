# Unity Editor Dark Theme -- Visual Spec (Web Reference)

**Scope:** Analysis of the Unity Editor Foundations design system, extracted specifically for a web UI rewrite that targets dark theme only. This is NOT a replica of the Unity Editor interface -- it is a style reference to help the web app feel visually at home alongside Unity's dark theme conventions: colors, typography, spacing, iconography, interactions, and component styles.

**Light theme omitted.** Dark theme only. Raw Unity USS variables (~100) collapsed into ~50 semantic CSS tokens.

**Context7:** `/websites/foundations_unity`

**Sources analyzed:**
- https://www.foundations.unity.com/fundamentals/color-palette
- https://www.foundations.unity.com/fundamentals/typography
- https://www.foundations.unity.com/fundamentals/iconography
- https://www.foundations.unity.com/fundamentals/interactions
- https://www.foundations.unity.com/components/button
- https://www.foundations.unity.com/components/dropdown
- https://www.foundations.unity.com/components/tab
- https://www.foundations.unity.com/components/toggle
- https://www.foundations.unity.com/components/text-field
- https://www.foundations.unity.com/components/numeric-field
- https://www.foundations.unity.com/components/search-field
- https://www.foundations.unity.com/components/toolbar
- https://www.foundations.unity.com/components/tooltip
- https://www.foundations.unity.com/fundamentals/accessibility
- https://www.foundations.unity.com/patterns/content-organization
- https://www.foundations.unity.com/components/tree-view
- https://www.foundations.unity.com/components/foldout

---

## 1. Color Palette

Source: Color Palette page. Collapses ~100 Unity USS variables into ~50 semantic tokens.

### 1.1 Surface (Background by Depth)

Layered darkest-to-lightest. Each step up = one layer closer to user.

| Token | Value | Usage |
|---|---|---|
| `--bg-deepest` | `#0D0D0D` | Inset accents, button pressed border, input field accent border |
| `--bg-app-bar` | `#191919` | Application toolbar, app toolbar button borders |
| `--bg-panel` | `#282828` | Default panel background, object field background |
| `--bg-input` | `#2A2A2A` | Text/numeric/search field background |
| `--bg-tab` | `#353535` | Unselected Editor window tab |
| `--bg-surface` | `#383838` | Standard window/surface background |
| `--bg-elevated` | `#3C3C3C` | Toolbar, header bar, selected tab, inspector toolbar |
| `--bg-titlebar` | `#3E3E3E` | Inspector titlebar |
| `--bg-alt-row` | `#3F3F3F` | Alternating list/table row |
| `--bg-control` | `#515151` | Control face (dropdown, button default) |
| `--bg-control-hover` | `#585858` | Control hover (button, dropdown) |
| `--bg-slider-groove` | `#5E5E5E` | Slider track |
| `--bg-scrollbar-thumb` | `#5F5F5F` | Scrollbar handle default |
| `--bg-slider-thumb` | `#999999` | Slider handle default |

**Interactive surface states:**

| Token | Value | Usage |
|---|---|---|
| `--bg-hover` | `#424242` | App toolbar button hover |
| `--bg-hover-light` | `#464646` | Toolbar button / header column hover |
| `--bg-hover-lighter` | `#474747` | Inspector titlebar hover |
| `--bg-hover-bright` | `#494949` | Scrollbar button hover |
| `--bg-hover-control` | `#676767` | Button hover surface |
| `--bg-active` | `#505050` | Toolbar button checked, header pressed |
| `--bg-active-darker` | `#6A6A6A` | App toolbar button active/pressed |
| `--bg-pressed` | `#46607C` | Button pressed (blue-tinted surface) |
| `--bg-hover-pressed` | `#4F657F` | Button hover + pressed combined |
| `--bg-focus` | `#6E6E6E` | Button focus state |

### 1.2 Borders

| Token | Value | Usage |
|---|---|---|
| `--border-deepest` | `#0D0D0D` | Input field accent, button pressed border |
| `--border-app-bar` | `#191919` | App toolbar button border |
| `--border-inspector` | `#1A1A1A` | Inspector titlebar border |
| `--border-object` | `#202020` | Object field border |
| `--border-input` | `#212121` | Input field border |
| `--border-accent` | `#222222` | App toolbar button border accent |
| `--border-default` | `#232323` | Default border (toolbar, helpbox, window) |
| `--border-window` | `#242424` | Window border, button/dropdown border accent |
| `--border-control` | `#303030` | Button, dropdown, inspector titlebar accent |
| `--border-scrollbar-thumb` | `#323232` | Scrollbar thumb border |
| `--border-input-hover` | `#656565` | Input/object field border on hover |

### 1.3 Text

| Token | Value | Usage |
|---|---|---|
| `--text-primary` | `#D2D2D2` | Default body text |
| `--text-secondary` | `#C4C4C4` | Labels, toolbar buttons |
| `--text-tertiary` | `#BDBDBD` | Dimmer text (helpbox, tabs, window, hover) |
| `--text-dropdown` | `#E4E4E4` | Dropdown/popup text |
| `--text-button` | `#EEEEEE` | Button label |
| `--text-overlay` | `#DEDEDE` | Preview overlay text |
| `--text-on-selection` | `#FFFFFF` | Text on highlighted/selected background |
| `--text-link` | `#4C7EFF` | Unvisited link, highlighted/selected text |
| `--text-link-visited` | `#FF00FF` | Visited link |
| `--text-error` | `#D32222` | Error message |
| `--text-warning` | `#F4BC02` | Warning message |
| `--text-focus` | `#81B4FF` | Label text when focused |
| `--text-highlight` | `#4C7EFF` | Selected/highlighted item text |

**Behavior notes:**
- Hover state dims text slightly (primary `#D2D2D2` -> `#BDBDBD`) since backgrounds don't always change.
- Error red `#D32222` is desaturated vs light theme (`#5A0000`) -- still noticeable but less fatiguing.
- Warning amber `#F4BC02` stays readable without being blinding.
- Link/highlight blue `#4C7EFF` carries brand accent without being too bright on dark.

### 1.4 Selection / Highlight

| Token | Value | Usage |
|---|---|---|
| `--selection-bg` | `#2C5D87` | Selected item or text background |
| `--selection-bg-inactive` | `#4D4D4D` | Selected item when control unfocused |
| `--selection-bg-hover` | `rgba(255, 255, 255, 0.06)` | Row hover overlay |
| `--selection-bg-hover-alt` | `#5F5F5F` | Row hover for rows with custom bg |
| `--selection-text` | `#4C7EFF` | Selected item text |
| `--selection-text-inactive` | `#FFFFFF` | Selected text when unfocused |

### 1.5 Accent / Focus Ring

| Token | Value | Usage |
|---|---|---|
| `--focus-ring` | `#3A79BB` | Input/object field focus border |
| `--focus-ring-bright` | `#7BAEFA` | Button focus border accent |

Blue is reserved for focusable, pressable, selectable controls.

### 1.6 Component-Specific

**Helpbox:**

| Token | Value |
|---|---|
| `--helpbox-bg` | `rgba(96, 96, 96, 0.20)` |
| `--helpbox-border` | `#232323` |
| `--helpbox-text` | `#BDBDBD` |

**Scrollbar:**

| Token | Value |
|---|---|
| `--scrollbar-button-bg` | `rgba(0, 0, 0, 0.05)` |
| `--scrollbar-button-hover` | `#494949` |
| `--scrollbar-groove-bg` | `rgba(0, 0, 0, 0.05)` |
| `--scrollbar-groove-border` | `rgba(0, 0, 0, 0.10)` |
| `--scrollbar-thumb-bg` | `#5F5F5F` |
| `--scrollbar-thumb-hover` | `#686868` |
| `--scrollbar-thumb-border` | `#323232` |

**Slider:**

| Token | Value |
|---|---|
| `--slider-groove-bg` | `#5E5E5E` |
| `--slider-groove-disabled` | `#575757` |
| `--slider-thumb-bg` | `#999999` |
| `--slider-thumb-hover` | `#EAEAEA` |
| `--slider-thumb-disabled` | `#666666` |
| `--slider-thumb-border` | `#999999` |
| `--slider-thumb-halo` | `rgba(16, 111, 205, 0.50)` |

---

## 2. Typography

Source: Typography page.

### 2.1 Font Family

```
Inter (primary) -> Verdana (Windows fallback) / Lucida Grande (macOS fallback)
```

Inter was chosen for dense UIs: tight letter-spacing, clear glyphs at small sizes, critical for dark-theme readability in a pixel-dense editor.

### 2.2 Type Scale

Six sizes using USS variables:

| USS Variable | Size | Usage |
|---|---|---|
| `--unity-metrics-default-font_tiny_size` | **9 px** | Only when absolutely necessary |
| `--unity-metrics-default-font_small_size` | **10 px** | Sparingly -- grid labels, Timeline/Profiler tracks, helpbox text |
| `--unity-metrics-default-font_semi_small_size` | **11 px** | Search fields inside toolbars |
| `--unity-metrics-default-font_normal_size` | **12 px** | **Default for most text** |
| `--unity-metrics-default-font_big_size` | **14 px** | Sparingly -- list labels (e.g. Profiler) |
| `--unity-metrics-default-font_very_big_size` | **19 px** | Sparingly -- window titles (e.g. Project Settings) |

### 2.3 Line Heights

| USS Variable | Height | Usage |
|---|---|---|
| `--unity-metrics-single_line_small-height` | **16 px** | Small single-line controls (mini toggle, mini text field) |
| `--unity-metrics-single_line-height` | **18 px** | Standard single-line controls (one-line text field) |
| `--unity-metrics-single_line_large-height` | **20 px** | Large single-line controls (Inspector title bar labels) |

### 2.4 Alignment

- **Left-aligned** -- windows, dialogs, most components
- **Center-aligned** -- button labels only
- **Indentation** -- conveys nesting/parenting (Hierarchy, Inspector, menus)

### 2.5 Font Weights

No explicit USS variables. Figma text styles imply Regular (400) for body/labels, Medium (500) for emphasis, matching Inter's intended use.

---

## 3. Interactions

Source: Interactions page.

### 3.1 State Model

Every interactive control can occupy these states (applied alphabetically as pseudo-classes):

| State | Behavior |
|---|---|
| Default | Idle, no interaction |
| `:hover` | Cursor paused over element -- lighter fill on action controls, lighter border on inputs |
| `:focus` | Keyboard or click focus -- blue ring/indicator (blue reserved for focusable/pressable/selectable only) |
| `:pressed` | Held down -- blue-tinted fill, emphasized border |
| `:checked` | Binary ON state (toggles, tabs, toolbar buttons) |
| `:disabled` | 40% opacity on entire control -- no input accepted, tooltip should explain why |
| `:selected` / `:highlighted` | List/tree view item or text selection -- blue background |
| `:inactive` | Selected control that lost focus -- dimmer selection color |

**State hierarchy note:** `:pressed` is dominant -- it donates continuous active state and overrides other visual treatments while held.

### 3.2 Disabled Treatment

**40% opacity** applied uniformly to label + icon + background of the entire control.

### 3.3 Focus Styling

- **1 px blue outline** surrounding the focused field or control
- For elements without a clear input boundary: a blue 1 px box around the greater element area
- Labels associated with the focused field also turn blue (`--text-focus`: `#81B4FF`)
- Focus indicator must have at least **3:1 contrast** with the background (WCAG 2.4.11)
- Selected list items show focus with blue highlight (`#2C5D87`) + white text (`#FFFFFF`)
- Blue (`#7BAEFA` / `#3A79BB`) is reserved for focusable, pressable, selectable controls only

### 3.4 Focus Navigation

- **Tab** -- top-left to bottom-right logical order
- **Shift+Tab** -- reverse
- **Ctrl+Tab** -- cycle between first open tab in each window group
- **Spacebar** -- expand dropdowns, activate buttons, toggle checkboxes
- **Arrow keys** -- cycle dropdown content, scroll 4 directions
- **Esc** -- close dropdown, dismiss dialog
- **Enter/Return** -- activate link, button, submit autocomplete

### 3.5 Drag and Drop

| Action | Modifier | Cursor |
|---|---|---|
| Add/Copy | (none) on supported targets | Copy cursor |
| Duplicate | **Alt** + drag | Copy cursor |
| Move/Reorder | (none) | Default (system) |

- Drop target shows **blue line** in list views, **blue background** in folder views.
- Drag ghost shows current position.
- Rounded corners reserved for interactive elements (not panels/containers).
- Underlining only for external-editor links, appears on hover only (not idle).

### 3.6 Cursor Cues

- Slider label: cursor changes glyph, drag L/R to adjust
- Numeric field: same
- Toggle label: click to toggle
- Resize cursor while dragging panel edges

---

## 4. Iconography

Source: Iconography page.

### 4.1 Icon Canvas

- **Artboard:** 16 x 16 px
- **Padding:** 1 px margin all around -> **effective icon body 14 x 14 px**
- **Format:** PNG with transparency (SVG not yet available in IMGUI)
- **Retina:** 2 x (32 x 32, `@2x` suffix)

### 4.2 Color Treatment on Dark Theme

**Default (grayscale) icons:**
- Dark theme: `#C4C4C4` (matches `--text-secondary`)

**Product-area colors** (brighter on dark theme for readability):

| Color | Area | Dark Theme |
|---|---|---|
| Blue | Graphics | `#80D8FF` |
| Coral | Navigation | `#FF6E40` |
| Cyan | Animation | `#80FFE6` |
| Green | Physics | `#B2FF59` |
| Magenta | Network & Constraints | `#E78DDC` |
| Purple | 2D | `#AF91F4` |
| Yellow | Lights | `#FFC107` |

**Feedback icon colors:**

| Role | Dark Theme |
|---|---|
| Active / ON (Cobalt) | `#57AEFF` |
| Neutral / Standby (Gray) | `#555555` |
| Success (Green) | `#14D368` |
| Error (Scarlet) | `#FF534A` |
| Warning (Yellow) | `#FFC107` |
| White (on selected state) | `#F0F0F0` |

**Tool mode accent colors:**

| Role | Dark Theme |
|---|---|
| Remove (Antique Red) | `#FD8678` |
| Modify (Iris/Purple) | `#A1A3FF` |
| Select (Orange) | `#FFBA6B` |
| Add (Sea/Spring Green) | `#69E39F` |

### 4.3 Icon States

- **Default:** Standard PNG (`d_` prefix for dark theme, e.g. `d_Animation.Play.png`)
- **Selected:** Separate file with ` On` suffix (e.g. `d_Animation.Play On.png`), rendered on blue selection highlight
- **Hover/Active:** No dedicated files -- composed at runtime via cobalt `#57AEFF` highlight overlay
- **Disabled:** No dedicated files -- handled via 40% opacity on the control

### 4.4 Dark Theme Default

Icons without `d_` prefix fall back to light-theme rendering on both themes. Dark theme is the default target -- all icons optimized for it.

---

## 5. Flat Design Principles

- **No excessive shadows.** Depth via accented borders and base layer backgrounds.
- **Insets:** Input fields use a darker top border to appear recessed.
- **Outsets:** Clickable controls (buttons) use a lighter top border to appear raised.
- **Base layers:** Colors arranged dark-to-light across 3 base layers (Base 1 = deepest / app bar, Base 2 = components/windows, Base 3 = toolbars on top).

---

## 6. Component Visuals

### 6.1 Button

| Property | Mini | Default | Large |
|---|---|---|---|
| Height | 18 px | 20 px | 24 px |
| Padding | 2 px | 3 px | 5 px |

- **Typography:** Inter, centered, single line, sentence case
- **Treat as:** Outset (sits above surface)

**Button states (dark theme):**

| State | Background | Border |
|---|---|---|
| Default | `#585858` | `#303030` |
| Hover | `#676767` | inherits |
| Focus | `#6E6E6E` | `#7BAEFA` |
| Pressed | `#46607C` | `#0D0D0D` |
| Hover + Pressed | `#4F657F` | inherits |
| Text | `#EEEEEE` | -- |

**Toolbar button variant:**

| State | Background | Border | Text |
|---|---|---|---|
| Default | `#3C3C3C` | `#232323` | `#C4C4C4` |
| Hover | `#464646` | inherits | `#BDBDBD` |
| Focus | `#464646` | inherits | -- |
| Checked | `#505050` | inherits | `#C4C4C4` |

### 6.2 Dropdown (Pop-up)

- **Anatomy:** Button (label + expander arrow) + Menu (appears below with **1 px overlap**)
- **Behaves like** a button with a pop-up layer

| State | Background | Border |
|---|---|---|
| Default | `#515151` | `#303030` |
| Hover | `#585858` | inherits |
| Focus | inherits | `#7BAEFA` (blue) |
| Text | `#E4E4E4` | -- |
| Border accent | -- | `#242424` |

### 6.3 Tab (Window Docking)

- Selected tab is `#3C3C3C` (matches toolbar/elevated surface), unselected is `#353535`
- Hover highlights to `#303030`
- Selected accent (blue line/underline): `#2C5D87`
- Text: `#BDBDBD`

| State | Background | Text |
|---|---|---|
| Default | `#353535` | `#BDBDBD` |
| Selected | `#3C3C3C` | `#BDBDBD` |
| Hover | `#303030` | inherits |

### 6.4 Toggle

- Reuses input field color tokens; no dedicated toggle color variables
- **Anatomy:** Label + Box + Glyph (checkmark or dash for mixed/indeterminate)
- Label on left (right-aligned for Inspector)
- **Checkmark glyph color:** `#C4C4C4` (dark theme)
- **States:** Default -> Hover -> Focused -> Pressed -> Disabled
- **Checked states:** Checked (checkmark), Unchecked (empty), Mixed (dash `-`)

**Color tokens used:**

| Role | Value |
|---|---|
| Box border accent | `#0D0D0D` |
| Box border hover | `#656565` |
| Box border focus | `#3A79BB` |

### 6.5 Text Field

- **Treat as:** Inset/recessed (sits beneath surface plane)
- **Typography:** Inter, 12 px default (USS `normal_size`)

| State | Background | Border |
|---|---|---|
| Default | `#282828` | `#0D0D0D` (accent) |
| Hover | inherits | `#656565` |
| Focus | inherits | `#3A79BB` |
| Disabled | 40% opacity on entire control | inherits |
| Placeholder | -- | tint `#999` |

### 6.6 Numeric Field

- Same inset slot pattern as Text Field
- **Label label-drag:** cursor changes glyph on label hover, drag L/R to adjust value
- Invalid entry reverts to last valid value on blur (no visual error border)

Color tokens identical to Text Field above.

### 6.7 Search Field

- **Pill-shaped** (`border-radius: 22 px`)
- Sits in toolbar area (nav variant) or full-width

| Property | Nav/Toolbar | Full-width |
|---|---|---|
| Height | 38 px | 44 px |
| Max width | 260 px | -- |
| Min width | 150 px | 800 px |

| State | Background | Border | Text |
|---|---|---|---|
| Default | `#323334` (nav) / `#191A1B` (full) | `1 px solid #565758` | `#C2C2C2` |
| Hover | `#565758` (nav) / no bg change (full) | `#565758` | `#E4E5E6` |
| Focus | inherits | `2 px solid rgba(33, 150, 243, 0.5)` | `#FFFFFF` |
| Search icon | `#C4C4C4` | -- | -- |
| Input padding-left | 16 px | -- | -- |

Search fields are **flat** (not recessed like text fields). The pill shape + dark fill creates a contained appearance.

### 6.8 Toolbar

- Sits at top of window below tab label
- Can be horizontal or vertical

| Part | Background | Border |
|---|---|---|
| Toolbar container | `#3C3C3C` | `#232323` |
| Toolbar button | `#3C3C3C` (matches container) | `#232323` |
| Toolbar button hover | `#464646` | inherits |
| Toolbar button checked | `#505050` | inherits |

- Every toolbar button has left + right border by default (`.ToolbarButtonLeft` / `.ToolbarButtonRight` strip one side to avoid double-borders at edges)
- **Element groups** separated by spacing
- High-traffic actions on left, low-traffic on right

### 6.9 Tooltip

| Property | Value |
|---|---|
| Background | `#373737` |
| Border | `#191919` (1 px) |
| Text | `#D2D2D2` (left-aligned) |
| Max width | 300 px |
| Max lines | 3 |
| Max chars | 200 |
| Position | Centered, 10 px below trigger |
| Appear delay | 400 ms hover |
| Disappear | Instant on drag start or cursor leaves trigger |
| Chain hover | New tooltip appears immediately (no delay) |

- Text-only (no icons/images)
- Drawn by OS as floating window (platform-native look on macOS vs Windows)
- All controls should have a tooltip

---

## 7. Accessibility & Layout

### 7.1 Contrast Requirements

Unity targets WCAG 2.1 AA:

| Element | Minimum ratio | WCAG ref |
|---|---|---|
| Normal text | **4.5:1** | 1.4.3 Contrast |
| Non-text (icons, form controls) | **3.0:1** | 1.4.11 Non-text contrast |
| Focus indicator | **3.0:1** vs background | 2.4.11 Focus appearance |

### 7.2 Focus Styling Summary

- 1 px blue outline around focused control
- Labels of focused fields turn blue
- Selected list items: blue `#2C5D87` background + white `#FFFFFF` text
- Blue is reserved for focusable/pressable/selectable controls

### 7.3 Inspector Spacing (Reference Scale)

Unity's Inspector spacing provides a sense of their vertical rhythm:

| Context | Spacing |
|---|---|
| Inspector window inner padding | 18 px left, 4 px right, 8 px top, 8 px bottom |
| Between single property fields | **2 px** vertical (1 px top + 1 px bottom margin) |
| Between grouped property fields | **8 px** vertical separation |
| Nesting / hierarchy indent | **15 px** per level (max 6 levels) |

### 7.4 Control Height Scale

Unity's single-line control heights map to the typography line-height scale:

| Size | Height | Usage |
|---|---|---|
| Small | **16 px** | Mini toggle, mini text field |
| Standard | **18 px** | One-line text field, standard controls |
| Large | **20 px** | Inspector title bar label |

---

## Naming Convention Reference

USS variable pattern: `--unity-{group}-{role_and_control}-{sub_element}-{pseudo_state_sequence}`

Example: `--unity-colors-button-text-hover`
- Group: colors
- Control: button
- Sub-element: text
- Pseudo-state: hover

Multiple pseudo-states appear alphabetically, underscore-separated: `focus_selected`.
