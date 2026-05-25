import { describe, expect, it } from 'vitest';
import {
  getMimeTypeForPath,
  getPathExtension,
  getPreviewKindForPath,
  getSyntaxLanguageForPath,
  getUnityFileCategory,
} from './index';

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
    expect(getPreviewKindForPath('Assets/Data.asset')).toBe('text');
    expect(getPreviewKindForPath('Assets/Data.bytes', new Uint8Array([0, 1, 2]))).toBe('unsupported');
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
