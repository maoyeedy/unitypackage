import { describe, expect, it } from 'vitest';
import {
  PREVIEW_SIZE_LIMIT_BYTES,
  getMimeTypeForPath,
  getPathExtension,
  getPreviewKindForPath,
  getSyntaxLanguageForPath,
  getUnityFileCategory,
  isUnityYamlBinary,
} from './index';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tempDirUrl = new URL('../../../fixtures/temp', import.meta.url);
const tempDir = fileURLToPath(tempDirUrl);

describe('file classification', () => {
  it('extracts lower-case extensions and handles extensionless paths', () => {
    expect(getPathExtension('Assets/Texture.PNG')).toBe('png');
    expect(getPathExtension('Assets/LICENSE')).toBe('');
    expect(getPathExtension('Assets/.hidden')).toBe('');
  });

  it('maps documented media and document MIME types', () => {
    expect(getMimeTypeForPath('Assets/Image.bmp')).toBe('image/bmp');
    expect(getMimeTypeForPath('Assets/Image.avif')).toBe('image/avif');
    expect(getMimeTypeForPath('Assets/Sound.flac')).toBe('audio/flac');
    expect(getMimeTypeForPath('Assets/Movie.mov')).toBe('video/quicktime');
    expect(getMimeTypeForPath('Assets/Manual.pdf')).toBe('application/pdf');
    expect(getMimeTypeForPath('Assets/Readme.md')).toBe('text/markdown');
    expect(getMimeTypeForPath('Assets/Unknown.bin')).toBe('application/octet-stream');
  });

  it('classifies Unity and developer files', () => {
    expect(getUnityFileCategory('Assets/Scene.unity')).toBe('unity-yaml');
    expect(getUnityFileCategory('Assets/Script.cs')).toBe('code');
    expect(getUnityFileCategory('Assets/File.meta')).toBe('meta');
    expect(getUnityFileCategory('Assets/Data.bin')).toBe('binary');
  });

  it('maps preview kinds consistently with web behavior', () => {
    expect(getPreviewKindForPath('Assets/Image.png')).toBe('image');
    expect(getPreviewKindForPath('Assets/Manual.pdf')).toBe('pdf');
    expect(getPreviewKindForPath('Assets/Sound.wav')).toBe('audio');
    expect(getPreviewKindForPath('Assets/Movie.mp4')).toBe('video');
    expect(getPreviewKindForPath('Assets/Data.asset')).toBe('unsupported');
    expect(getPreviewKindForPath('Assets/Data.bytes', new Uint8Array([0, 1, 2]))).toBe('unsupported');
    expect(getPreviewKindForPath('Assets/File.meta')).toBe('text');
    expect(getPreviewKindForPath('Assets/File.meta', new Uint8Array([0, 1, 2]))).toBe('text');
  });

  describe('isUnityYamlBinary and preview kinds', () => {
    const encoder = new TextEncoder();
    const encode = (str: string) => encoder.encode(str);

    it('treats undefined bytes as binary because the only caller never passes undefined', () => {
      expect(isUnityYamlBinary(undefined)).toBe(true);
    });

    it('handles inline cases correctly', () => {
      expect(isUnityYamlBinary(undefined)).toBe(true);
      expect(isUnityYamlBinary(new Uint8Array(0))).toBe(true);
      expect(isUnityYamlBinary(new Uint8Array([0, 0, 0, 0, 0]))).toBe(true);

      const shortYamlBytes = encode('%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!114 &1\nfoo: bar\n');
      expect(isUnityYamlBinary(shortYamlBytes)).toBe(false);

      expect(isUnityYamlBinary(encode('not a yaml file at all'))).toBe(true);

      const longLineYamlBytes = encode('%YAML 1.1\n' + 'a'.repeat(3000) + '\n');
      expect(isUnityYamlBinary(longLineYamlBytes)).toBe(true);

      // Trailing-long-line: %YAML + short body + padding past 32KB + 3000-char tail line
      const prefix = '%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!114 &1\n';
      const padding = 'a\n'.repeat(17000); // 34000 chars, well past 32KB
      const suffix = 'b'.repeat(3000) + '\n';
      const trailingLongLineBytes = encode(prefix + padding + suffix);
      expect(isUnityYamlBinary(trailingLongLineBytes)).toBe(true);

      const allNullBytes = new Uint8Array(500);

      expect(getPreviewKindForPath('Assets/Foo.asset', shortYamlBytes)).toBe('text');
      expect(getPreviewKindForPath('Assets/Foo.asset', longLineYamlBytes)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Foo.asset', allNullBytes)).toBe('unsupported');

      // Plain yaml/yml short-circuits to text regardless of content/sniffing
      expect(getPreviewKindForPath('Assets/pkg.yaml', encode('name: foo\nversion: 1.0'))).toBe('text');
      expect(getPreviewKindForPath('Assets/pkg.yml', encode('a: 1\nb: 2'))).toBe('text');
      expect(getPreviewKindForPath('Assets/pkg.yaml', undefined)).toBe('text');
    });
  });

  describe('PREVIEW_SIZE_LIMIT_BYTES cap', () => {
    const atLimit = new Uint8Array(PREVIEW_SIZE_LIMIT_BYTES);
    const overLimit = new Uint8Array(PREVIEW_SIZE_LIMIT_BYTES + 1);

    it('hides text-class files above the cap', () => {
      expect(getPreviewKindForPath('Assets/Script.cs', overLimit)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Data.json', overLimit)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Style.css', overLimit)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/pkg.yaml', overLimit)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/pkg.yml', overLimit)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Big.txt', overLimit)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/File.meta', overLimit)).toBe('unsupported');
    });

    it('hides Unity-generated YAML above the cap without running the binary sniff', () => {
      // Even bytes that would normally pass isUnityYamlBinary (text payload) are hidden.
      const headerOnly = new TextEncoder().encode(
        '%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!114 &1\nfoo: bar\n',
      );
      const padded = new Uint8Array(overLimit.byteLength);
      padded.set(headerOnly, 0);
      expect(getPreviewKindForPath('Assets/Foo.asset', padded)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Foo.prefab', padded)).toBe('unsupported');
    });

    it('preserves browser-native media kinds regardless of size', () => {
      expect(getPreviewKindForPath('Assets/Big.png', overLimit)).toBe('image');
      expect(getPreviewKindForPath('Assets/Long.mp3', overLimit)).toBe('audio');
      expect(getPreviewKindForPath('Assets/Long.mp4', overLimit)).toBe('video');
      expect(getPreviewKindForPath('Assets/Big.pdf', overLimit)).toBe('pdf');
    });

    it('keeps files exactly at the cap previewable (strict greater-than)', () => {
      expect(getPreviewKindForPath('Assets/Script.cs', atLimit)).toBe('text');
      expect(getPreviewKindForPath('Assets/File.meta', atLimit)).toBe('text');
    });
  });

  describe('binary .asset filename fast-path', () => {
    const encoder = new TextEncoder();
    const cleanYamlBytes = encoder.encode('%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!114 &1\nfoo: bar\n');

    it('hides known Unity-binary .asset filenames before sniffing', () => {
      // Bytes look like clean text YAML; sniff would return false. Filename pattern wins.
      expect(getPreviewKindForPath('Assets/Terrain/TerrainData_abc.asset', cleanYamlBytes)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Terrain/Terrain_0_0_xyz.asset', cleanYamlBytes)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Terrain/TerrainData_xyz.asset', cleanYamlBytes)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Lighting/LightingData.asset', cleanYamlBytes)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Lighting/LightmapSnapshot.asset', cleanYamlBytes)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/NavMeshData.asset', cleanYamlBytes)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/NavMesh 1.asset', cleanYamlBytes)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/OcclusionCullingData.asset', cleanYamlBytes)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Fonts/LiberationSans SDF.asset', cleanYamlBytes)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Fonts/LiberationSans SDF - Fallback.asset', cleanYamlBytes)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Fonts/baloo.bhaina-regular SDF.asset', cleanYamlBytes)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Fonts/HarmonyOS_Sans_SC_Regular SDF.asset', cleanYamlBytes)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Fonts/Noto SDF fallback.asset', cleanYamlBytes)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Probes/ProbeVolumeStreamable.asset', cleanYamlBytes)).toBe('unsupported');
      expect(getPreviewKindForPath('Assets/Probes/ProbeVolumeData.asset', cleanYamlBytes)).toBe('unsupported');
    });

    it('only matches the .asset extension; same-named .brush stays previewable', () => {
      // Terrainstamp_Canyon01_Brush.brush is a real fixture: name contains "Terrain" but extension is .brush.
      expect(getPreviewKindForPath('Assets/Brushes/Terrainstamp_Canyon01_Brush.brush', cleanYamlBytes)).toBe('text');
    });

    it('lets plain .asset names fall through to the content sniff', () => {
      expect(getPreviewKindForPath('Assets/MyScriptableObject.asset', cleanYamlBytes)).toBe('text');
      const garbage = new Uint8Array([0, 1, 2, 3]);
      expect(getPreviewKindForPath('Assets/MyScriptableObject.asset', garbage)).toBe('unsupported');
    });
  });

  describe.skipIf(!existsSync(tempDir))('real-fixture cases in fixtures/temp', () => {
    it('identifies LiberationSans SDF.asset as binary', () => {
      const filePath = join(tempDir, 'LiberationSans SDF.asset');
      const bytes = readFileSync(filePath);
      expect(isUnityYamlBinary(bytes)).toBe(true);
    });

    it('identifies LoreObj_5.1.asset as text', () => {
      const filePath = join(tempDir, 'LoreObj_5.1.asset');
      const bytes = readFileSync(filePath);
      expect(isUnityYamlBinary(bytes)).toBe(false);
    });

    it('identifies Terrain_0_0_<guid>.asset as binary', () => {
      const files = readdirSync(tempDir);
      const terrainFile = files.find(f => f.startsWith('Terrain_0_0_') && f.endsWith('.asset'));
      expect(terrainFile).toBeDefined();
      const filePath = join(tempDir, terrainFile!);
      const bytes = readFileSync(filePath);
      expect(isUnityYamlBinary(bytes)).toBe(true);
    });

    it('identifies Terrainstamp_Canyon01_Brush.brush as text', () => {
      const filePath = join(tempDir, 'Terrainstamp_Canyon01_Brush.brush');
      const bytes = readFileSync(filePath);
      expect(isUnityYamlBinary(bytes)).toBe(false);
    });

    it('hides TerrainData_*.asset via filename fast-path even when sniff would pass', () => {
      const files = readdirSync(tempDir);
      const terrainData = files.find(f => f.startsWith('TerrainData_') && f.endsWith('.asset'));
      expect(terrainData).toBeDefined();
      const filePath = join(tempDir, terrainData!);
      const bytes = readFileSync(filePath);
      // Regardless of sniff outcome on this file, the filename pattern routes it to 'unsupported'.
      expect(getPreviewKindForPath(`Assets/Terrain/${terrainData!}`, bytes)).toBe('unsupported');
    });

    it('hides LiberationSans SDF.asset via filename fast-path', () => {
      const filePath = join(tempDir, 'LiberationSans SDF.asset');
      const bytes = readFileSync(filePath);
      expect(getPreviewKindForPath('Assets/Fonts/LiberationSans SDF.asset', bytes)).toBe('unsupported');
    });
  });

  it('maps syntax languages for documented text extensions', () => {
    expect(getSyntaxLanguageForPath('Assets/File.meta')).toBe('yaml');
    expect(getSyntaxLanguageForPath('Assets/File.prefab')).toBe('yaml');
    expect(getSyntaxLanguageForPath('Assets/File.shadergraph')).toBe('json');
    expect(getSyntaxLanguageForPath('Assets/File.uxml')).toBe('xml');
    expect(getSyntaxLanguageForPath('Assets/File.uss')).toBe('css');
    expect(getSyntaxLanguageForPath('Assets/File.cs')).toBe('csharp');
    expect(getSyntaxLanguageForPath('Assets/File.shader')).toBe('shaderlab');
    expect(getSyntaxLanguageForPath('Assets/File.compute')).toBe('hlsl');
    expect(getSyntaxLanguageForPath('Assets/File.glsl')).toBe('glsl');
    expect(getSyntaxLanguageForPath('Assets/File.tsx')).toBe('typescript');
    expect(getSyntaxLanguageForPath('Assets/File.jsx')).toBe('javascript');
    expect(getSyntaxLanguageForPath('Assets/File.md')).toBe('markdown');
    expect(getSyntaxLanguageForPath('Assets/File.html')).toBe('html');
    expect(getSyntaxLanguageForPath('Assets/File.txt')).toBe('text');
  });
});
