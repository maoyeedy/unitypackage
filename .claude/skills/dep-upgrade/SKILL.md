---
name: dep-upgrade
description: Safely upgrade npm/bun/pnpm/yarn workspace dependencies in staged batches: minors first, then majors with Context7 migration research and iterative fix cycles. Use whenever the user asks to upgrade deps, bump packages, update dependencies, run ncu, modernize package versions, check for outdated packages, or wants to move to the latest versions of libraries -- even if they just say "update everything" or "ncu -u".
---

# dep-upgrade

Upgrade dependencies in two safe stages: minors (low-risk, install and verify), then majors (high-risk, research each one before fixing). The goal is a green `check` at the end with no regressions.

## 0. Detect environment

Before anything else, establish:
- **Package manager**: look for `bun.lock`/`bun.lockb` (bun), `pnpm-lock.yaml` (pnpm), `yarn.lock` (yarn), `package-lock.json` (npm). Default to `bun` if ambiguous.
- **Monorepo**: check for `pnpm-workspace.yaml`, `workspaces` in root `package.json`, or a `packages/` directory. If monorepo, `ncu` commands need `--workspaces` (or per-workspace flags depending on `ncu` version).
- **Check command**: look for a `check` script in root `package.json` (e.g., `bun run check`, `npm run check`). If absent, fall back to the closest equivalent you can find (build + test + lint separately). Ask the user if unclear.
- **ncu available**: verify `ncu --version` works; if not, install `npm-check-updates` globally or use `bunx ncu`.

## 1. Assess

Run two passes and present the results side by side before touching anything:

```
ncu [--workspaces]                    # all outdated packages
ncu --target minor [--workspaces]     # minors only
```

From the diff, compute:
- **Minor-safe set**: packages where both commands agree (the update is minor or patch)
- **Major set**: packages only in the first pass (need a major bump)

Show the user both lists. If majors are empty, skip to step 4 (just do minors + verify). If the list is unexpectedly large, ask whether to proceed or filter.

## 2. Bump minors

```
ncu --target minor -u [--workspaces]
<install>   # bun install / pnpm install / npm install / yarn
```

Then run the check:
```
<check command>
```

Capture any failures. These are your **baseline failures** -- pre-existing issues unrelated to the upcoming major bumps. Note them but do not fix them yet; majors come next and might change the picture.

## 3. Bump majors

```
ncu -u [--workspaces]   # upgrades everything not already at latest
<install>
```

After install, run the check again and collect **new failures** (failures that weren't in the baseline). Focus all fixing effort on these new failures only.

## 4. Research each major-bumped package

For every package that received a major bump (version N -> N+1 or larger), query Context7 for its migration documentation. This is mandatory before guessing at fixes -- major versions almost always have breaking changes in defaults, config, or API.

**Context7 query pattern:**

1. `resolve-library-id` with: package name + "migration guide breaking changes"
   - e.g., `"typescript migration guide breaking changes"`, `"eslint v9 migration flat config"`
2. Pick the best match (exact name, high benchmark score, recent version if version-specific)
3. `query-docs` with the library ID and: `"migration from vX to vY breaking changes configuration changes new defaults"`
   - Substitute the actual old/new version numbers

Run all the resolve calls in parallel (one per major-bumped package), then query each in parallel. Surface only the breaking changes relevant to errors you're actually seeing.

## 5. Fix errors

With migration docs in hand, work through the new failures. Common patterns to look for:

**TypeScript major bumps** -- TS often tightens defaults across majors:
- `types: []` default (TS 6+): CLI packages that rely on ambient `@types/node` need `"types": ["node"]` in their tsconfig.
- `moduleResolution` changes: `bundler` vs `node16` vs `nodenext` behavior shifts.
- Strict mode additions: new flags enabled by default.

**ESLint major bumps** -- plugin APIs change significantly:
- Flat config (`eslint.config.mjs`) vs legacy `.eslintrc`. Check if the bump requires migration.
- New rules added to existing plugins that fire on your code. Evaluate each: fix the code if the rule is pointing at a real issue, suppress with an inline comment or config entry if it's noise.
- Rule renames or removal.

**Build tool / framework bumps** -- config file formats, plugin APIs, peer dep requirements.

**Approach**: be pragmatic. If a new rule or type error reveals a real bug or anti-pattern, fix it properly. If it's churn (a cosmetic rename, a rule that doesn't apply to this codebase's patterns), suppress it and leave a comment explaining why. Don't suppress broadly -- prefer targeted suppression (`// eslint-disable-next-line` or a specific rule entry) over global disables.

Iterate: fix a batch, re-run check, narrow down remaining failures. Repeat until clean.

## 6. Verify

Once failures are resolved:
```
<check command>
```

Must pass with exit 0 and no new warnings that weren't present before. If there are pre-existing baseline failures that still remain, note them explicitly in your summary (do not silently absorb them as regressions).

If the check still has new failures after two fix attempts, switch to diagnostic mode: report what's failing, which package caused it per migration docs, and what the options are. Don't keep patching blindly.

## 7. Report

Summarize:
- Which packages were bumped (minor / major), with version ranges
- What broke and how it was fixed
- Any suppressions added and why
- Any baseline failures that pre-existed and were left untouched
- Suggested next steps if anything was deferred

Do not commit. The user decides when to commit.
