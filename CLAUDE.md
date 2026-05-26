## Packages

| Path | Package | Notes |
|------|---------|-------|
| `packages/core` | `unitypackage-core` | browser-safe, CJS+ESM |
| `packages/cli` | `unitypackage-tools` | Node CLI, Node ≥24 |
| `apps/web` | `@unitypackage-tools/web` | Vite 6 + React 19 PWA |
| `fixtures` | `@unitypackage-tools/fixtures` | synth builders (`generated/`), assets, archived packages (`static/`) |
| `scripts` | — | `copy-web-assets.ts`, `fixtures-build.ts` |

## Commands

```
bun run check                     # lint+typecheck+build+test
bun run build                     # all packages
bun run build:cli                 # build:web → copy-assets → build cli
bun run dev:web                   # Vite dev server
bun run lint:fix                  # eslint --fix all
bun run pack:dry                  # npm pack --dry-run
bun run test:core                 # vitest --project core
bun run test:cli                  # vitest --project cli
bun run test:web                  # vitest --project web
bun run --filter @unitypackage-tools/web typecheck
bun run --filter @unitypackage-tools/web build
bunx eslint apps/web/src         # source-only, avoids dev-dist/
```

Smoke test examples (ad-hoc shell, not in CI — agent invokes on demand):
```
bun packages/cli/dist/bin.js inspect "fixtures/static/archives/Polytope_URP.unitypackage" --json   # exit 0, valid JSON
bun packages/cli/dist/bin.js verify  "fixtures/static/archives/Polytope_URP.unitypackage"          # exit 0
node scripts/fixtures-build.ts                                                                     # exit 0
bun packages/cli/dist/bin.js diff fixtures/generated/minimal.unitypackage fixtures/generated/nested.unitypackage --json   # exit 0, entries differ
bun packages/cli/dist/bin.js extract "fixtures/static/archives/Polytope_URP.unitypackage" /tmp/unitypackage-extract-test --filter "**/*.shader"       # exit 0, files created
bun packages/cli/dist/bin.js extract "fixtures/static/archives/Polytope_URP.unitypackage" /tmp/unitypackage-extract-test --filter "**/*.shader" --merge # exit 0, files created
```

## Node

All contexts (dev, CI, published): Node ≥24.

## Architecture

- **core browser-safe**: no `node:*`, `fs`, `path`, `crypto`, `os`, `yaml`, HTTP. Only dep: `fflate`.
- **core barrel**: `packages/core/src/index.ts` is sole entry. No public subpath exports.
- **core module layout**: `model.ts`, `guid.ts`, `pathname.ts`, `meta.ts`, `sidecar.ts`, `parse.ts`, `create.ts`, `summary.ts`, `analyze.ts`, `classify.ts`, `component.ts`, `glob.ts`, `tar.ts` (private helpers). Tests co-located: `parse.test.ts`, `create.test.ts`, etc.
- **core build**: `tsconfig.json` omits `moduleResolution` intentionally. Build writes `printf '{"type":"module"}' > dist/esm/package.json` (load-bearing). Do not place non-test helpers under `packages/core/src`.
- **CLI imports**: all relative `.ts` imports use `.js` extension (NodeNext).
- **CLI parse**: use `parseUnityPackageEntries` (GUID-aware), not `parseUnityPackage`. Web uses entry-aware parsing via parse worker and `apps/web/src/packageModel.ts`.
- **Build order**: `build:cli` chains `build:web` then copies assets. Never run `scripts/copy-web-assets.ts` standalone.
- **`apps/web` typecheck**: `tsc -b` (not `--noEmit` — skips project ref resolution).
- **`apps/web` English-only**: no translations, language selectors, or `language` URL state.
- **`apps/web` Pack mode**: shell only. `.unitypackage` export disabled. ZIP remains Extract-mode.
- **`PackageFileRecord` has no `kind`**: use `extension` + `isUnityPreview` primitives, or `getRecordCategory(record)` for a single discriminator. Do not reintroduce `kind`. Extension is authoritative.
- **Tar entry names**: 100-byte limit, format `<guid>/pathname`. GUID is 32 chars.
- **Do not hand-edit** `packages/cli/assets/web/` — populated from `apps/web/dist` by `build:cli`.

## Pitfalls

- **CLI glob filters match full package pathnames**: use `**/*.shader` for nested files, `*.shader` for root only.
- **CLI JSON mode**: route progress/warnings through stderr; keep stdout parseable.
- **Smoke must use `bun`**, not `node` — Node fails on core ESM barrel's extensionless imports.
- **`verify` is format-scoped**: do not add Unity YAML schema validation.
- **`PARSER_IGNORED_PREVIEW` silently skipped** in verify — normal for every `preview.png`.
- **ESLint in CLI excludes `*.test.ts`** — they lack `@types/node` in tsconfig scope.
- **Generated fixtures**: `binary`, `duplicate-guid`, `legacy-metadata`, `minimal`, `nested`, `traversal`, `truncated`. Static fixtures cover common Unity file types. Archive: `fixtures/static/archives/Polytope_URP.unitypackage`.

## Testing

- **E2E**: `@playwright/test` via `apps/web/playwright.config.ts` (Chromium+Firefox, port 4173, `strictPort: true`). Requires `bun run build` first. Reuses preview server (`reuseExistingServer: true`). No `playwright-cli` or `@playwright/mcp`.
  - Run: `cd apps/web && bunx playwright test`
  - Debug: `cd apps/web && bunx playwright test --debug`
  - Report: `cd apps/web && bunx playwright show-report`
- **E2E tests are ESM**: use `path.dirname(fileURLToPath(import.meta.url))`, not `__dirname`.
- **E2E fixture path from `apps/web/tests/`**: `path.join(..., '../../../fixtures/static/archives/Polytope_URP.unitypackage')`.
- **`getByRole` name matching is substring**: use `exact: true` when label is a substring of another (e.g., `'Pack'` matches "Stage for pack").
- **`vitest.config.ts` at root**: projects for core, cli, web. Per-package `bun run --filter <pkg> test` works standalone.
- **`apps/web` unit tests**: Vitest. `bun run test:web` or `--filter @unitypackage-tools/web test`.

## Reference

- `docs/reference/archive-format-spec.md` — `.unitypackage` format
- `docs/reference/ctx7.md` — pre-resolved Context7 library IDs
- `docs/reference/playwright.md` — Playwright E2E test reference
- `docs/plans/ci/ci-release.md` — publishing checklist
- `docs/plans/` — phase plans and ship records; check before adding roadmap-scale features

## Do Not Edit

- `**/dist/`, `node_modules/`, `packages/cli/assets/web/`, `fixtures/generated/`, `**/*.tsbuildinfo`
