## Packages

| Path | Package | Notes |
|------|---------|-------|
| `packages/core` | `unitypackage-core` | published, browser-safe, CJS+ESM |
| `packages/cli` | `unitypackage-tools` | published, ships JS, runtime Node ≥24 |
| `apps/web` | `@unitypackage-tools/web` | private, Vite 6 + React 19 PWA workspace |
| `fixtures` | `@unitypackage-tools/fixtures` | private, synth builders (`generated/`) + loose assets + archived `.unitypackage` (`static/`) |
| `scripts` | — | `copy-web-assets.ts`, `fixtures-build.ts` |

## Commands

```
bun run check                     # full gate: lint+typecheck+build+test
bun run build                     # all packages
bun run build:cli                 # build:web → copy assets → build cli
bun run dev:web                   # Vite dev server
bun run lint:fix                  # eslint --fix all
bun run pack:dry                  # npm pack --dry-run
bun run --filter unitypackage-core test
bun run --filter unitypackage-tools test
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web typecheck
bun run --filter @unitypackage-tools/web build
bunx eslint apps/web/src
```

Manual smoke (after `build`):
```
bun packages/cli/dist/bin.js inspect "fixtures/static/archives/Polytope_URP.unitypackage" --json
bun packages/cli/dist/bin.js verify  "fixtures/static/archives/Polytope_URP.unitypackage"
node scripts/fixtures-build.ts
bun packages/cli/dist/bin.js diff fixtures/generated/minimal.unitypackage fixtures/generated/nested.unitypackage --json
bun packages/cli/dist/bin.js extract "fixtures/static/archives/Polytope_URP.unitypackage" /tmp/unitypackage-extract-test --filter "**/*.shader"
bun packages/cli/dist/bin.js extract "fixtures/static/archives/Polytope_URP.unitypackage" /tmp/unitypackage-extract-test --filter "**/*.shader" --merge
```

## Node versions

| Context | Version | Why |
|---------|---------|-----|
| Dev / CI / workspace root | **≥24** | `node scripts/*.ts` uses built-in type stripping (stable since 23.6) |
| Published runtime (`packages/core`, `packages/cli`) | **≥24** | uniform; Node 24 is current LTS |

## Reference

- `docs/reference/archive-format-spec.md` — `.unitypackage` format spec
- `docs/reference/ctx7.md` — pre-resolved Context7 library IDs
- `docs/reference/release.md` — publishing checklist
- `docs/reference/playwright.md` — Playwright E2E test reference
- `docs/plans/` — phase plans and ship records; check before adding roadmap-scale features

## Playwright

E2E testing via `@playwright/test`. Do not use `playwright-cli` or `@playwright/mcp` for this project.

- Config: `apps/web/playwright.config.ts` (Chromium + Firefox, `vite preview` on port 4173, `strictPort: true` in `vite.config.ts`). Requires `bun run build` before the first run. Reuses a running preview server when `reuseExistingServer` is true. Uses 4173 (not the dev-server 5173) to avoid port collisions with manual dev sessions and to test the built PWA + pre-compiled workers.
- Tests: `apps/web/tests/`. Run: `cd apps/web && bunx playwright test`.
- Debug: `cd apps/web && bunx playwright test --debug`.
- Report: `cd apps/web && bunx playwright show-report`.
- For detailed API docs (locators, assertions, fixtures, codegen, tracing), check Context7: `@playwright/test`.

## Architecture Rules

- **`packages/core` browser-safe**: no `node:*`, `fs`, `path`, `crypto`, `os`, `yaml`, HTTP. Only dep: `fflate`.
- **`packages/core` public API**: keep `packages/core/src/index.ts` as the root barrel only. Consumers import from `unitypackage-core`; do not add public subpath exports unless the package API is deliberately expanded.
- **`packages/core` module layout**: runtime implementation is split by domain: `model.ts`, `guid.ts`, `pathname.ts`, `meta.ts`, `parse.ts`, `create.ts`, `summary.ts`, and private tar helpers in `tar.ts`. Put tests beside the matching domain file (`parse.test.ts`, `create.test.ts`, etc.); keep `index.test.ts` as a small barrel smoke test.
- CLI must use `parseUnityPackageEntries` (GUID-aware), not `parseUnityPackage` (flat alias). `apps/web` also uses entry-aware parsing through its parse worker and derives `PackageFileRecord` values in `apps/web/src/packageModel.ts`.
- `apps/web` is English-only. Do not reintroduce translation files, language selectors, or `language` URL state.
- Web Extract selection lives in `apps/web/src/App.tsx` plus pure helpers in `apps/web/src/packageModel.ts`; keep checkbox, drag-sweep, folder select-all, and extension select-all behavior scoped to filtered visible records.
- **`PackageFileRecord` has no `kind` field**: removed because `extension` + `isUnityPreview: boolean` already discriminate every case. Internally, derive the category with `getRecordCategory(record)` → `'asset' | 'meta' | 'preview'` when you need a single discriminator (e.g., grouping, switch-on-category logic). For predicates prefer the primitives directly: `extension === 'meta'` for meta sidecars, `isUnityPreview` for synthetic thumbnails extracted from `entry.preview`, `!isUnityPreview && extension !== 'meta'` for real assets. Do not reintroduce a `kind` field, do not derive mime/syntax/preview by branching on category (extension is authoritative — see `docs/reference/extension-map.md`), and do not surface a per-record "Kind" label in the UI (the `.meta` / `.preview.png` suffix in the path conveys it). `RecordCategory` is exported only for the helper's return type and tests.
- Keep web drag-sweep selection constrained to the middle explorer pane and file rows; do not reintroduce Shift-click range selection unless product behavior changes explicitly.
- Web Pack mode is currently a shell: keep `.unitypackage` export disabled until `docs/plans/web/new-api.md` wires the final browser creation API. ZIP downloads remain Extract-mode behavior.
- Web PWA setup uses `vite-plugin-pwa`, `virtual:pwa-register`, and `workbox-window`; keep service worker registration in the app entrypoint.
- Never hand-edit `packages/cli/assets/web/` — populated from `apps/web/dist` by `build:cli`.

## Pitfalls

- **NodeNext `.js` extensions** (`packages/cli`): all relative `.ts` imports must use `.js` extension in source.
- **CLI glob filters match full package pathnames**: use `**/*.shader` for nested shader files; `*.shader` only matches root-level package paths.
- **CLI JSON modes keep stdout parseable**: route progress, warnings, and summaries through stderr/logger helpers.
- **`verify` is format-scoped**: do not add Unity YAML schema validation unless a later plan explicitly asks for it.
- **Generated fixtures currently include** `binary`, `duplicate-guid`, `legacy-metadata`, `minimal`, `nested`, `traversal`, and `truncated`; use `minimal` vs `nested` for diff smoke, not `multi-entry`.
- **`fixtures/static/` covers major file types**: `.unity` / `.prefab` / `.mat` / `.asset` / `.terrainlayer` (Unity YAML assets), `.fbx` (binary), `.png` / `.jpg` / `.tga` (image), `.wav` (audio), `.cginc` / `.shader` / `.cs` (code), `.txt` (doc), `.meta`. Archive: `archives/Polytope_URP.unitypackage`.
- **`packages/core/tsconfig.json` omits `moduleResolution`** intentionally: TS 5.9 forbids `module:CommonJS` + `moduleResolution:Node16`. Don't add it.
- **`packages/core` build writes `dist/esm/package.json`**: `printf '{"type":"module"}'` is load-bearing — keeps Node from emitting `MODULE_TYPELESS_PACKAGE_JSON`.
- **`packages/core` test helpers**: avoid non-test helper files under `packages/core/src`; `tsconfig.json` includes all non-`*.test.ts` source files in the published build.
- **`apps/web` typecheck is `tsc -b`** (not `--noEmit`). `--noEmit` skips project reference resolution.
- **`apps/web` tests are Vitest unit tests**: use `bun run --filter @unitypackage-tools/web test` for model/helper coverage.
- **`bun run --filter @unitypackage-tools/web lint` may lint generated `apps/web/dev-dist/`**: use `bunx eslint apps/web/src` for source-only lint after web UI edits.
- **ESLint type-aware rules exclude `*.test.ts`** in `packages/cli` — they lack `@types/node` in tsconfig scope.
- **`build:cli` order**: `node scripts/copy-web-assets.ts` errors if `apps/web/dist/` missing. Use the root `build:cli` script (chains `build:web` first).
- **Built CLI smoke uses Bun**: run `packages/cli/dist/bin.js` smoke commands with `bun`, not `node`; Node currently fails on the core ESM barrel's extensionless imports.
- **100-byte tar entry name limit**: entry format `<guid>/pathname`, `<guid>/asset.meta`, `<guid>/asset`. GUID is 32 chars — remaining budget tight.
- **`sanitize-filename` removed**: inlined as `sanitizeFilename()` in `packages/cli/src/util/path.ts` via simple regex (Node ≥22).
- **E2E tests are ESM**: `__dirname` is unavailable in `apps/web/tests/*.spec.ts`; use `path.dirname(fileURLToPath(import.meta.url))` for fixture paths.
- **`getByRole` name matching is substring by default**: `getByRole('button', { name: 'Pack' })` also matches "Stage for pack". Add `exact: true` whenever the button label appears inside another button's label.
- **E2E fixture path**: `fixtures/static/archives/Polytope_URP.unitypackage` is 3 dirs above `apps/web/tests/` — `path.join(…, '../../../fixtures/static/archives/Polytope_URP.unitypackage')`.
- **`PARSER_IGNORED_PREVIEW` is silently skipped in `verify`**: the core emits it for every `preview.png` in a GUID directory (normal Unity Editor output), but `packages/cli/src/commands/verify.ts` filters it out before adding to `findings` — intentional, not an oversight.

## Do Not Edit

- `**/dist/`, `node_modules/`, `packages/cli/assets/web/`, `fixtures/generated/`, `**/*.tsbuildinfo`
