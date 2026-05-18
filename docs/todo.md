# TODO — Post-Migration Roadmap

Ordered by value/effort ratio. Each phase is independently shippable.

---

## Phase 0 — Test Coverage Gaps (before adding features)

Cover every behavior documented in `docs/reference/format.md` with an assertion in `packages/core/src/index.test.ts`:

- [ ] Run all CLI commands against `fixtures/static/editor-packed.unitypackage` (real Unity export), compare behavior against `docs/reference/format.md` spec, and backfill format.md with any gaps found

- [ ] `preview.png` entry — currently silently ignored; test that it doesn't corrupt output, then decide whether to expose it via `UnityPackageEntry.preview?`
- [ ] Multi-line `pathname` — verify first-line-only parsing (some historical extractors produced multi-line content)
- [ ] 100-byte tar entry name limit — parse currently has no guard; create throws; test both sides
- [ ] GUID shape mismatch between directory name and `asset.meta` — verify doesn't error in lenient mode, add strict-mode test
- [ ] Non-ASCII pathnames — UTF-8 round-trip with CJK/cyrillic paths
- [ ] Corrupt/malformed tar entries — bad size field, wrong offset, truncated data — parse silently skips; test graceful handling
- [ ] Empty pathname in valid tar — parse skips; test it doesn't produce a bogus entry
- [ ] Duplicate pathname records — last-wins or first-wins? whichever the code does, test it explicitly
- [ ] Folder entries (no `asset` payload) — test that `asset` is `undefined` and entry is still valid

---

## Phase 1 — Immediate Gaps (broken or visibly incomplete)

### Web app
- [ ] Switch `App.tsx` from `parseUnityPackage` (flat record) to `parseUnityPackageEntries` (GUID-aware) — unlocks per-entry metadata, folder awareness, duplicate detection
- [ ] Fix hidden preview toggle — `enablePreview` checkbox wrapped in `display:none`; either expose it or remove it
- [ ] Add error boundary (`react-error-boundary` or manual) — crash currently shows blank white page
- [ ] `FileDropZone`: show visual drag-active state (border highlight, label change) — currently only hover CSS applies

### CLI
- [ ] `extract`: add `--no-meta` flag to skip `.meta` files on extract (mirrors web's `excludeMeta` option)
- [ ] `extract`: print skipped traversal entries count in summary, not just a `warn` per entry
- [ ] `pack`: validate `pathInPackage` starts with `Assets/` (or warn) — Unity silently breaks packages that don't
- [ ] `pack`: log skipped `.meta` source files explicitly so user knows why they disappeared

### Core
- [ ] `parseUnityPackageEntries`: return structured parse diagnostics instead of silently skipping malformed entries — add optional `warnings: string[]` to return type or a second overload
- [ ] `parseUnityPackageEntries`: expose `preview?` field on `UnityPackageEntry` — tar already contains the bytes, just not surfaced
- [ ] `createUnityPackage`: throw on duplicate GUIDs in input — currently silently produces broken packages

---

## Phase 2 — CLI Completeness

### New flags
- [ ] `extract --filter <glob>` — only extract matching pathnames (e.g. `--filter "Assets/Scripts/**"`)
- [ ] `extract --merge` — add to existing directory without collision error (--skip-existing implied, but reports what changed)
- [ ] `inspect --format tree` — render file tree instead of flat list
- [ ] `inspect --filter <ext>` — show only entries matching extension
- [ ] `verify --strict` — treat warnings as errors (exits non-zero on any finding)
- [ ] `pack --manifest <file.json>` — read `{ "src": "dst" }` pairs from JSON instead of CLI args; enables scripted workflows
- [ ] `pack --gzip-level <0-9>` — expose compression level; default 1 (speed), 6 for publish

### New commands
- [ ] `diff <pkg-a> <pkg-b>` — compare two packages: entries added/removed/changed (by GUID + pathname + asset hash); `--json` output
- [ ] `doctor <pkg>` — opinionated checks scoped to `docs/reference/format.md` patterns (GUID/meta mismatch, non-`Assets/` paths, zero-byte assets, unexpected files inside GUID directory); avoid Unity YAML analysis — format.md lists it as a non-goal

### Verify completeness
- [ ] `verify`: validate GUID in `asset.meta` matches directory name (`docs/reference/format.md`: "strict-mode error")
- [ ] `verify`: warn on unexpected files inside GUID directory (e.g. stray `.txt`, unknown sub-entries)

### UX
- [ ] Progress reporting for large packages: spinner on extract/pack over 100 entries (use `process.stderr` so `--json` stdout stays clean)
- [ ] `pack` unbounded parallel reads — add concurrency limit (e.g. `p-limit` or manual semaphore) to avoid OOM on dirs with thousands of files
- [ ] `extract` two-pass collision check reads disk twice — merge into single pass that builds conflict list without re-scanning

---

## Phase 3 — Web Robustness

### Performance
- [ ] Move `parseUnityPackage` / `parseUnityPackageEntries` call into a Web Worker — main thread blocks and UI freezes on large (>50MB) packages
- [ ] Virtualize file list with `react-window` or `tanstack/virtual` — currently renders all DOM nodes; breaks at >1000 files
- [ ] Memoize `getFilteredAndCategorizedFiles` result in `FileList` — currently re-computes on every render

### UX
- [ ] Dark mode — `App.css` hardcodes light colors; wire `prefers-color-scheme` CSS variables properly (body/App vars only, don't fight `index.css`)
- [ ] Text preview for code files (`.cs`, `.shader`, `.hlsl`, `.glsl`, `.json`, `.yaml`) — show syntax-highlighted or raw text in a modal/popover
- [ ] Image preview currently shows `display:none` img that only becomes visible on hover via JS state — simplify with conditional render only (current impl wastes a DOM node)
- [ ] Show parse progress / file name while loading, not just "Processing..."
- [ ] `downloadAll` zip creation blocks main thread — move to Worker or use streaming zip

### Correctness
- [ ] URL state for settings (`excludeMeta`, `categorize`, `language`) — survive page reload, shareable
- [ ] `FileListItem` creates blob URL on first render then never recreates — if `content` prop changes (can't happen currently but will after Worker refactor), URL goes stale; add `content` to `useEffect` deps

---

## Phase 4 — CI/CD and Release Pipeline

- [ ] GitHub Actions: matrix CI (ubuntu + windows + macos) on push to `main` — runs `bun run check`
- [ ] GitHub Actions: publish workflow — on tag `v*`, run `bun run pack:dry` then `npm publish` for `unitypackage-core` and `unitypackage-tools`
- [ ] GitHub Actions: deploy `apps/web` to GitHub Pages on push to `main` (after `build:web`)
- [ ] Dependabot config for the monorepo (single config at root `.github/dependabot.yml`)
- [ ] Changesets (`@changesets/cli`) for coordinated versioning of `core` + `cli` with cross-dep bump awareness
- [ ] Playwright smoke: load `apps/web`, drop `fixtures/generated/minimal.unitypackage`, assert file list renders
- [ ] Add `LICENSE` file to `packages/cli/` (currently only workspace root has one; npm tarball won't include it)

---

## Phase 5 — Core API Evolution

- [ ] Streaming / chunked parse API — `parseUnityPackageStream(reader: ReadableStream)` yielding `AsyncIterable<UnityPackageEntry>` — avoids loading entire package into memory; enables progress
- [ ] Deterministic output in `createUnityPackage` — stable entry order (sort by GUID), fixed mtime (0), fixed gzip seed — enables reproducible builds and byte-stable round-trips
- [ ] `createUnityPackage` size estimate before allocation — avoids double-allocation on large packages
- [ ] Export `UnityPackageEntry` parse warnings from `parseUnityPackageEntries` without breaking existing callers — add overload or options bag `{ collectWarnings?: boolean }`
- [ ] Browser-side pack in `apps/web` — expose `createUnityPackage` through a "Repack selection" button so users can download a filtered subset as a new `.unitypackage` (not just ZIP)

---

## Deferred / Won't Do (yet)

- `verify --fix` auto-repair — too risky to mutate packages silently; document findings and let user re-pack
- Unity meta YAML schema validation — Unity's format is undocumented and version-dependent; partial validation creates false confidence
- Streaming HTTP upload to `web` command — scope creep; CLI is for local use
- Support for `.unitypackage` files > 2GB — requires BigInt tar size fields; negligible real-world demand
