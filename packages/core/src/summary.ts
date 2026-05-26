import type { UnityPackageDiagnosticSeverity, UnityPackageEntry } from './model';
import type { UnityPackageParseDiagnostic } from './parse';

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
 * ascending. Folder entries (`entry.asset === undefined`) are excluded from
 * `byExtension` entirely; extensionless assets (no dot after the last slash)
 * still contribute to the `''` row.
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

    // Folder entries (no asset) are excluded from byExtension.
    if (entry.asset !== undefined) {
      // Derive extension from the pathname (lower-cased, without the leading dot)
      const dot = entry.pathname.lastIndexOf('.');
      const slash = entry.pathname.lastIndexOf('/');
      const extension = dot > slash && dot !== -1
        ? entry.pathname.slice(dot + 1).toLowerCase()
        : '';

      const existing = extMap.get(extension);
      const assetBytes = entry.asset.byteLength;
      if (existing === undefined) {
        extMap.set(extension, { count: 1, assetBytes });
      } else {
        existing.count += 1;
        existing.assetBytes += assetBytes;
      }
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
