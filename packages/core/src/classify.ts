export type UnityFileCategory =
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'code'
  | 'unity-yaml'
  | 'meta'
  | 'document'
  | 'binary';

export type PreviewKind = 'text' | 'image' | 'pdf' | 'audio' | 'video' | 'unsupported';

export type SyntaxLanguage =
  | 'text'
  | 'yaml'
  | 'json'
  | 'xml'
  | 'css'
  | 'csharp'
  | 'shaderlab'
  | 'hlsl'
  | 'glsl'
  | 'typescript'
  | 'javascript'
  | 'markdown'
  | 'html';

const imageMimeTypes = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['bmp', 'image/bmp'],
  ['apng', 'image/apng'],
  ['avif', 'image/avif'],
  ['webp', 'image/webp'],
  ['svg', 'image/svg+xml'],
]);

const audioMimeTypes = new Map([
  ['aac', 'audio/aac'],
  ['flac', 'audio/flac'],
  ['m4a', 'audio/mp4'],
  ['mp3', 'audio/mpeg'],
  ['ogg', 'audio/ogg'],
  ['wav', 'audio/wav'],
  ['webm', 'audio/webm'],
]);

const videoMimeTypes = new Map([
  ['m4v', 'video/mp4'],
  ['mov', 'video/quicktime'],
  ['mp4', 'video/mp4'],
  ['ogv', 'video/ogg'],
  ['webm', 'video/webm'],
]);

const yamlExtensions = new Set([
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
]);

const jsonExtensions = new Set(['json', 'asmdef', 'asmref', 'inputactions', 'shadergraph', 'shadersubgraph']);
const xmlExtensions = new Set(['xml', 'uxml']);
const cssExtensions = new Set(['css', 'uss', 'tss']);
const csharpExtensions = new Set(['cs']);
const shaderlabExtensions = new Set(['shader']);
const hlslExtensions = new Set(['hlsl', 'cginc', 'compute']);
const glslExtensions = new Set(['glsl']);
const typescriptExtensions = new Set(['ts', 'tsx']);
const javascriptExtensions = new Set(['js', 'jsx']);
const markdownExtensions = new Set(['md']);
const htmlExtensions = new Set(['html']);

const codeExtensions = new Set([
  ...csharpExtensions,
  ...typescriptExtensions,
  ...javascriptExtensions,
  ...shaderlabExtensions,
  ...hlslExtensions,
  ...glslExtensions,
  ...cssExtensions,
  ...jsonExtensions,
  ...xmlExtensions,
  ...htmlExtensions,
]);

const textExtensions = new Set([
  ...yamlExtensions,
  ...codeExtensions,
  ...markdownExtensions,
  'meta',
  'txt',
]);

export function getPathExtension(pathname: string): string {
  const fileName = pathname.split('/').pop() ?? pathname;
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return '';
  return fileName.slice(dotIndex + 1).toLowerCase();
}

export function getUnityFileCategory(pathname: string): UnityFileCategory {
  const extension = getPathExtension(pathname);
  if (extension === 'meta') return 'meta';
  if (imageMimeTypes.has(extension)) return 'image';
  if (audioMimeTypes.has(extension)) return 'audio';
  if (videoMimeTypes.has(extension)) return 'video';
  if (extension === 'pdf') return 'pdf';
  if (yamlExtensions.has(extension)) return 'unity-yaml';
  if (codeExtensions.has(extension)) return 'code';
  if (extension === 'md' || extension === 'txt') return 'document';
  return 'binary';
}

export function getMimeTypeForPath(pathname: string): string {
  const extension = getPathExtension(pathname);
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'json') return 'application/json';
  if (extension === 'md') return 'text/markdown';
  if (imageMimeTypes.has(extension)) return imageMimeTypes.get(extension)!;
  if (audioMimeTypes.has(extension)) return audioMimeTypes.get(extension)!;
  if (videoMimeTypes.has(extension)) return videoMimeTypes.get(extension)!;
  if (textExtensions.has(extension)) return 'text/plain;charset=utf-8';
  return 'application/octet-stream';
}

export function getPreviewKindForPath(pathname: string, bytes?: Uint8Array): PreviewKind {
  const extension = getPathExtension(pathname);
  if (extension === 'pdf') return 'pdf';
  if (imageMimeTypes.has(extension)) return 'image';
  if (audioMimeTypes.has(extension)) return 'audio';
  if (videoMimeTypes.has(extension)) return 'video';
  if (textExtensions.has(extension) || isLikelyUtf8Text(bytes)) return 'text';
  return 'unsupported';
}

export function getSyntaxLanguageForPath(pathname: string): SyntaxLanguage {
  const extension = getPathExtension(pathname);
  if (extension === 'meta' || yamlExtensions.has(extension)) return 'yaml';
  if (jsonExtensions.has(extension)) return 'json';
  if (xmlExtensions.has(extension)) return 'xml';
  if (cssExtensions.has(extension)) return 'css';
  if (csharpExtensions.has(extension)) return 'csharp';
  if (shaderlabExtensions.has(extension)) return 'shaderlab';
  if (hlslExtensions.has(extension)) return 'hlsl';
  if (glslExtensions.has(extension)) return 'glsl';
  if (typescriptExtensions.has(extension)) return 'typescript';
  if (javascriptExtensions.has(extension)) return 'javascript';
  if (markdownExtensions.has(extension)) return 'markdown';
  if (htmlExtensions.has(extension)) return 'html';
  return 'text';
}

function isLikelyUtf8Text(bytes?: Uint8Array): boolean {
  if (!bytes || bytes.byteLength === 0) return false;
  const sample = bytes.slice(0, Math.min(bytes.byteLength, 512));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.byteLength < 0.08;
}
