# Dependency Analysis

## Runtime

| Package | Owner | Purpose | Assessment |
|---------|-------|---------|------------|
| `fflate` | core, fixtures | Gzip/deflate | **Keep.** Core needs gzip for `.unitypackage` parsing/writing |
| `@tanstack/react-virtual` | web | Virtualized list | **Keep.** Headless/flexible. Alternatives: `virtua` (~3KB, simpler), `react-virtuoso` (~17KB, richer API) |
| `lucide-react` | web | SVG icons | **Keep.** Tree-shakes ~0.5KB/icon. Best balance of size/coverage |
| `react` + `react-dom` | web | UI | Latest 19.2.x. No change |

## Dev

| Package | Assessment |
|---------|------------|
| `eslint` 10.x + `typescript-eslint` 8.x | Latest, flat config in use |
| `typescript` 6.x | Latest stable |
| `vitest` 4.x | Latest |
| `vite` 8.x + `@vitejs/plugin-react` 6.x | Latest (v6 drops Babel, uses Oxc) |
| `@playwright/test` 1.x | Latest |

## Installed

### @changesets/cli

Installed at root (`bun add -d @changesets/cli`). Agent writes `.changeset/*.md` per change. At release time `bun changeset version` bumps versions, regenerates CHANGELOGs, and replaces `workspace:*` → `^x.y.z`. No CI bot — CLI-only mode.


## Installed

### Knip

A project linter that scans the entire dependency graph to find unused files, exports, types, and dependencies. ~150 built-in plugins (Vite, Vitest, Playwright, ESLint, etc.) auto-detect entry points. Monorepo-aware.

**What it enables:**
- Catch orphaned files, dead exports, and dangling dependencies that ESLint/TS miss (ESLint is file-scoped; Knip is graph-scoped)
- Surface unused `devDependencies` and internal exports after refactors
- Run in CI to prevent code bloat from accumulating
- `bun run knip` — config already tuned for this repo

### React Testing Library (RTL)

`@testing-library/react` + `@testing-library/jest-dom` + `@testing-library/user-event` + `jsdom`.

Renders a React component in isolation, queries its output by accessibility role/label/text (not implementation details), and asserts on behavior. Co-located `.test.tsx` files alongside components. Vitest scopes jsdom to `.test.tsx` via `environmentMatchGlobs` — existing `.test.ts` (Node) tests unaffected.

**Not a replacement for Playwright E2E** — they target different test layers:

| Aspect | Playwright E2E | RTL Component |
|--------|---------------|---------------|
| Scope | Full app, real browser, real network | Single component in isolation |
| Speed | ~seconds per test | ~milliseconds per test |
| Setup needed | `bun run build` first | None (vitest runs instantly) |
| What it catches | Integration bugs, PWA, file handlers, cross-component flows | Rendering logic, a11y roles, state variants, edge cases |
| Typical count | 45 tests (4 files) | Should be many more per component |
| Brittleness | High (depends on full app rendering) | Low (isolated, deterministic) |

RTL fills the **component layer** — fast, targeted, run-on-save tests for things too expensive to E2E:
- "Does the Pack button show disabled when selection is empty?"
- "Does the file row render correct icon for `.cs` vs `.shader`?"
- "Does pressing Escape close the detail panel?"
- "What happens when filter returns zero results?"

**What it enables:**
- Component state coverage (loading, empty, error, edge cases) without E2E overhead
- Accessibility regression detection (queries by role/label/text, not CSS selectors)
- Hook and composition testing in isolation
- `bun run test:web` — RTL tests run as part of the existing Vitest project

### React Compiler

`babel-plugin-react-compiler` + `@rolldown/plugin-babel` + `@babel/core` (all in `apps/web`).

Auto-memoizes React components at build time — equivalent to inserting correct `useMemo`/`useCallback`/`React.memo` with perfect dependency arrays. Enabled via `reactCompilerPreset` in `apps/web/vite.config.ts`. Babel plugin runs first, then oxc handles JSX transform/Fast Refresh.

**What it enables:**
- Components with zero manual memo get free optimization (7 of 12 `.tsx` files had none)
- Future code never needs manual `useMemo`/`useCallback` — write plain code, compiler handles caching
- ESLint rule (`eslint-plugin-react-compiler`) catches violations pre-build: impure components, prop mutation, conditional hooks
- Remove existing `useMemo`/`useCallback` incrementally after verifying with React DevTools "Memo ✨" badge
- Does NOT cover hooks that directly mutate DOM element properties (use `scrollElementNearEdge` helper pattern instead)
- TanStack Virtual integration is intentionally wrapped by `useVirtualizerCompat`; components that render virtual rows use `'use no memo'` because compiler optimization can prevent rows from rendering

**Cost:** ~10% slower builds due to Babel pass, ~20KB added to final bundle (compiler runtime).
