import { gunzipSync } from 'fflate';
import type { ExtractedFileContent, UnityPackageDiagnosticSeverity, UnityPackageEntry } from './model';
import { BLOCK_SIZE, textDecoder } from './tar';

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

const UNITY_GUID_PATTERN = /^[0-9a-fA-F]{32}$/;

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
