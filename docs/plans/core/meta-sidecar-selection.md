# Meta Sidecar Selection Utilities

## Context

Unity asset references depend on `.meta` GUIDs and importer settings. A file
downloaded without its sidecar can lose the original GUID on import, and
downloaded scenes or prefabs can then point at missing or regenerated GUIDs.

The web app currently models parsed `.unitypackage` contents as individual
`PackageFileRecord` values: asset rows, `.meta` rows, and optional preview rows.
The ZIP worker receives record IDs and writes the selected records directly.
The CLI `extract` command already writes each entry's `entry.meta` beside the
asset by default, while `--no-meta` opts out.

Add a small shared sidecar resolver in `packages/core` so web and CLI can
expand "selected assets" into "selected assets plus their corresponding metas"
without reimplementing matching rules.

## Scope

In:

- Browser-safe pure utilities in the relevant `packages/core/src` domain module, exported through `packages/core/src/index.ts`.
- Types that let callers pass lightweight records without depending on web or
  CLI types.
- Unit tests in the matching `packages/core/src/*.test.ts` file.
- README docs for the utility behavior.

Out:

- No web UI changes.
- No CLI flag changes.
- No YAML parsing or validation.
- No generation of missing `.meta` files.
- No changes to `UnityPackageEntry` or parser output.

## Phases

| ID | Title | Goal | Depends on | Files |
|----|-------|------|------------|-------|
| P1 | Path helpers | Add minimal `.meta` sidecar path helpers. | -- | `packages/core/src/pathname.ts`, matching test, `packages/core/src/index.ts` |
| P2 | Selection resolver | Add a generic resolver for selected IDs plus implicit sidecars. | P1 | relevant core domain module, matching test, `packages/core/src/index.ts` |
| P3 | Docs and examples | Document the resolver and its matching order. | P1, P2 | `packages/core/README.md` |

### P1 -- Path helpers

Add these exports:

```ts
export function isMetaSidecarPath(pathname: string): boolean;
export function assetPathForMetaSidecar(pathname: string): string | null;
export function metaSidecarPathForAsset(pathname: string): string;
```

Rules:

- A sidecar path is any pathname ending with `.meta`.
- `assetPathForMetaSidecar('Assets/Texture.png.meta')` returns
  `Assets/Texture.png`.
- `assetPathForMetaSidecar('Assets/Texture.png')` returns `null`.
- `metaSidecarPathForAsset('Assets/Texture.png')` returns
  `Assets/Texture.png.meta`.
- Do not normalize slashes, casing, drive paths, or traversal here. Callers use
  these helpers after package pathname validation.

Exit criteria:

```text
- The helpers are exported from `unitypackage-core`.
- Tests cover normal assets, extensionless assets, nested paths, already-meta paths, and empty strings.
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-core build
```

### P2 -- Selection resolver

Add generic types and a resolver:

```ts
export type SidecarSelectableKind = 'asset' | 'meta' | 'preview';

export interface SidecarSelectableRecord {
  id: string;
  guid: string;
  pathname: string;
  kind: SidecarSelectableKind;
}

export interface ResolveMetaSidecarsResult {
  ids: string[];
  explicitIds: string[];
  implicitMetaIds: string[];
  missingMetaForAssetIds: string[];
}

export function resolveMetaSidecarSelection(
  records: readonly SidecarSelectableRecord[],
  selectedIds: readonly string[],
): ResolveMetaSidecarsResult;
```

Resolver behavior:

- Preserve the caller's selected ID order.
- Treat `kind: 'asset'` records as sidecar sources.
- Treat `kind: 'meta'` records as selectable output but not as sidecar sources.
- Ignore `kind: 'preview'` records for sidecar expansion.
- For each selected asset, find the sidecar by same GUID and
  `pathname === metaSidecarPathForAsset(asset.pathname)` first.
- If no same-GUID match exists, fall back to exact pathname match.
- Append implicit meta IDs after explicit selected IDs, in selected asset order.
- Do not duplicate IDs when the meta was selected explicitly or selected by a
  previous asset.
- Report selected asset IDs with no matching meta in `missingMetaForAssetIds`.

Exit criteria:

```text
- Resolver has no web, DOM, Node, or CLI imports.
- Tests cover: asset pulls sidecar, explicit sidecar is not duplicated, missing sidecar is reported, preview selection does not pull sidecars, and duplicate pathnames with different GUIDs prefer same GUID.
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-core build
```

### P3 -- Docs and examples

Update `packages/core/README.md` with a short "Meta sidecar selection" section:

- Explain why sidecars matter: GUID preservation and import settings.
- Show a minimal `resolveMetaSidecarSelection` example.
- State that the resolver only selects existing sidecars and does not generate
  missing metas.
- State that callers still own UI hiding, ZIP creation, filesystem writes, and
  `--no-meta` style opt-outs.

Exit criteria:

```text
- README documents the new helper names and matching order.
- No docs claim CLI or web behavior exists until their follow-up plans ship.
- Run: bun run --filter unitypackage-core test
- Run: bun run --filter unitypackage-core build
```

## Verification

```sh
bun run --filter unitypackage-core test
bun run --filter unitypackage-core build
```
