import {
  entriesToComponentRecords,
  getMimeTypeForPath,
  getPreviewKindForPath,
  getSyntaxLanguageForPath,
  type PreviewKind,
  type SyntaxLanguage,
  type UnityPackageEntry,
  type UnityPackageParseDiagnostic,
} from 'unitypackage-core';

export type { PreviewKind, SyntaxLanguage } from 'unitypackage-core';

export type WorkspaceMode = 'extract' | 'pack';
export type GroupingMode = 'tree' | 'extension';
export type RecordCategory = 'asset' | 'meta' | 'preview';

export interface PackageFileRecord {
  id: string;
  guid: string;
  pathname: string;
  virtualPath: string;
  fileName: string;
  extension: string;
  mimeType: string;
  isUnityPreview: boolean;
  content: Uint8Array;
  byteLength: number;
  hasAsset: boolean;
  hasMeta: boolean;
  hasPreview: boolean;
  assetSize?: number;
  metaSize?: number;
  previewSize?: number;
  duplicatePathCount: number;
  previewKind: PreviewKind;
  syntaxLanguage: SyntaxLanguage;
  diagnostics: UnityPackageParseDiagnostic[];
}

export function getRecordCategory(record: PackageFileRecord): RecordCategory {
  if (record.isUnityPreview) return 'preview';
  if (record.extension === 'meta') return 'meta';
  return 'asset';
}

export interface TreeFolderRow {
  type: 'folder';
  id: string;
  name: string;
  path: string;
  depth: number;
  fileCount: number;
}

export interface TreeFileRow {
  type: 'file';
  id: string;
  record: PackageFileRecord;
  depth: number;
}

export type TreeRow = TreeFolderRow | TreeFileRow;

export interface ExtensionGroup {
  extension: string;
  records: PackageFileRecord[];
  totalBytes: number;
}

export interface PackValidation {
  status: 'ready' | 'blocked';
  messages: string[];
  createEntryCount: number;
}

export type SelectionState = 'none' | 'partial' | 'all';

export function entriesToRecords(
  entries: UnityPackageEntry[],
  diagnostics: UnityPackageParseDiagnostic[],
): PackageFileRecord[] {
  return entriesToComponentRecords(entries, diagnostics).map(record => ({
    id: record.id,
    guid: record.guid,
    pathname: record.pathname,
    virtualPath: record.virtualPath,
    fileName: record.virtualPath.split('/').pop() ?? record.virtualPath,
    extension: record.extension,
    mimeType: record.mimeType,
    isUnityPreview: record.component === 'preview',
    content: record.content,
    byteLength: record.byteLength,
    hasAsset: record.hasAsset,
    hasMeta: record.hasMeta,
    hasPreview: record.hasPreview,
    assetSize: record.assetSize,
    metaSize: record.metaSize,
    previewSize: record.previewSize,
    duplicatePathCount: record.duplicatePathCount,
    previewKind: record.previewKind,
    syntaxLanguage: record.syntaxLanguage,
    diagnostics: record.diagnostics,
  }));
}

export function buildTreeRows(records: PackageFileRecord[], collapsedFolders: ReadonlySet<string> = new Set()): TreeRow[] {
  const folderCounts = new Map<string, number>();
  for (const record of records) {
    const parts = record.virtualPath.split('/').filter(Boolean);
    for (let index = 0; index < parts.length - 1; index += 1) {
      const path = parts.slice(0, index + 1).join('/');
      folderCounts.set(path, (folderCounts.get(path) ?? 0) + 1);
    }
  }

  const rows: TreeRow[] = [];
  const emittedFolders = new Set<string>();
  const sortedRecords = [...records].sort((a, b) => a.virtualPath.localeCompare(b.virtualPath));

  for (const record of sortedRecords) {
    const parts = record.virtualPath.split('/').filter(Boolean);
    let hidden = false;

    for (let index = 0; index < parts.length - 1; index += 1) {
      const folderPath = parts.slice(0, index + 1).join('/');
      const parentPath = parts.slice(0, index).join('/');
      if (parentPath && collapsedFolders.has(parentPath)) {
        hidden = true;
        break;
      }

      if (!emittedFolders.has(folderPath)) {
        rows.push({
          type: 'folder',
          id: `folder:${folderPath}`,
          name: parts[index] ?? folderPath,
          path: folderPath,
          depth: index,
          fileCount: folderCounts.get(folderPath) ?? 0,
        });
        emittedFolders.add(folderPath);
      }
    }

    const parent = parts.slice(0, -1).join('/');
    if (!hidden && !collapsedFolders.has(parent)) {
      rows.push({
        type: 'file',
        id: record.id,
        record,
        depth: Math.max(0, parts.length - 1),
      });
    }
  }

  return rows;
}

export function buildExtensionGroups(records: PackageFileRecord[]): ExtensionGroup[] {
  const groups = new Map<string, PackageFileRecord[]>();
  for (const record of records) {
    const extension = record.extension || 'no extension';
    const group = groups.get(extension) ?? [];
    group.push(record);
    groups.set(extension, group);
  }

  return [...groups.entries()]
    .map(([extension, groupRecords]) => ({
      extension,
      records: groupRecords.sort((a, b) => a.virtualPath.localeCompare(b.virtualPath)),
      totalBytes: groupRecords.reduce((sum, record) => sum + record.byteLength, 0),
    }))
    .sort((a, b) => a.extension.localeCompare(b.extension));
}

export function getTreeFileRecordIds(rows: TreeRow[]): string[] {
  return rows.flatMap(row => row.type === 'file' ? [row.record.id] : []);
}

export function getExtensionFileRecordIds(groups: ExtensionGroup[]): string[] {
  return groups.flatMap(group => group.records.map(record => record.id));
}

export function getFolderRecordIds(records: PackageFileRecord[], folderPath: string): string[] {
  const prefix = `${folderPath.replace(/\/+$/, '')}/`;
  return records
    .filter(record => record.virtualPath.startsWith(prefix))
    .sort((a, b) => a.virtualPath.localeCompare(b.virtualPath))
    .map(record => record.id);
}

export function getRangeRecordIds(orderedIds: readonly string[], anchorId: string | null, targetId: string): string[] {
  const targetIndex = orderedIds.indexOf(targetId);
  if (targetIndex === -1) return [];

  const anchorIndex = anchorId === null ? -1 : orderedIds.indexOf(anchorId);
  if (anchorIndex === -1) return [targetId];

  const startIndex = Math.min(anchorIndex, targetIndex);
  const endIndex = Math.max(anchorIndex, targetIndex);
  return orderedIds.slice(startIndex, endIndex + 1);
}

export function getSelectionState(recordIds: readonly string[], selectedIds: ReadonlySet<string>): SelectionState {
  if (recordIds.length === 0) return 'none';

  let selectedCount = 0;
  for (const recordId of recordIds) {
    if (selectedIds.has(recordId)) selectedCount += 1;
  }

  if (selectedCount === 0) return 'none';
  if (selectedCount === recordIds.length) return 'all';
  return 'partial';
}

export function getPreviewKind(path: string, bytes?: Uint8Array): PreviewKind {
  return getPreviewKindForPath(path, bytes);
}

export function getMimeType(path: string): string {
  return getMimeTypeForPath(path);
}

export function getSyntaxLanguage(path: string): SyntaxLanguage {
  return getSyntaxLanguageForPath(path);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function validatePackDraft(records: PackageFileRecord[]): PackValidation {
  const messages: string[] = [];
  const stagedAssets = records.filter(record => !record.isUnityPreview && record.extension !== 'meta');
  const unsupported = records.filter(record => record.isUnityPreview);
  const guidCounts = new Map<string, number>();

  for (const record of stagedAssets) {
    guidCounts.set(record.guid, (guidCounts.get(record.guid) ?? 0) + 1);
    if (!record.hasMeta) {
      messages.push(`${record.pathname} is missing metadata.`);
    }
  }

  for (const record of unsupported) {
    messages.push(`${record.virtualPath} is a preview record and cannot be packed directly.`);
  }

  for (const [guid, count] of guidCounts) {
    if (count > 1) {
      messages.push(`${guid} is staged more than once.`);
    }
  }

  if (records.length === 0) {
    messages.push('Stage at least one extracted asset before packing.');
  }

  if (stagedAssets.length === 0 && records.length > 0) {
    messages.push('Only asset records can become package entries.');
  }

  messages.push('Unitypackage export is disabled until the package creation API from docs/plans/web/new-api.md is implemented.');

  return {
    status: 'blocked',
    messages,
    createEntryCount: stagedAssets.length,
  };
}
