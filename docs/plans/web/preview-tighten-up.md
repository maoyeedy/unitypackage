# apps/web preview pipeline tighten-up

## Context

The web preview pane has accumulated friction:

- It opportunistically tries to preview anything it *might* decode (sniffs the first 512 bytes via `isLikelyUtf8Text`), then truncates to "first 200 KB" of large files. Result: laggy previews for files that should never have been previewed, and an awkward size-cap UX.
- `highlight.js` runs synchronously on the main thread, only registers `csharp` / `yaml` / `json`, and leaves common Unity source kinds (`.hlsl`, `.cginc`, `.compute`, `.uss`, `.tss`, `.css`) un-highlighted.
- The metadata strip and the Details panel both surface internal-only `mimeType` strings to users. Details additionally shows a redundant `Type` row that just echoes the extension already visible in the filename.
- `docs/reference/extension-map.md` is stale and references PDF / audio / video MIME mappings even though `PreviewBody` only renders `image` and `text`.

**Detection is harder than it looks.** Unity's Force-Text serialization (`docs.unity3d.com/Manual/FormatDescription.html`) writes a YAML header but embeds large binary payloads (texture pixels, font glyph atlases, lightmap data, terrain heightmaps, shader variants) as hex/base64 inside a single very long line. Evidence from `fixtures/temp`:

- `LiberationSans SDF.asset` (2.2 MB, TextMeshPro SDF font) — starts with `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:`, but file has lines of 48..88 chars **plus one line of 2,097,169 chars** (the glyph atlas hex-encoded). Text-valid UTF-8 but operationally binary. Must be hidden.
- `Terrain_0_0_<guid>.asset` (820 KB) — all NUL bytes from byte 0, no YAML header. Must be hidden.
- `LoreObj_5.1.asset` (660 B) — pure text YAML, all short lines. Must preview.
- `Terrainstamp_Canyon01_Brush.brush` (1 KB) — name has "Terrain" but content is pure text YAML, short lines. Must preview.

Filename patterns (`*SDF.asset`, `*[Tt]errain*`) get this wrong in both directions; a naive `%YAML` magic check accepts SDF as text. The right answer is a content-based check that combines magic-byte with a head+tail line-length scan, paired with a tri-state UI gate (immediate / deferred / hidden) and no size cap anywhere.

## Scope

### In

- `packages/core/src/classify.ts` — add `isUnityYamlBinary(bytes)`; remove `isLikelyUtf8Text`; reroute `getPreviewKindForPath`.
- `packages/core/src/classify.test.ts` — inline cases + `fixtures/temp` cases under `describe.skipIf`.
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
| P2 | Classify tests (inline + fixtures/temp) | `packages/core/src/classify.test.ts` |
| P3 | Tri-state preview gate | `apps/web/src/components/PreviewPanel.tsx`, `apps/web/src/packageModel.ts` |
| P4 | Highlight.js: +css, +hlsl-via-glsl, skip-unsupported | `apps/web/src/components/PreviewPanel.tsx` |
| P5 | Preview-pane perf cleanups | `apps/web/src/components/PreviewPanel.tsx` |
| P6 | Faster `formatBytes` | `apps/web/src/packageModel.ts` |
| P7 | Remove MIME from UI, remove Type from Details | `apps/web/src/components/PreviewPanel.tsx`, `apps/web/src/components/PreviewPanel.test.tsx` |
| P8 | Rewrite `docs/reference/extension-map.md` | `docs/reference/extension-map.md` |
| P9 | Final hygiene pass | `apps/web/**`, `packages/core/**`, lint+typecheck+test+knip |

### P1 -- Content-based binary detection in core

**Goal:** export a single content-based predicate from core that decides whether a YAML-extension file is operationally binary, combining a `%YAML` magic-byte check with a head+tail line-length scan.

**Files:** `packages/core/src/classify.ts`, `packages/core/src/index.ts`.

**Approach:**

1. Add and export:
   ```ts
   const YAML_MAGIC = Uint8Array.of(0x25, 0x59, 0x41, 0x4D, 0x4C); // %YAML
   const LF = 0x0A;
   const MAX_LINE_BYTES = 2048;          // >2KB lines ⇒ embedded binary blob
   const SAMPLE_WINDOW_BYTES = 32 * 1024; // O(64KB) per file regardless of size

   export function isUnityYamlBinary(bytes: Uint8Array | undefined): boolean {
     if (!bytes || bytes.byteLength < YAML_MAGIC.length) return true;
     for (let i = 0; i < YAML_MAGIC.length; i++) {
       if (bytes[i] !== YAML_MAGIC[i]) return true;
     }
     const total = bytes.byteLength;
     if (hasLongLine(bytes, 0, Math.min(total, SAMPLE_WINDOW_BYTES))) return true;
     if (total > SAMPLE_WINDOW_BYTES) {
       if (hasLongLine(bytes, total - SAMPLE_WINDOW_BYTES, total)) return true;
     }
     return false;
   }

   function hasLongLine(bytes: Uint8Array, start: number, end: number): boolean {
     let lineStart = start;
     for (let i = start; i < end; i++) {
       if (bytes[i] === LF) {
         if (i - lineStart > MAX_LINE_BYTES) return true;
         lineStart = i + 1;
       }
     }
     return end - lineStart > MAX_LINE_BYTES;
   }
   ```
2. Delete `isLikelyUtf8Text` and its use.
3. Rewrite `getPreviewKindForPath(pathname, bytes?)`:
   ```ts
   if (yamlExtensions.has(extension) || extension === 'meta') {
     return isUnityYamlBinary(bytes) ? 'unsupported' : 'text';
   }
   if (textExtensions.has(extension)) return 'text';
   return 'unsupported';
   ```
   Conservative when bytes are absent (returns `unsupported` for YAML-ext files).
4. Re-export `isUnityYamlBinary` from `packages/core/src/index.ts`.
5. `packages/core/src/component.ts:79` already passes `content` — no caller change.

**Exit criteria:**

- `isUnityYamlBinary` exported from core barrel.
- `isLikelyUtf8Text` removed from `classify.ts`.
- `getPreviewKindForPath` no longer references `isLikelyUtf8Text`; uses `isUnityYamlBinary` for YAML-ext + `meta`.
- `bun run --filter unitypackage-core typecheck` clean.

### P2 -- Classify tests (inline + fixtures/temp)

**Goal:** lock in `isUnityYamlBinary` behavior with portable inline cases (CI) plus real-fixture cases against `fixtures/temp` (local dev).

**Files:** `packages/core/src/classify.test.ts`.

**Approach:**

1. Inline cases (always run):
   - `isUnityYamlBinary(undefined)` → `true`
   - `isUnityYamlBinary(new Uint8Array(0))` → `true`
   - `isUnityYamlBinary(new Uint8Array([0,0,0,0,0]))` → `true`
   - `isUnityYamlBinary(encode('%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!114 &1\nfoo: bar\n'))` → `false`
   - `isUnityYamlBinary(encode('not a yaml file at all'))` → `true`
   - Long-line discriminator: `encode('%YAML 1.1\n' + 'a'.repeat(3000) + '\n')` → `true`
   - Trailing-long-line: `%YAML` + short body + padding past 32KB + 3000-char tail line → `true`
   - `getPreviewKindForPath('Assets/Foo.asset', shortYamlBytes)` → `'text'`
   - `getPreviewKindForPath('Assets/Foo.asset', longLineYamlBytes)` → `'unsupported'`
   - `getPreviewKindForPath('Assets/Foo.asset', allNullBytes)` → `'unsupported'`
2. Real-fixture cases (`describe.skipIf(!existsSync(tempDir))`, `URL` + `readFileSync` pattern from `meta.test.ts`):
   - `LiberationSans SDF.asset` → `true`
   - `LoreObj_5.1.asset` → `false`
   - `Terrain_0_0_<guid>.asset` → `true`
   - `Terrainstamp_Canyon01_Brush.brush` → `false`
3. Update the existing `'maps preview kinds consistently with web behavior'` test: `Assets/Data.asset` without bytes now returns `'unsupported'` (conservative).

`fixtures/temp` is git-ignored (`~/.config/git/ignore:29:temp/`); `skipIf` keeps CI green when absent.

**Exit criteria:**

- `bun run test:core` green.
- When `fixtures/temp` is populated locally, all four real-fixture assertions pass.

### P3 -- Tri-state preview gate

**Goal:** route `PreviewBody` into `immediate` / `deferred` / `hidden` buckets; remove the 200 KB slice + truncation banner.

**Files:** `apps/web/src/components/PreviewPanel.tsx`, `apps/web/src/packageModel.ts`.

**Approach:**

1. Delete `TEXT_PREVIEW_LIMIT`, `slice(0, ...)`, the `isTruncated` flag, and the truncation banner JSX.
2. Add to `packageModel.ts`:
   ```ts
   const UNITY_GENERATED_EXTENSIONS = new Set<string>([ /* set above */ ]);
   export function isUnityGeneratedExtension(extension: string): boolean {
     return UNITY_GENERATED_EXTENSIONS.has(extension);
   }
   ```
3. Rewrite `PreviewBody`:
   ```tsx
   function PreviewBody({ record }: { record: PackageFileRecord }) {
     if (record.previewKind === 'image') return <ImagePreview key={record.id} record={record} />;
     if (record.previewKind === 'text') {
       if (isUnityGeneratedExtension(record.extension)) {
         return <DeferredTextPreview key={record.id} record={record} />;
       }
       return <TextPreview record={record} />;
     }
     return null;
   }
   ```
4. Add `DeferredTextPreview`:
   ```tsx
   function DeferredTextPreview({ record }: { record: PackageFileRecord }) {
     const [loaded, setLoaded] = useState(false);
     if (loaded) return <TextPreview record={record} />;
     return (
       <div className="preview-frame deferred-frame">
         <p>Unity-generated asset ({formatBytes(record.byteLength)})</p>
         <button type="button" onClick={() => setLoaded(true)}>Load preview</button>
       </div>
     );
   }
   ```
   `key={record.id}` resets `loaded` when selection changes.
5. `TextPreview` decodes `record.content` directly (no slice).
6. Smoke-test in `bun run dev:web` that `.preview-frame` CSS collapses cleanly when body is `null`.

**Exit criteria:**

- `TEXT_PREVIEW_LIMIT` removed from the file.
- Selecting a `.prefab` / `.unity` / `.asset` (text YAML) shows the "Load preview" button; clicking renders the YAML.
- Selecting a binary `.asset` (SDF, NavMesh, etc.) collapses the preview frame entirely — only header + metadata visible.
- `bun run test:web` green.

### P4 -- Highlight.js: +css, +hlsl-via-glsl, skip-unsupported

**Goal:** extend highlighting to css and HLSL (via GLSL grammar); short-circuit highlighting for any unregistered language with one `Set.has` check.

**Files:** `apps/web/src/components/PreviewPanel.tsx`.

**Approach:**

1. Register two more languages next to `csharp` / `yaml` / `json`:
   - `import css from 'highlight.js/lib/languages/css'` (built-in, confirmed via Context7 + local `node_modules`).
   - `import glsl from 'highlight.js/lib/languages/glsl'` (built-in). Register under both `'glsl'` and `'hlsl'` — HLSL has no first-party grammar; GLSL is close enough.
2. Module-level `Set<SyntaxLanguage>` of registered languages (`csharp`, `yaml`, `json`, `css`, `hlsl`, `glsl`). Short-circuit `highlightedHtml` with a single `Set.has` check; drop the `hljs.getLanguage() + try/catch` dance.
3. Other syntax langs (`shaderlab`, `markdown`, `html`, `xml`, `typescript`, `javascript`, `text`) render as plain `<pre><code>` with no highlight pass.

**Exit criteria:**

- `.css` / `.uss` / `.tss` previews show `<span>` markup.
- `.hlsl` / `.cginc` / `.compute` previews show `<span>` markup.
- `.shader` (ShaderLab) preview renders without `<span>` markup.
- New `PreviewPanel.test.tsx` cases: one css, one hlsl, one shaderlab-plain.
- `bun run --filter @unitypackage-tools/web build` still tree-shakes correctly (bundle size sanity).

### P5 -- Preview-pane perf cleanups

**Goal:** keep the low-cost wins; drop the now-dead `useMemo` over the slice.

**Files:** `apps/web/src/components/PreviewPanel.tsx`.

**Approach:**

- Keep module-scope `TextDecoder` (already present).
- Keep image `Blob` constructed once via `useState` initializer.
- Drop the `useMemo` that wrapped the `record.content.slice(...)` — decode `record.content` directly.
- Do **not** add a Web Worker for `hljs.highlight`. The deferred bucket means user explicitly opts in; sync work on click is acceptable. Context7 confirms Workers are the only documented perf knob — defer to a later pass only if profiling shows >50 ms blocks.

**Exit criteria:**

- No `useMemo` over a slice exists in `TextPreview`.
- No worker setup added.

### P6 -- Faster `formatBytes`

**Goal:** replace `Math.log` / `Math.pow` with a four-branch divide; keep the same UX rule (1 decimal under 10, integer otherwise).

**Files:** `apps/web/src/packageModel.ts`.

**Approach:**

```ts
const KB = 1024, MB = KB * 1024, GB = MB * 1024;
export function formatBytes(bytes: number): string {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(bytes < 10 * KB ? 1 : 0)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
  return `${(bytes / GB).toFixed(bytes < 10 * GB ? 1 : 0)} GB`;
}
```

Drops the unreachable TB rung. Output unchanged: `0 B` / `512 B` / `1.5 KB` / `250 KB` / `3.4 MB` / `1.1 GB`.

**Exit criteria:**

- No `Math.log` / `Math.pow` references in `packageModel.ts`.
- Existing `formatBytes` test cases (and any consumers in Stats / PreviewPanel / file rows) still produce the same output.

### P7 -- Remove MIME from UI, remove Type from Details

**Goal:** stop surfacing internal MIME strings to users; drop the redundant `Type` row that just echoes the extension.

**Files:** `apps/web/src/components/PreviewPanel.tsx`, `apps/web/src/components/PreviewPanel.test.tsx`.

**Approach:**

1. Header subtitle: drop `· {previewRecord.mimeType}`. Show only `{formatBytes(byteLength)}`.
2. `Metadata` rows: drop `Type` and `MIME`. Remaining: `Path`, `GUID`, `Size`, optional `Meta GUID` / `Importer`.
3. Keep `record.mimeType` on the record type — `App.tsx` download Blob + `ImagePreview` Blob still need it. Internal only.
4. Update `PreviewPanel.test.tsx`: drop assertions on header MIME / `Type` / `MIME` labels; add an assertion they are absent.
5. Grep `apps/web` for `/mimeType/i` and `"MIME"` to confirm no other UI surface leaks it.

**Exit criteria:**

- Header shows size only; no MIME string anywhere in UI.
- `Metadata` lacks `Type` and `MIME` rows.
- `record.mimeType` still wired into `App.tsx` download path.

### P8 -- Rewrite `docs/reference/extension-map.md`

**Goal:** make the reference doc describe actual post-refactor behavior, not stale ideals.

**Files:** `docs/reference/extension-map.md`.

**Approach:** sections:

- **Immediate image preview** — image extensions list, rendered via `<img>` blob URL.
- **Immediate code preview** — syntax-highlighted set (`cs`, `yaml`/`yml`, `json` group, `css`/`uss`/`tss`, `hlsl`/`cginc`/`compute` via GLSL grammar) vs plain (`shader`, `glsl`, `md`, `txt`, `html`, `xml`/`uxml`, `ts`/`tsx`, `js`/`jsx`). No size cap.
- **Deferred preview ("Load preview" button)** — full Unity-generated set; explain GitHub linguist-generated parallel.
- **Hidden (download only)** — decided by `isUnityYamlBinary` content sniff (NOT filename patterns from `gitattributes.md`). The check combines `%YAML` magic with a head+tail line-length scan, catching both raw-binary `.asset` (no header) and Force-Text-serialized assets with embedded binary blobs (TMP SDF fonts, lightmaps, shader variants). Counter-examples to call out: `Terrainstamp_Canyon01_Brush.brush` (name contains "Terrain" but text YAML — previewable); `LiberationSans SDF.asset` (text YAML header but 2M-char glyph atlas line — hidden).
- **Browser-non-native formats** (`ttf`, `fbx`, `dll`, ...) — hidden.
- **Internal-only fields** — `mimeType` exists only for download Blob construction; never shown.
- **Icon mapping** — one-liner pointing at `apps/web/src/fileIcons.ts`; no duplicate table.

**Exit criteria:**

- The doc no longer lists PDF / audio / video MIME mappings as previewable.
- The doc references `isUnityYamlBinary` and explains the two counter-examples.
- The doc no longer attempts to be the icon-mapping source of truth.

### P9 -- Final hygiene pass

**Goal:** lint, typecheck, test, knip all green; no dead code from earlier phases.

**Files:** repo-wide (read-only scans).

**Approach:**

- `bun run lint:fix && bun run --filter @unitypackage-tools/web typecheck && bun run test:web && bun run test:core && bun run knip`.
- Re-scan `PreviewPanel.tsx` for now-dead imports.
- Look for redundant `useMemo` / `useCallback` flagged by React Compiler ESLint.
- Confirm `fileIcons.ts` extension sets still align with `classify.ts`.
- Re-grep for `TEXT_PREVIEW_LIMIT`, `isLikelyUtf8Text`, UI-side `mimeType` — none should remain.

**Exit criteria:**

- All commands above exit 0.
- No remaining references to deleted symbols.

## Verification

1. **Unit / component**
   - `bun run test:core` — inline cases + (when present) `fixtures/temp` cases pass.
   - `bun run test:web` — highlight (css, hlsl, shaderlab-plain), deferred-frame click-through, hidden-frame collapse, no-MIME / no-Type metadata.
2. **Build / static analysis**
   - `bun run --filter @unitypackage-tools/web typecheck`
   - `bun run --filter @unitypackage-tools/web build`
   - `bun run knip`
3. **Manual dev verification via `fixtures/temp`** (load the four files via a synthetic `.unitypackage`):
   - `LiberationSans SDF.asset` → preview area **hidden**.
   - `LoreObj_5.1.asset` → "Load preview" → click → YAML renders.
   - `Terrain_0_0_<guid>.asset` → preview area hidden.
   - `Terrainstamp_Canyon01_Brush.brush` → "Load preview" → click → YAML renders.
4. **E2E against `fixtures/static/archives/Polytope_URP.unitypackage`**
   - `.cs` → highlighted immediately; header shows size only; Details: Path/GUID/Size.
   - `.hlsl` / `.compute` / `.cginc` → highlighted via glsl grammar.
   - `.css` / `.uss` → highlighted.
   - `.shader` (ShaderLab) → plain text.
   - `.terrainlayer` / `.prefab` → "Load preview" → click → renders.
   - `.png` → renders immediately; download still works (internal `mimeType` intact).
5. **Playwright** (`cd apps/web && bunx playwright test`) — update specs that asserted on header MIME / `Type` / `MIME`; add a spec that clicks "Load preview" on a Unity YAML and asserts the YAML body appears.
