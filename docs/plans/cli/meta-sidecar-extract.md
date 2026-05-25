# CLI Meta Sidecar Extract Selection

## Context

The current CLI already preserves metas during normal extraction:

- `extract` writes `entry.asset` to disk.
- If `entry.meta` exists and `--no-meta` is not set, it writes
  `<asset>.meta` beside the asset.
- `--filter <glob>` filters by package entry pathname, not by individual output
  file rows. Because the meta is part of the same package entry, filtered
  extraction already writes the matching asset's meta.

That means a broad new `--include-meta` flag on current `extract --filter`
would mostly be redundant. Keep the CLI UX quiet and only add sidecar expansion
for exact file-level selection if that surface exists or is introduced.

Prerequisite: `docs/plans/core/meta-sidecar-selection.md`.

## Scope

In:

- Document current extract behavior clearly.
- Add an intuitive default-off exact-selection flag only for file-level
  selection.
- Make `--no-meta` win over sidecar inclusion.
- Reuse core sidecar utilities.

Out:

- No new top-level command.
- No ZIP export command.
- No changes to `pack`; it already reads adjacent source `.meta` when present.
- No generation of missing metas.
- No redundant flag that changes nothing for normal `extract --filter`.

## Phases

| ID | Title | Goal | Depends on | Files |
|----|-------|------|------------|-------|
| P1 | Confirm current extract contract | Add tests/docs that lock current default meta behavior. | -- | `packages/cli/src/commands.test.ts`, `packages/cli/README.md` |
| P2 | Exact selection surface | Add or wire exact package-file selection without disrupting glob filter behavior. | P1, Core | `packages/cli/src/cli.ts`, `packages/cli/src/util/args.ts`, `packages/cli/src/commands/extract.ts` |
| P3 | `--with-meta` expansion | Expand exact asset selections through core sidecar utilities. | P2 | `packages/cli/src/commands/extract.ts`, `packages/cli/src/commands.test.ts` |
| P4 | Help and README | Document the difference between default extraction, `--no-meta`, and `--with-meta`. | P3 | `packages/cli/src/cli.ts`, `packages/cli/README.md` |

### P1 -- Confirm current extract contract

Before adding any flag, preserve what already works:

- `extract package.unitypackage out-dir` writes assets and metas by default.
- `extract --filter 'Assets/Textures/*.png'` writes matching PNG assets and
  their metas.
- `extract --no-meta` skips all meta writes.

Exit criteria:

```text
- Tests explicitly assert filtered extract writes the matching asset sidecar by default.
- README says normal extract preserves Unity `.meta` files unless `--no-meta` is set.
- No new CLI flag is added in this phase.
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
```

### P2 -- Exact selection surface

Only implement this phase if the CLI has, or is being given, a way to select
individual package file rows rather than package entries. Use an option name
that reads naturally with extraction:

```sh
unitypackage-tools extract package.unitypackage out-dir --path Assets/1.png --path Assets/2.png
```

Rules:

- `--path <pathname>` selects exact package output paths.
- Multiple `--path` flags are allowed.
- `--filter <glob>` and `--path <pathname>` are mutually exclusive.
- Without `--with-meta`, exact selection writes exactly the requested paths
  that exist.
- Existing `--filter` semantics stay unchanged.

If Node's current `parseArgs` setup cannot capture repeated flags cleanly with
the existing helper shape, use one comma-separated string instead:

```sh
unitypackage-tools extract package.unitypackage out-dir --paths Assets/1.png,Assets/2.png
```

Prefer repeated `--path` if it fits cleanly; prefer not to introduce a new
argument parser just for this feature.

Exit criteria:

```text
- Exact path selection is available without changing existing positional args.
- `--filter` and exact path selection reject when used together.
- Without `--with-meta`, exact path selection writes only requested files.
- Existing extract tests are unchanged except for added coverage.
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
```

### P3 -- `--with-meta` expansion

Add a default-off exact-selection flag:

```sh
unitypackage-tools extract package.unitypackage out-dir --path Assets/1.png --path Assets/2.png --with-meta
```

Behavior:

- Only applies to exact path selection from P2.
- Expands selected asset paths through `resolveMetaSidecarSelection`.
- Example: requested `1.png`, `1.png.meta`, `2.png` with `--with-meta`
  writes `1.png`, `1.png.meta`, `2.png`, and `2.png.meta` when both metas
  exist.
- Explicitly requested metas are not duplicated.
- Missing sidecars do not fail extraction; log a warning unless JSON mode would
  make that unsafe.
- `--no-meta` wins. If both `--no-meta` and `--with-meta` are passed, do not
  write metas and print one concise warning.
- `--filter` remains unchanged and does not need `--with-meta`, because entry
  filtering already writes metas by default.

Implementation note:

- Adapt parsed entries to the core resolver using synthetic IDs based on output
  path, with `kind` derived from asset/meta/preview output paths.
- Keep filesystem safety checks (`sanitizeFsPath`, `isInside`, overwrite
  handling) after expansion, not before.

Exit criteria:

```text
- `--with-meta` is parsed and passed into `extract` options.
- Exact selected assets pull existing sidecars.
- Explicit selected sidecars are not duplicated.
- `--no-meta --with-meta` writes no metas and warns once.
- Missing sidecar warns but exits successfully when selected asset writes successfully.
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
```

### P4 -- Help and README

Update help text and README without making the feature sound required:

Help text:

```text
extract flags:
  --path <pathname>  Extract an exact package path; repeatable
  --with-meta        With --path, include matching .meta sidecars
  --no-meta          Do not write .meta files
```

README notes:

- Normal extract preserves `.meta` files by default.
- Use `--no-meta` only when intentionally dropping Unity metadata.
- Use `--with-meta` only with exact `--path` selection when the user wants the
  CLI to add forgotten sidecars.

Exit criteria:

```text
- CLI help documents `--with-meta` as scoped to exact path selection.
- README includes one short example for `--path ... --with-meta`.
- No docs suggest that `--filter` needs `--with-meta`.
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
```

## Verification

```sh
bun run --filter unitypackage-tools test
bun run --filter unitypackage-tools build
```
