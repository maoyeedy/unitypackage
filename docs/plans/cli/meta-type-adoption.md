# CLI Adoption of Core Meta Importer Types

## Context

`docs/plans/core/meta-type-robustness.md` shipped on 2026-05-25 (commit
`4190d65`). The core package now exports four importer-type primitives:

- `MetaImporterType` -- union: `'DefaultImporter' | 'DefaultImporterFolder' | 'TextScriptImporter' | 'MonoImporter'`
- `detectMetaImporterType(pathname, isDir?)` -- extension-based dispatch
- `createMinimalMetaFor(guid, pathname, isDir?)` -- detect + generate
- `createMinimalFolderMeta(guid)` -- explicit folder generator
- `createMinimalMeta(guid)` -- legacy, unchanged, always `DefaultImporter`

The CLI does not consume any of these yet. Two CLI surfaces still hand-roll
their own meta generation:

1. `packages/cli/src/util/meta.ts` -- `generateMeta(pathInPackage, isDirectory)`
   returns a plain `Meta` object (`{ fileFormatVersion: 2, guid, folderAsset? }`).
   `serializeMeta` runs it through the `yaml` package. This output omits the
   importer block entirely, so Unity falls back to `DefaultImporter` for every
   file -- including `.cs` scripts and `.json` text assets, which logs importer
   warnings on import and mis-handles those assets.
2. `packages/cli/src/commands/pack.ts` calls `generateMeta(...)` for every
   source file without an adjacent `.meta` sidecar and packs the resulting
   block.

Additionally, the prior `docs/plans/cli/utils-adopt.md` P5 proposed a
`pack --auto-meta` flag that would call the *legacy* `createMinimalMeta(guid)`.
That phase has not shipped (`done.md` only lists Phase 0-2). **This plan ships
before utils-adopt P5.** When P5 is finally written, the `--auto-meta` flow
must call `createMinimalMetaFor(guid, pathInPackage, isDir)` instead of
`createMinimalMeta(guid)` so loose-file packing inherits the importer-type
correctness that this plan establishes as the default.

`packages/cli/src/util/meta.ts` also currently uses the `yaml` package in two
places: `serializeMeta` (write path, removed in P1) and `parseMeta` (read path,
used to read existing `.meta` sidecars during pack). The read path is the
*only* remaining consumer of the `yaml` runtime dep; P4 of this plan replaces
it with a cheap line-scan so the dep can be dropped entirely.

`extract`, `verify`, and `doctor` do not synthesize meta YAML today (they only
pass-through what is already in the archive), so meta-type correctness on those
commands is a *validation* opportunity, not a generation one: the CLI can warn
when a parsed entry's meta block disagrees with the importer type the file
extension would predict.

## Scope

**In:**

- Replace the local `generateMeta(...)` + `serializeMeta(...)` flow in
  `packages/cli/src/commands/pack.ts` with `createMinimalMetaFor(guid, pathname, isDir)`
  for the path-derived-GUID case (default `pack` behavior). Default-on; no
  opt-in flag (legacy `DefaultImporter`-for-everything output is a bug, not
  a feature).
- Delete the now-dead `generateMeta` and `serializeMeta` exports from
  `packages/cli/src/util/meta.ts`, and delete their tests in `util.test.ts`.
- Rewrite `parseMeta` as a regex line-scan for `guid: <32 hex>` (+ optional
  `folderAsset: yes`) so it no longer depends on `YAML.parse`. Drop the
  `yaml` runtime dep from `packages/cli/package.json` once nothing imports it.
- Cross-plan: update the wording of `docs/plans/cli/utils-adopt.md` P5 so
  that, when it eventually ships, `--auto-meta` calls
  `createMinimalMetaFor(guid, pathInPackage, isDir)` rather than the legacy
  `createMinimalMeta(guid)`. This plan does not implement the flag itself,
  only retargets the future phase.
- Add a `doctor` check (`META_IMPORTER_MISMATCH`, level `'warn'`) that
  compares each parsed entry's meta YAML against
  `detectMetaImporterType(entry.pathname, entry.asset === undefined)` and
  flags inconsistencies. Pure top-level key scan; no YAML parser.
- Add a `verify` finding (`META_IMPORTER_MISMATCH`, level `'warn'`, upgraded
  to `'error'` under `--strict`) covering the same comparison.
- Snapshot / fixture updates: regenerate any `fixtures/generated/*` packages
  whose meta blocks change, and update affected test assertions in
  `packages/cli/src/commands.test.ts`.
- Update `packages/cli/README.md` with one short paragraph on the new
  meta-importer behavior (default-on; intentional; matches Unity Editor
  output).

**Out:**

- No changes to `packages/core` (anything missing goes into a follow-on core
  plan).
- No new CLI subcommand.
- No YAML schema validation of importer block *contents* beyond the block name
  (e.g. we do not validate that `MonoImporter` has `executionOrder: 0`). That
  is doctor-format-scope creep.
- No web changes. The web package consumes `createMinimalMetaFor` through its
  own plan (`docs/plans/web/pack-export.md` P5 cross-plan touchpoint).
- No `extract`-time *rewriting* of meta blocks (extract remains a pass-through
  of archive bytes; importer mismatch is reported by `verify`/`doctor`, not
  silently fixed).
- Manifest schema for `pack` is unchanged.
- `createGuid` and `parseMeta` in `packages/cli/src/util/meta.ts` stay --
  `createGuid` is path-deterministic and unique to CLI's pack semantics;
  `parseMeta` reads existing sidecars during pack. P4 rewrites `parseMeta`
  internals but keeps its signature.

## Decisions

1. **Default-on adoption.** Switching `pack` to importer-aware meta generation
   is a bug fix, not a behavior change requiring opt-in. The legacy
   `DefaultImporter`-for-everything output causes Unity to log importer
   warnings on `.cs` / `.json` imports; the new output stops triggering them.
   No backward-compat flag is added on `pack`. README addition (P3) calls out
   the change for anyone tracking pack output across versions.
2. **`yaml` runtime dep is fully removed** (not partially). P1 removes the
   write-path consumer (`serializeMeta`); P4 rewrites `parseMeta` as a line
   scanner and drops the dep. Leaving `yaml` pinned by a single tiny reader
   is worse for clean code than rewriting one helper.
3. **Doctor mismatch is `'warn'`, not `'error'`.** Mismatches in third-party
   `.unitypackage` files are common (older tools, manual edits) and should
   not fail `doctor`. `verify --strict` is the escalation path.
4. **Block-name comparison only.** The doctor/verify check inspects the top
   level YAML keys for `DefaultImporter` / `MonoImporter` / `TextScriptImporter`
   (and the `folderAsset: yes` marker) -- it does not validate every nested
   field. This stays format-scoped per repo convention.
5. **Fixture regeneration is in-scope.** `fixtures/generated/*.unitypackage`
   produced by `scripts/fixtures-build.ts` will change byte-for-byte once
   pack switches generators. The script re-run is part of P3.
6. **Ship order.** This plan ships before `docs/plans/cli/utils-adopt.md` P5.
   That phase has not landed; its proposed `--auto-meta` flow currently
   targets `createMinimalMeta(guid)` and must be retargeted to
   `createMinimalMetaFor(guid, pathInPackage, isDir)` before it is applied.

## Phases

| ID | Title | Goal | Depends on | Parallel with | Files |
|----|-------|------|------------|---------------|-------|
| P1 | Pack adopts `createMinimalMetaFor` | Replace `generateMeta`/`serializeMeta` in the default pack path; delete the dead exports and their tests. | -- | P2 | `packages/cli/src/commands/pack.ts`, `packages/cli/src/util/meta.ts`, `packages/cli/src/util.test.ts`, `packages/cli/src/commands.test.ts` |
| P2 | Importer-mismatch checks in doctor/verify | Add `META_IMPORTER_MISMATCH` finding using `detectMetaImporterType`. | -- | P1 | `packages/cli/src/commands/doctor.ts`, `packages/cli/src/commands/verify.ts`, `packages/cli/src/commands.test.ts` |
| P3 | Fixture regeneration + README | Re-run `scripts/fixtures-build.ts`, update snapshot assertions, document behavior. | P1 | P4 | `fixtures/generated/*`, `packages/cli/README.md`, `packages/cli/src/commands.test.ts` |
| P4 | Drop `yaml` runtime dep | Rewrite `parseMeta` as a line scanner; remove `yaml` from `packages/cli/package.json`. | P1 | P3 | `packages/cli/src/util/meta.ts`, `packages/cli/src/util.test.ts`, `packages/cli/package.json` |

### P1 -- Pack adopts `createMinimalMetaFor`

**Goal:** every loose source file packed without an adjacent `.meta` sidecar
gets a meta block whose importer type matches its extension (`MonoImporter`
for `.cs`, `TextScriptImporter` for text-script extensions, folder block for
directories, `DefaultImporter` otherwise).

Site of change: `packages/cli/src/commands/pack.ts` -> `createPackageEntry`.

Current code:

```ts
const meta = (await getExistingMeta(sourcePath, limitRead)) ?? generateMeta(pathInPackage, isDirectory);
const entry: CreateUnityPackageEntry = {
  guid: meta.guid,
  pathname: pathInPackage,
  meta: serializeMeta(meta),
};
```

Target code (sketch -- final shape can collapse the branches):

```ts
const existing = await getExistingMeta(sourcePath, limitRead);
let guid: string;
let metaBytes: Uint8Array;
if (existing !== null) {
  guid = existing.guid;
  metaBytes = serializeMeta(existing);            // preserve user-authored metas verbatim
} else {
  guid = createGuid(pathInPackage);               // unchanged path-derived GUID
  metaBytes = new TextEncoder().encode(
    createMinimalMetaFor(guid, pathInPackage, isDirectory),
  );
}
const entry: CreateUnityPackageEntry = { guid, pathname: pathInPackage, meta: metaBytes };
```

Notes:

- The user-authored `.meta` branch stays untouched. Pack must not rewrite
  metas that already exist on disk -- that would silently mutate Unity
  project source.
- `generateMeta` and `serializeMeta` become unused after this phase and are
  deleted from `packages/cli/src/util/meta.ts`, along with their tests in
  `packages/cli/src/util.test.ts`. (Grep first to confirm no other consumer
  exists; the current grep shows only `pack.ts` and the test file.)
- `parseMeta` stays -- it still reads existing sidecars from disk. P4
  rewrites its internals to drop the `yaml` dep; the signature is unchanged.
- `createGuid` stays. It is the path-derived MD5-of-UTF16LE that the deleted
  `generateMeta` used internally; preserve byte-equality for existing
  fixtures that lack adjacent metas (none in the current fixture set, but
  cheap to keep).
- Do NOT drop the `yaml` dep in P1; `parseMeta` still imports it. P4 handles
  the dep removal in a clean separate phase.

**Exit criteria:**

```text
- Default `pack` of a directory containing `Script.cs`, `Data.json`, `Image.png`, and an empty subfolder produces meta blocks whose top-level YAML key is `MonoImporter`, `TextScriptImporter`, `DefaultImporter`, and `DefaultImporter` (with `folderAsset: yes`) respectively.
- Pack still preserves user-authored `.meta` files byte-equivalent through the existing `getExistingMeta` path; a fixture with a hand-written sidecar round-trips unchanged.
- `generateMeta` and `serializeMeta` are removed from `packages/cli/src/util/meta.ts`; their tests are removed from `packages/cli/src/util.test.ts`.
- `createGuid` and `parseMeta` remain exported. `yaml` dep remains in `package.json` (removed in P4).
- New tests in `commands.test.ts` cover the four-extension matrix above plus the user-authored-meta passthrough.
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
```

---

### P2 -- Importer-mismatch checks in doctor/verify

**Goal:** detect cases where a parsed entry's meta block claims an importer
that disagrees with `detectMetaImporterType(entry.pathname, isDir)`. Surface
this as a non-fatal warning in `doctor`, and a warning-by-default /
error-under-`--strict` finding in `verify`.

Detection helper (private to each command file or hoisted into
`packages/cli/src/util/meta.ts`):

```ts
function readImporterBlockName(metaYaml: string): MetaImporterType | null {
  // Cheap line scan -- no YAML parse. Look for a top-level key matching one of:
  //   'DefaultImporter:', 'MonoImporter:', 'TextScriptImporter:', 'NativeFormatImporter:', etc.
  // Then look for a top-level `folderAsset: yes` line and upgrade DefaultImporter -> DefaultImporterFolder.
  // Return null if no recognized block is present.
}
```

- `doctor.ts`: after the existing checks loop, iterate `entries` and for each
  entry that has a `meta` payload:
  - `predicted = detectMetaImporterType(entry.pathname, entry.asset === undefined)`
  - `actual = readImporterBlockName(new TextDecoder().decode(entry.meta))`
  - If `actual !== null && actual !== predicted`, emit `check('warn', 'META_IMPORTER_MISMATCH', '<pathname>: meta declares <actual>, extension suggests <predicted>', entry.pathname)`.
- `verify.ts`: same detection. Push a finding with `code: 'META_IMPORTER_MISMATCH'`,
  `level: 'warn'` (default) or `level: 'error'` when `opts.strict === true`.
  Make sure `verify --strict` exit-code logic still trips on the upgraded level.

If `readImporterBlockName` returns `null` (no recognized importer block at
all), do **not** emit `META_IMPORTER_MISMATCH` -- that is a separate concern
(`PARSER_META_MISSING` etc. already cover absent metas).

**Exit criteria:**

```text
- A fixture entry where `Assets/Script.cs` carries a `DefaultImporter` meta block triggers `META_IMPORTER_MISMATCH` in both `verify` and `doctor`.
- `verify` without `--strict` reports the mismatch at level `'warn'` and still exits zero.
- `verify --strict` reports the mismatch at level `'error'` and exits non-zero.
- `doctor` reports the mismatch at level `'warn'`; `summary.warnings` increments accordingly.
- A correctly-typed meta (e.g. a `MonoImporter` block on `.cs`) produces no finding.
- An entry with no recognizable importer block (e.g. only `fileFormatVersion: 2\nguid: ...`) does not produce `META_IMPORTER_MISMATCH`.
- New tests cover at least: cs+DefaultImporter (mismatch), cs+MonoImporter (clean), json+TextScriptImporter (clean), png+DefaultImporter (clean), and folder+DefaultImporterFolder (clean).
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
```

---

### P3 -- Fixture regeneration + README

**Goal:** refresh checked-in generated fixtures whose meta blocks change as a
side effect of P1, then document the new behavior.

- Run `node scripts/fixtures-build.ts` to regenerate
  `fixtures/generated/*.unitypackage`. Inspect the diff: only meta payloads
  for entries that were *not* user-authored should change; tar header bytes
  (mtime is fixed in the builder) and asset payloads should remain
  byte-equivalent.
- Update any snapshot or byte-exact assertions in
  `packages/cli/src/commands.test.ts` whose expected values depend on the old
  `DefaultImporter`-only outputs. Prefer asserting *importer type* rather than
  re-snapshotting full YAML blocks where possible -- this keeps future template
  edits in core from cascading into CLI test churn.
- Add a short README section to `packages/cli/README.md` ("Meta importer
  types") that says: pack now selects `MonoImporter` / `TextScriptImporter` /
  folder / `DefaultImporter` based on file extension; user-authored sidecars
  pass through unchanged; `doctor` and `verify --strict` flag mismatches.
  Frame the change as a bug fix (the legacy `DefaultImporter`-only output
  triggered spurious Unity importer warnings) so readers tracking pack
  output across CLI versions have context for the diff.

**Exit criteria:**

```text
- `node scripts/fixtures-build.ts` runs clean; `git status fixtures/generated/` shows expected modifications limited to entries that did not have user-authored metas.
- `packages/cli/src/commands.test.ts` passes against the regenerated fixtures without removing existing coverage.
- `packages/cli/README.md` has a "Meta importer types" subsection of at most ~15 lines.
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
- Run: bun run check
```

---

### P4 -- Drop `yaml` runtime dep

**Goal:** remove the `yaml` package from `packages/cli`'s runtime dependencies
by rewriting the last consumer (`parseMeta`) as a cheap line scanner. Mirrors
the line-scan approach P2 already adopts for `readImporterBlockName`, so the
CLI ends up with one consistent parsing strategy for meta YAML.

Site of change: `packages/cli/src/util/meta.ts`.

Current code:

```ts
import YAML from 'yaml';

export function parseMeta(content: string): Meta | null {
  try {
    const parsed = YAML.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.guid !== 'string') return null;
    return obj as unknown as Meta;
  } catch {
    return null;
  }
}
```

Target code (sketch):

```ts
const GUID_LINE = /^guid:\s+([0-9a-fA-F]{32})\s*$/m;
const FOLDER_LINE = /^folderAsset:\s+yes\s*$/m;

export function parseMeta(content: string): Meta | null {
  const guidMatch = GUID_LINE.exec(content);
  if (!guidMatch) return null;
  const meta: Meta = { fileFormatVersion: 2, guid: guidMatch[1] };
  if (FOLDER_LINE.test(content)) meta.folderAsset = true;
  return meta;
}
```

Then:

- Delete the `import YAML from 'yaml'` line.
- Remove `"yaml"` from `dependencies` in `packages/cli/package.json`.
- Run `bun install` to update the lockfile.
- Grep `packages/cli/src` for any remaining `from 'yaml'` import to confirm
  zero residue. If anything turns up, document it; do not silently keep the
  dep.

The `Meta` interface keeps its loose `[key: string]: ...` index signature
even though the line scanner only populates two fields. Consumers of
`parseMeta` (currently only `pack.ts` via `getExistingMeta`) read
`meta.guid` and pass the original sidecar bytes through unmodified, so they
never depend on populated extra fields.

**Exit criteria:**

```text
- `packages/cli/src/util/meta.ts` no longer imports `yaml`.
- `packages/cli/package.json` has no `yaml` entry under `dependencies`; lockfile is updated accordingly.
- `grep -R "from 'yaml'" packages/cli/src` returns no matches.
- `parseMeta` correctly extracts the GUID from a minimal Unity meta (file and folder), returns `folderAsset: true` for folder metas, returns `null` for inputs missing `guid:`, and tolerates trailing whitespace / mixed line endings.
- New tests in `packages/cli/src/util.test.ts` (replacing the deleted `generateMeta` tests from P1) cover at least: file meta, folder meta, missing-guid input, malformed input, CRLF line endings, and a real `MonoImporter`-shaped sidecar from a regenerated fixture.
- The existing `pack` round-trip behavior (user-authored sidecars pass through byte-equivalent) is unchanged.
- Run: bun run --filter unitypackage-tools test
- Run: bun run --filter unitypackage-tools build
- Run: bun run check
```

## Cross-plan touchpoints

- **Ordering: this plan ships BEFORE `docs/plans/cli/utils-adopt.md` P5.**
  That phase ("Pack: structured diagnostics + `--auto-meta`") currently
  specifies `createMinimalMeta(guid)` for the `--auto-meta` flow. Before P5
  is applied, its phase body must be retargeted to
  `createMinimalMetaFor(guid, pathInPackage, isDirectory)` so randomly-GUIDed
  loose files inherit the importer-type correctness that this plan
  establishes as the default. Applying P5 with its current wording would
  reintroduce the legacy `DefaultImporter`-only output on the `--auto-meta`
  code path.
- `docs/plans/web/pack-export.md` P5 imports `createMinimalMeta` +
  `generateGuid` for in-browser pack. Once that lands, swap it to
  `createMinimalMetaFor` for the same reason. The parallel
  `docs/plans/web/meta-type-adoption.md` P4 already calls this out; no change
  required from this CLI plan.
- `docs/plans/core/meta-type-robustness.md` is the upstream; do not modify.

## Critical files

- `packages/cli/src/commands/pack.ts` (P1)
- `packages/cli/src/util/meta.ts` (P1: delete `generateMeta`/`serializeMeta`; P4: rewrite `parseMeta`)
- `packages/cli/src/util.test.ts` (P1: delete `generateMeta` tests; P4: add `parseMeta` line-scan tests)
- `packages/cli/src/commands/doctor.ts` (P2)
- `packages/cli/src/commands/verify.ts` (P2)
- `packages/cli/src/commands.test.ts` (P1, P2, P3)
- `packages/cli/package.json` (P4: drop `yaml` dep)
- `packages/cli/README.md` (P3)
- `fixtures/generated/*.unitypackage` (P3: regenerated)
- `scripts/fixtures-build.ts` (P3: run, not edit)

## Verification

```sh
bun run --filter unitypackage-tools test
bun run --filter unitypackage-tools build
bun run check
```

Manual smoke (after `bun run build`):

```sh
# Pack a tiny tree containing .cs, .json, .png, and an empty folder; inspect the resulting metas.
node packages/cli/dist/bin.js pack /tmp/meta-types.unitypackage <src>/Script.cs Assets/Script.cs <src>/Data.json Assets/Data.json <src>/Image.png Assets/Image.png
node packages/cli/dist/bin.js inspect /tmp/meta-types.unitypackage --json | jq '.entries[] | {pathname, metaPreview}'   # confirm 4 distinct importer blocks

# Round-trip a fixture that already contains user-authored metas to confirm passthrough is byte-equal.
node packages/cli/dist/bin.js inspect "fixtures/static/editor-packed.unitypackage" --json
node packages/cli/dist/bin.js verify  "fixtures/static/editor-packed.unitypackage" --strict
node packages/cli/dist/bin.js doctor  "fixtures/static/editor-packed.unitypackage"
```
