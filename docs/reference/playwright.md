# Playwright E2E Test Reference

[Playwright](https://playwright.dev) (`@playwright/test`) is the E2E test runner for `apps/web`.

## Quick start

```bash
cd apps/web
bunx playwright test              # run all tests
bunx playwright test --debug      # run with Playwright Inspector
bunx playwright test --ui         # watch mode with timeline
bunx playwright show-report       # serve HTML report locally
bunx playwright codegen           # record actions, generate locator drafts
```

## Config

- `apps/web/playwright.config.ts` - project Chromium; expects Vite preview on port 4173.

## Best practices

- Use role/text/test-id locators (`getByRole`, `getByLabel`, `getByTestId`) - resilient to DOM changes.
- Use web-first assertions (`await expect(locator).toBeVisible()`).
- Let Playwright auto-wait through locators/assertions; do not add arbitrary sleeps for parse, render, or upload timing.
- Use the per-test `page` fixture; Playwright creates an isolated browser context for each test.
- Use `setInputFiles()` for `.unitypackage` uploads; do not automate OS file pickers.
- Search/filter before clicking virtualized explorer rows; offscreen package files are not attached to the DOM.
- Rebuild with `bun run build` before E2E when testing production preview output.
- Keep 5-10 smoke tests per app covering survival-critical paths.
- Keep browser smoke matrix cases as persistent tests when they caught a regression once: supported text, unsupported no-preview, image preview, frame height, and scroll behavior.

## Detailed API reference

For locators, assertions, fixtures, page object model, tracing, CI sharding, and component testing, query Context7 with library ID `/microsoft/playwright`. The `@playwright/test` docs cover all of:
- Locator API (`getByRole`, `getByText`, `filter`, `and`, `or`)
- Web-first assertions (`toBeVisible`, `toHaveText`, `toHaveCount`, `toHaveScreenshot`)
- Fixtures and page object model
- Network interception and mocking
- Authentication and storage state
- Device emulation
- Trace viewer and debugging
- CI integration with sharding and blob reports
