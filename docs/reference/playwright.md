# Playwright Reference

Microsoft's open-source (Apache 2.0) framework for web testing and automation. Drives Chromium, Firefox, and WebKit with a single API across Linux, macOS, and Windows.

- **Source**: <https://github.com/microsoft/playwright>
- **Docs**: <https://playwright.dev/docs/intro>
- **CLI (agents)**: <https://playwright.dev/docs/getting-started-cli>
- **MCP**: <https://playwright.dev/docs/getting-started-mcp>
- **npm**: `playwright` (library), `@playwright/test` (test runner), `@playwright/cli` (agent CLI), `@playwright/mcp` (MCP server)

---

## 1. Architecture & Core Concepts

### How Playwright Works

Unlike Selenium (which uses individual HTTP round-trips via WebDriver), Playwright maintains a **persistent bidirectional connection** to the browser via the Chrome DevTools Protocol (CDP) for Chromium and equivalent protocols for Firefox/WebKit. This enables:

- **Auto-waiting**: Before any action (click, fill, etc.), Playwright automatically verifies the element is visible, stable, enabled, and not obscured. No `sleep()` or explicit waits needed.
- **Browser contexts**: Isolated sessions within a single browser instance. Each context has its own cookies, localStorage, and session storage -- true test isolation without launching a new browser.
- **Cross-browser single API**: Same code drives Chromium, Firefox, and WebKit.

### Playwright Library vs. Playwright Test

| Aspect | Library (`playwright`) | Test Runner (`@playwright/test`) |
|--------|----------------------|----------------------------------|
| Install | `npm install playwright` | `npm init playwright@latest` |
| Import from | `playwright` | `@playwright/test` |
| Browser mgmt | Manual launch/context/page | Auto via fixtures (`page`, `context`) |
| Assertions | None built-in | Web-first assertions (`toHaveTitle`, `toBeVisible`) |
| Running | `node script.js` | `npx playwright test` |
| Cleanup | Manual `browser.close()` | Auto via fixtures |
| Config | N/A | `playwright.config.ts` (matrix, projects, sharding) |
| Reporting | N/A | HTML, JSON, JUnit, blob, etc. |

**Rule of thumb**: Use `@playwright/test` for end-to-end testing. Use `playwright` (library) for scripting, scraping, PDF generation, screenshot bots, or integrating with other test frameworks.

---

## 2. Installation & Setup

### Test Runner (recommended for E2E)

```bash
npm init playwright@latest
```

This scaffolds: `playwright.config.ts`, `tests/` folder, and a basic example.

### Library (programmatic scripting)

```bash
npm install playwright
# Then install browsers:
npx playwright install chromium firefox webkit
# Or via npm packages (auto-download on install):
npm install @playwright/browser-chromium @playwright/browser-firefox @playwright/browser-webkit
```

### MCP Server (AI agent integration)

```bash
npx @playwright/mcp@latest
```

See section 6 for MCP setup details per client.

---

## 3. Key APIs & Patterns

### Basic Script (Library)

```typescript
import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://example.com');
  await page.screenshot({ path: 'screenshot.png' });
  await browser.close();
})();
```

### Basic Test (Test Runner)

```typescript
import { test, expect } from '@playwright/test';

test('homepage has title', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});
```

### Locators (Preferred over CSS/XPath)

```typescript
// User-facing attributes - resilient to DOM changes
page.getByRole('button', { name: 'Submit' });
page.getByLabel('Email address');
page.getByPlaceholder('Enter your name');
page.getByText('Welcome back');
page.getByTestId('checkout-button');

// Chaining & filtering
const product = page.getByRole('listitem').filter({ hasText: 'Product 2' });
await product.getByRole('button', { name: 'Add to cart' }).click();
```

### Web-First Assertions

```typescript
await expect(page).toHaveURL(/checkout/);
await expect(page).toHaveTitle(/Success/);
await expect(page.getByText('welcome')).toBeVisible();
await expect(page.getByRole('button')).toBeEnabled();
await expect(page.locator('input')).toHaveValue('test');
await expect(page.locator('ul > li')).toHaveCount(3);

// Soft assertion - doesn't stop test, collects failures
await expect.soft(page.getByTestId('status')).toHaveText('Success');
```

### Page Object Model

```typescript
export class LoginPage {
  readonly usernameInput = this.page.getByLabel('Username');
  readonly passwordInput = this.page.getByLabel('Password');
  readonly submitButton = this.page.getByRole('button', { name: 'Sign in' });

  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('https://example.com/login');
  }

  async login(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}

// In test:
test('login works', async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto();
  await login.login('user', 'pass');
  await expect(page).toHaveURL(/dashboard/);
});
```

### Fixtures (Custom Test Extensions)

```typescript
import { test as base } from '@playwright/test';
import { LoginPage } from './login-page';

type MyFixtures = {
  loginPage: LoginPage;
};

export const test = base.extend<MyFixtures>({
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await use(loginPage);
    // cleanup runs after test
  },
});

export { expect } from '@playwright/test';
```

### Network Mocking & Interception

```typescript
// Full mock
await page.route('*/**/api/v1/fruits', async route => {
  await route.fulfill({ json: [{ name: 'Strawberry', id: 21 }] });
});

// Modify real response
await page.route('*/**/api/v1/fruits', async route => {
  const response = await route.fetch();
  const json = await response.json();
  json.push({ name: 'Loquat', id: 100 });
  await route.fulfill({ response, json });
});

// Block resources
await page.route('**.jpg', route => route.abort());
```

### Authentication via storageState

```typescript
// In global setup (playwright/auth.setup.ts):
import { test as setup } from '@playwright/test';

setup('authenticate', async ({ page }) => {
  await page.goto('https://github.com/login');
  await page.getByLabel('Username or email address').fill('user');
  await page.getByLabel('Password').fill('pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('https://github.com/');
  await page.context().storageState({ path: 'playwright/.auth/user.json' });
});
```

```typescript
// playwright.config.ts:
export default defineConfig({
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { storageState: 'playwright/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
});
```

### Tracing & Screenshots

```typescript
// Test runner - in config:
export default defineConfig({
  use: {
    trace: 'on-first-retry', // or 'on', 'retain-on-failure'
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});

// Library - programmatic:
await context.tracing.start({ screenshots: true, snapshots: true });
// ... actions ...
await context.tracing.stop({ path: 'trace.zip' });
```

### API Testing (without browser)

```typescript
test('api test', async ({ request }) => {
  const res = await request.post('https://api.example.com/login', {
    form: { user: 'admin', password: 'pass' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.token).toBeDefined();
});
```

### Device Emulation

```typescript
// Per-test:
test.use({ ...devices['iPhone 15'] });

// In config:
export default defineConfig({
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
```

---

## 4. Advanced Usage

### With Vite

Playwright Test is **bundler-agnostic**. To reuse Vite path mappings/plugins in tests, use `ctViteConfig` in `playwright.config.ts` (for component testing):

```typescript
export default defineConfig({
  ctViteConfig: {
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    plugins: [react()], // or vue(), svelte(), etc.
  },
});
```

For path alias support in regular E2E tests, configure `tsconfig.json` path mappings and point Playwright to it:

```typescript
// playwright.config.ts
export default defineConfig({
  tsconfig: './tsconfig.test.json',
});
```

### With Bun

Playwright runs on Node.js, so use it via `bunx` or regular npm scripts:

```bash
bunx playwright test
bunx playwright install
```

Programmatic usage from a Bun script works identically to Node.js. TypeScript types are auto-resolved.

### With TypeScript

- Works out of the box -- no separate compilation step needed.
- Create `.ts` test files and Playwright handles transpilation.
- Use `tsconfig` field in config for custom path mappings.
- Strongly recommended for IDE autocompletion and `no-floating-promises` linting.

```bash
npx playwright test --tsconfig tsconfig.test.json
```

### Browser Context Isolation

```typescript
// Multiple authenticated roles in one test
test('admin and user', async ({ browser }) => {
  const adminCtx = await browser.newContext({ storageState: 'admin.json' });
  const userCtx = await browser.newContext({ storageState: 'user.json' });
  const adminPage = await adminCtx.newPage();
  const userPage = await userCtx.newPage();
  // interact with both...
  await adminCtx.close();
  await userCtx.close();
});
```

### WebSocket & Event Handling

```typescript
page.on('request', request => console.log(request.url()));
page.on('response', response => console.log(response.status()));
page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
page.on('dialog', dialog => dialog.accept());
```

### Evaluating JavaScript in Page

```typescript
const title = await page.evaluate(() => document.title);
const dims = await page.evaluate(() => ({
  width: document.documentElement.scrollWidth,
  height: document.documentElement.scrollHeight,
}));
const links = await page.locator('a').evaluateAll(
  els => els.map(el => (el as HTMLAnchorElement).href)
);
```

### Running Headless vs. Headed

```typescript
const browser = await chromium.launch({
  headless: false, // show browser UI
  slowMo: 250,     // slow down by 250ms for debugging
});

// MCP server:
// npx @playwright/mcp@latest --headless
```

### CI Configuration (Sharding)

```yaml
# GitHub Actions - 4 parallel shards
jobs:
  playwright-tests:
    strategy:
      matrix:
        shardIndex: [1, 2, 3, 4]
        shardTotal: [4]
    steps:
      - run: npx playwright test --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}
      - uses: actions/upload-artifact@v4
        with:
          name: blob-report-${{ matrix.shardIndex }}
          path: blob-report

  # Merge step (separate job):
  # npx playwright merge-reports --reporter=html,github ./blob-reports
```

---

## 5. CLI Tools

| Command | Description |
|---------|-------------|
| `npx playwright test` | Run test suite |
| `npx playwright test --debug` | Run with Playwright Inspector |
| `npx playwright test --ui` | Launch UI Mode (watch, timeline, time travel) |
| `npx playwright test --project=chromium` | Run specific project |
| `npx playwright test --grep "login"` | Run tests matching pattern |
| `npx playwright test --shard=1/4` | Run 1 of 4 shards |
| `npx playwright codegen <url>` | Open recorder + locator picker |
| `npx playwright show-report` | Serve HTML report locally |
| `npx playwright install` | Install browser binaries |

---

## 6. Playwright CLI for Agent Automation (`@playwright/cli`)

The `@playwright/cli` package provides a command-line interface designed for AI coding agents (Claude Code, Codex, etc.). It avoids the token/context overhead of MCP tool schemas and verbose accessibility trees, making it the **preferred default** for agent-driven browser automation.

### Decision Table: CLI vs. MCP vs. Test Runner

| Use case | Better choice | Why |
|----------|---------------|-----|
| Claude Code working inside a repo | **CLI + skills** | Lower token/context overhead; works like normal shell tooling |
| Generate/verify E2E tests | **CLI + Test Runner** | Agent runs CLI commands, inspects snapshots/screenshots, then commits test code |
| Quick browser smoke test of local app | **CLI** | `open`, `click`, `snapshot`, `screenshot`, `console`, `requests` are enough |
| Long exploratory QA session | **MCP** | Persistent browser context + iterative reasoning over accessibility snapshots |
| Need Claude to "drive browser naturally" | **MCP** | Direct MCP browser tools; Claude Code supports `claude mcp add playwright npx @playwright/mcp@latest` |
| Security-sensitive / untrusted sites | **CLI (or MCP --isolated)** | MCP has broader tool surface; `browser_run_code_unsafe` is RCE-equivalent |
| Committed E2E test suites | **`@playwright/test`** | Standard test runner for CI, reporting, sharding, tracing |

### Installation

```bash
npm install -g @playwright/cli@latest
playwright-cli install --skills
```

This installs skills for Claude Code at `.claude/skills/playwright-cli/SKILL.md`.

### Basic Usage

```bash
# Open a browser session
playwright-cli open https://example.com

# Interact using refs from the snapshot
playwright-cli click e15
playwright-cli type "query"
playwright-cli press Enter

# Inspect state
playwright-cli snapshot
playwright-cli screenshot
playwright-cli console
playwright-cli requests

# Close
playwright-cli close
```

### Available Commands

Full reference in `.claude/skills/playwright-cli/SKILL.md` (installed skill).

| Category | Commands |
|----------|----------|
| Core | `open`, `goto`, `click`, `dblclick`, `fill`, `type`, `press`, `select`, `hover`, `drag`, `drop`, `upload`, `check`, `uncheck` |
| Navigation | `go-back`, `go-forward`, `reload` |
| Keyboard | `press`, `keydown`, `keyup` |
| Mouse | `mousemove`, `mousedown`, `mouseup`, `mousewheel` |
| Output | `snapshot`, `screenshot`, `pdf`, `eval` |
| Tabs | `tab-list`, `tab-new`, `tab-close`, `tab-select` |
| Storage | `state-save`, `state-load`, `cookie-*`, `localstorage-*`, `sessionstorage-*` |
| Network | `route`, `route-list`, `unroute` |
| DevTools | `console`, `requests`, `request`, `run-code`, `tracing-*`, `video-*`, `highlight`, `show --annotate`, `generate-locator` |

### Session Management

```bash
# Named sessions
playwright-cli -s=mysession open example.com --persistent
playwright-cli -s=mysession click e6
playwright-cli -s=mysession close

# List / close all
playwright-cli list
playwright-cli close-all
playwright-cli kill-all
```

### Browser Selection

```bash
playwright-cli open --browser=chrome
playwright-cli open --browser=firefox
playwright-cli open --browser=webkit
playwright-cli open --browser=msedge   # default if detected
```

### Raw Output Mode

```bash
playwright-cli --raw eval "document.title"
playwright-cli --raw snapshot > page.yml
```

### Project-Specific Config

Default config `.playwright/cli.config.json` is created by `playwright-cli install --skills`.

---

## 7. Playwright MCP (AI Agent Integration - Optional)

**Prefer `@playwright/cli` (section 6) for daily agent use.** MCP is better for long exploratory sessions where persistent browser context and iterative accessibility-tree reasoning matter more than token cost.

The `@playwright/mcp` package exposes browser automation as Model Context Protocol tools. AI agents (Claude Code, Codex, Cursor, etc.) can navigate, click, type, screenshot, and inspect pages -- using accessibility snapshots (not pixels), so **no vision model needed**.

### MCP Setup Per Client

#### Claude Code

```bash
claude mcp add playwright npx @playwright/mcp@latest
```

#### VS Code

```bash
code --add-mcp '{"name":"playwright","command":"npx","args":["@playwright/mcp@latest"]}'
```

#### Cursor

`Cursor Settings` -> `MCP` -> `Add new MCP Server` -> command type: `npx @playwright/mcp@latest`

#### Codex / Cline / Windsurf / Others

Add to your MCP config file (e.g., `.opencode/mcp.json`, `.windsurf/mcp.json`, `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

For Codex specifically, see [opencode MCP docs](https://opencode.ai/docs/agents/mcp).

### MCP Server Options

```bash
# Headless mode
npx @playwright/mcp@latest --headless

# Pick browser
npx @playwright/mcp@latest --browser=firefox

# Isolated session (no persisted state)
npx @playwright/mcp@latest --isolated

# Standalone HTTP server
npx @playwright/mcp@latest --port 8931
```

Then in MCP config:
```json
{ "mcpServers": { "playwright": { "url": "http://localhost:8931/mcp" } } }
```

### MCP Tools Available to AI Agents

- **Navigation**: open URL, go back/forward, reload
- **Interaction**: click, type, fill, select, hover, drag-drop
- **Screenshot**: full page or element
- **Network**: list requests, inspect, mock routes
- **Console**: access browser console output
- **Storage**: save/restore cookies, localStorage, session
- **Tabs**: create, close, switch tabs
- **Code execution**: `browser_run_code_unsafe` (requires opt-in)

### Example AI Prompt

```
Navigate to https://demo.playwright.dev/todomvc, add "Buy milk" and "Write docs" as todo items,
then mark "Buy milk" as completed. Take a screenshot of the result.
```

---

## 8. How Our Apps/Web Can Benefit

### Use Cases

1. **End-to-end testing**: Full user flow coverage across Chromium, Firefox, WebKit -- same API.
2. **Self-QA via AI agents**: MCP server lets Claude Code / Codex autonomously explore and verify web apps during development. Prompt: "Navigate to the staging site and test the checkout flow."
3. **Visual regression**: `expect(page).toHaveScreenshot()` with pixel-diff thresholds.
4. **API testing**: Unified test runner for both API and UI tests -- no need for a separate HTTP client.
5. **Web scraping & automation**: Programmatic scripts for data extraction, PDF generation, form automation.
6. **CI/CD gate**: Sharded parallel runs on GitHub Actions/Azure Pipelines with trace viewer for failures.
7. **Accessibility testing**: Built-in accessibility tree snapshots and role-based locators encourage a11y-aware tests.
8. **Component testing** (experimental): Isolate and test UI components with Vite integration.

### Benefits over Cypress / Selenium

| Feature | Playwright | Cypress | Selenium |
|---------|-----------|---------|----------|
| Cross-browser | Chromium, Firefox, WebKit | Chromium-family only | All (via drivers) |
| Auto-wait | Built-in, no flakiness | Built-in | Manual |
| Network mocking | Native `page.route()` | Intercept API | Proxy-based |
| Multi-page/tab | Yes | Limited | Yes |
| Iframe support | Full | Limited | Full |
| Mobile emulation | Yes (built-in device list) | Limited | Via Appium |
| AI agent (MCP) | Official `@playwright/mcp` | No | No |
| Protocol | CDP + custom (direct pipe) | Proxy-based | HTTP WebDriver |
| Language support | TS, JS, Python, Java, .NET | JS/TS only | Many |

---

## 9. Best Practices Summary

- **Use role-based locators** (`getByRole`, `getByLabel`, `getByTestId`) -- avoid CSS/XPath.
- **Use web-first assertions** (`await expect(locator).toBeVisible()`) -- avoid manual `isVisible()` checks.
- **Run tests in CI on every commit** with sharding for speed.
- **Use `storageState` for auth** -- log in once per setup project, not per test.
- **Enable tracing on first retry** (`trace: 'on-first-retry'`) for CI debugging.
- **Use Page Object Model** for maintainable, DRY test code.
- **Lint with TypeScript `no-floating-promises`** to catch missing `await`.
- **Keep Playwright updated** (`npm install -D @playwright/test@latest`).
- **Test across all 3 engines** (Chromium, Firefox, WebKit) via projects matrix.
- **Only install browsers you need** on CI (`npx playwright install chromium --with-deps`).

---

## 10. Quick Reference

```bash
# Init
npm init playwright@latest

# Run
npx playwright test

# Debug
npx playwright test --debug

# Codegen
npx playwright codegen https://example.com

# UI mode
npx playwright test --ui

# Trace viewer
npx playwright show-report

# MCP server
npx @playwright/mcp@latest
```
