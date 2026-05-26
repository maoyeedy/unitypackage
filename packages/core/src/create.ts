import { gzipSync } from 'fflate';
import type { UnityPackageDiagnosticSeverity } from './model';
import { BLOCK_SIZE, concatUint8Arrays, createTarEntry, textEncoder } from './tar';

export interface CreateUnityPackageEntry {
  guid: string;
  pathname: string;
  meta: Uint8Array;
  asset?: Uint8Array;
  preview?: Uint8Array;
}

export interface CreateUnityPackageOptions {
  gzipLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

export type CreateUnityPackageDiagnosticCode =
  | 'duplicate-guid'
  | 'missing-meta'
  | 'oversized-pathname'
  | 'oversized-pathname-tar'
  | 'empty-entries'
  | 'invalid-guid';

export interface CreateUnityPackageDiagnostic {
  code: CreateUnityPackageDiagnosticCode;
  message: string;
  severity: UnityPackageDiagnosticSeverity;
  guid?: string;
  path?: string;
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

    // preview member is optional
    if (entry.preview) {
      tarBytes += BLOCK_SIZE + Math.ceil(entry.preview.length / BLOCK_SIZE) * BLOCK_SIZE;
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
    const { guid: rawGuid, pathname } = entry;
    // Normalize to lowercase so tar paths and parse identities are stable
    const guid = rawGuid.toLowerCase();

    // invalid-guid: not exactly 32 hex characters (case-insensitive)
    if (!VALID_GUID_PATTERN.test(rawGuid)) {
      diagnostics.push({
        code: 'invalid-guid',
        message: `GUID is not exactly 32 hexadecimal characters: ${rawGuid}`,
        severity: 'error',
        guid: rawGuid,
      });
    }

    // duplicate-guid (compare normalized)
    if (seenGuids.has(guid)) {
      diagnostics.push({
        code: 'duplicate-guid',
        message: `Duplicate GUID in package entries: ${rawGuid}`,
        severity: 'error',
        guid: rawGuid,
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

    // oversized-pathname-tar (ustar 100-byte tar entry name limit)
    // Use the normalized (lowercase) guid since that is what gets written to the tar
    // Note: The worst-case tar entry name length is <guid>/preview.png (44 bytes),
    // but we check all generated entry names here.
    const tarNames = [
      `${guid}/pathname`,
      `${guid}/asset.meta`,
      ...(entry.asset ? [`${guid}/asset`] : []),
      ...(entry.preview ? [`${guid}/preview.png`] : []),
    ];
    for (const tarName of tarNames) {
      if (textEncoder.encode(tarName).length > TAR_NAME_LIMIT) {
        diagnostics.push({
          code: 'oversized-pathname-tar',
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

  // Sort by normalized (lowercase) GUID ascending for reproducible output
  const sorted = entries.slice().sort((a, b) => {
    const ga = a.guid.toLowerCase();
    const gb = b.guid.toLowerCase();
    return ga < gb ? -1 : ga > gb ? 1 : 0;
  });

  for (const entry of sorted) {
    const g = entry.guid.toLowerCase();
    tarEntries.push(createTarEntry(`${g}/pathname`, textEncoder.encode(entry.pathname)));
    tarEntries.push(createTarEntry(`${g}/asset.meta`, entry.meta));

    if (entry.asset) {
      tarEntries.push(createTarEntry(`${g}/asset`, entry.asset));
    }

    if (entry.preview) {
      tarEntries.push(createTarEntry(`${g}/preview.png`, entry.preview));
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
