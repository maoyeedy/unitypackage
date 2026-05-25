import { gzipSync, gunzipSync } from 'fflate';

export type ExtractedFileContent = Record<string, Uint8Array>;

export interface UnityPackageEntry {
  guid: string;
  pathname: string;
  asset?: Uint8Array;
  meta?: Uint8Array;
  preview?: Uint8Array;
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

export type CreateUnityPackageDiagnosticCode =
  | 'duplicate-guid'
  | 'missing-meta'
  | 'oversized-pathname'
  | 'empty-entries'
  | 'invalid-guid';

export interface CreateUnityPackageDiagnostic {
  code: CreateUnityPackageDiagnosticCode;
  message: string;
  guid?: string;
  path?: string;
}

export type UnityPackageParseDiagnosticCode =
  | 'asset-missing'
  | 'duplicate-guid'
  | 'empty-pathname'
  | 'ignored-preview'
  | 'malformed-tar-entry'
  | 'meta-missing'
  | 'non-standard-guid'
  | 'oversized-entry-name'
  | 'zero-byte-asset';

export interface UnityPackageParseDiagnostic {
  code: UnityPackageParseDiagnosticCode;
  message: string;
  path?: string;
  guid?: string;
}

export type UnityPackageEntriesResult = UnityPackageEntry[] & {
  diagnostics: UnityPackageParseDiagnostic[];
};

const BLOCK_SIZE = 512;
const UNITY_GUID_PATTERN = /^[0-9a-fA-F]{32}$/;
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

export function parseUnityPackageEntries(data: Uint8Array): UnityPackageEntriesResult {
  const diagnostics: UnityPackageParseDiagnostic[] = [];
  const decompressed = gunzipSync(data);
  const tarFiles = parseTar(decompressed, diagnostics);
  const entries = mapUnityEntries(tarFiles, diagnostics) as UnityPackageEntriesResult;
  Object.defineProperty(entries, 'diagnostics', {
    value: diagnostics,
    enumerable: false,
  });
  return entries;
}

export function estimateUnityPackageSize(
  entries: CreateUnityPackageEntry[],
): { tarBytes: number; entryCount: number } {
  let tarBytes = 0;
  let entryCount = 0;

  for (const entry of entries) {
    // pathname member is always written
    const pathnameBodyBytes = textEncoder.encode(entry.pathname).length;
    tarBytes += BLOCK_SIZE + Math.ceil(pathnameBodyBytes / BLOCK_SIZE) * BLOCK_SIZE;
    entryCount += 1;

    // asset.meta member is always written
    tarBytes += BLOCK_SIZE + Math.ceil(entry.meta.length / BLOCK_SIZE) * BLOCK_SIZE;
    entryCount += 1;

    // asset member is optional
    if (entry.asset) {
      tarBytes += BLOCK_SIZE + Math.ceil(entry.asset.length / BLOCK_SIZE) * BLOCK_SIZE;
      entryCount += 1;
    }
  }

  // two trailing end-of-archive zero blocks
  tarBytes += BLOCK_SIZE * 2;

  return { tarBytes, entryCount };
}

const VALID_GUID_PATTERN = /^[0-9a-fA-F]{32}$/;
const TAR_NAME_LIMIT = 100;

export function tryCreateUnityPackage(
  entries: CreateUnityPackageEntry[],
  options?: CreateUnityPackageOptions,
): { bytes: Uint8Array; diagnostics: CreateUnityPackageDiagnostic[] } | { bytes: null; diagnostics: CreateUnityPackageDiagnostic[] } {
  const diagnostics: CreateUnityPackageDiagnostic[] = [];

  // empty-entries
  if (entries.length === 0) {
    diagnostics.push({
      code: 'empty-entries',
      message: 'Package must contain at least one entry.',
    });
    return { bytes: null, diagnostics };
  }

  const seenGuids = new Set<string>();

  for (const entry of entries) {
    const { guid, pathname } = entry;

    // invalid-guid: not exactly 32 hex characters (case-insensitive)
    if (!VALID_GUID_PATTERN.test(guid)) {
      diagnostics.push({
        code: 'invalid-guid',
        message: `GUID is not exactly 32 hexadecimal characters: ${guid}`,
        guid,
      });
    }

    // duplicate-guid
    if (seenGuids.has(guid)) {
      diagnostics.push({
        code: 'duplicate-guid',
        message: `Duplicate GUID in package entries: ${guid}`,
        guid,
      });
    } else {
      seenGuids.add(guid);
    }

    // missing-meta: meta is absent or empty
    if (!entry.meta || entry.meta.byteLength === 0) {
      diagnostics.push({
        code: 'missing-meta',
        message: `Entry is missing a meta file: ${pathname}`,
        guid,
        path: pathname,
      });
    }

    // oversized-pathname (200-char pathname body limit)
    if (pathname.length > 200) {
      diagnostics.push({
        code: 'oversized-pathname',
        message: `Pathname exceeds 200 characters (${pathname.length}): ${pathname}`,
        guid,
        path: pathname,
      });
    }

    // oversized-pathname (ustar 100-byte tar entry name limit)
    const tarNames = [
      `${guid}/pathname`,
      `${guid}/asset.meta`,
      ...(entry.asset ? [`${guid}/asset`] : []),
    ];
    for (const tarName of tarNames) {
      if (textEncoder.encode(tarName).length > TAR_NAME_LIMIT) {
        diagnostics.push({
          code: 'oversized-pathname',
          message: `Tar entry name is too long: ${tarName}`,
          guid,
          path: tarName,
        });
      }
    }
  }

  if (diagnostics.length > 0) {
    return { bytes: null, diagnostics };
  }

  // Build the tar archive
  const tarEntries: Uint8Array[] = [];

  // Sort by GUID ascending for reproducible output
  const sorted = entries.slice().sort((a, b) => (a.guid < b.guid ? -1 : a.guid > b.guid ? 1 : 0));

  for (const entry of sorted) {
    tarEntries.push(createTarEntry(`${entry.guid}/pathname`, textEncoder.encode(entry.pathname)));
    tarEntries.push(createTarEntry(`${entry.guid}/asset.meta`, entry.meta));

    if (entry.asset) {
      tarEntries.push(createTarEntry(`${entry.guid}/asset`, entry.asset));
    }
  }

  tarEntries.push(new Uint8Array(BLOCK_SIZE * 2));
  const tar = concatUint8Arrays(tarEntries);
  // mtime: 0 makes the gzip header timestamp deterministic
  const bytes = gzipSync(tar, { level: (options?.gzipLevel ?? 6), mtime: 0 });
  return { bytes, diagnostics: [] };
}

export function createUnityPackage(entries: CreateUnityPackageEntry[], options: CreateUnityPackageOptions = {}): Uint8Array {
  const result = tryCreateUnityPackage(entries, options);
  if (result.bytes === null) {
    throw new Error(result.diagnostics[0].message);
  }
  return result.bytes;
}

function parseTar(data: Uint8Array, diagnostics: UnityPackageParseDiagnostic[]): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  let offset = 0;

  while (offset + BLOCK_SIZE <= data.length) {
    const header = data.slice(offset, offset + BLOCK_SIZE);

    if (header.every(b => b === 0)) break;

    const name = textDecoder.decode(header.slice(0, 100)).replace(/\0/g, '').trim();
    if (!name) {
      diagnostics.push({
        code: 'malformed-tar-entry',
        message: 'Skipped tar entry with an empty name.',
      });
      offset += BLOCK_SIZE;
      continue;
    }

    const sizeStr = textDecoder.decode(header.slice(124, 136)).replace(/\0/g, '').trim();
    const size = parseInt(sizeStr, 8);
    if (Number.isNaN(size)) {
      diagnostics.push({
        code: 'malformed-tar-entry',
        message: 'Skipped tar entry with an invalid size field.',
        path: name,
      });
      offset += BLOCK_SIZE;
      continue;
    }

    offset += BLOCK_SIZE;

    if (offset + size <= data.length && !name.endsWith('/')) {
      if (name.endsWith('/pathname') && name in files) {
        const guid = name.slice(0, -'/pathname'.length);
        diagnostics.push({
          code: 'duplicate-guid',
          message: 'GUID appears more than once in the archive.',
          path: name,
          guid,
        });
      } else {
        files[name] = data.slice(offset, offset + size);
      }
    } else if (offset + size > data.length) {
      diagnostics.push({
        code: 'malformed-tar-entry',
        message: 'Skipped tar entry whose content extends beyond the archive.',
        path: name,
      });
    }

    offset += Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }

  return files;
}

function mapUnityEntries(files: Record<string, Uint8Array>, diagnostics: UnityPackageParseDiagnostic[]): UnityPackageEntry[] {
  const result: UnityPackageEntry[] = [];

  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/');
    if (parts.length < 2) continue;

    const filename = parts.pop();
    const guid = parts.join('/');

    if (filename !== 'pathname') continue;

    try {

      const pathname = textDecoder.decode(content).split('\n')[0].trim();
      if (!pathname) {
        diagnostics.push({
          code: 'empty-pathname',
          message: 'Skipped record with an empty pathname.',
          path,
          guid,
        });
        continue;
      }

      if (!UNITY_GUID_PATTERN.test(guid)) {
        diagnostics.push({
          code: 'non-standard-guid',
          message: 'Record prefix is not a 32-character hexadecimal GUID.',
          path,
          guid,
        });
      }

      if (pathname.length > 200) {
        diagnostics.push({
          code: 'oversized-entry-name',
          message: `Pathname exceeds 200 characters (${pathname.length}).`,
          path,
          guid,
        });
      }

      const asset = files[`${guid}/asset`];
      const meta = files[`${guid}/asset.meta`] ?? files[`${guid}/metaData`];
      const preview = files[`${guid}/preview.png`];

      if (preview) {
        diagnostics.push({
          code: 'ignored-preview',
          message: 'preview.png is exposed on entries and ignored by flat parsing.',
          path: `${guid}/preview.png`,
          guid,
        });
      }

      if (asset === undefined) {
        if (meta !== undefined) {
          diagnostics.push({
            code: 'asset-missing',
            message: 'Entry has a pathname and meta but no asset file.',
            path: `${guid}/asset`,
            guid,
          });
        }
      } else if (asset.byteLength === 0) {
        diagnostics.push({
          code: 'zero-byte-asset',
          message: 'Asset file is present but has zero bytes.',
          path: `${guid}/asset`,
          guid,
        });
      }

      if (meta === undefined && asset !== undefined) {
        diagnostics.push({
          code: 'meta-missing',
          message: 'Entry has a pathname and asset but no asset.meta or metaData file.',
          path: `${guid}/asset.meta`,
          guid,
        });
      }

      result.push({ guid, pathname, asset, meta, preview });
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
