import { describe, expect, it } from 'vitest';

import { getFileIconDescriptor, normalizeExtension } from './fileIcons';
import type { PreviewKind, SyntaxLanguage } from './previewTypes';
import type { PackageFileRecord } from './packageModel';

const referenceExtensions = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'apng',
  'avif',
  'webp',
  'svg',
  'aac',
  'flac',
  'm4a',
  'mp3',
  'ogg',
  'wav',
  'webm',
  'm4v',
  'mov',
  'mp4',
  'ogv',
  'pdf',
  'cs',
  'ts',
  'tsx',
  'js',
  'jsx',
  'shader',
  'hlsl',
  'cginc',
  'compute',
  'glsl',
  'css',
  'uss',
  'tss',
  'json',
  'asmdef',
  'asmref',
  'inputactions',
  'shadergraph',
  'shadersubgraph',
  'xml',
  'uxml',
  'html',
  'unity',
  'prefab',
  'asset',
  'mat',
  'anim',
  'controller',
  'overridecontroller',
  'physicmaterial',
  'physicsmaterial2d',
  'playable',
  'mask',
  'brush',
  'flare',
  'fontsettings',
  'guiskin',
  'giparams',
  'rendertexture',
  'spriteatlas',
  'spriteatlasv2',
  'terrainlayer',
  'mixer',
  'shadervariants',
  'preset',
  'lighting',
  'dwlt',
  'vfx',
  'vfxblock',
  'vfxoperator',
  'yaml',
  'yml',
  'meta',
  'md',
  'txt',
];

describe('file icon descriptors', () => {
  it('normalizes extension input', () => {
    expect(normalizeExtension(' .ShaderGraph ')).toBe('shadergraph');
    expect(normalizeExtension('...meta')).toBe('meta');
  });

  it('covers every documented reference extension', () => {
    for (const extension of referenceExtensions) {
      expect(getFileIconDescriptor(record(extension)).tone, extension).not.toBe('binary');
    }
  });

  it('uses fallback descriptors for empty and unknown extensions', () => {
    expect(getFileIconDescriptor(record('')).label).toBe('File');
    expect(getFileIconDescriptor(record('bytes', 'unsupported')).tone).toBe('binary');
  });

  it('distinguishes webm audio and video by preview kind', () => {
    expect(getFileIconDescriptor(record('webm', 'audio')).tone).toBe('audio');
    expect(getFileIconDescriptor(record('webm', 'video')).tone).toBe('video');
  });

  it('maps representative Unity extensions to enriched categories', () => {
    expect(getFileIconDescriptor(record('unity')).tone).toBe('unity');
    expect(getFileIconDescriptor(record('prefab')).tone).toBe('unity');
    expect(getFileIconDescriptor(record('meta')).tone).toBe('meta');
    expect(getFileIconDescriptor(record('mat')).tone).toBe('unity');
    expect(getFileIconDescriptor(record('vfx')).tone).toBe('shader');
    expect(getFileIconDescriptor(record('mixer')).tone).toBe('audio');
  });
});

function record(
  extension: string,
  previewKind: PreviewKind = 'text',
  syntaxLanguage: SyntaxLanguage = 'text',
): Pick<PackageFileRecord, 'extension' | 'previewKind' | 'syntaxLanguage'> {
  return { extension, previewKind, syntaxLanguage };
}
