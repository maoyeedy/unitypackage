# P4 -- Lift `matchGlob` + `writeMetaGuid` into core

## Goal

Move two helpers that today exist in both consumers (with subtly different
semantics) into `packages/core` so CLI and web share one implementation
each.

## Files

- `packages/core/src/glob.ts` (new) -- `matchGlob(pattern, path): boolean`.
- `packages/core/src/glob.test.ts` (new) -- port relevant tests from CLI's
  `matchesGlob` and web's `matchGlob`; cover `**`, `**/`, `*`, `?`,
  anchored matching, and regex-special escaping.
- `packages/core/src/meta.ts` -- add
  `writeMetaGuid(meta: Uint8Array, newGuid: string): Uint8Array`. Use the
  same anchored `GUID_LINE_PATTERN` as `readMetaGuid`.
- `packages/core/src/meta.test.ts` -- add tests for `writeMetaGuid`,
  including the "no guid line present" prepend fallback.
- `packages/core/src/index.ts` -- export both new symbols.
- `packages/cli/src/util/glob.ts` -- delete; update
  `packages/cli/src/commands/extract.ts` to import `matchGlob` from
  `unitypackage-core`.
- `apps/web/src/packageModel.ts` -- replace the local `matchGlob` (around
  line 418) and `updateMetaBytesGuid` (around line 1031) with the core
  imports; preserve re-exports if any component imports the names from
  `packageModel`.

## Surface

- New public exports from `unitypackage-core`: `matchGlob`, `writeMetaGuid`.
- `packages/cli/src/util/glob.ts` deleted.
- Web's local `matchGlob` and `updateMetaBytesGuid` deleted.
- `matchGlob` resolves the cross-consumer `**` discrepancy by adopting the
  web variant's semantics (`**/` -> `(?:.+/)?` so root-level files match
  patterns like `**/*.cs`). CLI users filtering with `**/*.shader` keep
  working; CLI users relying on the prior "`**` is always `.*`" behavior
  for patterns ending in `/` will see a difference.

### Specifics

1. `matchGlob` semantics (final, single source of truth):
   - `**` followed by `/` matches zero or more path segments
     (`(?:.+/)?`).
   - `**` not followed by `/` matches any characters including `/`
     (`.*`).
   - `*` matches any character except `/` (`[^/]*`).
   - `?` matches exactly one character except `/` (`[^/]`).
   - Other characters match literally; regex specials are escaped.
   - The pattern is anchored at both ends.

2. `writeMetaGuid(meta, newGuid)`:
   - Decode `meta` with the shared `textDecoder`.
   - Use the same anchored `GUID_LINE_PATTERN` already defined in
     `meta.ts` (line-trimmed, optional `# comment` tail).
   - When a guid line is found, rebuild it as `guid: <newGuid>` and
     re-emit the file with the rest untouched.
   - When no guid line exists, prepend `guid: <newGuid>\n` (matches web's
     current fallback in `updateMetaBytesGuid`).
   - Return a UTF-8 `Uint8Array`.
   - Reject a `newGuid` that fails `isValidGuid` (post-P5 widening -- see
     P5 for case acceptance).

3. `packages/core/src/index.ts` re-exports:
   - Add `matchGlob` to the named exports block.
   - Add `writeMetaGuid` to the meta named exports block (next to
     `readMetaGuid`).

4. CLI: replace `import { matchesGlob } from '../util/glob.js'` with
   `import { matchGlob } from 'unitypackage-core'`. Note the name change
   (`matchesGlob` -> `matchGlob`).

5. Web: drop the local `matchGlob` function body in `packageModel.ts`;
   `import { matchGlob } from 'unitypackage-core'` instead. Same for
   `updateMetaBytesGuid` -> `writeMetaGuid`.

## Exit criteria

- `bun run check` passes.
- `cd apps/web && bunx playwright test` passes.
- `bun packages/cli/dist/bin.js extract "fixtures/static/editor-packed.unitypackage" /tmp/x --filter "**/*.shader"`
  matches the same file count it did before the change.
- No `matchGlob`-equivalent function exists outside `packages/core/src/glob.ts`.
- No `updateMetaBytesGuid`-equivalent exists in web; the regex that
  rewrites guid in meta bytes lives only in `packages/core/src/meta.ts`.
