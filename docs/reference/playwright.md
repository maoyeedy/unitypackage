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

- `apps/web/playwright.config.ts` - projects Chromium + Firefox; expects Vite preview on port 5173.

## Best practices

- Use role/text/test-id locators (`getByRole`, `getByLabel`, `getByTestId`) - resilient to DOM changes.
- Use web-first assertions (`await expect(locator).toBeVisible()`).
- Keep 5-10 smoke tests per app covering survival-critical paths.
- Use `page.route()` for network mocking.
- Use `storageState` for auth setups.

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
