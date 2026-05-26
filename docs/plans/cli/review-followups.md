# cli review followups

Follow-up fixes for `packages/cli` surfaced by the `refactor/cli` code review.
Apply after `docs/plans/core/review-followups.md` -- this plan assumes the
core `maxOutputBytes` guard is sound (core P1) and that GUIDs are normalized
to lowercase at create time (core P2).

## Context

Five issues remain on the CLI side after the core fixes:

1. `pack.ts` silently regenerates a user's authored `.meta` content when the
   file's GUID line is not 32-char hex, dropping any custom importer settings
   without warning.
2. `extract --path Assets/X.meta --no-meta` errors with `None of the
   requested extract paths exist.` even though the meta does exist.
3. `cli.ts` runs `parseGlobalParseOptions` before the command switch, so
   `web --max-entries -1` (and friends) fails on a flag the command does not
   use.
4. `verify.ts` re-runs `gunzipSync` via `listTarFiles` after
   `parsePackageBytes` already decompressed the archive, doubling peak
   memory on large packages.
5. `cli.ts` keeps a dead `flagBool(flags, 'h')` branch -- node `parseArgs`
   maps `-h` to `flags.help` via `short: 'h'`, never `flags.h`.

## Scope

In:
- `pack.ts` sidecar-meta handling for non-conforming GUID lines.
- `extract.ts` selection-mode error wording.
- `cli.ts` global parse-option scoping and the dead `-h` branch.
- `verify.ts` single-decompression refactor.

Out:
- Any new CLI command or flag.
- Any change to JSON output schema (`schemaVersion: 0` stays).
- Behavior changes that re-enable a YAML dependency.

## Phases

| Phase | Title                                          | Files                                              | Depends on |
|-------|------------------------------------------------|----------------------------------------------------|------------|
| P1    | Warn instead of silently regen sidecar metas   | `commands/pack.ts`, `commands/pack.test.ts`        | core P2    |
| P2    | Better extract error when --no-meta drops all  | `commands/extract.ts`, `commands/extract.test.ts`  | --         |
| P3    | Scope global parse-option validation           | `cli.ts`, `commands.test.ts`                       | core P1    |
| P4    | Verify: reuse parsed tar, drop second gunzip   | `commands/verify.ts`, `commands/verify.test.ts`    | core P1    |
| P5    | Drop dead `flagBool(flags, 'h')`               | `cli.ts`                                           | --         |

Phases are independent; P1 and P3 lean on core fixes but do not require any
new core API.

### P1 -- Warn instead of silently regen sidecar metas

Goal: When `pack` sees an existing `.meta` sidecar whose contents do not
expose a parseable 32-hex GUID line, warn the user and regenerate -- do not
silently discard the user's bytes.

Files:
- `packages/cli/src/commands/pack.ts`
- `packages/cli/src/commands/pack.test.ts`

Background: today `getExistingMeta` calls `readMetaGuid(content)`. The
helper returns `null` for any content that does not contain
`^guid:\s*[0-9a-f]{32}\s*$` (case-insensitive). On `null`, `pack` falls
through to `createGeneratedMeta`, which replaces the user's authored bytes
with a minimal generated meta. The user gets no signal that their
importer settings were dropped.

Approach: split the `null` case in `getExistingMeta` into two outcomes:
- `.meta` file does not exist -> generate as today.
- `.meta` file exists but `readMetaGuid` returned `null` -> emit a warning
  (`warn(\`Sidecar .meta has no recognizable GUID; regenerating: \${path}\`)`)
  and then generate. Return type stays `EntryMeta | null` with a side-effect
  warning, or expand to `{ meta: EntryMeta; warning?: string }` -- pick
  whichever keeps `createPackageEntry` callers simple.

Exit criteria:
- `pack` against a source with `Foo.cs.meta` containing
  `fileFormatVersion: 2\nguid: short\n` warns once with the file path and
  the reason, then proceeds with a generated meta.
- `pack` against a source with no `.meta` file warns *zero times* (current
  behavior preserved).
- `pack` against a source with a valid 32-hex GUID meta warns zero times
  and packs the bytes verbatim (current behavior preserved -- the existing
  `'preserves existing sidecar meta bytes exactly when random GUIDs are
  enabled'` test still passes).
- New pack.test.ts case covers the non-conforming-GUID warning.

### P2 -- Better extract error when --no-meta drops all

Goal: When a user runs `extract --path X.meta --no-meta` (or any set of
`--path` values that are all meta sidecars combined with `--no-meta`), the
error should say the selection was emptied by `--no-meta`, not that the
paths do not exist.

Files:
- `packages/cli/src/commands/extract.ts`
- `packages/cli/src/commands/extract.test.ts`

Approach: after the noMeta filter in the exact-selection branch, check
whether `selection.explicitRecords.length > 0 && selectedRecords.length === 0`.
If so, throw a distinct `CliError`:
`extract --no-meta dropped every requested path; remove --no-meta or
include non-meta paths.` Keep the existing `None of the requested extract
paths exist.` for the genuine no-match case (when
`selection.explicitRecords` was already empty).

Exit criteria:
- `extract pkg out --path Assets/X.meta --no-meta` errors with the new
  message; package contained `Assets/X.meta`.
- `extract pkg out --path Assets/Missing.cs` still errors with the
  original `None of the requested extract paths exist.` message.
- New extract.test.ts case covers the new error path.

### P3 -- Scope global parse-option validation

Goal: `--max-output-bytes` and `--max-entries` should validate only when the
command consumes parse options (`extract`, `inspect`, `verify`, `diff`).
Passing them to `web` or `pack` should be a no-op (the flag is ignored, the
command runs).

Files:
- `packages/cli/src/cli.ts`
- `packages/cli/src/commands.test.ts`

Approach: move the `parseGlobalParseOptions(flags)` call out of the top-level
`try` block and into each parse-consuming case branch. `web` and `pack`
should not call it. Confirm that `parseGlobalParseOptions` is still exported
for the existing unit test that exercises it directly.

Exit criteria:
- `cli(['web', '--max-entries', '-1'])` does not throw -- `web` starts
  normally (the test can pass `--port 0` to avoid binding 5173).
- `cli(['pack', 'out.unitypackage', '--max-output-bytes', 'abc'])` errors on
  pack's own arg validation (missing source/dest), not on the parse-guard
  format check.
- The existing `'rejects invalid guard values before reading package bytes'`
  test still passes (it uses `inspect`).
- The existing `'parses global safety limits into shared parser options'`
  test still passes (it calls `parseGlobalParseOptions` directly).

### P4 -- Verify: reuse parsed tar, drop second gunzip

Goal: `verify` decompresses the package exactly once.

Files:
- `packages/cli/src/commands/verify.ts`
- `packages/cli/src/commands/verify.test.ts`

Background: `parsePackageBytes(raw, opts.parseOptions)` already decompresses
the archive and walks every tar member to build `entries` and diagnostics.
`listTarFiles(new Uint8Array(raw))` then `gunzipSync`es the same bytes a
second time to find `UNEXPECTED_FILE` entries (tar names like
`<guid>/notes.txt`). With core P1 in place, the second decompression also
bypasses the streaming bomb guard.

Approach: instead of re-walking the tar in CLI code, surface the tar member
names that the core parser already saw. Two options, pick whichever is
cleaner:
- Add an optional `onTarMember?: (name: string) => void` to
  `ParseUnityPackageOptions` (core change -- coordinate with core plan; or
  defer to a follow-up if the core plan is locked).
- Or, more conservatively, add `diagnostics` with code
  `'unexpected-guid-file'` to the parser for any non-pathname/asset/meta/
  preview/metaData member.

If neither core change is in scope right now, defer this phase to a
follow-up and leave a TODO in verify.ts noting the redundant gunzip.

Exit criteria:
- `verify` invokes `gunzipSync` (or its streamed equivalent) at most once
  per call. Confirm by spying on `node:zlib.gunzipSync` in a test.
- The existing `'warns on unexpected files while allowing preview and
  legacy metadata'` test still passes -- the `UNEXPECTED_FILE` finding for
  `<guid>/notes.txt` is still emitted, and `preview.png`/`metaData` are
  still not flagged.
- No new public CLI flag.

### P5 -- Drop dead `flagBool(flags, 'h')`

Goal: Remove the unreachable `flagBool(flags, 'h')` branch in the help
guard.

Files:
- `packages/cli/src/cli.ts`

Approach: `parseArgs` configures `help: { type: 'boolean', short: 'h' }`,
so `-h` populates `flags.help`. The `flags.h` key is never set. Collapse
`if (!command || flagBool(flags, 'h') || flagBool(flags, 'help'))` to
`if (!command || flagBool(flags, 'help'))`.

Exit criteria:
- `cli(['--help'])` and `cli(['-h'])` both print help.
- `cli([])` still prints help.
- No test changes required; existing help test still passes.

## Verification

After each phase:

```
bun run --filter unitypackage-tools test
bun run --filter unitypackage-tools lint
bun run --filter unitypackage-tools build
```

After all phases land:

```
bun run check
```

Built-CLI manual smoke (run via Bun, not Node -- see CLAUDE.md Pitfalls):

```
bun run build
bun packages/cli/dist/bin.js inspect "fixtures/static/editor-packed.unitypackage" --json
bun packages/cli/dist/bin.js verify  "fixtures/static/editor-packed.unitypackage"
bun packages/cli/dist/bin.js extract "fixtures/static/editor-packed.unitypackage" /tmp/extract-test --path Assets/example.meta --no-meta
bun packages/cli/dist/bin.js web --port 0 --max-entries -1
```

The last command should start the web server briefly and exit cleanly on
Ctrl+C after P3 lands -- it should error before P3.

## Cross-plan updates

- This plan depends on `docs/plans/core/review-followups.md` P1 (bounded
  gunzip) for P4 to fully close the second-decompression gap.
- This plan depends on `docs/plans/core/review-followups.md` P2 (lowercase
  normalization at create) so P1 here does not need to re-lowercase
  user-supplied sidecar GUIDs.
- If core P4 (`subarray` sweep) lands, no CLI change is required.
