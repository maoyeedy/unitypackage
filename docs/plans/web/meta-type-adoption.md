# Web Meta Importer Type Adoption

## Context

The current core runtime already ships the importer and meta-inspection
surface this plan originally intended to build locally in the web app:

- `detectMetaImporterType(pathname, isDir?)`
- `createMinimalMetaFor(guid, pathname, isDir?)`
- `createMinimalFolderMeta(guid)`
- `readMetaGuid(meta)`
- `readDeclaredMetaImporter(meta)`
- `analyzeUnityPackageEntries(entries, diagnostics)`

`apps/web/src/packageModel.ts` also now consumes core component-record and
classification helpers. This plan should not reintroduce web-local importer
parsing, web-local MIME/syntax tables, or a new diagnostic union. The web app
should present core facts and core analysis findings.

## Decisions

1. **Metadata pane only for importer details.** No explorer column and no
   per-row chip. The right pane is the correct place for detailed metadata.
2. **Use core analysis for mismatch diagnostics.** Do not add
   `META_IMPORTER_MISMATCH`. Use `analyzeUnityPackageEntries` and render
   `meta-importer-mismatch`, `meta-guid-mismatch`, and `meta-missing` findings
   alongside parser diagnostics.
3. **Use core meta inspection.** Do not add `readDeclaredImporterType` in
   `packageModel.ts`. Use `readDeclaredMetaImporter`.
4. **Unknown importers are facts, not errors.** `TextureImporter` and other
   non-generated importers should display as declared importer names and should
   not produce a mismatch finding by themselves.
5. **No new `kind` field.** Continue using `getRecordCategory(record)`,
   `extension === 'meta'`, and `isUnityPreview`.

## Scope

In:

- Show expected importer type in the Metadata pane for every record.
- Show declared importer name for meta records and for assets with a meta
  sibling.
- Show declared meta GUID for meta records and for assets with a meta sibling.
- Route core analysis findings into the existing diagnostics UI and the global
  diagnostics drawer from `extract-enrich.md`.
- Add unit coverage around web helpers that adapt records to core inspection
  and analysis output.
- Update Pack mode docs so generated metas use `createMinimalMetaFor`.

Out:

- No YAML parser.
- No web-local importer regex.
- No custom `META_IMPORTER_MISMATCH` diagnostic code.
- No source changes in `packages/core`.
- No Pack export enabling.

## Phases

| ID | Title | Goal | Parallel with | Depends on | Files | Subagent |
|----|-------|------|---------------|------------|-------|----------|
| P1 | Metadata importer facts | Add web helpers that call core importer and meta-inspection APIs, then render expected importer, declared importer, and declared meta GUID in the Metadata pane. | - | core runtime | `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts`, `apps/web/src/App.tsx` | worker |
| P2 | Analysis finding routing | Run `analyzeUnityPackageEntries` after parse and route findings to record diagnostics plus the global diagnostics drawer model. | P1 | `extract-enrich.md` P5 if drawer exists | `apps/web/src/parsePackage.worker.ts`, `apps/web/src/workerTypes.ts`, `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts`, `apps/web/src/App.tsx` | worker |
| P3 | Tests and fixture coverage | Cover known, unknown, missing, and mismatched meta cases using real core helpers and the real texture meta fixture. | - | P1, P2 | `apps/web/src/packageModel.test.ts`, `apps/web/tests/explorer.spec.ts` | worker |
| P4 | Pack docs alignment | Ensure Pack mode docs require typed meta generation through core. No runtime change. | - | P1 | `docs/plans/web/pack-export.md` | inline |

### P1 - Metadata importer facts

Add pure helpers to `apps/web/src/packageModel.ts` that delegate to core:

- `getExpectedImporterTypeForRecord(record)` calls
  `detectMetaImporterType(assetPathname, isFolderLike)` after stripping the
  trailing `.meta` for meta records.
- `getSiblingMetaRecord(records, record)` finds the same-GUID meta component.
- `getDeclaredMetaInfoForRecord(records, record)` calls `readMetaGuid` and
  `readDeclaredMetaImporter` on the active meta record or its sibling meta.

Render Metadata rows:

- `Expected importer`
- `Declared importer` when available
- `Declared meta GUID` when available

Display unknown declared importers as their actual name, for example
`TextureImporter`.

Exit criteria
```text
- Metadata pane renders expected importer for asset, meta, and preview records.
- Metadata pane renders declared importer and declared meta GUID when a meta sidecar is present.
- `TextureImporter` from `fixtures/static/texture_02.png.meta` displays as `TextureImporter`, not as an error.
- Helpers use `detectMetaImporterType`, `readDeclaredMetaImporter`, and `readMetaGuid` from `unitypackage-core`.
- No `PackageFileRecord.kind` field is added.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
```

### P2 - Analysis finding routing

Use `analyzeUnityPackageEntries(entries, diagnostics)` after a package parses.
Keep parser diagnostics and analysis findings distinguishable in type names,
but render both through the same diagnostics surfaces.

Scope:

- Extend worker response types with `analysis`.
- Map analysis findings to affected records by `guid`, `pathname`, or `path`.
- Attach relevant findings to `PackageFileRecord.diagnostics` or introduce a
  neutral `record.findings` array if that is cleaner for the current UI.
- Global diagnostics drawer lists parser diagnostics and analysis findings with
  code, severity, message, and navigation target.
- Status counts include both parser diagnostics and analysis findings, grouped
  by severity.

Exit criteria
```text
- `analyzeUnityPackageEntries` runs once per parsed package.
- `meta-guid-mismatch`, `meta-importer-mismatch`, `meta-missing`, duplicate pathname, case collision, unsafe pathname, and parser-diagnostic findings can appear in the diagnostics drawer.
- Clicking a finding navigates to the best matching record.
- Unknown declared importers do not produce `meta-importer-mismatch`.
- Unit tests cover routing by guid, pathname, and path.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
```

### P3 - Tests and fixture coverage

Vitest coverage:

- Expected importer detection for `.cs`, `.json`, `.png`, `.yaml`, and
  extensionless folder-like paths.
- Meta sibling lookup for asset, meta, and preview records.
- Declared importer display for the real `texture_02.png.meta` fixture:
  declared importer is `TextureImporter`, declared GUID is
  `b2164c38ac6d28c478b53462658238f8`.
- Analysis routing for a synthetic `.cs` asset whose meta declares
  `DefaultImporter`.
- Analysis non-routing for a synthetic `.png` asset whose meta declares
  `TextureImporter`.

Optional Playwright:

- Load `fixtures/static/editor-packed.unitypackage`, select a texture asset,
  and assert the Metadata pane has expected and declared importer rows.

Exit criteria
```text
- `packageModel.test.ts` covers core-backed importer facts and analysis routing.
- Optional Playwright assertion is added, or the deferral is noted in the spec.
- Run: bun run --filter @unitypackage-tools/web test
- Run: bun run --filter @unitypackage-tools/web typecheck
- Run: bunx eslint apps/web/src
- Run: bun run --filter @unitypackage-tools/web build
```

### P4 - Pack docs alignment

`pack-export.md` P5 must require typed meta generation:

- Use `createMinimalMetaFor(guid, pathname, isDir?)` for generated metas.
- Use `createMinimalFolderMeta(guid)` for explicit folder entries.
- Do not use `createMinimalMeta(guid)` for loose file import except as a
  documented legacy fallback in tests.

Exit criteria
```text
- `docs/plans/web/pack-export.md` P5 references `createMinimalMetaFor` and `createMinimalFolderMeta`.
- No app or core source is modified by this docs-only phase.
```

## Verification

```sh
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web typecheck
bunx eslint apps/web/src
bun run --filter @unitypackage-tools/web build
bun run check
```

Manual smoke:

- Open `fixtures/static/editor-packed.unitypackage`.
- Select a texture asset and confirm expected importer plus declared
  `TextureImporter` display.
- Select the matching `.meta` record and confirm the same declared values.
- Load or synthesize a meta GUID mismatch and confirm it appears in diagnostics
  and navigates to the affected record.
