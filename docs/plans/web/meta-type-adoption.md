# Web Meta Importer Type Adoption

## Context

The core package (`packages/core`) shipped a meta importer-type detection and
generation surface on 2026-05-25 (see `docs/plans/core/meta-type-robustness.md`,
commit 4190d65). New public exports in `packages/core/src/index.ts`:

- `MetaImporterType` -- union of `'DefaultImporter' | 'DefaultImporterFolder' | 'TextScriptImporter' | 'MonoImporter'`.
- `detectMetaImporterType(pathname, isDir?)` -- extension-based dispatch.
- `createMinimalMetaFor(guid, pathname, isDir?)` -- detection + correct YAML template.
- `createMinimalFolderMeta(guid)` -- explicit folder meta generator.
- `createMinimalMeta(guid)` -- legacy, always `DefaultImporter` (unchanged).

The web app (`apps/web`) does not call any of these today. A repo-wide grep for
`createMinimalMeta`, `MetaImporterType`, `detectMetaImporterType`,
`createMinimalMetaFor`, and `createMinimalFolderMeta` returns no matches under
`apps/web`. The Metadata pane in `apps/web/src/App.tsx` shows path / GUID /
extension / MIME / size / asset bytes / meta bytes / preview bytes / duplicate
paths / preview support / syntax language, but does not surface importer type.
`packageModel.ts`'s `PackageFileRecord` model carries no importer-type field.

This plan adopts the new core surface in the web app so users can see what
Unity importer a packaged meta declares (or would declare) and so any
forthcoming meta-generation path in Pack mode uses the correct template.

## Decisions

1. **Surface: Metadata pane only.** No explorer column, no per-row chip.
   Extension grouping in the explorer already communicates most of this
   information implicitly (`.cs` is always `MonoImporter`); promoting it to
   the explorer would crowd a dense pane for low marginal information. The
   Metadata pane is the canonical surface for "more info about the selected
   record".
2. **Mismatch diagnostics flow through `record.diagnostics`, not a pane-local
   block.** The Metadata pane already renders `record.diagnostics` in a
   "Related diagnostics" section (`App.tsx:1281`). A second pane-local UI for
   the same UX concept ("issue affecting this record") would fragment an
   existing affordance. To preserve the architectural rule that core stays
   web-agnostic, we widen `PackageFileRecord.diagnostics` from
   `UnityPackageParseDiagnostic[]` to a web-local union
   `RecordDiagnostic[] = UnityPackageParseDiagnostic | MetaImporterMismatchDiagnostic`
   and keep discrimination by `code`. The existing Stats line that reads
   `diagnostics.length` correctly starts counting mismatches as issues.
3. **Declared-importer detection is a strict line-anchored regex on the head
   of the meta bytes** (decoded as UTF-8, capped at 4 KB). Pattern set
   mirrors the CLI plan's `readImporterBlockName` for cross-surface
   consistency:
   - `/^(DefaultImporter|TextScriptImporter|MonoImporter):\s*$/m` to name
     the block
   - `/^folderAsset:\s+yes\s*$/m` to upgrade `DefaultImporter` to
     `DefaultImporterFolder`
   - Returns `null` (and therefore emits no diagnostic) when no recognized
     block is present. Unrecognized metas are not our concern -- a separate
     diagnostic family already covers absent / malformed metas.
4. **Mismatch severity is `'info'`, not `'warning'`.** Third-party
   `.unitypackage` files frequently carry slightly-off metas (older tools,
   hand-edits); we surface the disagreement but do not raise alarm. Promoting
   to `'warning'` later is a one-constant change if real-world hit-rate
   warrants it.
5. **Detection is computed lazily on the active record only** in P1 to avoid
   per-record allocation in `entriesToRecords`. P2 needs detection across
   all meta records (for the diagnostic pass); that pass runs once at parse
   time and writes results into `record.diagnostics`.
6. **No auto-fix.** Extract behavior is observational. We do not rewrite
   meta bytes anywhere in the web app.
7. **Pack mode stays a shell.** P4 only updates the cross-plan note in
   `docs/plans/web/pack-export.md` P5 so the eventual generator uses the
   typed API. No runtime Pack change in this plan.
8. **English-only, no new URL state, ASCII punctuation, no `kind` field on
   `PackageFileRecord`.** Repo conventions; not relitigated.

## Scope

In:

- Surface detected importer type in the right-side Metadata pane for the
  active record.
- Add a browser-safe `detectImporterTypeFor(record)` helper in
  `packageModel.ts` that wraps `detectMetaImporterType` and strips trailing
  `.meta` so asset and meta records resolve to the same type.
- Add `readDeclaredImporterType(metaBytes)` using a strict line-anchored
  regex (Decision 3) -- no YAML parser.
- Widen `PackageFileRecord.diagnostics` to a web-local union
  `RecordDiagnostic = UnityPackageParseDiagnostic | MetaImporterMismatchDiagnostic`
  and append a `META_IMPORTER_MISMATCH` entry (`severity: 'info'`) to the
  meta record's diagnostics list when declared != detected.
- Render the existing "Related diagnostics" section in the Metadata pane so
  it picks up the mismatch automatically (the renderer iterates
  `record.diagnostics`; discrimination by `code` is the same pattern used
  today).
- Show an "Importer type" row in the Metadata pane for every record.
- Document that any future meta-generation path in Pack mode must call
  `createMinimalMetaFor` (or `createMinimalFolderMeta` for folders), not
  `createMinimalMeta`. Update the cross-plan note in `pack-export.md` P5.
- Unit tests in `apps/web/src/packageModel.test.ts` for both helpers and the
  diagnostic-attachment pass. Optional Playwright assertion that the
  Metadata pane shows the importer-type row for a known fixture record.

Out:

- No YAML schema validation. We do not introduce a YAML parser. Detection
  is a strict line-anchored regex against the four known importer keys.
- No auto-fix of existing metas. Extract is read-only with respect to meta
  bytes.
- No Pack mode export enabling. Pack-time meta generation is wired by
  `docs/plans/web/pack-export.md` P5 once the new browser creation API
  lands; this plan only updates the cross-plan note to require the typed API.
- No new explorer column or per-row chip. Importer type appears only in the
  Metadata pane.
- No `kind` field on `PackageFileRecord`.
- No core-package changes. The core surface is already public and tested.
- No pane-local mismatch block. Mismatches render through the existing
  `record.diagnostics` list (Decision 2).
- No promotion of mismatch severity above `'info'` (Decision 4).

## Phases

| ID | Title | Goal | Parallel with | Depends on | Files | Subagent |
|----|-------|------|---------------|------------|-------|----------|
| P1 | Detection helper and Metadata row | Add a derived `detectImporterTypeFor(record)` helper and render an "Importer type" row in the Metadata pane. | -- | core 4190d65 | `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts`, `apps/web/src/App.tsx` | worker |
| P2 | Declared-type detection and diagnostic routing | Widen `record.diagnostics`, add `readDeclaredImporterType`, attach `META_IMPORTER_MISMATCH` during `entriesToRecords`. Renders through existing diagnostics list. | -- | P1 | `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts`, `apps/web/src/App.tsx` | worker |
| P3 | Tests and small UX polish | Vitest coverage for the helper, the regex detector, and the attachment pass across all four importer types; optional Playwright assertion; inline help text on the Metadata row. | -- | P1, P2 | `apps/web/src/packageModel.test.ts`, `apps/web/src/App.tsx`, `apps/web/tests/explorer.spec.ts` | worker |
| P4 | Pack-time generation requirement | Document that the disabled Pack flow must call `createMinimalMetaFor` / `createMinimalFolderMeta` when meta generation is wired. No runtime change. | -- | P1 | `docs/plans/web/pack-export.md` | inline |

### P1 -- Detection helper and Metadata row

Add a pure helper to `apps/web/src/packageModel.ts`:

```ts
import { detectMetaImporterType, type MetaImporterType } from 'unitypackage-core';

export function detectImporterTypeFor(record: PackageFileRecord): MetaImporterType {
  // For meta records, the importer applies to the asset they describe, so
  // strip the trailing `.meta` from `pathname` before dispatch. For asset
  // records, dispatch directly. Folder detection relies on the core helper's
  // extensionless fallback; the web layer does not surface folder entries
  // as their own records today.
  const target = record.extension === 'meta'
    ? record.pathname.replace(/\.meta$/, '')
    : record.pathname;
  return detectMetaImporterType(target);
}
```

In `App.tsx`'s `Metadata` component, add a row after "Syntax language":

```text
['Importer type', detectImporterTypeFor(record)],
```

Use a stable label string (English). Do not add a column to the explorer.
Do not change `PackageFileRecord`.

Scope:

- Export `detectImporterTypeFor` from `packageModel.ts`.
- Render the row in the existing `<dl>` in `Metadata`.
- Re-export `MetaImporterType` from `packageModel.ts` only if a test or
  Playwright spec needs the literal union; otherwise import from
  `unitypackage-core` directly.

Exit criteria
```text
- `detectImporterTypeFor(record)` is exported from `apps/web/src/packageModel.ts` and uses `detectMetaImporterType` from `unitypackage-core`.
- The Metadata pane renders an `Importer type` row with one of `DefaultImporter`, `DefaultImporterFolder`, `TextScriptImporter`, `MonoImporter`.
- Asset records and their `.meta` sidecar records resolve to the same importer type.
- `PackageFileRecord` shape is unchanged (no new persisted field, no `kind`).
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
```

### P2 -- Declared-type detection and diagnostic routing

Add the web-local diagnostic shape and a strict line-anchored detector in
`packageModel.ts`, then attach mismatches to `record.diagnostics` during
record construction so the existing "Related diagnostics" section in the
Metadata pane (`App.tsx:1281`) picks them up with no UI changes.

Diagnostic type:

```ts
import type { UnityPackageParseDiagnostic } from 'unitypackage-core';

export interface MetaImporterMismatchDiagnostic {
  code: 'META_IMPORTER_MISMATCH';
  severity: 'info';
  message: string;            // e.g. "Meta declares TextScriptImporter; extension suggests MonoImporter."
  path: string;               // meta record pathname (with .meta suffix)
  declared: MetaImporterType;
  detected: MetaImporterType;
}

export type RecordDiagnostic =
  | UnityPackageParseDiagnostic
  | MetaImporterMismatchDiagnostic;
```

Widen `PackageFileRecord.diagnostics` from
`UnityPackageParseDiagnostic[]` to `RecordDiagnostic[]`. The Metadata
pane's renderer iterates the array and discriminates by `code`, which is
already how it handles the core diagnostic union -- the same switch picks up
`META_IMPORTER_MISMATCH` with no structural change.

Detection helper (strict, regex-based; Decision 3):

```ts
const IMPORTER_LINE = /^(DefaultImporter|TextScriptImporter|MonoImporter):\s*$/m;
const FOLDER_LINE = /^folderAsset:\s+yes\s*$/m;

export function readDeclaredImporterType(metaContent: Uint8Array): MetaImporterType | null {
  // Decode at most the first 4 KB as UTF-8. Real Unity metas are < 1 KB; the
  // cap is a defence against pathological inputs.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(
    metaContent.subarray(0, Math.min(metaContent.byteLength, 4096)),
  );
  const importerMatch = IMPORTER_LINE.exec(head);
  if (!importerMatch) return null;
  const base = importerMatch[1] as MetaImporterType;
  if (base === 'DefaultImporter' && FOLDER_LINE.test(head)) {
    return 'DefaultImporterFolder';
  }
  return base;
}
```

Attach diagnostics during the existing parse pipeline. In
`entriesToRecords` (`packageModel.ts:139`), after creating each meta record,
look up the asset pathname (strip `.meta` from the meta record pathname),
run `detectMetaImporterType(assetPathname)` and `readDeclaredImporterType(metaBytes)`,
and -- when both succeed and disagree -- push a `META_IMPORTER_MISMATCH`
into that meta record's `diagnostics` array.

Scope:

- Export `RecordDiagnostic` and `MetaImporterMismatchDiagnostic` from
  `packageModel.ts`.
- Widen `PackageFileRecord.diagnostics` to `RecordDiagnostic[]`.
- Add `readDeclaredImporterType` (private to the module is fine; expose only
  if a test needs it directly -- prefer testing via the attached diagnostic).
- Mismatch attachment happens once at parse time, not lazily on selection.
- Update the Metadata pane renderer (`App.tsx:1281`) to add a switch arm for
  `META_IMPORTER_MISMATCH` that prints the message inline. No new section.
  No styling change beyond reusing the existing diagnostic row.
- Verify all other consumers of `record.diagnostics` (`Stats` at App.tsx:567
  reads `diagnostics.length`) still compile and behave correctly under the
  widened type. Stats counting mismatches as issues is intentional
  (Decision 2).

Exit criteria
```text
- `RecordDiagnostic`, `MetaImporterMismatchDiagnostic`, and the widened `PackageFileRecord.diagnostics` are exported from `packageModel.ts`.
- A meta whose body declares `TextScriptImporter` and whose asset pathname (less `.meta`) suggests `MonoImporter` produces one `META_IMPORTER_MISMATCH` entry on the meta record's `diagnostics` array, with both types in the payload and a human-readable `message`.
- A meta whose declared type agrees with detection produces no entry.
- A meta whose body has no recognizable importer block (`readDeclaredImporterType` returns `null`) produces no entry.
- The Metadata pane's "Related diagnostics" section displays the mismatch via the existing list rendering, with the diagnostic discriminated by `code`.
- `Stats` and any other consumer reading `record.diagnostics.length` compile and run under the widened type without code changes (only the type-level change reaches them).
- No core types are modified; no YAML parser is introduced.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
```

### P3 -- Tests and small UX polish

Vitest coverage in `apps/web/src/packageModel.test.ts`:

- `detectImporterTypeFor` returns the expected importer type across at least
  one fixture per type: a `.cs` asset (MonoImporter), a `.json` asset
  (TextScriptImporter), a `.png` asset (DefaultImporter), and a `.yaml`
  asset (DefaultImporter). Also one meta record paired with each (the meta
  must resolve to the same type as its asset).
- `readDeclaredImporterType` parses each of the four template strings
  produced by `createMinimalMetaFor` from `unitypackage-core` and recovers
  the declared type. Use the real core helper to build the input; do not
  hand-write the YAML.
- `readDeclaredImporterType` also covers edge cases: CRLF line endings,
  leading UTF-8 BOM, 4-KB cap boundary, and a buffer with no recognizable
  importer block (returns `null`).
- Attachment pass: build a synthetic entry where the meta bytes come from
  `createMinimalMeta(guid)` (legacy `DefaultImporter`-for-everything) and
  the asset pathname is `Assets/Foo.cs`. After `entriesToRecords`, the meta
  record's `diagnostics` array must contain exactly one
  `META_IMPORTER_MISMATCH` with `declared: 'DefaultImporter'` and
  `detected: 'MonoImporter'`. The paired asset record must have no
  mismatch diagnostic. A second synthetic entry built via
  `createMinimalMetaFor(guid, 'Assets/Foo.cs', false)` must produce no
  mismatch entry. Build inputs through the real core helpers; do not
  hand-write the YAML.

UI polish:

- Inline `aria-describedby` help text next to the `Importer type` row,
  English-only, brief: "Inferred from extension. Use the asset record for
  the underlying mapping."
- No new CSS. Mismatch diagnostics render through the existing diagnostic
  row styling (Decision 2). If a future visual differentiation by severity
  is wanted, that is a separate UX plan.

Optional Playwright:

- Extend `apps/web/tests/explorer.spec.ts` (or add a new spec) to load
  `fixtures/static/editor-packed.unitypackage`, select the first asset row,
  and assert that the Metadata pane contains an `Importer type` row with one
  of the four importer-type strings. Keep the assertion narrow; do not
  assert specific types per fixture record.

Exit criteria
```text
- `packageModel.test.ts` covers `detectImporterTypeFor`, `readDeclaredImporterType` (four-template recovery, CRLF, BOM, 4-KB cap, null case), and the attachment pass (`createMinimalMeta` on `.cs` produces a `META_IMPORTER_MISMATCH`; `createMinimalMetaFor` produces none).
- Metadata pane "Importer type" row has an accessible description via `aria-describedby`.
- No new CSS variables or theme tokens; mismatch entries use existing diagnostic styling.
- Optional Playwright assertion (or a deliberate deferral comment in the spec) confirms the row renders for a real fixture.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
- Run: bun run --filter @unitypackage-tools/web build
```

### P4 -- Pack-time generation requirement (docs only)

Pack mode is currently a shell. `docs/plans/web/pack-export.md` P5 already
points at `createMinimalMeta(guid)` for loose-file imports. With
`createMinimalMetaFor` and `createMinimalFolderMeta` now shipped, P5 must
require the typed API.

Scope:

- Edit `docs/plans/web/pack-export.md` P5 cross-plan note to replace the
  reference to `createMinimalMeta(guid)` with `createMinimalMetaFor(guid, pathname, isDir?)`
  (and `createMinimalFolderMeta(guid)` for folder entries when the OS-side
  drop walks directories).
- Add a one-line constraint near the top of P5 stating: "Generated metas
  must use `createMinimalMetaFor` so that `.cs`, `.json`, `.txt`,
  `LICENSE`, `.yaml`, and folder entries receive the correct importer
  block."
- Do not change any code. Do not touch `done.md`.

Exit criteria
```text
- `docs/plans/web/pack-export.md` P5 references `createMinimalMetaFor` and `createMinimalFolderMeta` rather than `createMinimalMeta`.
- No source under `apps/web` or `packages/` is modified by this phase.
- No entry is added to `docs/plans/web/done.md` (the doc-only edit is part of P4 itself, not a plan-history update).
```

## Cross-plan updates

- `docs/plans/web/pack-export.md` P5: update the cross-plan note and the
  inline meta-generation snippet. See P4 above.
- `docs/plans/web/meta-sidecar-downloads.md`: no required changes today; the
  sidecar-download path passes existing meta bytes through `fflate` without
  generating new metas.
- `docs/reference/file-mapping.md`: not modified by this plan. Importer-type
  surface lives in the Metadata pane, not in extension routing.

## Verification

```sh
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web typecheck
bunx eslint apps/web/src
bun run --filter @unitypackage-tools/web build
bun run check
```

Optional Playwright (after `bun run build`):

```sh
cd apps/web && bunx playwright test
```

Manual smoke:

- Open `fixtures/static/editor-packed.unitypackage`. Click an asset record
  and confirm the Metadata pane shows an `Importer type` row with one of
  the four importer-type strings.
- Click the matching `.meta` record for that asset and confirm the same
  importer type appears.
- Click a `.cs` asset (if present in the fixture) and confirm
  `MonoImporter`; click a `.png` asset and confirm `DefaultImporter`; click
  a `.json` or `.txt` asset and confirm `TextScriptImporter`.
- Construct a synthetic mismatch (for example by editing a generated
  fixture's meta to claim `TextScriptImporter` for a `.cs` asset, or via
  the Vitest case described in P3) and confirm the Metadata pane shows
  both declared and detected values.
- Confirm the Pack mode Export button remains disabled and that no new
  meta-generation path runs in Extract mode.
