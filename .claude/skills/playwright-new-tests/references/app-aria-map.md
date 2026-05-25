# App ARIA Map — apps/web/src/App.tsx

Reflects the current state of `App.tsx`. Re-read the source if a new UI section has been added.

---

## Landmark structure

```
<main>                                       implicit role: main
  <header class="topbar">                    no landmark role (nested in <main>)
  <section aria-label="Unity package workspace">   role: region
    <aside aria-label="Package controls">          role: complementary
    <section aria-label="Package explorer">        role: region
    <aside aria-label="Preview and metadata">      role: complementary
  <footer aria-live="polite">                no landmark role (nested in <main>)
```

Note: `<header>` and `<footer>` only carry `banner`/`contentinfo` roles when direct children of `<body>`. Both are inside `<main>` here, so they have no landmark role.

---

## Element index by UI zone

### Topbar (always visible)

| Locator | Element | Notes |
|---------|---------|-------|
| `getByRole('heading', { name: 'Unity Package Workspace', level: 1 })` | App title h1 | Always present |
| `getByRole('button', { name: 'Extract', exact: true })` | Extract mode tab | exact: true required — see table below |
| `getByRole('button', { name: 'Pack', exact: true })` | Pack mode tab | exact: true required |
| `getByLabel('Open package')` | File input (header) | Wrapping label → resolves to `<input type="file">` |

### Sidebar — Package controls (always visible)

| Locator | Element | Notes |
|---------|---------|-------|
| `getByPlaceholder('Filter path, GUID, or kind')` | Search input | `type="search"` |
| `getByRole('button', { name: 'Tree' })` | Tree grouping button | Segmented control |
| `getByRole('button', { name: 'Extension' })` | Extension grouping button | Segmented control |

### Extract panel — toolbar (visible in Extract mode)

| Locator | Element | Initial state |
|---------|---------|---------------|
| `getByRole('button', { name: 'Clear selection' })` | Clear selection | Disabled until selection > 0 |
| `getByRole('button', { name: 'Stage for pack' })` | Stage for pack | Disabled until selection > 0 |
| `getByRole('button', { name: 'Selected ZIP' })` | Download selected ZIP | Disabled until selection > 0 |
| `getByRole('button', { name: 'All ZIP' })` | Download all ZIP | Disabled until records > 0 |

### Extract panel — explorer (visible in Extract mode, Tree grouping)

| Locator | Element | Notes |
|---------|---------|-------|
| `getByRole('tree', { name: 'Package file tree' })` | Tree container | Absent in Extension mode |
| `getByRole('treeitem')` | Folder or file rows | Both folder and file rows use treeitem |
| `getByRole('checkbox', { name: /^Select/, disabled: false })` | Selection toggles | Folders disabled when empty; `disabled: false` filters them out |

### Extract panel — explorer (Extension grouping)

| Locator | Element | Notes |
|---------|---------|-------|
| `page.getByRole('region', { name: 'Package explorer' }).getByRole('heading', { level: 3 }).first()` | First extension group header | h3 elements only appear in Extension mode |

### Pack panel (visible in Pack mode)

| Locator | Element | Notes |
|---------|---------|-------|
| `getByRole('heading', { name: 'Pack', level: 2, exact: true })` | Pack panel heading | exact: true required |
| `getByRole('button', { name: 'Clear' })` | Clear staged items | Scope to explorer region to distinguish from Extract's "Clear selection" |
| `getByRole('button', { name: 'Export .unitypackage' })` | Export button | Always disabled (shell — wired in docs/plans/web/new-api.md) |
| `getByText(/\d+ future package entries staged/)` | Staged count text | Use toContainText for partial match |

### Preview panel (always visible)

| Locator | Element | Notes |
|---------|---------|-------|
| `getByRole('complementary', { name: 'Preview and metadata' })` | Preview aside | Scopes child locators |
| `.getByRole('heading', { name: 'No file selected' })` | Empty state heading | Visible when no record is active |
| `.getByRole('heading', { level: 2 })` | Active file name | Visible after a record activates |

### Status bar (always visible, `aria-live="polite"`)

No landmark role. Target text directly:

```typescript
// Initial state
await expect(page.getByText('Open a .unitypackage to inspect its contents.')).toBeVisible();

// After successful parse
await expect(page.getByText(/Parsed \d+ records from .+\.unitypackage/)).toBeVisible({ timeout: 15_000 });

// Parse failed
await expect(page.getByText(/Package parsing failed/)).toBeVisible();
```

---

## Exact-match table

`getByRole` name matching is substring by default. These buttons require `exact: true` because their label appears inside another element's accessible name.

| Button name | Conflicts with | Fix |
|-------------|---------------|-----|
| `'Pack'` | `'Stage for pack'` | `{ name: 'Pack', exact: true }` |
| `'Extract'` | No current conflict | `exact: true` recommended for safety |

---

## Heading hierarchy

| Level | Text | Context |
|-------|------|---------|
| h1 | "Unity Package Workspace" | Always |
| h2 | "Extract" | Extract mode panel |
| h2 | "Pack" | Pack mode panel |
| h2 | `<file name>` | Preview panel when record active |
| h2 | "No file selected" | Preview panel when no record |
| h3 | Extension name (e.g. `.shader`) | Extension grouping mode only |
| h3 | "Metadata" | Preview panel, record detail |
| h3 | "Related diagnostics" | Preview panel, when diagnostics exist |

---

## Empty state locators

| State | Locator |
|-------|---------|
| No package loaded | `getByRole('heading', { name: 'No records loaded' })` |
| No record active in preview | `getByRole('complementary', { name: 'Preview and metadata' }).getByRole('heading', { name: 'No file selected' })` |

---

## Fixture

Real `.unitypackage` for upload tests: `fixtures/static/editor-packed.unitypackage`

```typescript
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/static/editor-packed.unitypackage'
);
```

Trigger upload via the header file input (not the drop zone):
```typescript
await page.getByLabel('Open package').setInputFiles(fixturePath);
```
