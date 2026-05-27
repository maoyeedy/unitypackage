import type { UnityPackageEntry } from './model';

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
  | 'oversized-pathname-tar';

export interface PathnameValidationResult {
  ok: boolean;
  reason?: PathnameRejectionReason;
  detail?: string;
}

const _tarEntryNameEncoder = new TextEncoder();
const META_SIDECAR_SUFFIX = '.meta';

export function metaSidecarPathForAsset(pathname: string): string {
  return `${pathname}${META_SIDECAR_SUFFIX}`;
}

/**
 * Validates a pathname against the rejection rules in the .unitypackage
 * format spec ("Extraction security" section). Returns a structured result;
 * never throws.
 *
 * When `options.guid` is supplied, also checks that the longest tar entry
 * name produced for this GUID + pathname does not exceed the 100-byte ustar
 * header limit (UTF-8). Note that the worst-case tar entry name is actually
 * `<guid>/preview.png` (44 bytes for a standard 32-character GUID), but we
 * check `<guid>/asset.meta` (43 bytes) to align with baseline checks. This
 * matches the internal check in `tryCreateUnityPackage`.
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
  // name fits in 100 bytes (UTF-8). The worst-case generated name is `<guid>/preview.png`
  // (44 bytes), but we check `<guid>/asset.meta` here to align with validation specs.
  if (options?.guid !== undefined) {
    const worstCaseName = `${options.guid}/asset.meta`;
    const byteLength = _tarEntryNameEncoder.encode(worstCaseName).length;
    if (byteLength > 100) {
      return {
        ok: false,
        reason: 'oversized-pathname-tar',
        detail: `${byteLength}`,
      };
    }
  }

  return { ok: true };
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
