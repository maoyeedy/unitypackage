import type { UnityPackageDiagnosticSeverity, UnityPackageEntry, UnityPackageParseDiagnostic } from 'unitypackage-core';

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

    if (entry.asset !== undefined) {
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
