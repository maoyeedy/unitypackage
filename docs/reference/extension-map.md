# File preview behavior

How `apps/web` decides what to do with each file extension. Three buckets only: **immediate**, **deferred**, **hidden**. Text-class previews are capped at **1 MB** (`PREVIEW_SIZE_LIMIT_BYTES` in `packages/core/src/classify.ts`); above the cap, the file lands in **hidden**. Image / audio / video / PDF kinds are not size-gated because browsers render them natively. All decisions flow from `packages/core/src/classify.ts` (preview kind + syntax language) and `apps/web/src/packageModel.ts` (Unity-generated set).

For icon styling, see `apps/web/src/fileIcons.ts` -- single source of truth, not duplicated here.

## Immediate -- image (`<img>` via blob URL)

| Extension | MIME (internal) |
|-----------|-----------------|
| png       | image/png       |
| jpg, jpeg | image/jpeg      |
| gif       | image/gif       |
| bmp       | image/bmp       |
| apng      | image/apng      |
| avif      | image/avif      |
| webp      | image/webp      |
| svg       | image/svg+xml   |

## Immediate -- code (`<pre><code>`, full content, up to 1 MB)

Syntax-highlighted by `highlight.js`:

| Extension(s) | Grammar |
|---|---|
| `cs` | csharp |
| `yaml`, `yml` | yaml |
| `json`, `asmdef`, `asmref`, `inputactions`, `shadergraph`, `shadersubgraph` | json |
| `css`, `uss`, `tss` | css |
| `hlsl`, `cginc`, `compute` | glsl (HLSL has no first-party grammar; GLSL is close enough) |

Plain `<pre><code>` (no highlight pass — registered-language `Set.has` short-circuit):

`shader` (ShaderLab), `glsl`, `md`, `txt`, `html`, `xml`, `uxml`, `ts`, `tsx`, `js`, `jsx`.

## Deferred -- "Load preview" button

Unity-generated YAML and `.meta`. Render only after user click. Same UX as GitHub's linguist-generated diff gate. Set lives in `apps/web/src/packageModel.ts` as `UNITY_GENERATED_EXTENSIONS`:

`unity`, `prefab`, `asset`, `mat`, `anim`, `controller`, `overridecontroller`, `physicmaterial`, `physicsmaterial2d`, `playable`, `mask`, `brush`, `flare`, `fontsettings`, `guiskin`, `giparams`, `rendertexture`, `spriteatlas`, `spriteatlasv2`, `terrainlayer`, `mixer`, `shadervariants`, `preset`, `lighting`, `dwlt`, `vfx`, `vfxblock`, `vfxoperator`, `meta`.

Plain `yaml` / `yml` stay immediate (not Unity-generated).

A deferred record only reaches this bucket if its content is at or below 1 MB **and** `isUnityYamlBinary(content)` returned `false` at parse time -- i.e., the file passed the content sniff.

## Hidden -- preview area collapses; download still works

The preview frame returns `null`. Header (breadcrumb + size + download) and metadata (Path, GUID, Size, optional Meta GUID + Importer) remain.

Five reasons a file lands here:

1. **Text-class content exceeds `PREVIEW_SIZE_LIMIT_BYTES` (1 MB).** Applies to every text or YAML extension. The cap runs *before* `isUnityYamlBinary`, so huge Force-Text assets with binary embedded mid-file (past the 32 KB head/tail sniff window) are reliably hidden without scanning. The cap also catches multi-MB code / JSON / shader files that would otherwise freeze the tab during synchronous `TextDecoder.decode` + `hljs.highlight`. Image, audio, video, and PDF kinds are not gated here.
2. **`.asset` filename matches a known Unity-binary pattern.** Additive fast-path for sub-cap files that the content sniff would miss (e.g. a 800 KB terrain heightmap embedded in YAML). Patterns mirror `docs/reference/gitattributes.md`'s `lfs`-marked `.asset` section (Terrain, Lightmap, NavMesh, OcclusionCulling, SDF, ProbeVolume families). Scoped to the `.asset` extension only -- `Terrainstamp_Canyon01_Brush.brush` does not match. Runs before `isUnityYamlBinary`, so a positive filename match short-circuits the sniff.
3. **YAML-extension file fails `isUnityYamlBinary`.** Only runs for files at or below the size cap with no filename match. The check is **content-based, not filename-based**:
   - Magic test: first five bytes must be `%YAML`. Catches Force-Binary `.asset` (terrain heightmaps, lightmap data, navmesh, occlusion) where the file has no YAML header.
   - Head + tail line-length scan: in the first 32 KB and last 32 KB, no line may exceed 2048 bytes. Catches **Force-Text serialized assets that embed binary as a long hex/base64 line**: TextMeshPro SDF fonts (glyph atlas), shader variants, baked sprite atlases, etc.
   - O(64 KB) per file regardless of total size.
4. **Browser-non-native binary extensions.** From `docs/reference/gitattributes.md`'s LFS list: `ttf`, `otf`, `fbx`, `obj`, `blend`, `3ds`, `dae`, `dll`, `pdb`, `so`, `a`, `exe`, `apk`, `zip`, `7z`, `rar`, `tar`, `gz`, `bz2`, `unitypackage`, `bundle`, `cubemap`, audio LFS extensions, video LFS extensions, fonts. `PreviewBody` only renders image and text; everything else is hidden.
5. **`previewKind` is `audio`, `video`, or `pdf`.** These kinds are still computed (icons use them) but `PreviewBody` does not render them. Documented limitation, not a current target.

### Counter-examples worth remembering

Filename patterns from `gitattributes.md` are an **additive fast-path** (rule 2 above), not the only signal. The content sniff still runs for `.asset` filenames that do not match the pattern list. Real samples from `fixtures/temp`:

- `LiberationSans SDF.asset` (2.2 MB, TextMeshPro font) -- matches `*SDF*.asset` filename rule -> **hidden** via fast-path, no sniff needed. Even without the rule, the line-length scan would catch the 2,097,169-char glyph atlas line.
- `TerrainData_<guid>.asset` (5.4 MB, Unity terrain) -- matches `*[Tt]errain*.asset` rule -> **hidden** via fast-path. Also exceeds the 1 MB cap.
- `Terrain_0_0_<guid>.asset` (820 KB, Force-Binary terrain) -- matches `*[Tt]errain*.asset` rule -> **hidden**. Under the 1 MB cap, so the filename fast-path is what catches it; the content sniff also catches it via the missing `%YAML` magic.
- `Terrainstamp_Canyon01_Brush.brush` (1 KB) -- name contains "Terrain" but extension is `.brush`, not `.asset`. Filename rule does **not** match. Content is pure short-line YAML, so `isUnityYamlBinary` returns false -> **deferred (previewable)**.

## Internal-only field

`UnityPackageComponentRecord.mimeType` exists for download `Blob` construction in `App.tsx` and the image-preview `Blob` in `PreviewPanel.tsx`. It is **never displayed** in any UI surface -- not in the header, not in the metadata panel, not in tooltips. Treat it as an internal serialization detail.
