import { describe, expect, it } from 'vitest';
import {
  getMimeTypeForPath,
  getPathExtension,
  getUnityFileCategory,
  isUnityYamlBinary,
} from './index';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const staticDirUrl = new URL('../../../fixtures/static', import.meta.url);
const staticDir = fileURLToPath(staticDirUrl);

describe('file classification', () => {
  it('extracts lower-case extensions and handles extensionless paths', () => {
    expect(getPathExtension('Assets/Texture.PNG')).toBe('png');
    expect(getPathExtension('Assets/LICENSE')).toBe('');
    expect(getPathExtension('Assets/.hidden')).toBe('');
  });

  it('maps documented media and document MIME types', () => {
    expect(getMimeTypeForPath('Assets/Image.bmp')).toBe('image/bmp');
    expect(getMimeTypeForPath('Assets/Image.avif')).toBe('image/avif');
    expect(getMimeTypeForPath('tex.tga')).toBe('image/x-tga');
    expect(getMimeTypeForPath('tex.tif')).toBe('image/tiff');
    expect(getMimeTypeForPath('tex.tiff')).toBe('image/tiff');
    expect(getMimeTypeForPath('Assets/Sound.flac')).toBe('audio/flac');
    expect(getMimeTypeForPath('Assets/Movie.mov')).toBe('video/quicktime');
    expect(getMimeTypeForPath('Assets/Manual.pdf')).toBe('application/pdf');
    expect(getMimeTypeForPath('Assets/Readme.md')).toBe('text/markdown');
    expect(getMimeTypeForPath('Assets/Unknown.bin')).toBe('application/octet-stream');
  });

  it('classifies Unity and developer files', () => {
    expect(getUnityFileCategory('Assets/Scene.unity')).toBe('unity-yaml');
    expect(getUnityFileCategory('Assets/Script.cs')).toBe('code');
    expect(getUnityFileCategory('Assets/Image.tga')).toBe('image');
    expect(getUnityFileCategory('Assets/File.meta')).toBe('meta');
    expect(getUnityFileCategory('Assets/Data.bin')).toBe('binary');
  });

  describe('isUnityYamlBinary', () => {
    const encoder = new TextEncoder();
    const encode = (str: string) => encoder.encode(str);

    it('treats undefined/empty/non-yaml bytes as binary', () => {
      expect(isUnityYamlBinary(undefined)).toBe(true);
      expect(isUnityYamlBinary(new Uint8Array(0))).toBe(true);
      expect(isUnityYamlBinary(new Uint8Array([0, 0, 0, 0, 0]))).toBe(true);
      expect(isUnityYamlBinary(encode('not a yaml file at all'))).toBe(true);
    });

    it('accepts short clean YAML', () => {
      const bytes = encode('%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!114 &1\nfoo: bar\n');
      expect(isUnityYamlBinary(bytes)).toBe(false);
    });

    it('rejects YAML with head long lines', () => {
      expect(isUnityYamlBinary(encode('%YAML 1.1\n' + 'a'.repeat(3000) + '\n'))).toBe(true);
    });

    it('rejects YAML with trailing long lines past 32KB', () => {
      const prefix = '%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!114 &1\n';
      const padding = 'a\n'.repeat(17000);
      const suffix = 'b'.repeat(3000) + '\n';
      expect(isUnityYamlBinary(encode(prefix + padding + suffix))).toBe(true);
    });
  });

  describe('real-fixture YAML binary detection', () => {
    it('identifies LiberationSans SDF.asset as binary', () => {
      const filePath = join(staticDir, 'LiberationSans SDF.asset');
      const bytes = readFileSync(filePath);
      expect(isUnityYamlBinary(bytes)).toBe(true);
    });

    it('identifies scriptable.asset as text', () => {
      const filePath = join(staticDir, 'scriptable.asset');
      const bytes = readFileSync(filePath);
      expect(isUnityYamlBinary(bytes)).toBe(false);
    });

    it('identifies TerrainData_<guid>.asset as binary', () => {
      const files = readdirSync(staticDir);
      const terrainFile = files.find(f => f.startsWith('TerrainData_') && f.endsWith('.asset'));
      expect(terrainFile).toBeDefined();
      const filePath = join(staticDir, terrainFile!);
      const bytes = readFileSync(filePath);
      expect(isUnityYamlBinary(bytes)).toBe(true);
    });

    it('identifies stamp.brush as text', () => {
      const filePath = join(staticDir, 'stamp.brush');
      const bytes = readFileSync(filePath);
      expect(isUnityYamlBinary(bytes)).toBe(false);
    });
  });
});
