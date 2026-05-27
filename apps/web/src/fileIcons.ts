import {
  File,
  FileArchive,
  FileAudio,
  FileBox,
  FileCode,
  FileCog,
  FileDigit,
  FileImage,
  FileJson,
  FileSliders,
  FileText,
  FileType,
  FileVideo,
  type LucideIcon,
} from 'lucide-react';

import type { PackageFileRecord } from './packageModel';

type FileIconTone =
  | 'audio'
  | 'binary'
  | 'code'
  | 'document'
  | 'image'
  | 'json'
  | 'meta'
  | 'pdf'
  | 'shader'
  | 'text'
  | 'unity'
  | 'video'
  | 'xml';

export interface FileIconDescriptor {
  Icon: LucideIcon;
  tone: FileIconTone;
  label: string;
}

type FileIconInput = Pick<PackageFileRecord, 'extension' | 'previewKind' | 'syntaxLanguage'>;

const imageExtensions = new Set(['apng', 'avif', 'bmp', 'gif', 'jpg', 'jpeg', 'png', 'svg', 'webp']);
const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav']);
const videoExtensions = new Set(['m4v', 'mov', 'mp4', 'ogv']);
const csharpExtensions = new Set(['cs']);
const typescriptExtensions = new Set(['ts', 'tsx']);
const javascriptExtensions = new Set(['js', 'jsx']);
const shaderExtensions = new Set(['shader', 'hlsl', 'cginc', 'compute', 'glsl']);
const styleExtensions = new Set(['css', 'uss', 'tss']);
const jsonExtensions = new Set(['json', 'asmdef', 'asmref', 'inputactions', 'shadergraph', 'shadersubgraph']);
const xmlExtensions = new Set(['xml', 'uxml']);
const htmlExtensions = new Set(['html']);
const unitySceneExtensions = new Set(['unity', 'prefab', 'asset', 'playable']);
const unityMaterialExtensions = new Set([
  'mat',
  'physicmaterial',
  'physicsmaterial2d',
  'rendertexture',
  'terrainlayer',
  'preset',
  'lighting',
]);
const unityAnimationExtensions = new Set(['anim', 'controller', 'overridecontroller', 'mask']);
const unityImageAssetExtensions = new Set(['brush', 'flare', 'fontsettings', 'guiskin', 'giparams', 'spriteatlas', 'spriteatlasv2']);
const unityVfxExtensions = new Set(['vfx', 'vfxblock', 'vfxoperator', 'shadervariants']);
const unityMetaExtensions = new Set(['meta', 'dwlt']);
const yamlExtensions = new Set(['yaml', 'yml']);

export function getFileIconDescriptor(record: FileIconInput): FileIconDescriptor {
  const extension = normalizeExtension(record.extension);

  if (!extension) return descriptor(File, 'binary', 'File');
  if (extension === 'pdf') return descriptor(FileText, 'pdf', 'PDF');

  if (extension === 'webm') {
    return record.previewKind === 'audio'
      ? descriptor(FileAudio, 'audio', 'Audio')
      : descriptor(FileVideo, 'video', 'Video');
  }

  if (imageExtensions.has(extension) || record.previewKind === 'image') return descriptor(FileImage, 'image', 'Image');
  if (audioExtensions.has(extension) || record.previewKind === 'audio') return descriptor(FileAudio, 'audio', 'Audio');
  if (videoExtensions.has(extension) || record.previewKind === 'video') return descriptor(FileVideo, 'video', 'Video');

  if (csharpExtensions.has(extension)) return descriptor(FileCode, 'code', 'C#');
  if (typescriptExtensions.has(extension)) return descriptor(FileCode, 'code', 'TypeScript');
  if (javascriptExtensions.has(extension)) return descriptor(FileCode, 'code', 'JavaScript');
  if (shaderExtensions.has(extension)) return descriptor(FileCode, 'shader', 'Shader');
  if (styleExtensions.has(extension)) return descriptor(FileType, 'code', 'Stylesheet');
  if (jsonExtensions.has(extension)) return descriptor(FileJson, 'json', 'JSON');
  if (xmlExtensions.has(extension)) return descriptor(FileCode, 'xml', 'XML');
  if (htmlExtensions.has(extension)) return descriptor(FileCode, 'code', 'HTML');

  if (unityMetaExtensions.has(extension)) return descriptor(FileCog, 'meta', 'Unity metadata');
  if (unityVfxExtensions.has(extension)) return descriptor(FileCode, 'shader', 'Unity visual effect');
  if (unityMaterialExtensions.has(extension)) return descriptor(FileSliders, 'unity', 'Unity settings asset');
  if (unityAnimationExtensions.has(extension)) return descriptor(FileDigit, 'unity', 'Unity animation asset');
  if (unityImageAssetExtensions.has(extension)) return descriptor(FileImage, 'image', 'Unity visual asset');
  if (unitySceneExtensions.has(extension)) return descriptor(FileBox, 'unity', 'Unity asset');
  if (extension === 'mixer') return descriptor(FileAudio, 'audio', 'Unity audio mixer');
  if (yamlExtensions.has(extension) || record.syntaxLanguage === 'yaml') return descriptor(FileCog, 'unity', 'YAML asset');

  if (extension === 'md') return descriptor(FileText, 'document', 'Markdown');
  if (extension === 'txt') return descriptor(FileText, 'text', 'Text');
  if (record.previewKind === 'text') return descriptor(FileText, 'text', 'Text');

  return descriptor(FileArchive, 'binary', 'Binary file');
}

export function normalizeExtension(extension: string): string {
  return extension.trim().toLowerCase().replace(/^\.+/, '');
}

function descriptor(Icon: LucideIcon, tone: FileIconTone, label: string): FileIconDescriptor {
  return { Icon, tone, label };
}
