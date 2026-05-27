import {
  entriesToComponentRecords,
  readDeclaredMetaImporter,
  readMetaGuid,
  type SidecarSelectableRecord,
  type UnityPackageEntry,
  type UnityPackageComponentRecord,
  type UnityPackageParseDiagnostic,
} from 'unitypackage-core';

export type { SidecarSelectableRecord } from 'unitypackage-core';
export { resolveMetaSidecarSelection } from 'unitypackage-core';

export type GroupingMode = 'tree' | 'extension';
export type RecordCategory = 'asset' | 'meta';
export type SortKey = 'name' | 'size' | 'extension' | 'guid';
export type SortDirection = 'asc' | 'desc';

export interface PackageFileRecord extends UnityPackageComponentRecord {
  fileName: string;
  isUnityPreview: false;
}

export function getRecordCategory(record: PackageFileRecord): RecordCategory {
  return record.extension === 'meta' ? 'meta' : 'asset';
}

export function toSidecarSelectableRecords(records: PackageFileRecord[]): SidecarSelectableRecord[] {
  return records.map(record => ({
    id: record.id,
    guid: record.guid,
    pathname: record.virtualPath,
    kind: getRecordCategory(record),
  }));
}

interface TreeFolderRow {
  type: 'folder';
  id: string;
  name: string;
  path: string;
  depth: number;
  fileCount: number;
}

interface TreeFileRow {
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

export type SelectionState = 'none' | 'partial' | 'all';

export function entriesToRecords(
  entries: UnityPackageEntry[],
  diagnostics: UnityPackageParseDiagnostic[] = [],
): PackageFileRecord[] {
  return entriesToComponentRecords(entries, diagnostics)
    .filter(record => record.component !== 'preview')
    .map(record => ({
      ...record,
      fileName: record.virtualPath.split('/').pop() ?? record.virtualPath,
      isUnityPreview: false,
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

export function getKeyboardRangeSelection(
  navigableRowIds: readonly string[],
  anchorId: string | null,
  targetId: string,
  validFileIds: ReadonlySet<string>,
  baseSelectedIds: ReadonlySet<string>,
  mode: 'add' | 'remove',
): Set<string> {
  if (!anchorId) return new Set(baseSelectedIds);

  const anchorIndex = navigableRowIds.indexOf(anchorId);
  const targetIndex = navigableRowIds.indexOf(targetId);
  if (anchorIndex === -1 || targetIndex === -1) return new Set(baseSelectedIds);

  const startIndex = Math.min(anchorIndex, targetIndex);
  const endIndex = Math.max(anchorIndex, targetIndex);
  const rangeFileIds = navigableRowIds
    .slice(startIndex, endIndex + 1)
    .filter(id => validFileIds.has(id));

  const next = new Set(baseSelectedIds);
  for (const id of rangeFileIds) {
    if (mode === 'add') {
      next.add(id);
    } else {
      next.delete(id);
    }
  }
  return next;
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

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function simpleMatchRecord(record: PackageFileRecord, query: string): boolean {
  const rawQuery = query.trim().toLowerCase();
  if (!rawQuery) return true;

  const terms = rawQuery.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const nameField = record.fileName.toLowerCase();
  const pathField = record.virtualPath.toLowerCase();

  return terms.every(term => nameField.includes(term) || pathField.includes(term));
}

export interface RecordFilterOptions {
  query: string;
  includeMetaSidecars: boolean;
}

export function filterRecords(
  records: PackageFileRecord[],
  options: RecordFilterOptions,
): PackageFileRecord[] {
  const { query, includeMetaSidecars } = options;

  return records.filter(record => {
    if (!includeMetaSidecars && record.extension === 'meta') return false;
    return simpleMatchRecord(record, query);
  });
}

export function sortRecords(
  records: PackageFileRecord[],
  key: SortKey,
  direction: SortDirection,
): PackageFileRecord[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...records].sort((a, b) => {
    let primary = 0;
    switch (key) {
      case 'name': primary = a.fileName.localeCompare(b.fileName); break;
      case 'size': primary = a.byteLength - b.byteLength; break;
      case 'extension': primary = a.extension.localeCompare(b.extension); break;
      case 'guid': primary = a.guid.localeCompare(b.guid); break;
    }
    if (primary !== 0) return primary * factor;
    return a.virtualPath.localeCompare(b.virtualPath);
  });
}

function getSiblingMetaRecord(
  records: PackageFileRecord[],
  record: PackageFileRecord,
): PackageFileRecord | undefined {
  return records.find(
    candidate => candidate.guid === record.guid && candidate.extension === 'meta',
  );
}

export interface DeclaredMetaInfo {
  guid: string | undefined;
  importer: string | undefined;
}

export function getDeclaredMetaInfoForRecord(
  records: PackageFileRecord[],
  record: PackageFileRecord,
): DeclaredMetaInfo {
  let metaBytes: Uint8Array | undefined;

  if (record.extension === 'meta') {
    metaBytes = record.content;
  } else {
    const sibling = getSiblingMetaRecord(records, record);
    if (sibling) {
      metaBytes = sibling.content;
    }
  }

  if (!metaBytes) {
    return { guid: undefined, importer: undefined };
  }

  const rawGuid = readMetaGuid(metaBytes);
  const declared = readDeclaredMetaImporter(metaBytes);

  let importerName: string | undefined;
  if (declared !== null) {
    importerName = declared.kind === 'known' ? declared.type : declared.name;
  }

  return {
    guid: rawGuid ?? undefined,
    importer: importerName,
  };
}

function getAncestorFolderPaths(virtualPath: string): string[] {
  const parts = virtualPath.split('/').filter(Boolean);
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    ancestors.push(parts.slice(0, i).join('/'));
  }
  return ancestors;
}

export function expandAncestors(
  virtualPath: string,
  collapsedFolders: ReadonlySet<string>,
): Set<string> {
  const ancestors = getAncestorFolderPaths(virtualPath);
  const next = new Set(collapsedFolders);
  for (const ancestor of ancestors) {
    next.delete(ancestor);
  }
  return next;
}

export function getAllFolderPaths(records: PackageFileRecord[]): string[] {
  const seen = new Set<string>();
  for (const record of records) {
    const parts = record.virtualPath.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) {
      seen.add(parts.slice(0, i).join('/'));
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
