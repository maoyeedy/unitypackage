import { getMimeTypeForPath, getPathExtension, type UnityPackageEntry, type UnityPackageParseDiagnostic } from 'unitypackage-core';

export type UnityPackageEntryComponent = 'asset' | 'meta' | 'preview';

export interface UnityPackageComponentRecord {
  id: string;
  guid: string;
  pathname: string;
  virtualPath: string;
  component: UnityPackageEntryComponent;
  content: Uint8Array;
  byteLength: number;
  extension: string;
  mimeType: string;
  diagnostics: UnityPackageParseDiagnostic[];
  hasAsset: boolean;
  hasMeta: boolean;
  hasPreview: boolean;
  assetSize?: number;
  metaSize?: number;
  previewSize?: number;
  duplicatePathCount: number;
}

export type ContentlessRecord = Omit<UnityPackageComponentRecord, 'content'>;

export function entriesToComponentRecords(
  entries: UnityPackageEntry[],
  diagnostics: UnityPackageParseDiagnostic[] = [],
): UnityPackageComponentRecord[] {
  const pathCounts = new Map<string, number>();
  for (const entry of entries) {
    pathCounts.set(entry.pathname, (pathCounts.get(entry.pathname) ?? 0) + 1);
  }

  const records: UnityPackageComponentRecord[] = [];
  for (const entry of entries) {
    if (entry.asset) {
      records.push(createComponentRecord(entry, 'asset', entry.pathname, entry.asset, pathCounts, diagnostics));
    }
    if (entry.meta) {
      records.push(createComponentRecord(entry, 'meta', `${entry.pathname}.meta`, entry.meta, pathCounts, diagnostics));
    }
    if (entry.preview) {
      records.push(createComponentRecord(entry, 'preview', `${entry.pathname}.preview.png`, entry.preview, pathCounts, diagnostics));
    }
  }

  return records.sort((a, b) => a.virtualPath.localeCompare(b.virtualPath) || a.guid.localeCompare(b.guid));
}

function createComponentRecord(
  entry: UnityPackageEntry,
  component: UnityPackageEntryComponent,
  virtualPath: string,
  content: Uint8Array,
  pathCounts: ReadonlyMap<string, number>,
  diagnostics: UnityPackageParseDiagnostic[],
): UnityPackageComponentRecord {
  return {
    id: `${entry.guid}:${component}:${virtualPath}`,
    guid: entry.guid,
    pathname: entry.pathname,
    virtualPath,
    component,
    content,
    byteLength: content.byteLength,
    extension: getPathExtension(virtualPath),
    mimeType: getMimeTypeForPath(virtualPath),
    diagnostics: getComponentDiagnostics(entry, component, diagnostics),
    hasAsset: Boolean(entry.asset),
    hasMeta: Boolean(entry.meta),
    hasPreview: Boolean(entry.preview),
    assetSize: entry.asset?.byteLength,
    metaSize: entry.meta?.byteLength,
    previewSize: entry.preview?.byteLength,
    duplicatePathCount: pathCounts.get(entry.pathname) ?? 1,
  };
}

function getComponentDiagnostics(
  entry: UnityPackageEntry,
  component: UnityPackageEntryComponent,
  diagnostics: UnityPackageParseDiagnostic[],
): UnityPackageParseDiagnostic[] {
  return diagnostics.filter(diagnostic => {
    if (diagnostic.guid !== entry.guid && !diagnostic.path?.startsWith(`${entry.guid}/`)) {
      return false;
    }

    if (diagnostic.code === 'ignored-preview') {
      return false;
    }

    if (diagnostic.code === 'duplicate-guid') {
      return component === 'asset';
    }

    if (diagnostic.code === 'asset-missing') {
      return component === 'meta';
    }

    if (diagnostic.code === 'meta-missing') {
      return component === 'asset';
    }

    if (diagnostic.code === 'oversized-entry-name') {
      return entry.asset !== undefined ? component === 'asset' : component === 'meta';
    }

    if (diagnostic.path?.endsWith('/preview.png')) {
      return component === 'preview';
    }

    if (diagnostic.path?.endsWith('/asset.meta') || diagnostic.path?.endsWith('/metaData')) {
      return component === 'meta';
    }

    if (diagnostic.path?.endsWith('/asset')) {
      return component === 'asset';
    }

    return true;
  });
}
