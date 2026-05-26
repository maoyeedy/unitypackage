# Phase 2 CLI Completeness - Ship Record

## What shipped

Phase 2 filled out the CLI surface with filtering, merge extraction, tree
inspection, strict verification, manifest packing, package diffing, doctor
checks, progress reporting, and safer large-directory behavior.

- Extract can filter entries with `--filter`, merge into existing directories
  with `--merge`, report changed/skipped files, and plan collisions in one pass.
- Inspect can render tree output with `--format tree` and limit displayed
  entries by extension with `--filter`.
- Verify now supports `--strict`, checks `asset.meta` GUIDs against directory
  names, reports parser diagnostics, and warns on unexpected GUID-directory
  files while allowing documented optional and legacy records.
- Pack now supports manifest input, configurable gzip levels, bounded
  concurrent file reads, and stderr progress for large source trees.
- Diff and doctor commands were added, including parseable JSON output for
  diff and format-scoped package health checks for doctor.
- CLI tests cover the new flags, commands, large-package progress behavior,
  and deterministic helpers for concurrency and collision planning.

## Files changed

| File | Change |
|------|--------|
| `packages/cli/src/cli.ts` | Added CLI wiring and help for extract, inspect, verify, pack, diff, and doctor options. |
| `packages/cli/src/commands.test.ts` | Added coverage for new flags, commands, diagnostics, progress, and concurrency behavior. |
| `packages/cli/src/commands/diff.ts` | Added package diff command with text and JSON output. |
| `packages/cli/src/commands/doctor.ts` | Added package health checks scoped to documented unitypackage format patterns. |
| `packages/cli/src/commands/extract.ts` | Added filtering, merge extraction, progress reporting, and single-pass collision planning. |
| `packages/cli/src/commands/inspect.ts` | Added tree rendering and extension filtering. |
| `packages/cli/src/commands/pack.ts` | Added manifest input, gzip-level validation, bounded reads, and large-package progress. |
| `packages/cli/src/commands/verify.ts` | Added strict mode, parser diagnostic reporting, GUID checks, and unexpected-file warnings. |
| `packages/cli/src/util/args.ts` | Added argument helpers needed by the new command flags. |
| `packages/cli/src/util/concurrency.ts` | Added a small concurrency limiter for pack reads. |
| `packages/cli/src/util/glob.ts` | Added glob matching for extract filtering. |
| `packages/cli/src/util/logger.ts` | Added stderr progress logging support. |

## Design notes

- **Machine-readable output:** Progress and summaries for long-running work use
  stderr so JSON modes keep stdout parseable.
- **Large package behavior:** Extract now plans writes once before mutating the
  destination, which provides a complete conflict list without a second scan.
- **Pack resource usage:** Pack reads use a bounded concurrency helper to avoid
  unbounded parallel filesystem reads on large source trees.
- **Later docs polish:** Keep CLI examples explicit that filters match full
  package pathnames; nested shader smoke tests need `**/*.shader`.
- **Later fixture polish:** Add a generated fixture pair that naturally shows
  changed entries in `diff` output. Current generated smoke coverage is useful
  for added/removed entries, while changed-entry behavior is covered in tests.
- **Later scope boundary:** Keep Unity YAML schema validation out of `doctor`
  unless a later plan explicitly expands the command beyond format checks.
