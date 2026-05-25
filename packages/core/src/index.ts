import { gzipSync, gunzipSync } from 'fflate';

export type ExtractedFileContent = Record<string, Uint8Array>;

// ---------------------------------------------------------------------------
// GUID utilities
// ---------------------------------------------------------------------------

const VALID_GUID_LOWERCASE_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Returns true when value is exactly 32 lowercase hexadecimal characters.
 * Unity Editor exports use lowercase 32-hex GUIDs; the parser preserves
 * whatever prefix appears in the archive as `guid`.
 */
export function isValidGuid(value: string): boolean {
  return VALID_GUID_LOWERCASE_PATTERN.test(value);
}

/**
 * Generates a random 32-character lowercase hex GUID using
 * `globalThis.crypto.getRandomValues`. Browser-safe; no `node:crypto` import.
 */
export function generateGuid(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

// ---------------------------------------------------------------------------
// MD5 implementation (browser-safe, no external deps)
// Used by guidFromPath to match the CLI's createGuid algorithm.
// ---------------------------------------------------------------------------

function md5(data: Uint8Array): Uint8Array {
  // Pre-computed sine-derived constants (floor(abs(sin(i+1))) * 2^32)
  const T = new Uint32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ]);

  // Bit shift amounts per round
  const S = new Uint8Array([
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]);

  // Pad message: append 0x80, then zeros, then 64-bit little-endian bit length
  const bitLen = data.length * 8;
  const padLen = ((55 - data.length) % 64 + 64) % 64 + 1;
  const msg = new Uint8Array(data.length + padLen + 8);
  msg.set(data);
  msg[data.length] = 0x80;
  // Write bit length as 64-bit LE (we only support lengths < 2^32 bits)
  const view = new DataView(msg.buffer, msg.byteOffset);
  view.setUint32(data.length + padLen, bitLen >>> 0, true);
  view.setUint32(data.length + padLen + 4, Math.floor(bitLen / 0x100000000), true);

  // Initial hash state
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const msgView = new DataView(msg.buffer, msg.byteOffset);

  for (let i = 0; i < msg.length; i += 64) {
    // Load 16 little-endian uint32 words from this chunk
    const M: number[] = [];
    for (let j = 0; j < 16; j += 1) {
      M.push(msgView.getUint32(i + j * 4, true));
    }

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let step = 0; step < 64; step += 1) {
      let F: number;
      let g: number;

      if (step < 16) {
        F = (B & C) | (~B & D);
        g = step;
      } else if (step < 32) {
        F = (D & B) | (~D & C);
        g = (5 * step + 1) % 16;
      } else if (step < 48) {
        F = B ^ C ^ D;
        g = (3 * step + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * step) % 16;
      }

      // Use >>> 0 to keep values as unsigned 32-bit
      F = ((F + A + T[step] + M[g]) >>> 0);
      const rot = S[step];
      A = D;
      D = C;
      C = B;
      B = ((B + ((F << rot) | (F >>> (32 - rot)))) >>> 0);
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  // Write digest as little-endian bytes
  const digest = new Uint8Array(16);
  const digestView = new DataView(digest.buffer);
  digestView.setUint32(0, a0, true);
  digestView.setUint32(4, b0, true);
  digestView.setUint32(8, c0, true);
  digestView.setUint32(12, d0, true);
  return digest;
}

/**
 * Derives a deterministic 32-character lowercase hex GUID from a pathname
 * using the MD5-of-UTF-16LE algorithm that the CLI's `createGuid` helper uses.
 * Two calls with the same input always produce identical output.
 */
export function guidFromPath(pathname: string): string {
  // Encode as UTF-16LE (little-endian), matching Buffer.from(s, 'utf16le')
  const utf16 = new Uint8Array(pathname.length * 2);
  for (let i = 0; i < pathname.length; i += 1) {
    const code = pathname.charCodeAt(i);
    utf16[i * 2] = code & 0xff;
    utf16[i * 2 + 1] = (code >> 8) & 0xff;
  }
  const digest = md5(utf16);
  let hex = '';
  for (const byte of digest) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

// ---------------------------------------------------------------------------
// Path safety helpers
// ---------------------------------------------------------------------------

export type PathnameRejectionReason =
  | 'empty'
  | 'absolute'
  | 'drive-or-unc'
  | 'parent-traversal'
  | 'backslash'
  | 'control-character'
  | 'oversized-tar-entry';

export interface PathnameValidationResult {
  ok: boolean;
  reason?: PathnameRejectionReason;
  detail?: string;
}

const _tarEntryNameEncoder = new TextEncoder();

/**
 * Validates a pathname against the rejection rules in the .unitypackage
 * format spec ("Extraction security" section). Returns a structured result;
 * never throws.
 *
 * When `options.guid` is supplied, also checks that the longest tar entry
 * name produced for this GUID + pathname -- `<guid>/asset.meta` -- does not
 * exceed the 100-byte ustar header limit (UTF-8). This matches the internal
 * check in `tryCreateUnityPackage`.
 */
export function validatePathname(
  pathname: string,
  options?: { guid?: string },
): PathnameValidationResult {
  // empty
  if (pathname.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  // control characters (codepoint < 0x20)
  for (let i = 0; i < pathname.length; i += 1) {
    if (pathname.charCodeAt(i) < 0x20) {
      return {
        ok: false,
        reason: 'control-character',
        detail: `Control character at index ${i} (U+${pathname.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase()})`,
      };
    }
  }

  // backslash
  if (pathname.includes('\\')) {
    return { ok: false, reason: 'backslash' };
  }

  // drive letter (e.g. "C:") or UNC prefix ("\\", already caught by backslash above,
  // but also handle forward-slash UNC-like "//")
  if (/^[A-Za-z]:/.test(pathname)) {
    return { ok: false, reason: 'drive-or-unc' };
  }

  if (pathname.startsWith('//')) {
    return { ok: false, reason: 'drive-or-unc' };
  }

  // absolute path (starts with /)
  if (pathname.startsWith('/')) {
    return { ok: false, reason: 'absolute' };
  }

  // parent traversal: any segment that is exactly ".."
  const segments = pathname.split('/');
  for (const segment of segments) {
    if (segment === '..') {
      return { ok: false, reason: 'parent-traversal' };
    }
  }

  // oversized tar entry: when guid is supplied, check that the longest tar entry
  // name (<guid>/asset.meta) fits in 100 bytes (UTF-8), matching tryCreateUnityPackage
  if (options?.guid !== undefined) {
    const worstCaseName = `${options.guid}/asset.meta`;
    const byteLength = _tarEntryNameEncoder.encode(worstCaseName).length;
    if (byteLength > 100) {
      return {
        ok: false,
        reason: 'oversized-tar-entry',
        detail: `${byteLength}`,
      };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Minimal meta YAML generator
// ---------------------------------------------------------------------------

/**
 * Returns a Unity-compatible minimal `.meta` YAML text for the given GUID.
 * Uses the `DefaultImporter` shape; the caller encodes to UTF-8 bytes when
 * persisting.
 *
 * Throws when `isValidGuid(guid)` is false -- the error message names the
 * offending value.
 *
 * Does not parse YAML; emits a literal template string. No `yaml` dep.
 * Browser-safe; no `node:*` imports.
 */
export function createMinimalMeta(guid: string): string {
  if (!isValidGuid(guid)) {
    throw new Error(`createMinimalMeta: invalid GUID "${guid}" -- must be exactly 32 lowercase hexadecimal characters`);
  }
  return `fileFormatVersion: 2\nguid: ${guid}\nDefaultImporter:\n  externalObjects: {}\n  userData:\n  assetBundleName:\n  assetBundleVariant:\n`;
}

export interface UnityPackageEntry {
  guid: string;
  pathname: string;
  asset?: Uint8Array;
  meta?: Uint8Array;
  preview?: Uint8Array;
}

// ---------------------------------------------------------------------------
// Pathname collision detection
// ---------------------------------------------------------------------------

export interface PathnameCollision {
  /** Canonical (first-seen casing) pathname. */
  pathname: string;
  /** Lower-cased pathname used for grouping. */
  caseFolded: string;
  /** GUIDs of all entries that collide. */
  guids: string[];
  /** True when at least two entries share the exact pathname bytes (not just case-folded equivalent). */
  exactDuplicates: boolean;
}

/**
 * Groups entries by case-folded pathname and returns only the groups that
 * contain more than one entry (i.e. collisions).
 *
 * `exactDuplicates` is true when at least two entries in a group share
 * identical pathname bytes. Folder records (no asset payload) are included
 * alongside files; the caller decides whether folder/file overlap counts.
 *
 * Pure function -- no `node:*` imports, browser-safe.
 */
export function detectPathnameCollisions(
  entries: Pick<UnityPackageEntry, 'guid' | 'pathname'>[],
): PathnameCollision[] {
  // Map from caseFolded -> { pathname (first-seen), guids, exactSet }
  const groups = new Map<string, { pathname: string; guids: string[]; exactSet: Set<string> }>();

  for (const entry of entries) {
    const caseFolded = entry.pathname.toLowerCase();
    const existing = groups.get(caseFolded);
    if (existing === undefined) {
      groups.set(caseFolded, {
        pathname: entry.pathname,
        guids: [entry.guid],
        exactSet: new Set([entry.pathname]),
      });
    } else {
      existing.guids.push(entry.guid);
      existing.exactSet.add(entry.pathname);
    }
  }

  const result: PathnameCollision[] = [];
  for (const [caseFolded, group] of groups) {
    if (group.guids.length > 1) {
      result.push({
        pathname: group.pathname,
        caseFolded,
        guids: group.guids,
        exactDuplicates: group.exactSet.size < group.guids.length,
      });
    }
  }
  return result;
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

export type UnityPackageDiagnosticSeverity = 'info' | 'warning' | 'error';

export type CreateUnityPackageDiagnosticCode =
  | 'duplicate-guid'
  | 'missing-meta'
  | 'oversized-pathname'
  | 'empty-entries'
  | 'invalid-guid';

export interface CreateUnityPackageDiagnostic {
  code: CreateUnityPackageDiagnosticCode;
  message: string;
  severity: UnityPackageDiagnosticSeverity;
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
  severity: UnityPackageDiagnosticSeverity;
  path?: string;
  guid?: string;
}

/** @deprecated Use the `{ entries, diagnostics }` return shape from `parseUnityPackageEntries` instead. */
export type UnityPackageEntriesResult = UnityPackageEntry[] & {
  diagnostics: UnityPackageParseDiagnostic[];
};

// ---------------------------------------------------------------------------
// Decompression bomb guard
// ---------------------------------------------------------------------------

/** Default maximum total decompressed output bytes across all entries (4 GiB). */
export const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024 * 1024;

/** Default maximum number of parsed GUID entries. */
export const DEFAULT_MAX_ENTRIES = 250_000;

/**
 * Thrown by `parseUnityPackageEntries` / `parseUnityPackage` when the archive
 * exceeds the configured `maxOutputBytes` or `maxEntries` limit.
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

// ---------------------------------------------------------------------------
// Parse options
// ---------------------------------------------------------------------------

export interface ParseUnityPackageOptions {
  /** Maximum total decompressed bytes across all entries. Default: {@link DEFAULT_MAX_OUTPUT_BYTES} (4 GiB). */
  maxOutputBytes?: number;
  /** Maximum number of parsed GUID entries. Default: {@link DEFAULT_MAX_ENTRIES} (250 000). */
  maxEntries?: number;
}

// ---------------------------------------------------------------------------
// Streaming parse types
// ---------------------------------------------------------------------------

export interface StreamParseProgressEvent {
  /** Decompressed bytes consumed so far in the tar stream. */
  bytesRead: number;
  /** Total decompressed tar bytes (always known after synchronous gzip decompression). */
  bytesTotal: number;
  /** Number of fully emitted GUID entries so far. */
  entryCount: number;
}

export interface StreamParseOptions extends ParseUnityPackageOptions {
  /**
   * Called after each completed GUID entry is emitted.
   * Rate-limited to no more than ~62 events per second (~16 ms minimum interval).
   * The callback is synchronous; do not return a Promise.
   */
  onProgress?: (event: StreamParseProgressEvent) => void;
}

const BLOCK_SIZE = 512;
const UNITY_GUID_PATTERN = /^[0-9a-fA-F]{32}$/;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function parseUnityPackage(
  data: Uint8Array,
  options?: ParseUnityPackageOptions,
): ExtractedFileContent {
  const result: ExtractedFileContent = {};

  const { entries } = parseUnityPackageEntries(data, options);
  for (const entry of entries) {
    if (entry.asset) {
      result[entry.pathname] = entry.asset;
    }

    if (entry.meta) {
      result[`${entry.pathname}.meta`] = entry.meta;
    }
  }

  return result;
}

export function parseUnityPackageEntries(
  data: Uint8Array,
  options?: ParseUnityPackageOptions,
): { entries: UnityPackageEntry[]; diagnostics: UnityPackageParseDiagnostic[] } {
  const maxOutputBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;

  const diagnostics: UnityPackageParseDiagnostic[] = [];
  const decompressed = gunzipSync(data);
  const tarFiles = parseTar(decompressed, diagnostics);
  const entries = mapUnityEntries(tarFiles, diagnostics, maxOutputBytes, maxEntries);
  return { entries, diagnostics };
}

// ---------------------------------------------------------------------------
// Discriminated union yielded by parseUnityPackageStream
// ---------------------------------------------------------------------------
//
// Each item yielded by parseUnityPackageStream carries `_kind`:
//   - `_kind: 'entry'`      -- a fully resolved UnityPackageEntry
//   - `_kind: 'diagnostic'` -- a UnityPackageParseDiagnostic emitted during parsing
//
// Narrowing example:
//   for await (const item of parseUnityPackageStream(bytes)) {
//     if (item._kind === 'entry') { /* item is UnityPackageEntry & { _kind: 'entry' } */ }
//     else                        { /* item is UnityPackageParseDiagnostic & { _kind: 'diagnostic' } */ }
//   }

/** Discriminator added by {@link parseUnityPackageStream} to each yielded item. */
export type StreamParseItemKind = 'entry' | 'diagnostic';

/**
 * A {@link UnityPackageEntry} as yielded by {@link parseUnityPackageStream}.
 * Carries an additional `_kind: 'entry'` discriminator.
 */
export type StreamedEntry = UnityPackageEntry & { _kind: 'entry' };

/**
 * A {@link UnityPackageParseDiagnostic} as yielded by {@link parseUnityPackageStream}.
 * Carries an additional `_kind: 'diagnostic'` discriminator.
 */
export type StreamedDiagnostic = UnityPackageParseDiagnostic & { _kind: 'diagnostic' };

/**
 * Iterator-based parse. Decompresses the gzip payload synchronously via fflate
 * (full tar buffer is available immediately), then streams at the **tar layer**:
 * processes one ustar block at a time and yields items as GUID entries complete.
 *
 * Each yielded item is either a {@link StreamedEntry} (`_kind === 'entry'`) or a
 * {@link StreamedDiagnostic} (`_kind === 'diagnostic'`). Diagnostics are yielded
 * immediately when detected; entries are yielded after all tar members for a GUID
 * have been collected (when the next GUID starts or the archive ends).
 *
 * Honors `maxOutputBytes` and `maxEntries` limits from {@link ParseUnityPackageOptions}.
 * Throws {@link DecompressionBombError} when either limit is exceeded.
 *
 * `onProgress` fires after each completed entry, rate-limited to ~62 events/second
 * (no more than one call per ~16 ms). The rate-limit uses a timestamp check; no
 * timers or `setTimeout` are used. Browser-safe; no `node:*` imports.
 */
export function* parseUnityPackageStream(
  bytes: Uint8Array,
  options?: StreamParseOptions,
): Generator<StreamedEntry | StreamedDiagnostic> {
  const maxOutputBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const onProgress = options?.onProgress;

  const decompressed = gunzipSync(bytes);
  const totalBytes = decompressed.length;

  let offset = 0;
  let totalOutputBytes = 0;
  let emittedEntryCount = 0;
  let lastProgressMs = -Infinity;

  // Accumulator for the current GUID's tar members
  let currentGuid: string | null = null;
  const currentFiles = new Map<string, Uint8Array>();
  // Diagnostics that fire at tar-parse time (before GUID is resolved) are yielded immediately.
  // Diagnostics that fire at entry-resolution time are yielded alongside or just before the entry.

  // -------------------------------------------------------------------------
  // Inner helper: resolve currentFiles into a UnityPackageEntry (or nothing),
  // emit entry-level diagnostics, and yield the entry.
  // -------------------------------------------------------------------------
  function* resolveCurrent(
    guid: string,
    files: Map<string, Uint8Array>,
  ): Generator<StreamedEntry | StreamedDiagnostic> {
    const pathnameBuf = files.get(`${guid}/pathname`);
    if (pathnameBuf === undefined) {
      // No pathname for this GUID -- skip (orphan files without a pathname entry)
      return;
    }

    const pathname = textDecoder.decode(pathnameBuf).split('\n')[0].trim();
    if (!pathname) {
      yield {
        _kind: 'diagnostic',
        code: 'empty-pathname',
        message: 'Skipped record with an empty pathname.',
        severity: 'error',
        path: `${guid}/pathname`,
        guid,
      };
      return;
    }

    if (!UNITY_GUID_PATTERN.test(guid)) {
      yield {
        _kind: 'diagnostic',
        code: 'non-standard-guid',
        message: 'Record prefix is not a 32-character hexadecimal GUID.',
        severity: 'info',
        path: `${guid}/pathname`,
        guid,
      };
    }

    if (pathname.length > 200) {
      yield {
        _kind: 'diagnostic',
        code: 'oversized-entry-name',
        message: `Pathname exceeds 200 characters (${pathname.length}).`,
        severity: 'warning',
        path: `${guid}/pathname`,
        guid,
      };
    }

    const asset = files.get(`${guid}/asset`);
    const meta = files.get(`${guid}/asset.meta`) ?? files.get(`${guid}/metaData`);
    const preview = files.get(`${guid}/preview.png`);

    if (preview !== undefined) {
      yield {
        _kind: 'diagnostic',
        code: 'ignored-preview',
        message: 'preview.png is exposed on entries and ignored by flat parsing.',
        severity: 'info',
        path: `${guid}/preview.png`,
        guid,
      };
    }

    if (asset === undefined) {
      if (meta !== undefined) {
        yield {
          _kind: 'diagnostic',
          code: 'asset-missing',
          message: 'Entry has a pathname and meta but no asset file.',
          severity: 'warning',
          path: `${guid}/asset`,
          guid,
        };
      }
    } else if (asset.byteLength === 0) {
      yield {
        _kind: 'diagnostic',
        code: 'zero-byte-asset',
        message: 'Asset file is present but has zero bytes.',
        severity: 'warning',
        path: `${guid}/asset`,
        guid,
      };
    }

    if (meta === undefined && asset !== undefined) {
      yield {
        _kind: 'diagnostic',
        code: 'meta-missing',
        message: 'Entry has a pathname and asset but no asset.meta or metaData file.',
        severity: 'warning',
        path: `${guid}/asset.meta`,
        guid,
      };
    }

    yield {
      _kind: 'entry',
      guid,
      pathname,
      asset,
      meta,
      preview,
    };
  }

  // -------------------------------------------------------------------------
  // Tar streaming loop
  // -------------------------------------------------------------------------
  while (offset + BLOCK_SIZE <= decompressed.length) {
    const header = decompressed.slice(offset, offset + BLOCK_SIZE);

    if (header.every(b => b === 0)) break;

    const name = textDecoder.decode(header.slice(0, 100)).replace(/\0/g, '').trim();
    if (!name) {
      yield {
        _kind: 'diagnostic',
        code: 'malformed-tar-entry',
        message: 'Skipped tar entry with an empty name.',
        severity: 'error',
      };
      offset += BLOCK_SIZE;
      continue;
    }

    const sizeStr = textDecoder.decode(header.slice(124, 136)).replace(/\0/g, '').trim();
    const size = parseInt(sizeStr, 8);
    if (Number.isNaN(size)) {
      yield {
        _kind: 'diagnostic',
        code: 'malformed-tar-entry',
        message: 'Skipped tar entry with an invalid size field.',
        severity: 'error',
        path: name,
      };
      offset += BLOCK_SIZE;
      continue;
    }

    offset += BLOCK_SIZE;

    const parts = name.split('/');
    const entryGuid = parts.length >= 2 ? parts.slice(0, -1).join('/') : null;

    // When we see a new GUID, resolve and yield the previous one first
    if (entryGuid !== null && entryGuid !== currentGuid) {
      if (currentGuid !== null && currentFiles.size > 0) {
        for (const item of resolveCurrent(currentGuid, currentFiles)) {
          if (item._kind === 'entry') {
            // Bomb guard: output bytes
            const entryBytes =
              (item.asset?.byteLength ?? 0) +
              (item.meta?.byteLength ?? 0) +
              (item.preview?.byteLength ?? 0);
            totalOutputBytes += entryBytes;
            if (totalOutputBytes > maxOutputBytes) {
              throw new DecompressionBombError('output-bytes', totalOutputBytes);
            }

            yield item;
            emittedEntryCount += 1;

            // Bomb guard: entry count
            if (emittedEntryCount > maxEntries) {
              throw new DecompressionBombError('entry-count', emittedEntryCount);
            }

            // Progress callback -- rate-limited to ~62 events/sec (~16 ms)
            if (onProgress !== undefined) {
              const now = Date.now();
              if (now - lastProgressMs >= 16) {
                lastProgressMs = now;
                onProgress({ bytesRead: offset, bytesTotal: totalBytes, entryCount: emittedEntryCount });
              }
            }
          } else {
            yield item;
          }
        }
      }
      currentGuid = entryGuid;
      currentFiles.clear();
    }

    if (offset + size <= decompressed.length && !name.endsWith('/')) {
      if (name.endsWith('/pathname') && currentFiles.has(name)) {
        // Duplicate GUID: same pathname key already present
        const dupGuid = name.slice(0, -'/pathname'.length);
        yield {
          _kind: 'diagnostic',
          code: 'duplicate-guid',
          message: 'GUID appears more than once in the archive.',
          severity: 'error',
          path: name,
          guid: dupGuid,
        };
        // Skip the duplicate; do not overwrite
      } else {
        currentFiles.set(name, decompressed.slice(offset, offset + size));
      }
    } else if (offset + size > decompressed.length) {
      yield {
        _kind: 'diagnostic',
        code: 'malformed-tar-entry',
        message: 'Skipped tar entry whose content extends beyond the archive.',
        severity: 'error',
        path: name,
      };
    }

    offset += Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }

  // Resolve the last accumulated GUID group
  if (currentGuid !== null && currentFiles.size > 0) {
    for (const item of resolveCurrent(currentGuid, currentFiles)) {
      if (item._kind === 'entry') {
        const entryBytes =
          (item.asset?.byteLength ?? 0) +
          (item.meta?.byteLength ?? 0) +
          (item.preview?.byteLength ?? 0);
        totalOutputBytes += entryBytes;
        if (totalOutputBytes > maxOutputBytes) {
          throw new DecompressionBombError('output-bytes', totalOutputBytes);
        }

        yield item;
        emittedEntryCount += 1;

        if (emittedEntryCount > maxEntries) {
          throw new DecompressionBombError('entry-count', emittedEntryCount);
        }

        if (onProgress !== undefined) {
          const now = Date.now();
          if (now - lastProgressMs >= 16) {
            lastProgressMs = now;
            onProgress({ bytesRead: totalBytes, bytesTotal: totalBytes, entryCount: emittedEntryCount });
          }
        }
      } else {
        yield item;
      }
    }
  }

  // Final progress event (always fires once, even if rate-limited earlier)
  if (onProgress !== undefined) {
    onProgress({ bytesRead: totalBytes, bytesTotal: totalBytes, entryCount: emittedEntryCount });
  }
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
      severity: 'error',
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
        severity: 'error',
        guid,
      });
    }

    // duplicate-guid
    if (seenGuids.has(guid)) {
      diagnostics.push({
        code: 'duplicate-guid',
        message: `Duplicate GUID in package entries: ${guid}`,
        severity: 'error',
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
        severity: 'error',
        guid,
        path: pathname,
      });
    }

    // oversized-pathname (200-char pathname body limit)
    if (pathname.length > 200) {
      diagnostics.push({
        code: 'oversized-pathname',
        message: `Pathname exceeds 200 characters (${pathname.length}): ${pathname}`,
        severity: 'error',
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
          severity: 'error',
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

// ---------------------------------------------------------------------------
// Package summary
// ---------------------------------------------------------------------------

export interface UnityPackageSummary {
  entryCount: number;
  fileCount: number;
  folderCount: number;
  previewCount: number;
  uniqueGuidCount: number;
  duplicateGuidCount: number;
  totalAssetBytes: number;
  totalMetaBytes: number;
  totalPreviewBytes: number;
  byExtension: {
    extension: string;
    count: number;
    assetBytes: number;
  }[];
  diagnosticsBySeverity: Record<UnityPackageDiagnosticSeverity, number>;
}

/**
 * Computes a structured summary from a list of parsed entries and optional
 * diagnostics. Pure function; browser-safe; no side effects.
 *
 * `byExtension` is ordered by `count` descending, ties broken by `extension`
 * ascending. Extensions are lower-cased; extensionless assets use `''`.
 *
 * `diagnosticsBySeverity` is zeroed (`{ info: 0, warning: 0, error: 0 }`)
 * when `diagnostics` is omitted or empty.
 */
export function summarizePackage(
  entries: UnityPackageEntry[],
  diagnostics?: UnityPackageParseDiagnostic[],
): UnityPackageSummary {
  let fileCount = 0;
  let folderCount = 0;
  let previewCount = 0;
  let totalAssetBytes = 0;
  let totalMetaBytes = 0;
  let totalPreviewBytes = 0;

  const seenGuids = new Set<string>();
  // Map from lower-cased extension -> { count, assetBytes }
  const extMap = new Map<string, { count: number; assetBytes: number }>();

  for (const entry of entries) {
    seenGuids.add(entry.guid);

    if (entry.asset !== undefined) {
      fileCount += 1;
      totalAssetBytes += entry.asset.byteLength;
    } else {
      folderCount += 1;
    }

    if (entry.meta !== undefined) {
      totalMetaBytes += entry.meta.byteLength;
    }

    if (entry.preview !== undefined) {
      previewCount += 1;
      totalPreviewBytes += entry.preview.byteLength;
    }

    // Derive extension from the pathname (lower-cased, without the leading dot)
    const dot = entry.pathname.lastIndexOf('.');
    const slash = entry.pathname.lastIndexOf('/');
    const extension = dot > slash && dot !== -1
      ? entry.pathname.slice(dot + 1).toLowerCase()
      : '';

    const existing = extMap.get(extension);
    const assetBytes = entry.asset?.byteLength ?? 0;
    if (existing === undefined) {
      extMap.set(extension, { count: 1, assetBytes });
    } else {
      existing.count += 1;
      existing.assetBytes += assetBytes;
    }
  }

  const byExtension = Array.from(extMap.entries())
    .map(([extension, { count, assetBytes }]) => ({ extension, count, assetBytes }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.extension < b.extension ? -1 : a.extension > b.extension ? 1 : 0;
    });

  const diagnosticsBySeverity: Record<UnityPackageDiagnosticSeverity, number> = {
    info: 0,
    warning: 0,
    error: 0,
  };
  if (diagnostics !== undefined) {
    for (const diag of diagnostics) {
      diagnosticsBySeverity[diag.severity] += 1;
    }
  }

  return {
    entryCount: entries.length,
    fileCount,
    folderCount,
    previewCount,
    uniqueGuidCount: seenGuids.size,
    duplicateGuidCount: entries.length - seenGuids.size,
    totalAssetBytes,
    totalMetaBytes,
    totalPreviewBytes,
    byExtension,
    diagnosticsBySeverity,
  };
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
        severity: 'error',
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
        severity: 'error',
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
          severity: 'error',
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
        severity: 'error',
        path: name,
      });
    }

    offset += Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }

  return files;
}

function mapUnityEntries(
  files: Record<string, Uint8Array>,
  diagnostics: UnityPackageParseDiagnostic[],
  maxOutputBytes: number,
  maxEntries: number,
): UnityPackageEntry[] {
  const result: UnityPackageEntry[] = [];
  let totalOutputBytes = 0;

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
          severity: 'error',
          path,
          guid,
        });
        continue;
      }

      if (!UNITY_GUID_PATTERN.test(guid)) {
        diagnostics.push({
          code: 'non-standard-guid',
          message: 'Record prefix is not a 32-character hexadecimal GUID.',
          severity: 'info',
          path,
          guid,
        });
      }

      if (pathname.length > 200) {
        diagnostics.push({
          code: 'oversized-entry-name',
          message: `Pathname exceeds 200 characters (${pathname.length}).`,
          severity: 'warning',
          path,
          guid,
        });
      }

      const asset = files[`${guid}/asset`];
      const meta = files[`${guid}/asset.meta`] ?? files[`${guid}/metaData`];
      const preview = files[`${guid}/preview.png`];

      // Bomb guard: track decompressed bytes (asset + meta + preview)
      const entryBytes =
        (asset?.byteLength ?? 0) +
        (meta?.byteLength ?? 0) +
        (preview?.byteLength ?? 0);
      totalOutputBytes += entryBytes;
      if (totalOutputBytes > maxOutputBytes) {
        throw new DecompressionBombError('output-bytes', totalOutputBytes);
      }

      if (preview) {
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

      result.push({ guid, pathname, asset, meta, preview });

      // Bomb guard: check entry count after push
      if (result.length > maxEntries) {
        throw new DecompressionBombError('entry-count', result.length);
      }
    } catch (err) {
      // Re-throw DecompressionBombError; swallow other errors
      if (err instanceof DecompressionBombError) throw err;
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
