# File preview behavior

How `apps/web` decides what to do with each file extension. Three buckets only: **immediate**, **deferred**, **hidden**. There is no size cap. All decisions flow from `packages/core/src/classify.ts` (preview kind + syntax language) and `apps/web/src/packageModel.ts` (Unity-generated set).

For icon styling, see `apps/web/src/fileIcons.ts` — single source of truth, not duplicated here.

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

## Immediate -- code (`<pre><code>`, full content, no size cap)

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

A deferred record only reaches this bucket if `isUnityYamlBinary(content)` returned `false` at parse time — i.e., the file passed the content sniff.

## Hidden -- preview area collapses; download still works

The preview frame returns `null`. Header (breadcrumb + size + download) and metadata (Path, GUID, Size, optional Meta GUID + Importer) remain.

Three reasons a file lands here:

1. **YAML-extension file fails `isUnityYamlBinary`.** This is the important case. The check is **content-based, not filename-based**:
   - Magic test: first five bytes must be `%YAML`. Catches Force-Binary `.asset` (terrain heightmaps, lightmap data, navmesh, occlusion) where the file has no YAML header.
   - Head + tail line-length scan: in the first 32 KB and last 32 KB, no line may exceed 2048 bytes. Catches **Force-Text serialized assets that embed binary as a long hex/base64 line**: TextMeshPro SDF fonts (glyph atlas), shader variants, baked sprite atlases, etc.
   - O(64 KB) per file regardless of total size.
2. **Browser-non-native binary extensions.** From `docs/reference/gitattributes.md`'s LFS list: `ttf`, `otf`, `fbx`, `obj`, `blend`, `3ds`, `dae`, `dll`, `pdb`, `so`, `a`, `exe`, `apk`, `zip`, `7z`, `rar`, `tar`, `gz`, `bz2`, `unitypackage`, `bundle`, `cubemap`, audio LFS extensions, video LFS extensions, fonts. `PreviewBody` only renders image and text; everything else is hidden.
3. **`previewKind` is `audio`, `video`, or `pdf`.** These kinds are still computed (icons use them) but `PreviewBody` does not render them. Documented limitation, not a current target.

### Counter-examples worth remembering

Filename patterns from `gitattributes.md` (`*[Tt]errain*.asset`, `*LightingData.asset`, `*SDF.asset`, etc.) are **not** how this code decides. Two real samples from `fixtures/temp` that prove it:

- `LiberationSans SDF.asset` (2.2 MB, TextMeshPro font) -- starts with `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:` (would pass a naive magic check). But the file has lines of 48..88 chars plus **one line of 2,097,169 chars** (the entire glyph atlas hex-encoded). The line-length scan returns true -> **hidden**.
- `Terrainstamp_Canyon01_Brush.brush` (1 KB) -- name contains "Terrain" (would match a `*[Tt]errain*` filename rule). Content is pure short-line YAML. `isUnityYamlBinary` returns false -> **deferred (previewable)**.

## Internal-only field

`UnityPackageComponentRecord.mimeType` exists for download `Blob` construction in `App.tsx` and the image-preview `Blob` in `PreviewPanel.tsx`. It is **never displayed** in any UI surface — not in the header, not in the metadata panel, not in tooltips. Treat it as an internal serialization detail.
