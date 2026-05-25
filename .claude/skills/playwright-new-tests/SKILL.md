---
name: playwright-new-tests
description: Write committed E2E test suites for apps/web using @playwright/test. Use this skill whenever the user asks to add, write, create, expand, or update Playwright tests for the web app — even if they just say "add a test for X", "cover this feature", or "make sure Y is tested". Handles the full loop: reading app structure, planning test groups, writing semantic locators, building, running, and fixing failures.
---

# Writing E2E Tests for apps/web

Tests live in `apps/web/tests/`. Runner: `cd apps/web && bunx playwright test` (Chromium + Firefox, port 4173 preview).

## Workflow

1. **Orient** — read `apps/web/playwright.config.ts` and scan `apps/web/tests/` so you know what already exists.
2. **Map the UI** — read `references/app-aria-map.md` for the ARIA landmark and element map. Only re-read `apps/web/src/App.tsx` if a feature was added after the map was written.
3. **Plan** — group tests by feature boundary, one file per area. Reuse existing files when extending coverage, create new ones for distinct features.
4. **Write** — follow the locator and pattern rules below.
5. **Build then run** — `bun run --filter @unitypackage-tools/web build` then `cd apps/web && bunx playwright test`. The build is required; the preview server serves `dist/`.
6. **Fix** — read failure output, fix locators or assertions, re-run. After two failed attempts at a fix, stop patching and diagnose the root cause from the snapshot or trace.

## Locator priority

Use in this order — stop at the first one that uniquely identifies the element:

1. `getByRole(role, { name })` — always prefer semantic roles
2. `getByLabel(text)` — for form controls with a label
3. `getByPlaceholder(text)` — for inputs with placeholder text
4. `getByText(text)` — for visible text content, use regex for partial match
5. `getByTestId` — only if none of the above work and adding `data-testid` is justified

Never use CSS class selectors or XPath in tests.

## Patterns

### ESM fixture import
```typescript
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/static/editor-packed.unitypackage'
);
```
`__dirname` is not available — test files are ESM.

### Tests that need a loaded package
```typescript
test.describe('feature name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Open package').setInputFiles(fixturePath);
    await expect(page.getByText(/Parsed \d+ records/)).toBeVisible({ timeout: 15_000 });
  });

  test('...', async ({ page }) => { ... });
});
```

### Exact matching
`getByRole` does substring name matching by default. Use `{ exact: true }` whenever the label is a substring of another element's label.

Known cases in this app — see `references/app-aria-map.md` for the full list.

## Assertions

Use web-first assertions only (`toBeVisible`, `toBeEnabled`, `toBeDisabled`, `toContainText`, `toHaveText`). Never use `isVisible()` with manual `expect(bool).toBe(true)`.

Always wait for the parse to complete before asserting on explorer or preview state:
```typescript
await expect(page.getByText(/Parsed \d+ records/)).toBeVisible({ timeout: 15_000 });
```

## Reference

`references/app-aria-map.md` — full ARIA landmark map, element index, and exact-match table for `apps/web/src/App.tsx`. Read it at step 2 of the workflow.
