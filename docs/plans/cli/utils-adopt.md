# CLI Adoption of Core Utils

## Context

`docs/plans/core/utils-expand.md` shipped on 2026-05-25 and added these
exports to `unitypackage-core`:

- `isValidGuid`, `generateGuid`, `guidFromPath`
- `validatePathname` with structured `PathnameRejectionReason`
- `detectPathnameCollisions`
- `createMinimalMeta`
- `summarizePackage`
- `tryCreateUnityPackage` + `CreateUnityPackageDiagnostic`
- `parseUnityPackageStream` (synchronous `function*` generator)
- `DecompressionBombError`, `ParseUnityPackageOptions`
  (`maxOutputBytes`, `maxEntries`)
- `severity` on both `UnityPackageParseDiagnostic` and
  `CreateUnityPackageDiagnostic`

The CLI was migrated to the new `{ entries, diagnostics }` parse return
shape during the core rollout (`verify`, `doctor`, `extract`, `diff`,
`inspect`). `verify.ts` already routes parser diagnostic `severity`
to its finding level. Nothing else in `packages/cli` consumes the new
helpers yet.

This plan adopts the new helpers in CLI commands, replaces duplicated
local checks, and adds two small features (`pack --auto-meta`, parse
bomb-guard flags) that are now unblocked. The goal is to pressure-test
the helper surfaces before the web plans bake them into hooks and UI.

Soft-shipped during the core rollout (do not redo, just verify it
remains correct):

- `verify.ts` already maps `diagnostic.severity === 'error'` to finding
  level `'error'`; tests assert non-zero exit for `empty-pathname`,
  `malformed-tar-entry`, `duplicate-guid` without `--strict`.
- The `parseUnityPackageEntries` destructure migration is complete in
  all CLI commands.

Constraints carried forward:

- CLI runtime is Node >= 24.
- All CLI commands must keep stdout parseable in `--json` mode; route
  progress, warnings, summaries through `stderr`/logger helpers.
- `doctor` stays format-scoped; do not introduce Unity YAML schema
  validation.
- `sanitizeFilename` and `sanitizeFsPath` stay in `packages/cli/src/util/path.ts`.
  They are filesystem-layer helpers that core deliberately does not own.
  This plan does not move them.
- Manifest-driven `pack` keeps its existing input shape.

## Scope

**In:**

- Adopt `validatePathname` and `detectPathnameCollisions` in `verify`,
  `doctor`, and `extract`.
- Adopt `summarizePackage` in `inspect` and `doctor`.
- Route parser diagnostic `severity` in `doctor` (parity with
  `verify`).
- Adopt `tryCreateUnityPackage` in `pack`; surface structured
  diagnostics on failure.
- Add `pack --auto-meta` using `createMinimalMeta` + `generateGuid`
  for loose source files that lack a sidecar `.meta`.
- Add `--max-output-bytes` and `--max-entries` flags on commands that
  parse, plumbed through to `ParseUnityPackageOptions`; handle
  `DecompressionBombError` with a dedicated exit code.
- Adopt `parseUnityPackageStream` for stderr progress reporting in
  `extract`, `inspect`, and `diff` on large packages.
- Tighten `docs/reference/format.md` and `packages/core/README.md` to
  match the shipped surface (stale diagnostic interface snippet;
  sync-Generator vs `for await` example).

**Out:**

- Web changes. `docs/plans/web/extract-enrich.md` and
  `docs/plans/web/pack-export.md` own web adoption of streaming,
  severity rendering, and `createMinimalMeta` consumption.
- New CLI commands (no `merge`, no separate `summary`).
- Changes to `packages/core`. Anything missing from core is out of
  scope here -- file a follow-on core plan instead.
- Reworking `pack`'s manifest schema.
- Replacing `sanitizeFsPath` / `sanitizeFilename`; they remain in CLI.

## Phases

| ID | Title | Goal | Depends on | Parallel with | Files |
|----|-------|------|------------|---------------|-------|
| P1 | Doctor severity parity | Route parser diagnostic severity in `doctor` to its check level. | -- | P2, P3, P4 | `packages/cli/src/commands/doctor.ts`, `packages/cli/src/commands.test.ts` |
| P2 | Path safety helpers in extract/verify/doctor | Replace hand-rolled traversal / backslash / absolute checks with `validatePathname`. | -- | P1, P3, P4 | `packages/cli/src/commands/extract.ts`, `packages/cli/src/commands/verify.ts`, `packages/cli/src/commands/doctor.ts`, `packages/cli/src/commands.test.ts` |
| P3 | Collision detection in verify/doctor | Replace local `Set<string>` collision logic with `detectPathnameCollisions`. | -- | P1, P2, P4 | `packages/cli/src/commands/verify.ts`, `packages/cli/src/commands/doctor.ts`, `packages/cli/src/commands.test.ts` |
| P4 | Summary helper in inspect/doctor | Replace local `summarize` with `summarizePackage`; surface extension + size breakdown in `inspect` output. | -- | P1, P2, P3 | `packages/cli/src/commands/inspect.ts`, `packages/cli/src/commands/doctor.ts`, `packages/cli/src/commands.test.ts` |
| P5 | Pack: structured diagnostics + auto-meta | `pack` uses `tryCreateUnityPackage`; new `--auto-meta` flag generates minimal meta for loose assets. | -- | P6, P7 | `packages/cli/src/commands/pack.ts`, `packages/cli/src/bin.ts`, `packages/cli/src/commands.test.ts` |
| P6 | Bomb-guard flags | `--max-output-bytes` / `--max-entries` on parse commands; new `EXIT.BOMB` for `DecompressionBombError`. | -- | P5, P7 | `packages/cli/src/bin.ts`, `packages/cli/src/util/exit.ts`, `packages/cli/src/commands/extract.ts`, `packages/cli/src/commands/inspect.ts`, `packages/cli/src/commands/verify.ts`, `packages/cli/src/commands/doctor.ts`, `packages/cli/src/commands/diff.ts`, `packages/cli/src/commands.test.ts` |
| P7 | Streaming progress | Adopt `parseUnityPackageStream` for stderr progress in `extract`, `inspect`, `diff`. | P6 | P5 | `packages/cli/src/commands/extract.ts`, `packages/cli/src/commands/inspect.ts`, `packages/cli/src/commands/diff.ts`, `packages/cli/src/commands.test.ts` |
| P8 | Docs cleanup + gate | Refresh `format.md` interface snippet and core README streaming example; run full gate. | P1-P7 | -- | `docs/reference/format.md`, `packages/core/README.md` |

### P1 -- Doctor severity parity

**Goal:** `doctor` should map each parser diagnostic's `severity`
to a `DoctorCheckLevel` the same way `verify` already does, instead
of forwarding everything as `'warn'`.

`packages/cli/src/commands/doctor.ts` currently emits:

```ts
for (const diagnostic of parseDiagnostics) {
  check('warn', `PARSER_${...}`, diagnostic.message, diagnostic.path);
}
```

Change to:

```ts
for (const diagnostic of parseDiagnostics) {
  const level: DoctorCheckLevel =
    diagnostic.severity === 'error' ? 'error' :
    diagnostic.severity === 'warning' ? 'warn' : 'ok';
  check(level, `PARSER_${...}`, diagnostic.message, diagnostic.path);
}
```

`severity: 'info'` maps to `'ok'` and remains visible in the
checks list but does not count toward the warnings/errors summary.

**Exit criteria:**

```text
- `doctor` propagates `severity` -> `DoctorCheckLevel` for every parser diagnostic.
- New test in `commands.test.ts` asserts a fixture that triggers `empty-pathname` (error-severity) raises `PARSER_EMPTY_PATHNAME` at level `'error'` and increases `summary.errors` by 1.
- New test asserts a fixture that triggers `meta-missing` (warning-severity) raises `PARSER_META_MISSING` at level `'warn'` and increases `summary.warnings` by 1.
- New test asserts a fixture that triggers `non-standard-guid` (info-severity) raises `PARSER_NON_STANDARD_GUID` at level `'ok'` and does not increase `summary.warnings` or `summary.errors`.
- Existing `doctor` smoke (`reports package health checks scoped to unitypackage format patterns`) still passes without modification of expectations beyond severity routing.
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
```

---

### P2 -- Path safety helpers in extract/verify/doctor

**Goal:** replace the local pathname checks in three places with
`validatePathname` so format-spec rejection rules are sourced from
core.

Sites to migrate:

- `extract.ts`
  - `hasTraversalSegment(rawPath)` (local) + `path.isAbsolute` check
    against the joined dest path.
  - Keep `sanitizeFsPath` + `isInside(outDir, dest)` as the
    filesystem-layer guard (handles OS-specific quirks core does not
    know about). `validatePathname` is the format-layer gate.
- `verify.ts`
  - The `path.normalize` + `startsWith('..')` + `path.isAbsolute`
    block becomes a single `validatePathname` call. Map the rejection
    `reason` to a finding code:
    - `parent-traversal`, `absolute`, `drive-or-unc`, `backslash`
      -> `'error'` `PATH_TRAVERSAL` (keep the existing code so JSON
      consumers do not break).
    - `control-character` -> `'warn'` `CONTROL_CHARACTER` (new code).
    - `oversized-tar-entry` is not relevant at verify (no `guid` is
      passed); the existing `LONG_PATH` warning continues to flag
      length > 255.
- `doctor.ts`
  - Replace the local `hasUnsafePathname` helper with
    `validatePathname`. Keep the `BACKSLASH_PATH`,
    `PATH_OUTSIDE_ASSETS`, and `NON_STANDARD_GUID` warnings that are
    format-scoped beyond path safety.

`validatePathname` does not call out about `Assets/...` rooting --
that warning is doctor-specific and stays.

**Exit criteria:**

```text
- `extract` rejects pathnames with `validatePathname` results that are not `ok`; the existing `traversal entries skipped` summary line continues to work and reports the same count as before for the same fixtures.
- `verify` maps each `PathnameRejectionReason` to a finding code per the table above; `PATH_TRAVERSAL` exit code coverage is preserved.
- `doctor` uses `validatePathname` for the `UNSAFE_PATHNAME` check.
- New tests in `commands.test.ts` cover: an `extract` run with `../Escape.cs` is skipped and counted; `verify` reports `PATH_TRAVERSAL` for `../etc/passwd`; `verify` reports `CONTROL_CHARACTER` for a pathname containing `\x01`; `doctor` reports `UNSAFE_PATHNAME` only for inputs the core helper rejects.
- No regression in `seenPaths.toLowerCase()` duplicate-path detection (that work moves in P3, not here).
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
```

---

### P3 -- Collision detection in verify/doctor

**Goal:** replace `verify`'s `seenPaths.has(normalizedPath)` and
`doctor`'s `seenPaths.has(sanitized)` checks with one call to
`detectPathnameCollisions`. The local `Set` logic only catches
exact-after-sanitize duplicates and emits per-row warnings; the core
helper returns canonical group info we can format more clearly.

- After parsing entries, call
  `detectPathnameCollisions(entries.map(e => ({ guid: e.guid, pathname: e.pathname })))`.
- For each `PathnameCollision`:
  - In `verify`: emit `DUPLICATE_PATH` `'warn'` for case-folded
    collisions, `DUPLICATE_PATH_EXACT` `'error'` when
    `exactDuplicates === true`. Include the colliding GUIDs in the
    finding `entry` field as `<pathname> (guids: <a>, <b>)`.
  - In `doctor`: emit `DUPLICATE_OUTPUT_PATH` `'warn'` with the same
    format. Doctor's existing message intentionally uses the
    sanitized-on-disk semantics; keep the wording but replace the
    detection.
- Remove the local `seenPaths` Set in both files.

Doctor's existing case-insensitive sanitized check has slightly
different semantics (it normalizes via `sanitizeFsPath` first).
Document the change in the doctor block of this plan: we are
intentionally moving doctor to the simpler format-layer collision
model. CLI-side `sanitizeFsPath` collisions can still happen in
`extract`; that is a follow-on if the project needs it.

**Exit criteria:**

```text
- `verify` and `doctor` no longer maintain a local `seenPaths` set.
- A fixture with two GUIDs sharing `Assets/Foo.cs` reports `DUPLICATE_PATH_EXACT` (error) in `verify` and `DUPLICATE_OUTPUT_PATH` (warn) in `doctor`, with both GUIDs in the entry text.
- A fixture with two GUIDs `Assets/Foo.cs` and `Assets/FOO.cs` reports `DUPLICATE_PATH` (warn) in `verify` and `DUPLICATE_OUTPUT_PATH` (warn) in `doctor`.
- Existing duplicate-path tests still pass after the wording / code update.
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
```

---

### P4 -- Summary helper in inspect/doctor

**Goal:** drop the local `summarize` in `inspect.ts` in favor of
`summarizePackage`, and surface the new extension / size breakdown
in human-readable output.

- `inspect.ts`
  - Replace `summarize(filteredEntries)` with a call to
    `summarizePackage(parsedEntries)` for the unfiltered case and a
    second filtered call when `--filter` is provided.
  - `InspectResult.summary` widens to include
    `{ entries, withAsset, withMeta, folders, totalAssetBytes, byExtension }`.
    Keep the existing four fields for back-compat (`schemaVersion: 0`
    stays); add the new fields. JSON consumers see a superset.
  - In human-readable mode, after the existing
    `Entries: N total (...)` line, print a `Top extensions:` block
    listing the first 5 entries from `byExtension` with count and
    total asset bytes (formatted via `toLocaleString`).
- `doctor.ts`
  - Call `summarizePackage(entries, parseDiagnostics)` once.
  - Use `summary.diagnosticsBySeverity` to populate the existing
    `summary.errors` / `summary.warnings` counters instead of
    `checks.filter(...)`. This keeps the human-readable footer line
    consistent with parser severity counts.

**Exit criteria:**

```text
- `InspectResult.summary` includes `totalAssetBytes` and `byExtension` (count + assetBytes); existing fields unchanged; `schemaVersion` remains `0`.
- Human-readable `inspect` output prints `Top extensions:` after the entries summary; the section is omitted when `byExtension` is empty.
- `--filter <ext>` continues to scope the summary to filtered entries.
- `doctor` derives `summary.errors`/`summary.warnings` from `summarizePackage(..., parseDiagnostics).diagnosticsBySeverity` plus the doctor-level checks; the visible footer message format is unchanged.
- New tests in `commands.test.ts` cover: `inspect` JSON includes `totalAssetBytes` and `byExtension`; `inspect` text output prints `Top extensions:`; `doctor` footer counts match `severity` rollups.
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
```

---

### P5 -- Pack: structured diagnostics + `--auto-meta`

**Goal:** `pack` should surface every create-time validation failure
in one error block (not just the first throw), and accept a new
`--auto-meta` flag that fills in a minimal `.meta` for loose source
files that have no sidecar `.meta`.

- Replace the `createUnityPackage(packageEntries, { gzipLevel })`
  call at the bottom of `pack.ts` with
  `tryCreateUnityPackage(packageEntries, { gzipLevel })`.
- On `{ bytes: null, diagnostics }`: print each diagnostic to stderr
  via the existing `error` logger (`code: message`), then throw
  `CliError('Pack failed.', EXIT.ERROR)`. Keep the existing process
  exit semantics (no new exit code here).
- Add `--auto-meta` to the `pack` subcommand parser (`bin.ts`). When
  set, `createPackageEntry` should detect the loose-asset case
  (`getExistingMeta` returns `null`) and:
  - Call `generateGuid()` for a fresh GUID.
  - Call `createMinimalMeta(guid)`; encode UTF-8 bytes via
    `new TextEncoder().encode(...)`; use the result as the entry's
    `meta`.
  - Skip the existing `generateMeta(pathInPackage, isDirectory)`
    call. (`generateMeta` lives in `packages/cli/src/util/meta.js`
    and uses a path-derived GUID by default. `--auto-meta` opts into
    the fresh-GUID flow.)
- The default behavior (no flag) is unchanged: `generateMeta` still
  runs and `meta.guid` is derived from the pathname.

Document on `bin.ts` help text that `--auto-meta` produces
non-reproducible GUIDs across runs and is intended for ad-hoc
packing of loose files, not for source-controlled builds. Reuse the
existing `--gzip-level` help text style.

**Exit criteria:**

```text
- `pack` uses `tryCreateUnityPackage`; a manifest with two entries that share a GUID surfaces both `duplicate-guid` diagnostics in stderr before exiting non-zero.
- `pack --auto-meta` on a loose source file (no sidecar `.meta`) produces a `.unitypackage` whose entry carries a 32-hex lowercase GUID; running the same command twice produces *different* GUIDs (proves randomness).
- `pack` without `--auto-meta` on the same loose file continues to derive a path-based GUID (no change).
- New tests in `commands.test.ts` cover: duplicate-GUID manifest -> `Pack failed.` with both diagnostic messages on stderr; `--auto-meta` produces a parseable package whose entry GUID matches `^[0-9a-f]{32}$`; two `--auto-meta` runs produce different GUIDs.
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
```

---

### P6 -- Bomb-guard flags

**Goal:** expose `maxOutputBytes` and `maxEntries` on every CLI
command that parses, and translate `DecompressionBombError` into a
dedicated exit code so CI and tooling can recognize it.

- `packages/cli/src/util/exit.ts`: add `BOMB: 4` (or the next
  available code; pick at implementation time) to `EXIT`. Document
  inline.
- `packages/cli/src/bin.ts`: add two global flags to the parser:
  `--max-output-bytes <n>` and `--max-entries <n>`. Both accept
  integers; reject `< 0`. When set, plumb through to the relevant
  command via a shared `parseOptions` object.
- Each parse-consuming command (`extract`, `inspect`, `verify`,
  `doctor`, `diff`) accepts a new `parseOptions?: { maxOutputBytes?: number; maxEntries?: number }`
  argument and passes it to `parseUnityPackageEntries` /
  `parseUnityPackageStream` (after P7).
- Top-level error handler in `bin.ts`: if the thrown error is
  `DecompressionBombError` (use the `name === 'DecompressionBombError'`
  check, since `instanceof` can fail across module boundaries), print
  a one-line stderr message including `err.kind` and `err.observed`,
  then exit with `EXIT.BOMB`.

**Exit criteria:**

```text
- `--max-output-bytes` and `--max-entries` are documented in `bin.ts` help text and reach every parse command.
- A synthetic fixture that decompresses to > 1 KB raises `DecompressionBombError` when invoked with `--max-output-bytes 1024` and exits with `EXIT.BOMB`; the stderr message names the observed byte count.
- A synthetic fixture with 5 entries raises `DecompressionBombError` when invoked with `--max-entries 1` and exits with `EXIT.BOMB`; the stderr message names the observed entry count.
- The editor-packed fixture continues to parse with default flags (no regression).
- New tests in `commands.test.ts` cover the two bomb-guard cases for at least `inspect` and `verify`; `extract`, `doctor`, `diff` share the same plumbing and are covered by a single shared-plumbing test rather than four duplicates.
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
```

---

### P7 -- Streaming progress

**Goal:** replace the post-parse loop progress reporting in `extract`
with stream-time progress (one progress line per ~100 entries while
the parser is still walking the tar), and add coarse progress to
`inspect` and `diff` for large packages.

- `extract.ts`
  - Switch the top-level parse from `parseUnityPackageEntries` to
    `parseUnityPackageStream(bytes, { onProgress, ...parseOptions })`.
    Accumulate entries into an array as they are yielded; collect
    diagnostics into the existing `findings`/log pipeline.
  - `onProgress` posts `Parse progress: read X of Y bytes (N entries)`
    to stderr at the helper's built-in rate limit (~16 ms). The
    existing per-task `Extract progress: ...` lines stay, because
    they cover the write phase, not the parse phase.
- `inspect.ts` / `diff.ts`
  - Same pattern. `inspect` posts parse progress before printing the
    summary. `diff` posts parse progress for each of the two
    packages (`Parsing A: ...`, `Parsing B: ...`).
- Pass `{ maxOutputBytes, maxEntries }` from P6 into
  `parseUnityPackageStream` directly; the same `DecompressionBombError`
  path triggers.

Streaming yields `_kind === 'entry'` and `_kind === 'diagnostic'`
items. Diagnostics are appended to the same `parseDiagnostics` array
the buffered call used to return so downstream code does not branch.

**Exit criteria:**

```text
- `extract`, `inspect`, and `diff` use `parseUnityPackageStream`; the editor-packed fixture continues to produce byte-equal output for `inspect --json` and `diff --json`.
- A new test asserts that `inspect` prints at least one `Parse progress:` line to stderr when run against a fixture with > 500 entries (use one of the generated fixtures or synthesize a larger one in-test).
- `diff --json` output is byte-equal to its pre-streaming output for the same input.
- The non-streaming `parseUnityPackageEntries` continues to be used by `verify` and `doctor` (no UI motivation for streaming there; reduces blast radius).
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
```

---

### P8 -- Docs cleanup + gate

**Goal:** small refresh to reference docs that drifted during the
core rollout, then a clean gate.

- `docs/reference/format.md`
  - Replace the `interface UnityPackageParseDiagnostic { ... }`
    snippet (lines 77-83) with the current union of 9 codes and the
    `severity` field.
  - Optionally add a note that `unitypackage-tools` exposes
    `--max-output-bytes` and `--max-entries` after P6.
- `packages/core/README.md`
  - The `parseUnityPackageStream` example currently uses
    `for await (const item of parseUnityPackageStream(bytes))`. The
    helper is a synchronous `function*` generator, so update the
    example to `for (const item of parseUnityPackageStream(bytes))`.
  - Update the description from "AsyncGenerator" to "Generator".
  - The `onProgress` description is correct; leave it.

This phase is docs-only. No code changes.

Then run the full gate.

**Exit criteria:**

```text
- `docs/reference/format.md` interface snippet lists all 9 parse diagnostic codes and the `severity` field.
- `packages/core/README.md` describes `parseUnityPackageStream` as a synchronous `Generator`; the example uses `for (const item of ...)`.
- Run: bun run check
- Smoke:
  - node packages/cli/dist/bin.js inspect "fixtures/static/editor-packed.unitypackage" --json
  - node packages/cli/dist/bin.js verify  "fixtures/static/editor-packed.unitypackage"
  - node packages/cli/dist/bin.js verify  "fixtures/static/editor-packed.unitypackage" --strict
  - node packages/cli/dist/bin.js doctor  "fixtures/static/editor-packed.unitypackage"
  - node packages/cli/dist/bin.js diff fixtures/generated/minimal.unitypackage fixtures/generated/nested.unitypackage --json
- Confirm `inspect --json` for the editor-packed fixture now includes the new summary fields.
- Confirm `doctor` shows non-zero `summary.errors` only when a real parser/format error is present (no regression from severity routing).
```

## Cross-plan touchpoints

- `docs/plans/web/extract-enrich.md` P7 still says "streaming parse if
  available". After this CLI plan ships, both consumers will be using
  the same `parseUnityPackageStream`; the web plan can drop its
  conditional language.
- `docs/plans/web/pack-export.md` P5 already imports `createMinimalMeta`
  + `generateGuid` per its 2026-05-25 cross-plan note. Nothing to
  update there.
- `docs/plans/web/workspace-polish.md` P3 references streaming
  progress; same drop-the-conditional update applies once the CLI
  consumer exists.

## Critical files

- `packages/cli/src/commands/extract.ts`
- `packages/cli/src/commands/inspect.ts`
- `packages/cli/src/commands/verify.ts`
- `packages/cli/src/commands/doctor.ts`
- `packages/cli/src/commands/diff.ts`
- `packages/cli/src/commands/pack.ts`
- `packages/cli/src/bin.ts`
- `packages/cli/src/util/exit.ts`
- `packages/cli/src/commands.test.ts`
- `docs/reference/format.md`
- `packages/core/README.md`

## Verification

```sh
bun run --filter unitypackage-tools test
bun run --filter unitypackage-tools build
bun run check
```

Manual smoke (after `bun run build`):

```sh
node packages/cli/dist/bin.js inspect "fixtures/static/editor-packed.unitypackage" --json
node packages/cli/dist/bin.js verify  "fixtures/static/editor-packed.unitypackage"
node packages/cli/dist/bin.js verify  "fixtures/static/editor-packed.unitypackage" --strict
node packages/cli/dist/bin.js doctor  "fixtures/static/editor-packed.unitypackage"
node packages/cli/dist/bin.js diff fixtures/generated/minimal.unitypackage fixtures/generated/nested.unitypackage --json
node packages/cli/dist/bin.js inspect "fixtures/static/editor-packed.unitypackage" --max-entries 1   # should exit with EXIT.BOMB
node packages/cli/dist/bin.js pack /tmp/auto-meta.unitypackage some/loose/file.png Assets/loose.png --auto-meta
node packages/cli/dist/bin.js inspect /tmp/auto-meta.unitypackage --json   # confirm 32-hex guid
```
