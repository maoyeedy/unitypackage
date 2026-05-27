# File preview behavior

How `apps/web` decides what to show for each file extension. Image, audio, video, PDF kinds are rendered natively by the browser. Text-class files use synchronous `TextDecoder.decode` + `hljs.highlight`. Preview kind is classified by `getPreviewKindForPath(pathname)` in `apps/web/src/packageModel.ts`. Extension-first routing with content-based refinement: `.asset` files that pass the extension check are then tested by `isUnityYamlBinary` in the parse worker and downgraded to `'unsupported'` if binary. Unsupported kinds render a `NoPreview` component (frame stays visible). Files are downloadable regardless of preview kind.

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
| `hlsl`, `cginc`, `compute`, `shader` | glsl (Unity `.shader` is ShaderLab with embedded HLSL blocks. highlight.js has no ShaderLab grammar; GLSL is close enough for the HLSL portions) |

Plain `<pre><code>` (no highlight pass -- registered-language `Set.has` short-circuit):

`glsl`, `md`, `txt`, `html`, `xml`, `uxml`, `ts`, `tsx`, `js`, `jsx`, `meta`.

## Unsupported -- `NoPreview` component shown; download still works

Preview frame stays visible with a "No preview" message. Header (breadcrumb + size + download) and metadata (Path, GUID, Size, optional Meta GUID + Importer) remain.

Three reasons a file lands here:

1. **Skip extension check** — `.unity`, `.prefab` are always `unsupported` via `yamlSkipExtensions`.

2. **Binary YAML detection** — `.asset`, `.mat`, `.anim`, `.controller`, `.overridecontroller`, `.physicmaterial`, `.physicsmaterial2d`, `.playable`, `.mask`, `.brush`, `.flare`, `.fontsettings`, `.guiskin`, `.giparams`, `.rendertexture`, `.spriteatlas`, `.spriteatlasv2`, `.terrainlayer`, `.mixer`, `.shadervariants`, `.preset`, `.lighting`, `.dwlt`, `.vfx`, `.vfxblock`, `.vfxoperator` are initially classified as `'text'` by extension, then binary payloads (textures, font atlases, terrain heightmaps, shader variants) are caught by `isUnityYamlBinary` in the parse worker and downgraded to `'unsupported'`. Non-binary files in this set are rendered as text.

3. **Browser-non-native binary extensions.** From `docs/reference/gitattributes.md`'s LFS list: `ttf`, `otf`, `fbx`, `obj`, `blend`, `3ds`, `dae`, `dll`, `pdb`, `so`, `a`, `exe`, `apk`, `zip`, `7z`, `rar`, `tar`, `gz`, `bz2`, `unitypackage`, `bundle`, `cubemap`, audio LFS extensions, video LFS extensions, fonts. `PreviewBody` only renders image and text; everything else is unsupported.

## Internal-only field

`UnityPackageComponentRecord.mimeType` exists for download `Blob` construction in `App.tsx` and the image-preview `Blob` in `PreviewPanel.tsx`. It is **never displayed** in any UI surface -- not in the header, not in the metadata panel, not in tooltips. Treat it as an internal serialization detail.
