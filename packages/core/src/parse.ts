import { Gunzip } from 'fflate';
import type { ExtractedFileContent, UnityPackageDiagnosticSeverity, UnityPackageEntry } from './model';
import { BLOCK_SIZE, concatUint8Arrays, textDecoder } from './tar';

export type UnityPackageParseDiagnosticCode =
  | 'asset-missing'
  | 'duplicate-guid'
  | 'empty-pathname'
  | 'entries-outside-guid-directory'
  | 'ignored-preview'
  | 'invalid-tar-checksum'
  | 'malformed-tar-entry'
  | 'meta-missing'
  | 'non-standard-guid'
  | 'oversized-entry-name'
  | 'unexpected-guid-directory-file'
  | 'unsupported-tar-typeflag'
  | 'zero-byte-asset';

export interface UnityPackageParseDiagnostic {
  code: UnityPackageParseDiagnosticCode;
  message: string;
  severity: UnityPackageDiagnosticSeverity;
  path?: string;
  guid?: string;
}


/** Default maximum total decompressed output bytes across all entries (4 GiB). */
export const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024 * 1024;

/** Default maximum number of parsed GUID entries. */
export const DEFAULT_MAX_ENTRIES = 250_000;

/**
 * Thrown when a parse operation exceeds a configured decompression-bomb guard.
 *
 * ### `observed` semantics
 * `observed` is the **cumulative total after the offending entry or chunk was
 * processed**, so `observed > limit` is always true; `observed === limit` never
 * triggers the guard.
 *
 * ### `kind` values
 * - `'output-bytes'` -- the guard fired on raw decompressed size.
 *   `observed` is the total decompressed byte count accumulated up to and
 *   including the chunk that pushed it past the limit
 *   (set via {@link ParseUnityPackageOptions.maxOutputBytes};
 *   default {@link DEFAULT_MAX_OUTPUT_BYTES}).
 * - `'entry-count'` -- the guard fired on the number of GUID entries.
 *   `observed` is the entry count at the point the limit was exceeded
 *   (set via {@link ParseUnityPackageOptions.maxEntries};
 *   default {@link DEFAULT_MAX_ENTRIES}).
 */
export class DecompressionBombError extends Error {
  readonly kind: 'output-bytes' | 'entry-count';
  readonly observed: number;

  constructor(kind: 'output-bytes' | 'entry-count', observed: number) {
    const label = kind === 'output-bytes'
      ? `decompressed output size ${observed} bytes`
      : `entry count ${observed}`;
    super(`Decompression bomb guard triggered: ${label} exceeds the configured limit`);
    this.name = 'DecompressionBombError';
    this.kind = kind;
    this.observed = observed;
  }
}

export interface ParseUnityPackageOptions {
  /** Maximum total decompressed bytes across all entries. Default: {@link DEFAULT_MAX_OUTPUT_BYTES} (4 GiB). */
  maxOutputBytes?: number;
  /** Maximum number of parsed GUID entries. Default: {@link DEFAULT_MAX_ENTRIES} (250 000). */
  maxEntries?: number;
}

export interface StreamParseProgressEvent {
  /** Decompressed bytes consumed so far in the tar stream. */
  bytesRead: number;
  /** Total decompressed tar bytes, when known. */
  bytesTotal: number;
  /** Number of fully emitted GUID entries so far. */
  entryCount: number;
}

export interface StreamParseOptions extends ParseUnityPackageOptions {
  onProgress?: (event: StreamParseProgressEvent) => void;
}

export type StreamParseItemKind = 'entry' | 'diagnostic';
export type StreamedEntry = UnityPackageEntry & { _kind: 'entry' };
export type StreamedDiagnostic = UnityPackageParseDiagnostic & { _kind: 'diagnostic' };

const UNITY_GUID_PATTERN = /^[0-9a-fA-F]{32}$/;
const EXPECTED_GUID_FILES = new Set(['pathname', 'asset', 'asset.meta', 'metaData', 'preview.png']);
interface TarMember {
  name: string;
  content: Uint8Array;
}

export function parseUnityPackage(
  data: Uint8Array,
  options?: ParseUnityPackageOptions,
): ExtractedFileContent {
  const result: ExtractedFileContent = {};
  const { entries } = parseUnityPackageEntries(data, options);

  for (const entry of entries) {
    if (entry.asset) result[entry.pathname] = entry.asset;
    if (entry.meta) result[`${entry.pathname}.meta`] = entry.meta;
  }

  return result;
}

export function parseUnityPackageEntries(
  data: Uint8Array,
  options?: ParseUnityPackageOptions,
): { entries: UnityPackageEntry[]; diagnostics: UnityPackageParseDiagnostic[] } {
  const maxOutputBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const decompressed = gunzipBounded(data, maxOutputBytes);
  return parseUnityPackageTar(decompressed, options);
}

export function* parseUnityPackageStream(
  bytes: Uint8Array,
  options?: StreamParseOptions,
): Generator<StreamedEntry | StreamedDiagnostic> {
  const maxOutputBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const decompressed = gunzipBounded(bytes, maxOutputBytes);
  const { entries, diagnostics } = parseUnityPackageTar(decompressed, options);

  for (const diagnostic of diagnostics) {
    yield { ...diagnostic, _kind: 'diagnostic' };
  }

  let entryCount = 0;
  let lastProgressMs = -Infinity;
  for (const entry of entries) {
    yield { ...entry, _kind: 'entry' };
    entryCount += 1;
    if (options?.onProgress !== undefined) {
      const now = Date.now();
      if (now - lastProgressMs >= 16) {
        lastProgressMs = now;
        options.onProgress({ bytesRead: decompressed.byteLength, bytesTotal: decompressed.byteLength, entryCount });
      }
    }
  }

  if (options?.onProgress !== undefined) {
    options.onProgress({ bytesRead: decompressed.byteLength, bytesTotal: decompressed.byteLength, entryCount });
  }
}

export function parseUnityPackageStreamed(
  data: Uint8Array,
  options?: ParseUnityPackageOptions & { chunkSize?: number },
): { entries: UnityPackageEntry[]; diagnostics: UnityPackageParseDiagnostic[] } {
  const maxOutputBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const chunkSize = options?.chunkSize ?? 64 * 1024;
  const decompressed = gunzipBounded(data, maxOutputBytes, chunkSize);
  return parseUnityPackageTar(decompressed, options);
}

/**
 * Decompresses a gzip-compressed buffer in chunks, throwing
 * {@link DecompressionBombError} the moment the running decompressed total
 * exceeds `maxOutputBytes`.  All three sync/generator entry points call this
 * so the guard fires before any tar work runs.
 */
function gunzipBounded(
  data: Uint8Array,
  maxOutputBytes: number,
  chunkSize = 256 * 1024,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let thrown: unknown;

  const ondata = ((...args: unknown[]) => {
    const err = args.length === 3 ? args[0] : null;
    const chunk = (args.length === 3 ? args[1] : args[0]) as Uint8Array | undefined;
    if (err) {
      thrown = err;
      return;
    }
    if (chunk === undefined) return;
    totalBytes += chunk.byteLength;
    if (totalBytes > maxOutputBytes) {
      thrown = new DecompressionBombError('output-bytes', totalBytes);
      return;
    }
    chunks.push(chunk);
  }) as never;

  const gunzip = new Gunzip(ondata);
  for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
    if (thrown !== undefined) break;
    gunzip.push(
      data.subarray(offset, Math.min(data.byteLength, offset + chunkSize)),
      offset + chunkSize >= data.byteLength,
    );
  }

  if (thrown !== undefined) {
    throw thrown instanceof Error ? thrown : new Error('Gunzip failed with a non-Error value.');
  }
  return concatUint8Arrays(chunks);
}

function parseUnityPackageTar(
  tar: Uint8Array,
  options?: ParseUnityPackageOptions,
): { entries: UnityPackageEntry[]; diagnostics: UnityPackageParseDiagnostic[] } {
  const diagnostics: UnityPackageParseDiagnostic[] = [];
  const members = readTarMembers(tar, diagnostics);
  const entries = mapUnityEntries(members, diagnostics, options);
  return { entries, diagnostics };
}

function readTarMembers(data: Uint8Array, diagnostics: UnityPackageParseDiagnostic[]): TarMember[] {
  const members: TarMember[] = [];
  let offset = 0;

  while (offset + BLOCK_SIZE <= data.length) {
    const header = data.subarray(offset, offset + BLOCK_SIZE);
    if (header.every(byte => byte === 0)) break;

    const name = readTarString(header, 0, 100);
    if (!name) {
      diagnostics.push({
        code: 'malformed-tar-entry',
        message: 'Skipped tar entry with an empty name.',
        severity: 'error',
      });
      offset += BLOCK_SIZE;
      continue;
    }

    const size = readTarOctal(header, 124, 12);
    if (size === null) {
      diagnostics.push({
        code: 'malformed-tar-entry',
        message: 'Skipped tar entry with an invalid size field.',
        severity: 'error',
        path: name,
      });
      offset += BLOCK_SIZE;
      continue;
    }

    if (!isTarChecksumValid(header)) {
      diagnostics.push({
        code: 'invalid-tar-checksum',
        message: 'Tar entry checksum does not match its header.',
        severity: 'warning',
        path: name,
      });
    }

    const typeflag = header[156];
    if (typeflag !== 0 && typeflag !== 0x30) {
      diagnostics.push({
        code: 'unsupported-tar-typeflag',
        message: `Skipped tar entry with unsupported typeflag ${String.fromCharCode(typeflag)}.`,
        severity: 'warning',
        path: name,
      });
      offset += BLOCK_SIZE + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
      continue;
    }

    offset += BLOCK_SIZE;
    if (offset + size > data.length) {
      diagnostics.push({
        code: 'malformed-tar-entry',
        message: 'Skipped tar entry whose content extends beyond the archive.',
        severity: 'error',
        path: name,
      });
      break;
    }

    if (!name.endsWith('/')) {
      validateTarMemberName(name, diagnostics);
      members.push({ name, content: data.slice(offset, offset + size) });
    }

    offset += Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }

  return members;
}

function mapUnityEntries(
  members: TarMember[],
  diagnostics: UnityPackageParseDiagnostic[],
  options?: ParseUnityPackageOptions,
): UnityPackageEntry[] {
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const groups = new Map<string, Map<string, Uint8Array>>();

  for (const member of members) {
    const slashIndex = member.name.indexOf('/');
    if (slashIndex === -1) continue;

    const guid = member.name.slice(0, slashIndex);
    const filename = member.name.slice(slashIndex + 1);
    let files = groups.get(guid);
    if (files === undefined) {
      files = new Map();
      groups.set(guid, files);
    }

    if (filename === 'pathname' && files.has(filename)) {
      diagnostics.push({
        code: 'duplicate-guid',
        message: 'GUID appears more than once in the archive.',
        severity: 'error',
        path: member.name,
        guid,
      });
      continue;
    }

    if (!files.has(filename)) files.set(filename, member.content);
  }

  const entries: UnityPackageEntry[] = [];

  for (const [guid, files] of groups) {
    const pathnameBuf = files.get('pathname');
    if (pathnameBuf === undefined) continue;

    const pathname = textDecoder.decode(pathnameBuf).split('\n')[0].trim();
    if (!pathname) {
      diagnostics.push({
        code: 'empty-pathname',
        message: 'Skipped record with an empty pathname.',
        severity: 'error',
        path: `${guid}/pathname`,
        guid,
      });
      continue;
    }

    if (!UNITY_GUID_PATTERN.test(guid)) {
      diagnostics.push({
        code: 'non-standard-guid',
        message: 'Record prefix is not a 32-character hexadecimal GUID.',
        severity: 'info',
        path: `${guid}/pathname`,
        guid,
      });
    }

    if (pathname.length > 200) {
      diagnostics.push({
        code: 'oversized-entry-name',
        message: `Pathname exceeds 200 characters (${pathname.length}).`,
        severity: 'warning',
        path: `${guid}/pathname`,
        guid,
      });
    }

    const asset = files.get('asset');
    const meta = files.get('asset.meta') ?? files.get('metaData');
    const preview = files.get('preview.png');

    if (preview !== undefined) {
      diagnostics.push({
        code: 'ignored-preview',
        message: 'preview.png is exposed on entries and ignored by flat parsing.',
        severity: 'info',
        path: `${guid}/preview.png`,
        guid,
      });
    }

    if (asset === undefined) {
      if (meta !== undefined) {
        diagnostics.push({
          code: 'asset-missing',
          message: 'Entry has a pathname and meta but no asset file.',
          severity: 'warning',
          path: `${guid}/asset`,
          guid,
        });
      }
    } else if (asset.byteLength === 0) {
      diagnostics.push({
        code: 'zero-byte-asset',
        message: 'Asset file is present but has zero bytes.',
        severity: 'warning',
        path: `${guid}/asset`,
        guid,
      });
    }

    if (meta === undefined && asset !== undefined) {
      diagnostics.push({
        code: 'meta-missing',
        message: 'Entry has a pathname and asset but no asset.meta or metaData file.',
        severity: 'warning',
        path: `${guid}/asset.meta`,
        guid,
      });
    }

    entries.push({ guid, pathname, asset, meta, preview });
    if (entries.length > maxEntries) {
      throw new DecompressionBombError('entry-count', entries.length);
    }
  }

  return entries;
}

function validateTarMemberName(name: string, diagnostics: UnityPackageParseDiagnostic[]): void {
  const parts = name.split('/');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    diagnostics.push({
      code: 'entries-outside-guid-directory',
      message: 'Tar entry is not inside a single GUID directory.',
      severity: 'warning',
      path: name,
    });
    return;
  }

  if (!EXPECTED_GUID_FILES.has(parts[1])) {
    diagnostics.push({
      code: 'unexpected-guid-directory-file',
      message: 'Tar entry inside a GUID directory is not a recognized Unity package member.',
      severity: 'warning',
      path: name,
      guid: parts[0],
    });
  }
}

function readTarString(header: Uint8Array, offset: number, length: number): string {
  return textDecoder.decode(header.subarray(offset, offset + length)).replace(/\0/g, '').trim();
}

function readTarOctal(header: Uint8Array, offset: number, length: number): number | null {
  const value = readTarString(header, offset, length);
  if (!/^[0-7]+$/.test(value)) return null;
  return parseInt(value, 8);
}

function isTarChecksumValid(header: Uint8Array): boolean {
  const expected = readTarOctal(header, 148, 8);
  if (expected === null) return false;

  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }

  return actual === expected;
}
