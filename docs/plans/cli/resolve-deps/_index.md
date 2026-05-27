# pack --resolve-deps: Recursive GUID Dependency Resolution

## Context

When packing a `.unitypackage` from loose source files, the current `pack` command only includes the explicitly listed files. Unity assets (`.unity`, `.prefab`, `.mat`, etc.) reference other assets via `PPtr` triples embedded in YAML: `{fileID: <n>, guid: <32hex>, type: <m>}`. These references form a dependency graph (scene → prefab → material → texture + shader, etc.).

The feature adds `--resolve-deps` to `pack` that scans source files for these GUID references, recursively resolves them against the project directory, and includes the transitive closure automatically.

## Scope

### In Scope

- `packages/depgraph/` workspace package with three modules: `guidScanner`, `pathnameIndex`, `dependencyResolver`
- `pack --resolve-deps`, `--dep-root`, `--max-dep-depth` flags on the existing `pack` command
- Regex-based GUID extraction from YAML content (anchored to `{fileID:` context to avoid false positives on `.meta` identity lines)
- Extension-based skip list (images, audio, video, models, code, archives — no YAML refs)
- Binary YAML detection via `isUnityYamlBinary` from core
- Built-in GUID filtering (`0000000000000000e000000000000000`, `0000000000000000f000000000000000`)
- Dry-run / JSON output compatibility (resolved entries appear in plan output)
- Unit + integration tests using `fixtures/temp/` for realistic fixture scenarios

### Out of Scope

- Standalone `deps` CLI command (use `pack --dry-run --json --resolve-deps` instead)
- DOT / Graphviz output (pipe JSON to viz tool)
- `--no-dev` script/exclusive reference filtering (deferred)
- Web app changes (web is view-only, never sees loose project files)
- `unitypackage-core` changes (core is browser-safe format lib, no analysis)
- GUID remapping or rewriting
- Unity YAML schema validation
- Binary `.unity3d` / AssetBundle scanning
- Handling external references resolved via `Packages/` folder

## Phase Overview

| Phase | File | Goal |
|-------|------|------|
| [P1 -- depgraph Scaffold](P1-depgraph-scaffold.md) | Bootstrap `packages/depgraph/` package |
| [P2 -- guidScanner](P2-guid-scanner.md) | Regex-based GUID reference extractor |
| [P3 -- pathnameIndex](P3-pathname-index.md) | GUID-to-pathname index from project `.meta` files |
| [P4 -- dependencyResolver](P4-dependency-resolver.md) | BFS transitive dependency resolver |
| [P5 -- CLI Integration](P5-cli-integration.md) | Wire `--resolve-deps` into `pack` command |
| [P6 -- Tests](P6-tests.md) | Unit + integration tests across all modules |

## Dependencies

```
P1 → P2 → P4 → P5
  └→ P3 →┘    ↑
               P6 (wraps everything)
```

P2 and P3 are independent after P1 and can be parallelized. P4 requires both. P5 requires P4. P6 spans all and can start after P2/P3/P4 stabilize.

## Verification

- `pack --dry-run --json --resolve-deps` on `Environment_Free.unity` lists the scene + all transitive deps (prefabs, materials, textures, meshes, scripts, terrain data)
- `pack --dry-run --json --resolve-deps` on a standalone `.cs` file (no refs) produces the same output as without the flag
- `pack --resolve-deps` produces a valid `.unitypackage` that passes `verify`
- Built-in GUIDs are excluded from resolution
- Cycle (A→B→A) terminates without infinite loop
- Binary YAML `.asset` files (embedded terrain data) are skipped as ref-sources but still included when referenced by other files
