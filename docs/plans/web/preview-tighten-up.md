# apps/web preview pipeline tighten-up

## Context

The web preview pane has accumulated friction:

- It opportunistically tries to preview anything it *might* decode (sniffs the first 512 bytes via `isLikelyUtf8Text`), then truncates to "first 200 KB" of large files. Result: laggy previews for files that should never have been previewed, and an awkward size-cap UX.
- `highlight.js` runs synchronously on the main thread, only registers `csharp` / `yaml` / `json`, and leaves common Unity source kinds (`.hlsl`, `.cginc`, `.compute`, `.uss`, `.tss`, `.css`) un-highlighted.
- The metadata strip and the Details panel both surface internal-only `mimeType` strings to users. Details additionally shows a redundant `Type` row that just echoes the extension already visible in the filename.
- `docs/reference/extension-map.md` is stale and references PDF / audio / video MIME mappings even though `PreviewBody` only renders `image` and `text`.

**Detection is harder than it looks.** Unity's Force-Text serialization (`docs.unity3d.com/Manual/FormatDescription.html`) writes a YAML header but embeds large binary payloads (texture pixels, font glyph atlases, lightmap data, terrain heightmaps, shader variants) as hex/base64 inside a single very long line. Evidence from `fixtures/static`:

- `LiberationSans SDF.asset` (2.2 MB, TextMeshPro SDF font) — starts with `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:`, but file has lines of 48..88 chars **plus one line of 2,097,169 chars** (the glyph atlas hex-encoded). Text-valid UTF-8 but operationally binary. Must be hidden.
- `TerrainData_445999c2-5240-4b5c-9394-4cacb62d7eec.asset` (820 KB) — all NUL bytes from byte 0, no YAML header. Must be hidden.
- `scriptable.asset` (660 B) — pure text YAML, all short lines. Must preview.
- `stamp.brush` (1 KB) — content is pure text YAML, short lines. Must preview.

Filename patterns (`*SDF.asset`, `*[Tt]errain*`) get this wrong in both directions; a naive `%YAML` magic check accepts SDF as text. The right answer is a content-based check that combines magic-byte with a head+tail line-length scan, paired with a tri-state UI gate (immediate / deferred / hidden) and no size cap anywhere.

## Scope

### In

- `packages/core/src/classify.ts` — add `isUnityYamlBinary(bytes)`; remove `isLikelyUtf8Text`; reroute `getPreviewKindForPath`.
- `packages/core/src/classify.test.ts` — inline cases + `fixtures/static` cases under `describe` (always on).
- `packages/core/src/index.ts` — barrel re-export.
- `apps/web/src/components/PreviewPanel.tsx` — tri-state `PreviewBody`, new `DeferredTextPreview`, +css/hlsl highlight registrations, drop `TEXT_PREVIEW_LIMIT`, drop MIME from header + Type/MIME from Metadata.
- `apps/web/src/components/PreviewPanel.test.tsx` — extend.
- `apps/web/src/packageModel.ts` — `formatBytes` rewrite; `UNITY_GENERATED_EXTENSIONS` Set + `isUnityGeneratedExtension` helper.
- `docs/reference/extension-map.md` — rewrite to match reality.

### Out

- Audio / video / PDF preview rendering — icons stay; preview hidden.
- Web Worker offload for `hljs.highlight` — revisit only if profiling shows >50 ms blocks after click-through.
- Any change to CLI / core download / extract paths.
- New runtime dependency (`istextorbinary` and similar evaluated and rejected — they detect NUL/control bytes, useless against text-valid YAML carrying binary).

## Preview routing (the new tri-state)

`PreviewBody` routes records into exactly three buckets, **no size threshold anywhere**:

| Bucket | What lands here | Render |
|---|---|---|
| **Immediate** | image (png, jpg, gif, bmp, apng, avif, webp, svg); plain code (`cs`, `hlsl`/`cginc`/`compute`, `glsl`, `shader`, `css`/`uss`/`tss`, `json`/`asmdef`/`asmref`/`inputactions`/`shadergraph`/`shadersubgraph`, `xml`/`uxml`, `html`, `ts`/`tsx`, `js`/`jsx`, `md`, `txt`, `yaml`/`yml`) | Render immediately, full content, no cap |
| **Deferred** | Unity-generated YAML extensions + `meta` whose content passes the binary sniff (see set below) | "Load preview" button; click decodes + renders full content |
| **Hidden** | YAML-ext files that fail the sniff (real binary `.asset` or text-YAML-with-embedded-binary like SDF fonts); browser-non-native binaries (`ttf`, `otf`, `fbx`, `obj`, `blend`, `dll`, `pdb`, `so`, `exe`, `apk`, `zip`, `7z`, ...); audio/video/pdf | `PreviewBody` returns `null` — preview area collapses, header + metadata only |

**Unity-generated set (deferred):** `unity`, `prefab`, `asset`, `mat`, `anim`, `controller`, `overridecontroller`, `physicmaterial`, `physicsmaterial2d`, `playable`, `mask`, `brush`, `flare`, `fontsettings`, `guiskin`, `giparams`, `rendertexture`, `spriteatlas`, `spriteatlasv2`, `terrainlayer`, `mixer`, `shadervariants`, `preset`, `lighting`, `dwlt`, `vfx`, `vfxblock`, `vfxoperator`, `meta`. Plain `yaml`/`yml` stay immediate.

## Phases

| # | Title | Files |
|---|---|---|
| P1 | Content-based binary detection in core | `packages/core/src/classify.ts`, `packages/core/src/index.ts` |
| P2 | Classify tests (inline + fixtures/static) | `packages/core/src/classify.test.ts` |
| P3 | Tri-state preview gate | `apps/web/src/components/PreviewPanel.tsx`, `apps/web/src/packageModel.ts` |
| P4 | Highlight.js: +css, +hlsl-via-glsl, skip-unsupported | `apps/web/src/components/PreviewPanel.tsx` |
| P5 | Preview-pane perf cleanups | `apps/web/src/components/PreviewPanel.tsx` |
| P6 | Faster `formatBytes` | `apps/web/src/packageModel.ts` |
| P7 | Remove MIME from UI, remove Type from Details | `apps/web/src/components/PreviewPanel.tsx`, `apps/web/src/components/PreviewPanel.test.tsx` |
| P8 | Rewrite `docs/reference/extension-map.md` | `docs/reference/extension-map.md` |
| P9 | Final hygiene pass | `apps/web/**`, `packages/core/**`, lint+typecheck+test+knip |

### P1 -- Content-based binary detection in core  [DONE 2026-05-27]

Shipped: added content-based binary detection (`isUnityYamlBinary`) to check for a `%YAML` magic header and scan line lengths to identify operationally binary files.
Modified: `packages/core/src/classify.ts` to implement the logic and update `getPreviewKindForPath`; `packages/core/src/index.ts` to export it from the barrel.

### P2 -- Classify tests (inline + fixtures/static)  [DONE 2026-05-27]

Shipped: added comprehensive unit tests for `isUnityYamlBinary` and preview kind mapping in `packages/core/src/classify.test.ts`.
Implemented: inline tests for CI and fixture checks for text/binary SDF assets, terrain assets, and brushes under `fixtures/static` (always active; `skipIf` removed after migration from `fixtures/temp`).

### P3 -- Tri-state preview gate  [DONE 2026-05-27]

Shipped: implemented tri-state routing (`immediate` / `deferred` / `hidden`) in `PreviewBody` of `PreviewPanel.tsx` and added `DeferredTextPreview` for Unity-generated files. Added `UNITY_GENERATED_EXTENSIONS` set and helper `isUnityGeneratedExtension` in `packageModel.ts`. Removed the text preview length limit and truncation banner. Added E2E tests for deferred/hidden behavior.

### P4 -- Highlight.js: +css, +hlsl-via-glsl, skip-unsupported  [DONE 2026-05-27]

Shipped: registered `css` and `glsl`/`hlsl` languages in `PreviewPanel.tsx`. Introduced a `REGISTERED_LANGUAGES` Set to short-circuit highlight.js for unsupported syntaxes and render them as plain text. Added CSS and HLSL highlighting test cases, and a plain ShaderLab test case.

### P5 -- Preview-pane perf cleanups  [DONE 2026-05-27]

Shipped: removed the `useMemo` decoding logic wrapper around `textDecoder.decode` in `TextPreview` component to directly decode full file content on demand.

### P6 -- Faster `formatBytes`  [DONE 2026-05-27]

Shipped: optimized `formatBytes` helper function in `packageModel.ts` using a four-branch division algorithm instead of generic logarithmic calls, preserving the exact same rounding output behavior.

### P7 -- Remove MIME from UI, remove Type from Details  [DONE 2026-05-27]

Shipped: removed the internal MIME string display from the preview panel header subtitle. Deleted both the `Type` and `MIME` metadata rows from the file details pane. Added assertions in `PreviewPanel.test.tsx` to prevent regression.


### P8 -- Rewrite `docs/reference/extension-map.md`  [DONE 2026-05-27]

Shipped: Rewrote the `docs/reference/extension-map.md` documentation to accurately reflect actual post-refactor behavior. Described immediate, deferred, and hidden rules, referenced the `isUnityYamlBinary` logic with its counter-examples, and mapped icon styling to its single source of truth.

### P9 -- Final hygiene pass  [DONE 2026-05-27]

Shipped: Executed hygiene scans across the workspace, verified that all E2E tests, vitest suites, lint checks, typecheck builders, and knip audits pass with zero errors. Checked for any remaining deleted symbols or dead imports.

## Verification

1. **Unit / component**
   - `bun run test:core` — inline cases + `fixtures/static` cases pass.
   - `bun run test:web` — highlight (css, hlsl, shaderlab-plain), deferred-frame click-through, hidden-frame collapse, no-MIME / no-Type metadata.
2. **Build / static analysis**
   - `bun run --filter @unitypackage-tools/web typecheck`
   - `bun run --filter @unitypackage-tools/web build`
   - `bun run knip`
3. **Manual dev verification via `fixtures/static`** (load the four files via a synthetic `.unitypackage`):
   - `LiberationSans SDF.asset` → preview area **hidden**.
   - `scriptable.asset` → "Load preview" → click → YAML renders.
   - `TerrainData_445999c2-5240-4b5c-9394-4cacb62d7eec.asset` → preview area hidden.
   - `stamp.brush` → "Load preview" → click → YAML renders.
4. **E2E against `fixtures/static/archives/Polytope_URP.unitypackage`**
   - `.cs` → highlighted immediately; header shows size only; Details: Path/GUID/Size.
   - `.hlsl` / `.compute` / `.cginc` → highlighted via glsl grammar.
   - `.css` / `.uss` → highlighted.
   - `.shader` (ShaderLab) → plain text.
   - `.terrainlayer` / `.prefab` → "Load preview" → click → renders.
   - `.png` → renders immediately; download still works (internal `mimeType` intact).
5. **Playwright** (`cd apps/web && bunx playwright test`) — update specs that asserted on header MIME / `Type` / `MIME`; add a spec that clicks "Load preview" on a Unity YAML and asserts the YAML body appears.
