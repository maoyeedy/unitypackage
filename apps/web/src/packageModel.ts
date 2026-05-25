import type { UnityPackageEntry, UnityPackageParseDiagnostic } from 'unitypackage-core';

export type WorkspaceMode = 'extract' | 'pack';
export type GroupingMode = 'tree' | 'extension';
export type RecordCategory = 'asset' | 'meta' | 'preview';
export type PreviewKind = 'text' | 'image' | 'pdf' | 'audio' | 'video' | 'unsupported';
export type SyntaxLanguage = 'text' | 'yaml' | 'json' | 'xml' | 'css' | 'csharp' | 'shaderlab' | 'hlsl' | 'glsl' | 'typescript' | 'javascript' | 'markdown' | 'html';

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

type EntryComponent = 'asset' | 'meta' | 'preview';

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

const yamlExtensions = new Set([
  'anim',
  'asset',
  'meta',
  'yaml',
  'yml',
  'unity',
  'prefab',
  'mat',
  'controller',
  'overridecontroller',
  'physicmaterial',
  'physicsmaterial2d',
  'playable',
  'mask',
  'brush',
  'flare',
  'fontsettings',
  'guiskin',
  'giparams',
  'rendertexture',
  'spriteatlas',
  'spriteatlasv2',
  'terrainlayer',
  'mixer',
  'shadervariants',
  'preset',
  'lighting',
  'dwlt',
  'vfx',
  'vfxblock',
  'vfxoperator',
]);

const jsonExtensions = new Set(['json', 'asmdef', 'asmref', 'inputactions', 'shadergraph', 'shadersubgraph']);
const xmlExtensions = new Set(['xml', 'uxml']);
const cssExtensions = new Set(['css', 'uss', 'tss']);
const csharpExtensions = new Set(['cs']);
const shaderlabExtensions = new Set(['shader']);
const hlslExtensions = new Set(['cginc', 'compute', 'hlsl']);
const glslExtensions = new Set(['glsl']);
const typescriptExtensions = new Set(['ts', 'tsx']);
const javascriptExtensions = new Set(['js', 'jsx']);
const markdownExtensions = new Set(['md']);
const htmlExtensions = new Set(['html']);
const textExtensions = new Set([
  ...yamlExtensions,
  ...jsonExtensions,
  ...xmlExtensions,
  ...cssExtensions,
  ...csharpExtensions,
  ...shaderlabExtensions,
  ...hlslExtensions,
  ...glslExtensions,
  ...typescriptExtensions,
  ...javascriptExtensions,
  ...markdownExtensions,
  ...htmlExtensions,
  'txt',
]);

const imageExtensions = new Set(['apng', 'avif', 'bmp', 'gif', 'jpg', 'jpeg', 'png', 'svg', 'webp']);
const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav', 'webm']);
const videoExtensions = new Set(['m4v', 'mov', 'mp4', 'ogv', 'webm']);

export function entriesToRecords(
  entries: UnityPackageEntry[],
  diagnostics: UnityPackageParseDiagnostic[],
): PackageFileRecord[] {
  const pathCounts = new Map<string, number>();
  for (const entry of entries) {
    pathCounts.set(entry.pathname, (pathCounts.get(entry.pathname) ?? 0) + 1);
  }

  const records: PackageFileRecord[] = [];
  for (const entry of entries) {
    if (entry.asset) {
      records.push(createRecord(entry, 'asset', entry.pathname, entry.asset, pathCounts, getRecordDiagnostics(entry, 'asset', diagnostics)));
    }

    if (entry.meta) {
      records.push(createRecord(entry, 'meta', `${entry.pathname}.meta`, entry.meta, pathCounts, getRecordDiagnostics(entry, 'meta', diagnostics)));
    }

    if (entry.preview) {
      records.push(createRecord(entry, 'preview', `${entry.pathname}.preview.png`, entry.preview, pathCounts, getRecordDiagnostics(entry, 'preview', diagnostics)));
    }
  }

  return records.sort((a, b) => a.virtualPath.localeCompare(b.virtualPath) || a.guid.localeCompare(b.guid));
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
  const extension = getExtension(path);
  if (extension === 'pdf') return 'pdf';
  if (imageExtensions.has(extension)) return 'image';
  if (audioExtensions.has(extension)) return 'audio';
  if (videoExtensions.has(extension)) return 'video';
  if (textExtensions.has(extension) || isLikelyUtf8Text(bytes)) return 'text';
  return 'unsupported';
}

export function getMimeType(path: string): string {
  const extension = getExtension(path);
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'json') return 'application/json';
  if (extension === 'md') return 'text/markdown';
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'wav') return 'audio/wav';
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4';
  if (textExtensions.has(extension)) return 'text/plain;charset=utf-8';
  return 'application/octet-stream';
}

export function getSyntaxLanguage(path: string): SyntaxLanguage {
  const extension = getExtension(path);
  if (yamlExtensions.has(extension)) return 'yaml';
  if (jsonExtensions.has(extension)) return 'json';
  if (xmlExtensions.has(extension)) return 'xml';
  if (cssExtensions.has(extension)) return 'css';
  if (csharpExtensions.has(extension)) return 'csharp';
  if (shaderlabExtensions.has(extension)) return 'shaderlab';
  if (hlslExtensions.has(extension)) return 'hlsl';
  if (glslExtensions.has(extension)) return 'glsl';
  if (typescriptExtensions.has(extension)) return 'typescript';
  if (javascriptExtensions.has(extension)) return 'javascript';
  if (markdownExtensions.has(extension)) return 'markdown';
  if (htmlExtensions.has(extension)) return 'html';
  return 'text';
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

function createRecord(
  entry: UnityPackageEntry,
  component: EntryComponent,
  virtualPath: string,
  content: Uint8Array,
  pathCounts: ReadonlyMap<string, number>,
  diagnostics: UnityPackageParseDiagnostic[],
): PackageFileRecord {
  const fileName = virtualPath.split('/').pop() ?? virtualPath;
  const extension = getExtension(virtualPath);
  return {
    id: `${entry.guid}:${virtualPath}`,
    guid: entry.guid,
    pathname: entry.pathname,
    virtualPath,
    fileName,
    extension,
    mimeType: getMimeType(virtualPath),
    isUnityPreview: component === 'preview',
    content,
    byteLength: content.byteLength,
    hasAsset: Boolean(entry.asset),
    hasMeta: Boolean(entry.meta),
    hasPreview: Boolean(entry.preview),
    assetSize: entry.asset?.byteLength,
    metaSize: entry.meta?.byteLength,
    previewSize: entry.preview?.byteLength,
    duplicatePathCount: pathCounts.get(entry.pathname) ?? 1,
    previewKind: getPreviewKind(virtualPath, content),
    syntaxLanguage: getSyntaxLanguage(virtualPath),
    diagnostics,
  };
}

function getRecordDiagnostics(
  entry: UnityPackageEntry,
  component: EntryComponent,
  diagnostics: UnityPackageParseDiagnostic[],
): UnityPackageParseDiagnostic[] {
  return diagnostics.filter(diagnostic => {
    if (diagnostic.guid !== entry.guid && !diagnostic.path?.startsWith(`${entry.guid}/`)) {
      return false;
    }

    if (diagnostic.code === 'ignored-preview') {
      return false; // preview is surfaced as its own record; not ignored in entry-aware parsing
    }

    // duplicate-guid: route to 'asset' (primary representative of the entry)
    if (diagnostic.code === 'duplicate-guid') {
      return component === 'asset';
    }

    // asset-missing: asset record does not exist; attach to 'meta' (the only present component)
    if (diagnostic.code === 'asset-missing') {
      return component === 'meta';
    }

    // meta-missing: meta record does not exist; attach to 'asset' (the only present component)
    if (diagnostic.code === 'meta-missing') {
      return component === 'asset';
    }

    // oversized-entry-name: prefer 'asset', fall back to 'meta' when asset is absent
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

function getExtension(path: string): string {
  const fileName = path.split('/').pop() ?? path;
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return '';
  return fileName.slice(dotIndex + 1).toLowerCase();
}

function isLikelyUtf8Text(bytes?: Uint8Array): boolean {
  if (!bytes || bytes.byteLength === 0) return false;
  const sample = bytes.slice(0, Math.min(bytes.byteLength, 512));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.byteLength < 0.08;
}
