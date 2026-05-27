# File preview behavior

How `apps/web` decides what to show for each file extension. Two buckets: **immediate** or **hidden**. Image, audio, video, PDF kinds are rendered natively by the browser. Text-class files use synchronous `TextDecoder.decode` + `hljs.highlight`. All decisions flow from extension-only logic in `getPreviewKindForPath(pathname)` in `packages/core/src/classify.ts`.

No content sniffing, no filesize gating, no deferred "Load preview" button -- just extension-based routing. If the extension matches a known text or media type, the file is previewed; if it is a Unity-generated YAML extension, it is hidden. Files that are hidden still appear in the file tree and can be downloaded.

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

## Immediate -- code (`<pre><code>`, full content)

Syntax-highlighted by `highlight.js`:

| Extension(s) | Grammar |
|---|---|
| `cs` | csharp |
| `yaml`, `yml` | yaml |
| `json`, `asmdef`, `asmref`, `inputactions`, `shadergraph`, `shadersubgraph` | json |
| `css`, `uss`, `tss` | css |
| `hlsl`, `cginc`, `compute` | glsl (HLSL has no first-party grammar; GLSL is close enough) |

Plain `<pre><code>` (no highlight pass -- registered-language `Set.has` short-circuit):

`shader` (ShaderLab), `glsl`, `md`, `txt`, `html`, `xml`, `uxml`, `ts`, `tsx`, `js`, `jsx`, `meta`.

## Hidden -- preview area collapses; download still works

The preview frame returns `null`. Header (breadcrumb + size + download) and metadata (Path, GUID, Size, optional Meta GUID + Importer) remain.

Two reasons a file lands here:

1. **Extension is a Unity-generated YAML type** (`.unity`, `.prefab`, `.asset`, `.mat`, `.anim`, `.controller`, `.overridecontroller`, `.physicmaterial`, `.physicsmaterial2d`, `.playable`, `.mask`, `.brush`, `.flare`, `.fontsettings`, `.guiskin`, `.giparams`, `.rendertexture`, `.spriteatlas`, `.spriteatlasv2`, `.terrainlayer`, `.mixer`, `.shadervariants`, `.preset`, `.lighting`, `.dwlt`, `.vfx`, `.vfxblock`, `.vfxoperator`). These are always hidden regardless of content or size. Binary YAML embedded in Force-Text files is never loaded into the tab.

2. **Browser-non-native binary extensions.** From `docs/reference/gitattributes.md`'s LFS list: `ttf`, `otf`, `fbx`, `obj`, `blend`, `3ds`, `dae`, `dll`, `pdb`, `so`, `a`, `exe`, `apk`, `zip`, `7z`, `rar`, `tar`, `gz`, `bz2`, `unitypackage`, `bundle`, `cubemap`, audio LFS extensions, video LFS extensions, fonts. `PreviewBody` only renders image and text; everything else is hidden.

## Internal-only field

`UnityPackageComponentRecord.mimeType` exists for download `Blob` construction in `App.tsx` and the image-preview `Blob` in `PreviewPanel.tsx`. It is **never displayed** in any UI surface -- not in the header, not in the metadata panel, not in tooltips. Treat it as an internal serialization detail.
