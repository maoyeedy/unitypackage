# core shared runtime

Follow-up to [review-followups.md](../review-followups.md) -- surfaced by a
`/code-review` pass on the current `packages/core/` state with the question:
beyond the P1-P6 followups, what else makes core a better shared runtime for
the CLI and the web app?

## Context

After the P1-P6 review followups landed (commit `f5768a9`), a high-effort
re-review found 15 cleanup / debloat opportunities clustered into six phases.
These are not bug fixes -- they are dead-code removals, API-surface
collapses, shared-helper migrations into core, and consistency fixes between
CLI and web consumers.

Breaking changes are allowed in this plan: `unitypackage-core` is pre-1.0 and
both consumers (`packages/cli`, `apps/web`) update in the same PR as any
core break. No deprecation aliases.

## Scope

### In

- `packages/core/src/*` cleanup, API consolidation, new shared helpers.
- `packages/cli/src/*` consumer updates and `verify` simplification.
- `apps/web/src/*` consumer updates and record-shape refactor.
- Tests, README updates, and `docs/reference/archive-format-spec.md` updates that follow
  from API renames.

### Out

- New format features (preview-on-create excepted -- that's P5).
- Performance work beyond removing duplicate work.
- CLI command surface changes (flags, JSON schema versions).
- Web UI behavior changes.
- Actual streaming tar parsing -- P3 acknowledges the current
  `parseUnityPackageStream` is not memory-streaming and renames it
  accordingly, but does not implement true streaming.

## Phases

| Phase | Title | Files touched | Independent? |
|------:|-------|---------------|:---:|
| [P1](P1-drop-dead-code.md) | Drop dead and deprecated code | core, cli, web | yes |
| [P2](P2-verify-consume-diagnostics.md) | CLI `verify` consumes core diagnostics | cli | yes |
| [P3](P3-collapse-parse-surface.md) | Collapse parse API surface | core, cli, web, docs | breaking |
| [P4](P4-lift-helpers-to-core.md) | Lift `matchGlob` + `writeMetaGuid` into core | core, cli, web | yes |
| [P5](P5-cross-package-consistency.md) | GUID validity, preview-on-create, diagnostic codes | core, cli, web | breaking |
| [P6](P6-web-record-extends-core.md) | `PackageFileRecord` extends `UnityPackageComponentRecord` | web | yes |

Phases are mostly independent and can ship in any order. P1 and P2 are pure
deletion/refactor and good first picks. P3 and P5 require consumer updates
in the same PR.

## Cross-plan updates

- `docs/plans/core/review-followups.md` is the immediate predecessor and
  stays in place as historical record.
- After P3 lands, `docs/reference/archive-format-spec.md` must drop references to
  `parseUnityPackageStreamed` and update the `parseUnityPackageStream` entry
  (rename or sharpened docstring -- see P3 "Open call").

## Verification

Every phase:

- `bun run check` -- full gate (lint + typecheck + build + test).
- For phases that touch the web parse or create workers (P1, P3, P4, P6):
  `cd apps/web && bunx playwright test`.

Plan-level smoke after all phases land:

- Round-trip: parse `fixtures/static/editor-packed.unitypackage`, run
  `tryCreateUnityPackage` on the entries, parse the result, assert entry
  identity (guid + pathname + asset/meta/preview byte equality). Add this
  test under `packages/core/src/` so it gates future regressions.
- Manual CLI smoke per `CLAUDE.md`:
  - `bun packages/cli/dist/bin.js inspect "fixtures/static/editor-packed.unitypackage" --json`
  - `bun packages/cli/dist/bin.js verify  "fixtures/static/editor-packed.unitypackage"`
  - `bun packages/cli/dist/bin.js diff fixtures/generated/minimal.unitypackage fixtures/generated/nested.unitypackage --json`
