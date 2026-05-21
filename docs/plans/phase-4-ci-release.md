# Phase 4 - CI/CD and Release Pipeline

## Context

This phase adds repository automation for CI, release publishing, web deployment,
dependency updates, coordinated versioning, browser smoke coverage, and package
metadata completeness.

## Phases

| ID | Title | Goal | Parallel with | Depends on | Files | Subagent |
|----|-------|------|---------------|------------|-------|----------|
| P1 | CI, publish, and Pages workflows | Add GitHub Actions for matrix CI, tag publishing, and web deployment. | P2 | - | `.github/workflows/*.yml`, `docs/reference/publishing.md`, `package.json` | worker |
| P2 | Dependency and version automation | Add Dependabot and Changesets configuration for the monorepo. | P1 | - | `.github/dependabot.yml`, `.changeset/config.json`, `package.json`, `bun.lock`, `docs/reference/publishing.md` | worker |
| P3 | Playwright smoke | Add a browser smoke test that loads the web app, drops a generated package, and asserts the file list renders. | - | P1, P2 | `apps/web/**/*`, `fixtures/**/*`, `package.json`, `bun.lock` | worker |
| P4 | Package metadata and release verification | Ensure CLI package includes a license and run the release dry-run gate. | - | P3 | `packages/cli/LICENSE`, `packages/cli/package.json`, `docs/reference/publishing.md` | worker |

### P1 - CI, publish, and Pages workflows

Add workflows that reflect the commands already documented for this repository.
Keep secrets and publish behavior explicit and conservative.

Exit criteria
```text
- Matrix CI runs on ubuntu, windows, and macos for pushes to `main` and runs `bun run check`.
- Publish workflow runs on `v*` tags, runs `bun run pack:dry`, and publishes `unitypackage-core` and `unitypackage-tools`.
- GitHub Pages workflow builds `apps/web` after pushes to `main` and deploys the built web app.
- Workflow YAML is valid and documented where release behavior is non-obvious.
- Run: bun run check
```

### P2 - Dependency and version automation

Add repository automation for dependency updates and coordinated package
versioning without changing package versions unless required by tooling setup.

Exit criteria
```text
- Root Dependabot config covers the monorepo package ecosystem.
- Changesets is configured for coordinated `core` and `cli` versioning.
- Root scripts or docs explain the changeset workflow if a command is added.
- Run: bun run check
```

### P3 - Playwright smoke

Add a deterministic browser smoke test for the web app using the existing
fixtures. The test should be suitable for CI.

Exit criteria
```text
- Playwright smoke test loads `apps/web`.
- The test drops `fixtures/generated/minimal.unitypackage` or creates the fixture as part of setup.
- The test asserts the file list renders.
- The test is wired into CI or an explicit package/root script.
- Run: bun run check
```

### P4 - Package metadata and release verification

Finish npm package metadata coverage and verify packaging output.

Exit criteria
```text
- `packages/cli/` includes a `LICENSE` file suitable for npm tarball inclusion.
- `bun run pack:dry` succeeds.
- Publishing documentation reflects the final release flow.
- Run: bun run pack:dry
- Run: bun run check
```

## Verification

```sh
bun run check
bun run pack:dry
```

Manual smoke:
- Review generated GitHub Actions in the GitHub UI after pushing to a branch.
- Confirm publish workflow secrets and npm permissions before tagging a release.
