# P1 -- Drop dead and deprecated code

## Goal

Delete code that is unreachable, redundant, or stale documentation; inline
1-line wrappers in CLI util. Pure cleanup with no behavior change for any
valid input.

## Files

- `packages/core/src/parse.ts` -- delete the in-loop bomb check in
  `mapUnityEntries`; drop the duplicated `maxOutputBytes` lookup it depends
  on.
- `packages/core/src/parse.ts` -- delete the `UnityPackageEntriesResult`
  `@deprecated` type alias.
- `packages/core/src/index.ts` -- stop exporting `UnityPackageEntriesResult`.
- `packages/core/src/summary.ts` -- fix the stale docstring on
  `summarizePackage` so it matches the post-P5 byExtension behavior (folder
  entries excluded).
- `apps/web/src/parsePackage.worker.ts` -- delete the streamed-to-entries
  try/catch fallback (both paths route through `gunzipBounded` now).
- `packages/cli/src/util/package.ts` -- delete the `parsePackageBytes`
  1-line wrapper; keep `readPackageBytes`.
- `packages/cli/src/util/meta.ts` -- delete the file entirely
  (`parseMeta` is a 1-line wrapper around `readMetaGuid`).
- `packages/cli/src/commands/*.ts` -- update imports of `parsePackageBytes`
  to `parseUnityPackageEntries` directly; replace the single `parseMeta`
  caller with an inline `readMetaGuid` call.

## Surface

No public API changes to `unitypackage-core` other than removing the
deprecated `UnityPackageEntriesResult` type alias. CLI internal util surface
shrinks by two files. Web worker error path becomes the single streamed-parse
error path.

### Specifics

1. `packages/core/src/parse.ts` `mapUnityEntries` (around lines 304 and
   376-380): remove the `maxOutputBytes` derivation and the
   `if (totalOutputBytes > maxOutputBytes) throw ...` block (plus the
   `totalOutputBytes` accumulator that only fed it). Keep the `maxEntries`
   check below.

2. `packages/core/src/parse.ts` (around lines 28-31): delete
   `export type UnityPackageEntriesResult = ...`.

3. `packages/core/src/index.ts` (around line 72): remove
   `UnityPackageEntriesResult` from the `type { ... } from './parse'`
   re-export block.

4. `packages/core/src/summary.ts` JSDoc on `summarizePackage` (around
   line 31): replace
   `"Extensions are lower-cased; extensionless assets use ''"`
   with text that calls out:
   - folder entries (`entry.asset === undefined`) are excluded from
     `byExtension` entirely;
   - extensionless *assets* still contribute to a `''` row.

5. `apps/web/src/parsePackage.worker.ts` (lines 17-34): collapse the
   `try { parseUnityPackageStreamed(...) } catch { parseUnityPackageEntries(...) }`
   to a single call. Pick `parseUnityPackageStreamed` for now -- P3 will
   collapse the two names anyway.

6. `packages/cli/src/util/package.ts`: delete `parsePackageBytes`. Update
   every caller (`inspect.ts`, `verify.ts`, `diff.ts`, `extract.ts`) to
   import `parseUnityPackageEntries` from `unitypackage-core` directly and
   call it inline.

7. `packages/cli/src/util/meta.ts`: delete the file. Grep for `parseMeta`
   imports and replace with `readMetaGuid` inline; callers that need
   `{ guid }` shape can construct it at the call site.

## Exit criteria

- `bun run check` passes.
- `cd apps/web && bunx playwright test` passes.
- No reference to `UnityPackageEntriesResult` remains in source or in
  the generated `.d.ts`.
- No reference to `parsePackageBytes` or `parseMeta` remains anywhere
  in the workspace (`packages/cli`, `apps/web`, `scripts`, `docs`).
- `mapUnityEntries` contains exactly one `throw new DecompressionBombError`,
  on the `maxEntries` check.
- The summary JSDoc reads naturally for a cold reader and accurately
  describes `byExtension` membership.
