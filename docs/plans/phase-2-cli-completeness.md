# Phase 2 - CLI Completeness

## Context

This phase fills out the CLI surface with filtering, merge extraction, tree
inspection, strict verification, manifest packing, package diffing, doctor
checks, progress reporting, and safer large-directory behavior.

## Phases

| ID | Title | Goal | Parallel with | Depends on | Files | Subagent |
|----|-------|------|---------------|------------|-------|----------|
| P1 | Extract and inspect flags | Add extract filtering/merge behavior and inspect tree/filter output. | P2 | - | `packages/cli/src/commands/extract.ts`, `packages/cli/src/commands/inspect.ts`, `packages/cli/src/commands.test.ts`, `packages/cli/src/util/*.ts` | worker |
| P2 | Verify and pack flags | Add strict verify behavior plus manifest and gzip-level packing support. | P1 | - | `packages/cli/src/commands/verify.ts`, `packages/cli/src/commands/pack.ts`, `packages/cli/src/commands.test.ts`, `packages/cli/src/util/*.ts` | worker |
| P3 | New diff and doctor commands | Add `diff` and `doctor` commands with JSON-capable output where specified. | - | P1, P2 | `packages/cli/src/cli.ts`, `packages/cli/src/commands/*.ts`, `packages/cli/src/commands.test.ts`, `packages/core/src/index.ts` | worker |
| P4 | Large package UX and performance | Add progress reporting, pack read concurrency limiting, and a single-pass extract collision check. | - | P3 | `packages/cli/src/commands/extract.ts`, `packages/cli/src/commands/pack.ts`, `packages/cli/src/util/*.ts`, `packages/cli/src/commands.test.ts` | worker |

### P1 - Extract and inspect flags

Add user-facing filtering and tree output while preserving current defaults.
Keep JSON output machine-readable and route progress or summaries through the
existing logger conventions.

Exit criteria
```text
- `extract --filter <glob>` extracts only matching pathnames.
- `extract --merge` merges into an existing directory without collision error and reports changed/skipped files.
- `inspect --format tree` renders a tree instead of a flat list.
- `inspect --filter <ext>` limits displayed entries by extension.
- Tests cover matching, non-matching, merge, tree, and extension-filter behavior.
- Run: bun run --filter unitypackage-tools test
```

### P2 - Verify and pack flags

Implement strict verification and pack configuration flags with validation.
Use Phase 1 parser diagnostics where they improve verification output. Keep
defaults compatible with existing CLI behavior.

Exit criteria
```text
- `verify --strict` exits non-zero when warnings are present.
- `verify` checks GUID values in `asset.meta` against directory names.
- `verify` warns on unexpected files inside a GUID directory while allowing documented optional and legacy entries such as `preview.png` and `metaData`.
- `verify` reports relevant Phase 1 parser diagnostics such as malformed tar entries, empty pathnames, non-standard GUIDs, and ignored previews.
- `pack --manifest <file.json>` reads `{ "src": "dst" }` pairs.
- `pack --gzip-level <0-9>` controls compression level and validates the range.
- Tests cover success and failure cases for all new flags.
- Run: bun run --filter unitypackage-tools test
```

### P3 - New diff and doctor commands

Add focused commands for comparing packages and surfacing opinionated package
health checks. Avoid Unity YAML schema validation.

Exit criteria
```text
- `diff <pkg-a> <pkg-b>` reports entries added, removed, and changed by GUID, pathname, and asset hash.
- `diff --json` emits parseable JSON.
- `doctor <pkg>` reports checks scoped to `docs/reference/format.md` patterns.
- Command help and tests cover both new commands.
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
```

### P4 - Large package UX and performance

Improve behavior for large packages without changing successful small-package
output. Preserve clean stdout for JSON modes.

Exit criteria
```text
- Extract and pack operations over 100 entries show stderr progress.
- Pack file reads are concurrency-limited to avoid unbounded parallel reads.
- Extract collision detection is performed in a single pass that builds a conflict list without re-scanning.
- Tests cover the changed behavior or isolate it behind deterministic helpers.
- Run: bun run --filter unitypackage-tools test
- Run: bun run check
```

## Verification

```sh
bun run --filter unitypackage-tools test
bun run check
node packages/cli/dist/bin.js inspect "fixtures/static/editor-packed.unitypackage" --format tree
node packages/cli/dist/bin.js verify "fixtures/static/editor-packed.unitypackage" --strict
node packages/cli/dist/bin.js doctor "fixtures/static/editor-packed.unitypackage"
```

Manual smoke:
- Run `diff` against two generated fixture packages and inspect both text and `--json` output.
- Exercise `extract --filter` and `extract --merge` into a temporary directory.
