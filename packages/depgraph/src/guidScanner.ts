import { isUnityYamlBinary, isValidGuid } from 'unitypackage-core';
import type { ScanResult } from './types.js';

export interface ScanOptions {
  skipBuiltin?: boolean;
  skipBinaryYaml?: boolean;
}

export const PPTR_REF_PATTERN = /\{fileID:\s*\d+\s*,\s*guid:\s*([0-9a-fA-F]{32})\s*,\s*type:\s*\d+\s*\}/g;

const BUILT_IN_GUIDS = new Set([
  '0000000000000000e000000000000000',
  '0000000000000000f000000000000000',
]);

const NO_REFERENCE = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.apng', '.avif', '.webp', '.svg', '.tga', '.tif', '.tiff', '.exr', '.hdr', '.psd', '.pict', '.iff',
  '.aac', '.flac', '.m4a', '.mp3', '.ogg', '.wav', '.webm', '.aif', '.aiff', '.it', '.mod', '.s3m', '.xm',
  '.m4v', '.mov', '.mp4', '.ogv', '.asf', '.avi', '.flv', '.mpeg', '.mpg', '.wmv',
  '.cs', '.ts', '.js', '.shader', '.hlsl', '.cginc', '.compute', '.glsl', '.raytrace',
  '.json', '.asmdef', '.asmref', '.inputactions',
  '.css', '.uss', '.xml', '.uxml', '.html', '.md', '.txt',
  '.fbx', '.obj', '.blend', '.dae', '.3ds', '.c4d', '.ma', '.max', '.mb', '.ply', '.stl',
  '.ttf', '.otf', '.dll', '.pdb', '.so', '.a', '.exe', '.apk',
  '.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.unitypackage', '.bundle',
  '.cubemap', '.pdf', '.index',
]);

export { BUILT_IN_GUIDS, NO_REFERENCE };

export function scanGuids(
  content: string,
  filename?: string,
  options?: ScanOptions,
): ScanResult {
  const {
    skipBuiltin = true,
    skipBinaryYaml = true,
  } = options ?? {};

  if (filename) {
    const dot = filename.lastIndexOf('.');
    if (dot !== -1) {
      const ext = filename.slice(dot);
      if (NO_REFERENCE.has(ext)) {
        return { fileGuid: null, references: new Set(), skipped: true, skipReason: 'extension' };
      }
    }
  }

  if (skipBinaryYaml && content.startsWith('%YAML')) {
    const bytes = new TextEncoder().encode(content);
    if (isUnityYamlBinary(bytes)) {
      return { fileGuid: null, references: new Set(), skipped: true, skipReason: 'binary-yaml' };
    }
  }

  const references = new Set<string>();
  PPTR_REF_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PPTR_REF_PATTERN.exec(content)) !== null) {
    const guid = match[1];
    if (isValidGuid(guid)) {
      references.add(guid);
    }
  }

  if (skipBuiltin) {
    for (const guid of BUILT_IN_GUIDS) {
      references.delete(guid);
    }
  }

  return { fileGuid: null, references, skipped: false };
}
