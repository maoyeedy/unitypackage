# Web Plan Index

## Current Core Runtime Baseline

The web plans assume the latest `unitypackage-core` runtime is available:

- Entry parsing: `parseUnityPackageEntries`, `parseUnityPackageStreamed`
- Component records: `entriesToComponentRecords`
- Classification: `getPathExtension`, `getMimeTypeForPath`,
  `getPreviewKindForPath`, `getSyntaxLanguageForPath`, `getUnityFileCategory`
- Meta inspection: `readMetaGuid`, `readDeclaredMetaImporter`
- Analysis: `analyzeUnityPackageEntries`
- Sidecars: `resolveMetaSidecarSelection`
- Creation: `tryCreateUnityPackage`, `estimateUnityPackageSize`,
  `createMinimalMetaFor`, `createMinimalFolderMeta`, `generateGuid`,
  `validatePathname`

Do not rebuild these surfaces in `apps/web`.

## Recommended Apply Order

1. `meta-type-adoption.md`
   - Smallest integration layer over new core meta inspection and analysis.
   - Establishes diagnostics/finding routing that later Extract polish can use.

2. `meta-sidecar-downloads.md`
   - Narrow UX behavior that depends on stable component records and sidecar
     resolver behavior.
   - Useful before deeper Extract filtering so hidden meta rows are handled
     consistently.

3. `extract-enrich.md`
   - Broadest Extract-mode UX expansion.
   - Should consume the diagnostics/sidecar behavior from the first two plans
     instead of inventing parallel state.

4. `pack-export.md`
   - Enables the Pack workflow after Extract selection/staging is richer and
     sidecar behavior is settled.
   - Core creation phases are already done, so start at the web worker phase.

5. `workspace-debloat.md`
   - First workspace cleanup pass after Extract and Pack surfaces exist.
   - Splits the oversized web files, removes low-value filters, hides preview
     rows by default, and makes the left and right panes readable again.

6. `workspace-additions.md`
   - Restrained follow-up polish after the debloat pass lands.
   - Adds pane controls, compact top-bar menus, related-record navigation,
     operation feedback, and Pack scanability without restoring clutter.

## Validation Floor

For plan work that touches web source:

```sh
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web typecheck
bunx eslint apps/web/src
```

For plan work that touches core source:

```sh
bun run --filter unitypackage-core test
bun run --filter unitypackage-core typecheck
bun run --filter unitypackage-core lint
```
