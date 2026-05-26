# Phase 0 - Test Coverage Gaps — Ship Record

## What shipped

The core package now asserts the package-format behavior documented in
`docs/reference/format.md` before new feature work continues. The audit checked
the real Unity-exported fixture against the format reference, then the core test
suite was expanded around parser and creator edge cases.

- Confirmed the real editor fixture matches the documented gzip tar record
  model, including 32-hex Unity GUID directories, file records with assets, and
  one folder record without an `asset` payload.
- Backfilled focused core tests for ignored `preview.png`, multi-line
  `pathname`, tar entry name limits, non-ASCII pathnames, malformed package
  data, empty pathname records, duplicate pathnames, permissive record prefixes,
  and folder records without assets.
- Documented the observed GUID validation boundary: Unity exports use 32-hex
  directory names, while the core parser preserves any archive prefix as `guid`.
- Cleared existing CLI lint blockers so the full workspace check can pass.

## Files changed

| File | Change |
|------|--------|
| `.apply-plan/checkpoints/P1.md` | Added the format audit checkpoint and fixture baseline. |
| `.apply-plan/checkpoints/P2.md` | Added the implementation checkpoint with test and verification results. |
| `docs/reference/format.md` | Documented the parser's permissive GUID prefix preservation. |
| `packages/core/src/index.test.ts` | Added Phase 0 parser and creator coverage for documented format edge cases. |
| `packages/cli/src/commands/web.ts` | Removed a lint-only unnecessary type assertion. |
| `packages/cli/src/util/args.ts` | Removed a lint-only unnecessary type assertion. |
| `packages/cli/src/util/path.ts` | Rewrote equivalent control-character filtering without a lint-blocked regex. |

## Design notes

- **GUID prefix contract:** Unity-exported records use 32-hex directory names,
  but `parseUnityPackageEntries` intentionally preserves whatever archive prefix
  is present as `guid` instead of validating shape. The docs now call this out
  so tests describe the current parser contract rather than implying stricter
  validation.
