## Packages

| Path | Package | Notes |
|------|---------|-------|
| `packages/core` | `unitypackage-core` | published, browser-safe, CJS+ESM |
| `packages/cli` | `unitypackage-tools` | published, ships JS, runtime Node ≥24 |
| `apps/web` | `@unitypackage-tools/web` | private, Vite 6 + React 19 |
| `fixtures` | `@unitypackage-tools/fixtures` | private, synth builders + real editor-exported `.unitypackage` |
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
bun run --filter @unitypackage-tools/web build
```

Manual smoke (after `build`):
```
node packages/cli/dist/bin.js inspect "fixtures/static/editor-packed.unitypackage" --json
node packages/cli/dist/bin.js verify  "fixtures/static/editor-packed.unitypackage"
node packages/cli/dist/bin.js extract "fixtures/static/editor-packed.unitypackage" /tmp/unitypackage-extract-test
node scripts/fixtures-build.ts
```

## Node versions

| Context | Version | Why |
|---------|---------|-----|
| Dev / CI / workspace root | **≥24** | `node scripts/*.ts` uses built-in type stripping (stable since 23.6) |
| Published runtime (`packages/core`, `packages/cli`) | **≥24** | uniform; Node 24 is current LTS |

## Reference

- `docs/reference/format.md` — `.unitypackage` format spec
- `docs/reference/ctx7.md` — pre-resolved Context7 library IDs
- `docs/reference/publishing.md` — publishing checklist
- `docs/todo.md` — roadmap, check before adding features

## Architecture Rules

- **`packages/core` browser-safe**: no `node:*`, `fs`, `path`, `crypto`, `os`, `yaml`, HTTP. Only dep: `fflate`.
- CLI must use `parseUnityPackageEntries` (GUID-aware), not `parseUnityPackage` (flat alias). `apps/web` uses `parseUnityPackage` intentionally (deferred, see todo.md Phase 1).
- Never hand-edit `packages/cli/assets/web/` — populated from `apps/web/dist` by `build:cli`.

## Pitfalls

- **NodeNext `.js` extensions** (`packages/cli`): all relative `.ts` imports must use `.js` extension in source.
- **`packages/core/tsconfig.json` omits `moduleResolution`** intentionally: TS 5.9 forbids `module:CommonJS` + `moduleResolution:Node16`. Don't add it.
- **`packages/core` build writes `dist/esm/package.json`**: `printf '{"type":"module"}'` is load-bearing — keeps Node from emitting `MODULE_TYPELESS_PACKAGE_JSON`.
- **`apps/web` typecheck is `tsc -b`** (not `--noEmit`). `--noEmit` skips project reference resolution.
- **ESLint type-aware rules exclude `*.test.ts`** in `packages/cli` — they lack `@types/node` in tsconfig scope.
- **`build:cli` order**: `node scripts/copy-web-assets.ts` errors if `apps/web/dist/` missing. Use the root `build:cli` script (chains `build:web` first).
- **100-byte tar entry name limit**: entry format `<guid>/pathname`, `<guid>/asset.meta`, `<guid>/asset`. GUID is 32 chars — remaining budget tight.
- **`sanitize-filename` removed**: inlined as `sanitizeFilename()` in `packages/cli/src/util/path.ts` via simple regex (Node ≥22).

## Do Not Edit

- `**/dist/`, `node_modules/`, `packages/cli/assets/web/`, `fixtures/generated/`, `**/*.tsbuildinfo`
