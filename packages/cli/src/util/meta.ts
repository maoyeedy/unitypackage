import crypto from 'node:crypto';
import YAML from 'yaml';

export interface Meta {
  fileFormatVersion: 2;
  guid: string;
  folderAsset?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export function createGuid(input: string): string {
  const inputBytes = Buffer.from(input, 'utf16le');
  return crypto.createHash('md5').update(inputBytes).digest('hex').toUpperCase();
}

export function parseMeta(content: string): Meta | null {
  try {
    const parsed = YAML.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.guid !== 'string') return null;
    return obj as unknown as Meta;
  } catch {
    return null;
  }
}

export function generateMeta(pathInPackage: string, isDirectory: boolean): Meta {
  return {
    fileFormatVersion: 2,
    guid: createGuid(pathInPackage),
    ...(isDirectory && { folderAsset: true }),
  };
}

export function serializeMeta(meta: Meta): Uint8Array {
  return new TextEncoder().encode(YAML.stringify(meta));
}
