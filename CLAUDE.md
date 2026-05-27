## Packages

| Path | Package | Notes |
|------|---------|-------|
| `packages/core` | `unitypackage-core` | browser-safe, CJS+ESM |
| `packages/cli` | `unitypackage-tools` | Node CLI, Node ≥24 |
| `apps/web` | `@unitypackage-tools/web` | Vite 8 + React 19 view/extract web UI |
| `fixtures` | `@unitypackage-tools/fixtures` | synth builders (`generated/`), assets, archived packages (`static/`) |
| `scripts` | — | `clean.ts`, `copy-web-assets.ts`, `fixtures-build.ts`, `smoke.ts` |

## Commands

```
bun run check                     # lint+typecheck+build+test+smoke
bun run build                     # all packages
bun run build:cli                 # build:web → copy-assets → build cli
bun run clean                     # wipe all build artifacts
bun run dev:web                   # Vite dev server
bun run lint:fix                  # eslint --fix all
bun run pack:dry                  # npm pack --dry-run
bun run smoke                     # ad-hoc smoke tests (inspect, verify, diff, extract)
bun run test:core                 # vitest --project core
bun run test:cli                  # vitest --project cli
bun run test:web                  # vitest --project web
bun run typecheck:scripts         # typecheck root scripts/*.ts with NodeNext + erasableSyntaxOnly
bun run typecheck:stable          # direct tsc -p projects with --stableTypeOrdering
bun run knip                      # detect unused deps/exports/files
bun run test:knip                 # alias
bun run test:web                  # vitest --project web (unit + RTL)
bun run --filter @unitypackage-tools/web typecheck
bun run --filter @unitypackage-tools/web build
bunx eslint apps/web/src         # source-only, avoids dev-dist/
```

Smoke test examples (ad-hoc shell, not in CI — agent invokes on demand):
```
bun packages/cli/dist/bin.js inspect "fixtures/static/archives/Polytope_URP.unitypackage" --json   # exit 0, valid JSON
bun packages/cli/dist/bin.js verify  "fixtures/static/archives/Polytope_URP.unitypackage"          # exit 0
bun scripts/fixtures-build.ts                                                                     # exit 0
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
- **Node-only TS target**: CLI, fixtures, web node config, and `scripts/*.ts` typecheck against ES2025. Core and browser app runtime stay conservative unless browser support/polyfills are explicitly handled.
- **Root scripts typecheck**: `tsconfig.scripts.json` covers `scripts/*.ts` with NodeNext, `types: ["node"]`, and `erasableSyntaxOnly` so scripts remain compatible with native Node TS stripping.
- **CLI parse**: use `parseUnityPackageEntries` (GUID-aware), not `parseUnityPackage`. Web uses entry-aware parsing via parse worker and `apps/web/src/packageModel.ts`.
- **Build order**: `build:cli` chains `build:web` then copies assets. Never run `scripts/copy-web-assets.ts` standalone.
- **`apps/web` typecheck**: `tsc -b` (not `--noEmit` — skips project ref resolution).
- **`apps/web` product scope**: see `docs/product/product-web.md`. Web is view/extract only: open, browse, preview basics, select, and ZIP extract. Pack, verify, diagnostics, diff, rich source preview, and PWA behavior stay out of web scope.
- **`apps/web` English-only**: no translations, language selectors, or `language` URL state.
- **`apps/web` has React Compiler**: enabled via `@rolldown/plugin-babel` + `reactCompilerPreset` in `vite.config.ts`. Auto-memoizes components at build time. Manual `useMemo`/`useCallback`/`React.memo` can be removed incrementally after verifying via React DevTools "Memo ✨" badge. Does not apply to hooks that mutate DOM props directly (use `scrollElementNearEdge` helper pattern).
- **TanStack Virtual + React Compiler**: components that call `useVirtualizerCompat` need a local `'use no memo'` directive. Hiding `useVirtualizer` behind a custom hook removes lint noise, but component-level compiler opt-out is required or virtual rows can fail to render in E2E.
- **Web `PackageFileRecord` has no `kind`**: web drops Unity preview records during `entriesToRecords`; use `extension` or `getRecordCategory(record)` for asset/meta discrimination. Do not reintroduce `kind`. Extension is authoritative.
- **Tar entry names**: 100-byte limit, format `<guid>/pathname`. GUID is 32 chars.
- **`highlight.js` usage**: Import and register languages explicitly from core (`highlight.js/lib/core`). Registered set: `csharp`, `yaml`, `json`, `css`, `glsl` (also aliased to `hlsl` since highlight.js has no first-party HLSL grammar). Do not import the main entry point — keeps the bundle small. Anything not in the registered set renders as plain `<pre><code>` via a `Set.has` short-circuit.
- **Web preview tri-state**: `PreviewBody` routes into immediate / deferred / hidden. Immediate covers image + plain code, no size cap. Deferred shows a "Load preview" button for Unity-generated YAML (set in `apps/web/src/packageModel.ts` as `UNITY_GENERATED_EXTENSIONS`) plus `.meta`, gated GitHub-linguist-generated style. Hidden returns `null` from `PreviewBody` so the frame collapses; this covers `previewKind === 'unsupported'`, audio/video/pdf (not rendered), and YAML-ext files that fail the content sniff. Source of truth: `docs/reference/extension-map.md`.
- **`isUnityYamlBinary` (core)**: content-based detector for Unity YAML payloads, exported from `unitypackage-core`. Combines `%YAML` magic-byte check with a head+tail line-length scan (32 KB windows, 2048-byte max line). Catches both Force-Binary `.asset` (no header) and Force-Text assets that embed binary blobs as long hex/base64 lines (TMP SDF fonts, shader variants, lightmaps). Filename patterns from `gitattributes.md` are not used.
- **Do not hand-edit** `packages/cli/assets/web/` — populated from `apps/web/dist` by `build:cli`.

## Pitfalls

- **CLI glob filters match full package pathnames**: use `**/*.shader` for nested files, `*.shader` for root only.
- **CLI JSON mode**: route progress/warnings through stderr; keep stdout parseable.
- **Smoke must use `bun`**, not `node` — Node fails on core ESM barrel's extensionless imports.
- **`verify` is format-scoped**: do not add Unity YAML schema validation.
- **`PARSER_IGNORED_PREVIEW` silently skipped** in verify — normal for every `preview.png`.
- **ESLint in CLI excludes `*.test.ts`** — they lack `@types/node` in tsconfig scope.
- **Generated fixtures**: `binary`, `duplicate-guid`, `legacy-metadata`, `minimal`, `nested`, `traversal`, `truncated`. Static fixtures cover common Unity file types. Archive: `fixtures/static/archives/Polytope_URP.unitypackage`.
- **React effect state**: `react-hooks/set-state-in-effect` is enabled via the React Hooks recommended config. Do not use effects for derived-state or prop-change resets; derive during render or remount keyed children. Keep effects for external sync, subscriptions, timers, async callbacks, and cleanup.
- **`bun run test` runs all 3 vitest projects in parallel** via `vitest run` at root (~2.8s). Do not use `bun run --filter '*' test` (fails on core/cli which lack local vitest configs).
- **Force-Text YAML may embed binary**: Unity's Force-Text serialization writes a `%YAML` header but inlines large binary payloads (texture pixels, font glyph atlases, lightmap data, shader variants, terrain heightmaps) as one very long hex/base64 line. A naive `%YAML` magic check is not enough; use `isUnityYamlBinary` from core. Counter-example fixture: `LiberationSans SDF.asset` (text YAML header, 2-million-char glyph atlas line — must be hidden).
- **`fixtures/temp` is git-ignored**: per `~/.config/git/ignore` (`temp/`). Local-only fixtures for classify validation; tests that read it must use `describe.skipIf(!existsSync(tempDir))` (mirroring `meta.test.ts` `URL` + `readFileSync` pattern) so CI stays green when the dir is absent.

## Testing

- **E2E**: `@playwright/test` via `apps/web/playwright.config.ts` (Chromium, port 4173, `strictPort: true`). Requires `bun run build` first. Reuses preview server (`reuseExistingServer: true`). No `playwright-cli` or `@playwright/mcp`.
  - Run: `cd apps/web && bunx playwright test`
  - Debug: `cd apps/web && bunx playwright test --debug`
  - Report: `cd apps/web && bunx playwright show-report`
- **E2E tests are ESM**: use `path.dirname(fileURLToPath(import.meta.url))`, not `__dirname`.
- **E2E fixture path from `apps/web/tests/`**: `path.join(..., '../../../fixtures/static/archives/Polytope_URP.unitypackage')`.
- **`getByRole` name matching is substring**: use `exact: true` when one label is a substring of another.
- **E2E explorer rows are virtualized**: search/filter before selecting named rows that may be offscreen. Use file-row selectors or exact file checkbox names when you need a file; broad `getByRole('checkbox', { name: /^Select/ }).first()` can hit folder scope toggles and select many records.
- **Polytope E2E fixture contents**: use real asset names from `fixtures/static/archives/Polytope_URP.unitypackage` such as `Ground_Layer_01.terrainlayer`; do not assume docs-like files such as `README.md` exist.
- **`vitest.config.ts` at root**: projects for core, cli, web. Per-package `bun run --filter <pkg> test` works standalone.
- **`apps/web` unit tests**: Vitest. `bun run test:web` or `--filter @unitypackage-tools/web test`.
- **Web component tests use jsdom + RTL**: setup in `apps/web/src/test/setup.ts`. Use `@testing-library/react` and `@testing-library/jest-dom`. Place `.test.tsx` files co-located with components. Each `.test.tsx` must start with `// @vitest-environment jsdom` (vitest 4.x bug with nested project+root config).
- **React Compiler ESLint rule**: `eslint-plugin-react-compiler` is active in the web-app block. Errors indicate the compiler will skip that component/hook. Fix violations to maximize compiler coverage.
- **Knip** (`bun run knip`): detects unused files, exports, dependencies. Config at `knip.ts`. Run after structural changes to catch dead code.

## Reference

- `docs/reference/archive-format-spec.md` — `.unitypackage` format
- `docs/product/product-web.md` - web product scope, dependency boundaries, and acceptance checks
- `docs/reference/ctx7.md` — pre-resolved Context7 library IDs
- `docs/reference/playwright.md` — Playwright E2E test reference
- `docs/plans/ci/ci-release.md` — publishing checklist
- `docs/plans/` — phase plans and ship records; check before adding roadmap-scale features

## Do Not Edit

- `**/dist/`, `node_modules/`, `packages/cli/assets/web/`, `fixtures/generated/`, `**/*.tsbuildinfo`
