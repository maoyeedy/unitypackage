# apps/web preview pipeline follow-ups

## Context

Code review on `refactor/file-types` (against `master`) surfaced one shipped behavior bug and several smaller correctness / cleanup gaps in the preview pipeline that landed in `preview-tighten-up.md` P1..P7. This plan fixes them.

The headline bug: `getPreviewKindForPath` routes plain `.yaml`/`.yml` files through `isUnityYamlBinary`, which requires a `%YAML` magic header. A user-authored `config.yaml` like `name: foo\nversion: 1` has no such header, so the sniff returns `true`, the preview kind is set to `'unsupported'`, and `PreviewBody` returns `null`. The plan that produced this code (`preview-tighten-up.md`) explicitly states plain `yaml`/`yml` should be **immediate**, not hidden. The bug slipped through because `classify.test.ts` only exercises the sniff via `Assets/Foo.asset`; no test hits a `.yaml` path.

Secondary issues:

- `hljs.highlight` lost its try/catch in P4; any future grammar-table mismatch or malformed-input edge case takes down the preview pane instead of falling back to plain text.
- `UNITY_GENERATED_EXTENSIONS` (web) and `yamlExtensions` (core) overlap by 28 entries and will drift when either side adds an extension.
- `REGISTERED_LANGUAGES` (web) is a hand-mirrored Set against the `hljs.registerLanguage(...)` calls above it -- adding a sixth language requires editing two places.
- `formatBytes` dropped the `TB` unit (a behavior change the P6 ship note said it preserved).
- `TextPreview` removed `useMemo` for the decode but kept it for the highlight -- asymmetric and undocumented.
- `isUnityYamlBinary(undefined)` returns `true`, conflating "no bytes" with "binary"; latent footgun now that it is exported from the core barrel.

## Scope

### In

- `packages/core/src/classify.ts` -- exclude `yaml`/`yml` from the sniff; clarify the `undefined` semantics of `isUnityYamlBinary`.
- `packages/core/src/classify.test.ts` -- cover plain `.yaml`/`.yml` through `getPreviewKindForPath`; cover the `undefined`-bytes semantic.
- `packages/core/src/index.ts` -- re-export consolidated set if the dedupe lands here (see P3).
- `apps/web/src/components/PreviewPanel.tsx` -- restore highlight fallback; consolidate language registration; reconcile memoization.
- `apps/web/src/components/PreviewPanel.test.tsx` -- assert the highlight fallback path; assert memoization choice via a re-render counter or a smoke test.
- `apps/web/src/packageModel.ts` -- restore `TB`; refactor `UNITY_GENERATED_EXTENSIONS` to a single source.

### Out

- New preview kinds (audio/video/pdf) -- still hidden, unchanged.
- Web Worker offload for `hljs.highlight` -- only revisit under measured >50ms blocking, per the parent plan.
- Any change to CLI / extract paths.

## Phases

| # | Title | Files |
|---|---|---|
| P1 | Plain `.yaml`/`.yml` immediate + tests | `packages/core/src/classify.ts`, `packages/core/src/classify.test.ts` |
| P2 | Restore highlight.js fallback | `apps/web/src/components/PreviewPanel.tsx`, `apps/web/src/components/PreviewPanel.test.tsx` |
| P3 | Single source of truth for Unity-generated set and registered languages | `packages/core/src/classify.ts`, `packages/core/src/index.ts`, `apps/web/src/packageModel.ts`, `apps/web/src/components/PreviewPanel.tsx` |
| P4 | Minor cleanups: TB unit, TextPreview memoization, `isUnityYamlBinary(undefined)` semantics | `apps/web/src/packageModel.ts`, `apps/web/src/components/PreviewPanel.tsx`, `packages/core/src/classify.ts`, `packages/core/src/classify.test.ts` |
| P5 | Hygiene pass | lint + typecheck + test + knip, web only |

### P1 -- Plain `.yaml`/`.yml` immediate + tests  [DONE 2026-05-27]

Shipped: Excluded `yaml`/`yml` from the inline binary sniff in `getPreviewKindForPath` (packages/core/src/classify.ts) so plain YAML preview renders immediately as text. Added tests in `packages/core/src/classify.test.ts`.

### P2 -- Restore highlight.js fallback  [DONE 2026-05-27]

Shipped: Wrapped `hljs.highlight(...)` in `try/catch` in `apps/web/src/components/PreviewPanel.tsx` to return `null` and fall back to plain text on exception. Added component test in `apps/web/src/components/PreviewPanel.test.tsx`.

### P3 -- Single source of truth for Unity-generated set and registered languages  [DONE 2026-05-27]

Shipped: Exported `yamlExtensions` from `packages/core/src/index.ts`. Derived `UNITY_GENERATED_EXTENSIONS` dynamically in `apps/web/src/packageModel.ts`. Consolidated language registrations in `PreviewPanel.tsx` using a single tuple list.

### P4 -- Minor cleanups  [DONE 2026-05-27]

Shipped: Reintroduced `TB` branch to `formatBytes` with tests. Removed manual `useMemo` hooks from `TextPreview` in favor of React Compiler memoization. Documented and test-pinned `isUnityYamlBinary(undefined)` semantics.

### P5 -- Hygiene pass  [DONE 2026-05-27]

Shipped: Executed hygiene scans and resolved all knip warnings by cleaning up unused exports across command files in CLI and packageModel in web.

## Verification

1. **Unit / component**
   - `bun run test:core` -- new plain-yaml cases pass; `isUnityYamlBinary(undefined)` semantic pinned.
   - `bun run test:web` -- highlight-fallback test passes; existing memoization tests still green.
2. **Static analysis**
   - `bun run --filter @unitypackage-tools/web typecheck`
   - `bun run --filter @unitypackage-tools/web build`
   - `bun run knip`
3. **Manual dev verification**
   - Build a small synthetic `.unitypackage` containing `config.yaml` (`name: foo\nversion: 1`), open in `bun run dev:web`, confirm preview renders immediately as YAML.
   - Open a `.prefab` -- still shows "Load preview" gate.
   - Open a `.cs` -- still highlights.
   - In DevTools, override `hljs.highlight` to throw once; confirm the preview falls back to plain text and no error overlay appears.
4. **E2E** (`cd apps/web && bunx playwright test`) -- existing specs continue to pass; no new specs needed unless `formatBytes` change is asserted somewhere.
