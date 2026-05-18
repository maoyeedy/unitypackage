import { gzipSync, gunzipSync } from 'fflate';

export type ExtractedFileContent = Record<string, Uint8Array>;

export interface UnityPackageEntry {
  guid: string;
  pathname: string;
  asset?: Uint8Array;
  meta?: Uint8Array;
}

export interface CreateUnityPackageEntry {
  guid: string;
  pathname: string;
  meta: Uint8Array;
  asset?: Uint8Array;
}

export interface CreateUnityPackageOptions {
  gzipLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

const BLOCK_SIZE = 512;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function parseUnityPackage(data: Uint8Array): ExtractedFileContent {
  const result: ExtractedFileContent = {};

  for (const entry of parseUnityPackageEntries(data)) {
    if (entry.asset) {
      result[entry.pathname] = entry.asset;
    }

    if (entry.meta) {
      result[`${entry.pathname}.meta`] = entry.meta;
    }
  }

  return result;
}

export function parseUnityPackageEntries(data: Uint8Array): UnityPackageEntry[] {
  const decompressed = gunzipSync(data);
  const tarFiles = parseTar(decompressed);
  return mapUnityEntries(tarFiles);
}

export function createUnityPackage(entries: CreateUnityPackageEntry[], options: CreateUnityPackageOptions = {}): Uint8Array {
  const tarEntries: Uint8Array[] = [];

  for (const entry of entries) {
    tarEntries.push(createTarEntry(`${entry.guid}/pathname`, textEncoder.encode(entry.pathname)));
    tarEntries.push(createTarEntry(`${entry.guid}/asset.meta`, entry.meta));

    if (entry.asset) {
      tarEntries.push(createTarEntry(`${entry.guid}/asset`, entry.asset));
    }
  }

  tarEntries.push(new Uint8Array(BLOCK_SIZE * 2));
  const tar = concatUint8Arrays(tarEntries);
  return gzipSync(tar, { level: options.gzipLevel ?? 6 });
}

function parseTar(data: Uint8Array): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  let offset = 0;

  while (offset + BLOCK_SIZE <= data.length) {
    const header = data.slice(offset, offset + BLOCK_SIZE);

    if (header.every(b => b === 0)) break;

    const name = textDecoder.decode(header.slice(0, 100)).replace(/\0/g, '').trim();
    if (!name) {
      offset += BLOCK_SIZE;
      continue;
    }

    const sizeStr = textDecoder.decode(header.slice(124, 136)).replace(/\0/g, '').trim();
    const size = parseInt(sizeStr, 8);
    if (Number.isNaN(size)) {
      offset += BLOCK_SIZE;
      continue;
    }

    offset += BLOCK_SIZE;

    if (offset + size <= data.length && !name.endsWith('/')) {
      files[name] = data.slice(offset, offset + size);
    }

    offset += Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }

  return files;
}

function mapUnityEntries(files: Record<string, Uint8Array>): UnityPackageEntry[] {
  const result: UnityPackageEntry[] = [];

  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/');
    if (parts.length < 2) continue;

    const filename = parts.pop();
    const guid = parts.join('/');

    if (filename !== 'pathname') continue;

    try {
      const pathname = textDecoder.decode(content).split('\n')[0].trim();
      if (!pathname) continue;

      const asset = files[`${guid}/asset`];
      const meta = files[`${guid}/asset.meta`] ?? files[`${guid}/metaData`];

      result.push({ guid, pathname, asset, meta });
    } catch {
      continue;
    }
  }

  return result;
}

function createTarEntry(name: string, content: Uint8Array): Uint8Array {
  const header = new Uint8Array(BLOCK_SIZE);
  const nameBytes = textEncoder.encode(name);

  if (nameBytes.length > 100) {
    throw new Error(`Tar entry name is too long: ${name}`);
  }

  header.set(nameBytes, 0);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, content.length);
  writeOctal(header, 136, 12, 0);

  for (let i = 148; i < 156; i += 1) {
    header[i] = 0x20;
  }

  header[156] = 0x30;
  header.set(textEncoder.encode('ustar\0'), 257);
  header.set(textEncoder.encode('00'), 263);

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumString = checksum.toString(8).padStart(6, '0') + '\0 ';
  header.set(textEncoder.encode(checksumString), 148);

  const paddedSize = Math.ceil(content.length / BLOCK_SIZE) * BLOCK_SIZE;
  const entry = new Uint8Array(BLOCK_SIZE + paddedSize);
  entry.set(header, 0);
  entry.set(content, BLOCK_SIZE);
  return entry;
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  const valueString = value.toString(8).padStart(length - 1, '0') + '\0';
  target.set(textEncoder.encode(valueString), offset);
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}
