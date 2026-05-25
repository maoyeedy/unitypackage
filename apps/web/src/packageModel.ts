import type { UnityPackageEntry, UnityPackageParseDiagnostic } from 'unitypackage-core';

export type WorkspaceMode = 'extract' | 'pack';
export type GroupingMode = 'tree' | 'extension';
export type PackageRecordKind = 'asset' | 'meta' | 'preview';
export type PreviewKind = 'text' | 'image' | 'pdf' | 'audio' | 'video' | 'unsupported';

export interface PackageFileRecord {
  id: string;
  guid: string;
  pathname: string;
  virtualPath: string;
  fileName: string;
  extension: string;
  mimeType: string;
  kind: PackageRecordKind;
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
  diagnostics: UnityPackageParseDiagnostic[];
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

const textExtensions = new Set([
  'anim',
  'asmdef',
  'asmref',
  'asset',
  'cginc',
  'compute',
  'controller',
  'cs',
  'css',
  'glsl',
  'hlsl',
  'html',
  'js',
  'json',
  'jsx',
  'mat',
  'md',
  'meta',
  'prefab',
  'shader',
  'ts',
  'tsx',
  'txt',
  'unity',
  'uss',
  'uxml',
  'xml',
  'yaml',
  'yml',
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

  return records.sort((a, b) => a.virtualPath.localeCompare(b.virtualPath) || a.kind.localeCompare(b.kind));
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

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function validatePackDraft(records: PackageFileRecord[]): PackValidation {
  const messages: string[] = [];
  const stagedAssets = records.filter(record => record.kind === 'asset');
  const unsupported = records.filter(record => record.kind === 'preview');
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
  kind: PackageRecordKind,
  virtualPath: string,
  content: Uint8Array,
  pathCounts: ReadonlyMap<string, number>,
  diagnostics: UnityPackageParseDiagnostic[],
): PackageFileRecord {
  const fileName = virtualPath.split('/').pop() ?? virtualPath;
  const extension = getExtension(virtualPath);
  const previewKind = kind === 'meta' ? 'text' : getPreviewKind(virtualPath, content);
  const mimeType = kind === 'meta' ? 'text/plain;charset=utf-8' : getMimeType(virtualPath);
  return {
    id: `${entry.guid}:${kind}:${virtualPath}`,
    guid: entry.guid,
    pathname: entry.pathname,
    virtualPath,
    fileName,
    extension,
    mimeType,
    kind,
    content,
    byteLength: content.byteLength,
    hasAsset: Boolean(entry.asset),
    hasMeta: Boolean(entry.meta),
    hasPreview: Boolean(entry.preview),
    assetSize: entry.asset?.byteLength,
    metaSize: entry.meta?.byteLength,
    previewSize: entry.preview?.byteLength,
    duplicatePathCount: pathCounts.get(entry.pathname) ?? 1,
    previewKind,
    diagnostics,
  };
}

function getRecordDiagnostics(
  entry: UnityPackageEntry,
  kind: PackageRecordKind,
  diagnostics: UnityPackageParseDiagnostic[],
): UnityPackageParseDiagnostic[] {
  return diagnostics.filter(diagnostic => {
    if (diagnostic.guid !== entry.guid && !diagnostic.path?.startsWith(`${entry.guid}/`)) {
      return false;
    }

    if (diagnostic.code === 'ignored-preview') {
      return kind === 'preview';
    }

    if (diagnostic.path?.endsWith('/preview.png')) {
      return kind === 'preview';
    }

    if (diagnostic.path?.endsWith('/asset.meta') || diagnostic.path?.endsWith('/metaData')) {
      return kind === 'meta';
    }

    if (diagnostic.path?.endsWith('/asset')) {
      return kind === 'asset';
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
