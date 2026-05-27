import {
  entriesToComponentRecords,
  findMetaSidecarForAsset as findCoreMetaSidecarForAsset,
  readDeclaredMetaImporter,
  readMetaGuid,
  resolveMetaSidecarSelection,
  type PreviewKind,
  type SidecarSelectableRecord,
  type SyntaxLanguage,
  type UnityPackageEntry,
  type ContentlessRecord,
  type UnityPackageParseDiagnostic,
} from 'unitypackage-core';

export type { SidecarSelectableRecord } from 'unitypackage-core';
export { resolveMetaSidecarSelection } from 'unitypackage-core';

export type GroupingMode = 'tree' | 'extension';
export type RecordCategory = 'asset' | 'meta';
export type SortKey = 'name' | 'size' | 'extension' | 'guid';
export type SortDirection = 'asc' | 'desc';

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'apng', 'avif', 'webp', 'svg', 'tga', 'tif', 'tiff']);
const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav', 'webm']);
const videoExtensions = new Set(['m4v', 'mov', 'mp4', 'ogv', 'webm']);
const yamlSkipExtensions = new Set(['unity', 'prefab']);
const yamlTextExtensions = new Set([
  'asset', 'mat', 'anim', 'controller', 'overridecontroller',
  'physicmaterial', 'physicsmaterial2d', 'playable', 'mask', 'brush', 'flare',
  'fontsettings', 'guiskin', 'giparams', 'rendertexture', 'spriteatlas', 'spriteatlasv2',
  'terrainlayer', 'mixer', 'shadervariants', 'preset', 'lighting', 'dwlt', 'vfx',
  'vfxblock', 'vfxoperator', 'yaml', 'yml',
]);
const yamlExtensions = new Set([...yamlSkipExtensions, ...yamlTextExtensions]);
const codeExtensions = new Set([
  'cs', 'ts', 'tsx', 'js', 'jsx', 'shader', 'hlsl', 'cginc', 'compute', 'glsl',
  'css', 'uss', 'tss', 'json', 'asmdef', 'asmref', 'inputactions', 'shadergraph',
  'shadersubgraph', 'xml', 'uxml', 'html',
]);
const textExtensions = new Set([...yamlExtensions, ...codeExtensions, 'md', 'meta', 'txt']);

function getPreviewKindForPath(pathname: string): PreviewKind {
  const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (imageExtensions.has(ext)) return 'image';
  if (audioExtensions.has(ext)) return 'audio';
  if (videoExtensions.has(ext)) return 'video';
  if (yamlSkipExtensions.has(ext)) return 'unsupported';
  if (yamlTextExtensions.has(ext)) return 'text';
  if (textExtensions.has(ext)) return 'text';
  return 'unsupported';
}

function getSyntaxLanguageForPath(pathname: string): SyntaxLanguage {
  const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'meta' || yamlExtensions.has(ext)) return 'yaml';
  if (ext === 'json' || ext === 'asmdef' || ext === 'asmref' || ext === 'inputactions' || ext === 'shadergraph' || ext === 'shadersubgraph') return 'json';
  if (ext === 'xml' || ext === 'uxml') return 'xml';
  if (ext === 'css' || ext === 'uss' || ext === 'tss') return 'css';
  if (ext === 'cs') return 'csharp';
  if (ext === 'shader') return 'hlsl';
  if (ext === 'hlsl' || ext === 'cginc' || ext === 'compute') return 'hlsl';
  if (ext === 'glsl') return 'glsl';
  if (ext === 'ts' || ext === 'tsx') return 'typescript';
  if (ext === 'js' || ext === 'jsx') return 'javascript';
  if (ext === 'md') return 'markdown';
  if (ext === 'html') return 'html';
  return 'text';
}

export interface PackageFileRecord extends ContentlessRecord {
  fileName: string;
  isUnityPreview: false;
  previewKind: PreviewKind;
  syntaxLanguage: SyntaxLanguage;
}

export function getRecordCategory(record: PackageFileRecord): RecordCategory {
  return record.extension === 'meta' ? 'meta' : 'asset';
}

export function toSidecarSelectableRecords(records: readonly PackageFileRecord[]): SidecarSelectableRecord[] {
  return records.map(record => ({
    id: record.id,
    guid: record.guid,
    pathname: record.virtualPath,
    kind: getRecordCategory(record),
  }));
}

export function resolveSelectedZipRecordIds(
  records: readonly SidecarSelectableRecord[],
  selectedRecordIds: readonly string[],
  includeMetaSidecars: boolean,
): string[] {
  if (includeMetaSidecars) {
    return resolveMetaSidecarSelection(records, selectedRecordIds).ids;
  }

  const metaIds = new Set(records.filter(record => record.kind === 'meta').map(record => record.id));
  return selectedRecordIds.filter(id => !metaIds.has(id));
}

export function resolveAllZipRecordIds(
  records: readonly SidecarSelectableRecord[],
  includeMetaSidecars: boolean,
): string[] {
  const assetIds = records
    .filter(record => record.kind === 'asset')
    .map(record => record.id);

  if (!includeMetaSidecars) return assetIds;
  return resolveMetaSidecarSelection(records, assetIds).ids;
}

interface TreeFolderRow {
  type: 'folder';
  id: string;
  name: string;
  path: string;
  depth: number;
  fileCount: number;
  recordIds: string[];
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
): { records: PackageFileRecord[]; contents: Record<string, Uint8Array<ArrayBuffer>> } {
  const records: PackageFileRecord[] = [];
  const contents: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const componentRecord of entriesToComponentRecords(entries, diagnostics)) {
    if (componentRecord.component === 'preview') continue;
    const { content, ...rest } = componentRecord;
    records.push({
      ...rest,
      fileName: rest.virtualPath.split('/').pop() ?? rest.virtualPath,
      isUnityPreview: false,
      previewKind: getPreviewKindForPath(rest.virtualPath),
      syntaxLanguage: getSyntaxLanguageForPath(rest.virtualPath),
    });
    contents[rest.id] = content as Uint8Array<ArrayBuffer>;
  }
  return { records, contents };
}

export function buildTreeRows(records: PackageFileRecord[], collapsedFolders: ReadonlySet<string> = new Set()): TreeRow[] {
  const folderCounts = new Map<string, number>();
  const folderRecordIds = new Map<string, string[]>();
  for (const record of records) {
    const parts = record.virtualPath.split('/').filter(Boolean);
    let folderPath = '';
    for (let index = 0; index < parts.length - 1; index += 1) {
      folderPath = folderPath ? `${folderPath}/${parts[index]}` : parts[index] ?? '';
      folderCounts.set(folderPath, (folderCounts.get(folderPath) ?? 0) + 1);
      const ids = folderRecordIds.get(folderPath);
      if (ids) ids.push(record.id);
      else folderRecordIds.set(folderPath, [record.id]);
    }
  }

  const rows: TreeRow[] = [];
  const emittedFolders = new Set<string>();
  const sortedRecords = [...records].sort((a, b) => a.virtualPath.localeCompare(b.virtualPath));

  for (const record of sortedRecords) {
    const parts = record.virtualPath.split('/').filter(Boolean);
    let hidden = false;
    let folderPath = '';
    let parentPath = '';

    for (let index = 0; index < parts.length - 1; index += 1) {
      if (parentPath && collapsedFolders.has(parentPath)) {
        hidden = true;
        break;
      }

      folderPath = folderPath ? `${folderPath}/${parts[index]}` : parts[index] ?? '';
      if (!emittedFolders.has(folderPath)) {
        rows.push({
          type: 'folder',
          id: `folder:${folderPath}`,
          name: parts[index] ?? folderPath,
          path: folderPath,
          depth: index,
          fileCount: folderCounts.get(folderPath) ?? 0,
          recordIds: folderRecordIds.get(folderPath) ?? [],
        });
        emittedFolders.add(folderPath);
      }
      parentPath = folderPath;
    }

    const parent = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
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

const KB = 1024, MB = KB * 1024, GB = MB * 1024, TB = GB * 1024;
export function formatBytes(bytes: number): string {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(bytes < 10 * KB ? 1 : 0)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
  if (bytes < TB) return `${(bytes / GB).toFixed(bytes < 10 * GB ? 1 : 0)} GB`;
  return `${(bytes / TB).toFixed(bytes < 10 * TB ? 1 : 0)} TB`;
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
}

export function filterRecords(
  records: PackageFileRecord[],
  options: RecordFilterOptions,
): PackageFileRecord[] {
  const { query } = options;

  return records.filter(record => {
    if (record.extension === 'meta') return false;
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

export function getMetaSidecarForAsset(
  records: readonly PackageFileRecord[],
  record: PackageFileRecord,
  selectableRecords?: readonly SidecarSelectableRecord[],
): PackageFileRecord | undefined {
  if (record.extension === 'meta') return undefined;

  const selectable = selectableRecords ?? toSidecarSelectableRecords(records);
  const selectableAsset = selectable.find(candidate => candidate.id === record.id);
  if (!selectableAsset) return undefined;

  const selectableMeta = findCoreMetaSidecarForAsset(selectable, selectableAsset);
  if (!selectableMeta) return undefined;

  return records.find(candidate => candidate.id === selectableMeta.id);
}

export interface DeclaredMetaInfo {
  guid: string | undefined;
  importer: string | undefined;
}

export function getDeclaredMetaInfoForRecord(
  records: readonly PackageFileRecord[],
  record: PackageFileRecord,
  getContent: (id: string) => Uint8Array<ArrayBuffer> | undefined,
  selectableRecords?: readonly SidecarSelectableRecord[],
): DeclaredMetaInfo {
  let metaBytes: Uint8Array | undefined;

  if (record.extension === 'meta') {
    metaBytes = getContent(record.id);
  } else {
    const sibling = getMetaSidecarForAsset(records, record, selectableRecords);
    if (sibling) {
      metaBytes = getContent(sibling.id);
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
