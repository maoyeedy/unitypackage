## Packages

### General
- `scripts/` — `clean.ts`, `copy-web-assets.ts`, `fixtures-build.ts`, `smoke.ts`
- `fixtures/` — synth builders (`generated/`), static assets (`static/`), archived packages
- Node >=24

### Packages (`packages/`)
- `unitypackage-core` — browser-safe parser/writer, CJS+ESM
- `unitypackage-depgraph` — Node-only GUID dep graph resolver
- `unitypackage-tools` — CLI (extract, pack, inspect, verify, diff, web)

### Web (`apps/web`)
- `@unitypackage-tools/web` — view/extract web UI

## Non-obvious commands

- Rebuild core for downstream picks: `bun run --filter unitypackage-core build`
- E2E: `cd apps/web && bunx playwright test` (needs `bun run build`)

## Architecture

### Core
- Browser-safe: no `node:*`. Only dep: `fflate`.
- Barrel: `packages/core/src/index.ts` is sole entry. No subpath exports.
- CJS/ESM dual: `dist/index.js` + `dist/esm/index.js`, each with `package.json` type stub.
- Use `parseUnityPackageEntries` (GUID-aware), not `parseUnityPackage`.

### Depgraph
- Node-only: depends on `unitypackage-core` + `node:fs`.
- Exports: `resolveDependencies`, `buildPathnameIndex`, `NO_REFERENCE`.
- Regex: `/\{fileID:\s*\d+\s*,\s*guid:\s*([0-9a-fA-F]{32})\s*,\s*type:\s*\d+\s*\}/g`. Filters built-in GUIDs.
- `buildPathnameIndex` skips `node_modules`, `Library`, `Temp`, `obj`, `Packages`. First-wins on duplicates.
- `resolveDependencies`: BFS with visited-set, depth-limited.

### CLI
- Relative `.ts` imports use `.js` extension (NodeNext).
- `pack --resolve-deps` flags: `--dep-root`, `--max-dep-depth`. Runs after collection, before archive.

### Web
- View/extract only (no pack/verify/diagnostics/diff). English-only.
- React Compiler enabled. `useVirtualizerCompat` components need `'use no memo'`.
- `PackageFileRecord` has no `kind` — use `extension` or `getRecordCategory`.
- `highlight.js`: import from `lib/core`, register `csharp`, `yaml`, `json`, `css`, `glsl` (aliases `hlsl`). Unregistered → plain `<pre><code>`.
- `isUnityYamlBinary` called in `parsePackage.worker.ts` to downgrade binary `.asset` text→unsupported.

### Build order
- `build:cli` = `build:web` → `copy-web-assets.ts` → `--filter unitypackage-tools build`. Never standalone.
- Do not hand-edit `packages/cli/assets/web/` — populated from `apps/web/dist`.

## Pitfalls

### General
- `bun run --filter '*' test` fails (no local vitest config). Use root `bun run test` or `--project`.
- CLI globs match full pathnames: `**/*.shader` for nested, `*.shader` for root.
- CLI JSON: stderr for progress/warnings, stdout for parseable output.
- `verify` is format-scoped only — no YAML schema validation.
- `PARSER_IGNORED_PREVIEW` silently skipped (normal).
- Force-Text YAML may embed binary — use `isUnityYamlBinary`, not just `%YAML`.

### Core
- No non-test helpers under `packages/core/src`.

### Web
- `TextPreview` is sync-only. Multi-MB YAML downgraded by `isUnityYamlBinary` before reaching it.
- Each `.test.tsx` must start with `// @vitest-environment jsdom` (vitest 4.x).

## Testing

- Some tests read fixture files (`classify.test.ts`, `dependencyResolver.test.ts`, `pathnameIndex.test.ts`).
- E2E: Playwright, Chromium-only. `cd apps/web && bunx playwright test`.
- E2E fixture: `fixtures/static/archives/Polytope_URP.unitypackage`.
- Upload: `page.getByLabel('Open Unity package').setInputFiles(path)`.
- Preview coverage: `.cs`/`.shader` text, `.mat`/`.terrainlayer` YAML, `.unity`/`.prefab`/`.asset` (binary) no-preview, `.png` image, `.fbx` no-preview.

## Reference

- `docs/product/product-core.md` / `product-web.md` / `product-cli.md`
- `docs/reference/archive-format-spec.md` / `extension-map.md` / `ctx7.md` / `playwright.md`
- `docs/plans/` — check before adding roadmap-scale features

## Do Not Edit

- `**/dist/`, `node_modules/`, `packages/cli/assets/web/`, `fixtures/generated/`, `**/*.tsbuildinfo`
