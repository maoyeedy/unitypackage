import {
  detectMetaImporterType,
  entriesToComponentRecords,
  getMimeTypeForPath,
  getPreviewKindForPath,
  getSyntaxLanguageForPath,
  readDeclaredMetaImporter,
  readMetaGuid,
  validatePathname,
  generateGuid,
  createMinimalMetaFor,
  createMinimalFolderMeta,
  type MetaImporterType,
  type PreviewKind,
  type SidecarSelectableRecord,
  type SyntaxLanguage,
  type UnityPackageAnalysisFinding,
  type UnityPackageEntry,
  type UnityPackageParseDiagnostic,
} from 'unitypackage-core';

export type { MetaImporterType, PreviewKind, SidecarSelectableRecord, SyntaxLanguage, UnityPackageAnalysisFinding, ResolveMetaSidecarsResult } from 'unitypackage-core';
export { resolveMetaSidecarSelection, readMetaGuid, readDeclaredMetaImporter } from 'unitypackage-core';

export type WorkspaceMode = 'extract' | 'pack';
export type GroupingMode = 'tree' | 'extension';
export type RecordCategory = 'asset' | 'meta' | 'preview';
export type FilterMatchMode = 'filename' | 'path' | 'guid';
export type SortKey = 'name' | 'size' | 'extension' | 'guid';
export type SortDirection = 'asc' | 'desc';

export interface FilterState {
  query: string;
  matchMode: FilterMatchMode;
  caseSensitive: boolean;
  globMode: boolean;
  categories: ReadonlySet<RecordCategory>;
  sizeMin: string;
  sizeMax: string;
  diagCodes: ReadonlySet<string>;
}

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
  findings: UnityPackageAnalysisFinding[];
  meta?: Uint8Array;
  isRawImported?: boolean;
  isDirectory?: boolean;
}

export function getRecordCategory(record: PackageFileRecord): RecordCategory {
  if (record.isUnityPreview) return 'preview';
  if (record.extension === 'meta') return 'meta';
  return 'asset';
}

/**
 * Adapts a PackageFileRecord[] to the shape resolveMetaSidecarSelection expects.
 * Uses getRecordCategory(record) for the 'kind' field.
 * This is the only place that produces SidecarSelectableRecord from PackageFileRecord.
 */
export function toSidecarSelectableRecords(records: PackageFileRecord[]): SidecarSelectableRecord[] {
  return records.map(record => ({
    id: record.id,
    guid: record.guid,
    pathname: record.virtualPath,
    kind: getRecordCategory(record),
  }));
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

export type PackDraftDiagnosticCode =
  | 'missing-meta'
  | 'duplicate-guid'
  | 'oversized-pathname'
  | 'empty-entries'
  | 'preview-record'
  | 'no-assets'
  | 'invalid-pathname';

export interface PackDraftDiagnostic {
  code: PackDraftDiagnosticCode;
  message: string;
  recordId?: string;
}

export interface PackValidation {
  status: 'ready' | 'blocked';
  diagnostics: PackDraftDiagnostic[];
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
    findings: [],
  }));
}

/**
 * Attaches analysis findings to matching records in-place.
 *
 * Routing priority:
 * 1. guid match: attach to all records with the same GUID.
 * 2. pathname match: attach to all records whose `pathname` equals the finding
 *    `pathname` (when guid is absent).
 * 3. path match: attach to the record whose `id` ends with the finding `path`
 *    suffix (e.g. `<guid>/asset.meta` points at the meta record).
 *
 * A finding without any of guid, pathname, or path is appended to all records
 * so it is always visible.
 */
export function routeAnalysisFindings(
  records: PackageFileRecord[],
  findings: UnityPackageAnalysisFinding[],
): void {
  for (const record of records) {
    record.findings = [];
  }

  for (const finding of findings) {
    let matched = false;

    if (finding.guid !== undefined) {
      for (const record of records) {
        if (record.guid === finding.guid) {
          record.findings.push(finding);
          matched = true;
        }
      }
    } else if (finding.pathname !== undefined) {
      for (const record of records) {
        if (record.pathname === finding.pathname) {
          record.findings.push(finding);
          matched = true;
        }
      }
    }

    if (!matched && finding.path !== undefined) {
      for (const record of records) {
        if (record.id.endsWith(`/${finding.path}`) || record.id === finding.path) {
          record.findings.push(finding);
          matched = true;
        }
      }
    }

    if (!matched) {
      for (const record of records) {
        record.findings.push(finding);
      }
    }
  }
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

/**
 * Keyboard range selection helper.
 * Given the full list of navigable row IDs (including folders/headers),
 * the anchor row ID, the target row ID, the set of all valid file record IDs,
 * the base selected set, and the selection mode ('add' | 'remove'),
 * returns the next set of selected file IDs.
 */
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
  const rangeRowIds = navigableRowIds.slice(startIndex, endIndex + 1);

  // Filter range to only include valid file IDs
  const rangeFileIds = rangeRowIds.filter(id => validFileIds.has(id));

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

/**
 * Parses a human byte-size shorthand string into a byte count.
 *
 * Accepts numeric strings with optional suffix: k/K = 1024, m/M = 1024^2,
 * g/G = 1024^3. Bare numbers are treated as bytes. Returns null when the
 * input is empty or not parseable.
 *
 * Examples: '100k' => 102400, '2m' => 2097152, '512' => 512.
 */
export function parseSize(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /^(\d+(?:\.\d+)?)(k|m|g)?$/i.exec(trimmed);
  if (!match) return null;
  const value = parseFloat(match[1] ?? '0');
  const suffix = (match[2] ?? '').toLowerCase();
  if (suffix === 'k') return Math.round(value * 1024);
  if (suffix === 'm') return Math.round(value * 1024 * 1024);
  if (suffix === 'g') return Math.round(value * 1024 * 1024 * 1024);
  return Math.round(value);
}

/**
 * Tiny browser-safe glob matcher that supports:
 * - `**` matching any number of path segments (including none)
 * - `*`  matching any characters within a single segment
 * - `?`  matching exactly one character
 * - All other characters match literally.
 *
 * The path is tested against the full string (anchored at both ends).
 */
export function matchGlob(pattern: string, path: string): boolean {
  // Build a regex from the glob pattern token-by-token.
  // Process `**` before `*` to avoid double-substitution.
  let regexSource = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      // `**` matches zero or more characters including slashes.
      // When followed by a `/` separator we make both the `**/` and the empty
      // match optional so that `**/*.cs` matches root-level `Player.cs`.
      if (pattern[i + 2] === '/') {
        regexSource += '(?:.+/)?';
        i += 3; // skip **/
      } else {
        regexSource += '.*';
        i += 2;
      }
    } else if (pattern[i] === '*') {
      // `*` matches any character except `/`
      regexSource += '[^/]*';
      i += 1;
    } else if (pattern[i] === '?') {
      // `?` matches exactly one character (except `/`)
      regexSource += '[^/]';
      i += 1;
    } else {
      // Escape regex special chars
      regexSource += (pattern[i] ?? '').replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${regexSource}$`).test(path);
}

/**
 * Returns true when the record matches all space-separated terms in the query
 * against the active match field.
 *
 * Terms are split on whitespace. An empty query always matches.
 * When globMode is true each term is treated as a glob pattern matched against
 * the full field value. Otherwise a simple substring (or prefix-exact) test is
 * used.
 */
export function matchRecord(
  record: PackageFileRecord,
  query: string,
  mode: FilterMatchMode,
  caseSensitive: boolean,
  globMode: boolean,
): boolean {
  const rawQuery = query.trim();
  if (!rawQuery) return true;

  const terms = rawQuery.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  let fieldValue: string;
  switch (mode) {
    case 'filename': fieldValue = record.fileName; break;
    case 'path':     fieldValue = record.virtualPath; break;
    case 'guid':     fieldValue = record.guid; break;
  }

  const field = caseSensitive ? fieldValue : fieldValue.toLowerCase();

  return terms.every(rawTerm => {
    const term = caseSensitive ? rawTerm : rawTerm.toLowerCase();
    if (globMode) return matchGlob(term, field);
    return field.includes(term);
  });
}

export interface RecordFilterOptions {
  query: string;
  matchMode: FilterMatchMode;
  caseSensitive: boolean;
  globMode: boolean;
  /** When empty Set, all categories pass. */
  categories: ReadonlySet<RecordCategory>;
  /** Raw string input; empty string means no min bound. */
  sizeMin: string;
  /** Raw string input; empty string means no max bound. */
  sizeMax: string;
  /** When empty Set, all diagnostic codes pass. */
  diagCodes: ReadonlySet<string>;
  includeMetaSidecars: boolean;
}

/**
 * Applies all active filters to a record list.
 *
 * Ordering:
 * 1. Text query (AND-of-terms, respects matchMode / caseSensitive / globMode)
 * 2. Category chips (Assets, Meta, Previews)
 * 3. Size range (sizeMin / sizeMax in parsed bytes)
 * 4. Diagnostic-code chips (record must carry at least one matching code)
 * 5. Meta-sidecar visibility (includeMetaSidecars)
 */
export function filterRecords(
  records: PackageFileRecord[],
  options: RecordFilterOptions,
): PackageFileRecord[] {
  const {
    query,
    matchMode,
    caseSensitive,
    globMode,
    categories,
    sizeMin,
    sizeMax,
    diagCodes,
    includeMetaSidecars,
  } = options;

  const minBytes = parseSize(sizeMin);
  const maxBytes = parseSize(sizeMax);
  const hasCategories = categories.size > 0;
  const hasDiagCodes = diagCodes.size > 0;

  return records.filter(record => {
    // 1. Meta-sidecar visibility
    if (!includeMetaSidecars && record.extension === 'meta') return false;

    // 2. Text query
    if (!matchRecord(record, query, matchMode, caseSensitive, globMode)) return false;

    // 3. Category chips
    if (hasCategories && !categories.has(getRecordCategory(record))) return false;

    // 4. Size range
    if (minBytes !== null && record.byteLength < minBytes) return false;
    if (maxBytes !== null && record.byteLength > maxBytes) return false;

    // 5. Diagnostic-code chips
    if (hasDiagCodes) {
      const allCodes = [
        ...record.diagnostics.map(d => d.code),
        ...record.findings.map(f => f.code),
      ];
      if (!allCodes.some(code => diagCodes.has(code))) return false;
    }

    return true;
  });
}

/**
 * Returns a stable-sorted copy of records.
 *
 * Primary key: the selected SortKey. Secondary key: virtualPath (stable
 * tie-breaker so ordering is deterministic even when primary values collide).
 */
export function sortRecords(
  records: PackageFileRecord[],
  key: SortKey,
  direction: SortDirection,
): PackageFileRecord[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...records].sort((a, b) => {
    let primary = 0;
    switch (key) {
      case 'name':      primary = a.fileName.localeCompare(b.fileName); break;
      case 'size':      primary = a.byteLength - b.byteLength; break;
      case 'extension': primary = a.extension.localeCompare(b.extension); break;
      case 'guid':      primary = a.guid.localeCompare(b.guid); break;
    }
    if (primary !== 0) return primary * factor;
    // Stable secondary sort by path, always ascending
    return a.virtualPath.localeCompare(b.virtualPath);
  });
}

/**
 * Collects all unique diagnostic codes present on the given records.
 * Returns codes sorted alphabetically.
 */
export function collectDiagCodes(records: PackageFileRecord[]): string[] {
  const codes = new Set<string>();
  for (const record of records) {
    for (const d of record.diagnostics) codes.add(d.code);
    for (const f of record.findings) codes.add(f.code);
  }
  return [...codes].sort();
}

/**
 * Returns the Unity importer type expected for the record's pathname, as
 * determined by `detectMetaImporterType` from `unitypackage-core`.
 *
 * For meta records (extension === 'meta'), strips the trailing `.meta` before
 * passing the pathname to the detector so the importer type reflects the
 * underlying asset, not the sidecar.
 *
 * Preview records (isUnityPreview) are folder-like synthetic entries; they
 * are detected against their raw pathname.
 */
export function getExpectedImporterTypeForRecord(record: PackageFileRecord): MetaImporterType {
  let pathname = record.pathname;
  if (record.extension === 'meta' && pathname.endsWith('.meta')) {
    pathname = pathname.slice(0, -5);
  }
  return detectMetaImporterType(pathname);
}

/**
 * Finds the meta sibling record for the given record among `records`.
 *
 * Returns the record whose `extension === 'meta'` and whose `guid` matches the
 * given record's guid. Returns `undefined` if no such sibling exists.
 */
export function getSiblingMetaRecord(
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

/**
 * Reads the declared GUID and importer name from the record's meta sidecar.
 *
 * Uses the record's own content when it is a meta record; otherwise falls back
 * to the content of its sibling meta record from `records`.
 *
 * Returns `{ guid: undefined, importer: undefined }` when no meta bytes are
 * available.
 */
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

/**
 * Returns the ordered ancestor folder paths for the given virtualPath.
 * E.g. "Assets/Scripts/Player.cs" => ["Assets", "Assets/Scripts"].
 */
export function getAncestorFolderPaths(virtualPath: string): string[] {
  const parts = virtualPath.split('/').filter(Boolean);
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    ancestors.push(parts.slice(0, i).join('/'));
  }
  return ancestors;
}

/**
 * Returns a new collapsed-folders Set with all ancestor folders of
 * `virtualPath` removed (i.e. expanded) so the record is visible.
 */
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

/**
 * Finds the first record whose virtualPath matches `virtualPath`.
 * Returns `undefined` when no match exists.
 */
export function findRecordByVirtualPath(
  records: PackageFileRecord[],
  virtualPath: string,
): PackageFileRecord | undefined {
  return records.find(record => record.virtualPath === virtualPath);
}

/**
 * Returns all unique folder paths present in the given records, ordered
 * by path (shallow before deep).
 */
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

export function validatePackDraft(
  stagedRecords: PackageFileRecord[],
  allRecords: PackageFileRecord[] = stagedRecords,
): PackValidation {
  const diagnostics: PackDraftDiagnostic[] = [];
  const stagedAssets = stagedRecords.filter(record => !record.isUnityPreview && record.extension !== 'meta');
  const unsupported = stagedRecords.filter(record => record.isUnityPreview);
  const guidCounts = new Map<string, number>();

  for (const record of stagedAssets) {
    guidCounts.set(record.guid, (guidCounts.get(record.guid) ?? 0) + 1);
    
    // Look for meta record in stagedRecords, then in allRecords, or record.meta
    const hasMeta = !!record.meta ||
                    stagedRecords.some(r => r.guid === record.guid && r.extension === 'meta') ||
                    allRecords.some(r => r.guid === record.guid && r.extension === 'meta');
    if (!hasMeta) {
      diagnostics.push({
        code: 'missing-meta',
        message: `${record.pathname} is missing metadata.`,
        recordId: record.id,
      });
    }

    // Use validatePathname for safety and tar entry budget checks
    const pathVal = validatePathname(record.pathname, { guid: record.guid });
    if (record.pathname.length > 200) {
      diagnostics.push({
        code: 'oversized-pathname',
        message: `Pathname validation failed for ${record.pathname}: pathname exceeds 200 characters (${record.pathname.length})`,
        recordId: record.id,
      });
    }
    if (!pathVal.ok) {
      if (pathVal.reason === 'oversized-tar-entry') {
        diagnostics.push({
          code: 'oversized-pathname',
          message: `Pathname validation failed for ${record.pathname}: tar entry name is too long (${pathVal.detail} bytes)`,
          recordId: record.id,
        });
      } else {
        diagnostics.push({
          code: 'invalid-pathname',
          message: `Pathname validation failed for ${record.pathname}: ${pathVal.reason}`,
          recordId: record.id,
        });
      }
    }
  }

  for (const record of unsupported) {
    diagnostics.push({
      code: 'preview-record',
      message: `${record.virtualPath} is a preview record and cannot be packed directly.`,
      recordId: record.id,
    });
  }

  for (const record of stagedAssets) {
    if ((guidCounts.get(record.guid) ?? 0) > 1) {
      diagnostics.push({
        code: 'duplicate-guid',
        message: `${record.guid} is staged more than once.`,
        recordId: record.id,
      });
    }
  }

  if (stagedRecords.length === 0) {
    diagnostics.push({
      code: 'empty-entries',
      message: 'Stage at least one extracted asset before packing.',
    });
  }

  if (stagedAssets.length === 0 && stagedRecords.length > 0) {
    diagnostics.push({
      code: 'no-assets',
      message: 'Only asset records can become package entries.',
    });
  }

  const hasFatal = diagnostics.length > 0;
  const status = (!hasFatal && stagedAssets.length > 0) ? 'ready' : 'blocked';

  return {
    status,
    diagnostics,
    createEntryCount: stagedAssets.length,
  };
}

export interface FileSystemFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export interface RecentPackage {
  key: string;
  name: string;
  size: number;
  headHash: string;
  openedAt: number;
  fileHandle?: FileSystemFileHandle | null;
}

export async function computeHeadHash(file: File | Blob): Promise<string> {
  const size = file.size;
  const chunk = file.slice(0, Math.min(size, 64 * 1024));
  const arrayBuffer = await chunk.arrayBuffer();
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return `mock-hash-${arrayBuffer.byteLength}`;
}

const DB_NAME = 'unitypackage-web-db';
const DB_VERSION = 1;
const STORE_NAME = 'recents';

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(new Error(request.error?.message ?? 'Database open failed'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

export async function getRecentPackages(): Promise<RecentPackage[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to get records'));
      request.onsuccess = () => {
        const results = request.result as RecentPackage[];
        results.sort((a, b) => b.openedAt - a.openedAt);
        resolve(results);
      };
    });
  } catch (err) {
    console.error('Failed to get recents from IndexedDB:', err);
    return [];
  }
}

export async function addRecentPackage(recent: Omit<RecentPackage, 'openedAt'>): Promise<void> {
  try {
    const db = await openDatabase();
    const item: RecentPackage = {
      ...recent,
      openedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(item);
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to put record'));
      request.onsuccess = () => resolve();
    });

    const recents = await getRecentPackages();
    if (recents.length > 10) {
      const toDelete = recents.slice(10);
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      for (const entry of toDelete) {
        store.delete(entry.key);
      }
    }
  } catch (err) {
    console.error('Failed to add recent package to IndexedDB:', err);
  }
}

export async function removeRecentPackage(key: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to delete record'));
      request.onsuccess = () => resolve();
    });
  } catch (err) {
    console.error('Failed to remove recent package from IndexedDB:', err);
  }
}

export interface RawDroppedFile {
  relativePath: string;
  content: Uint8Array;
  isDirectory: boolean;
}

export interface PairedDroppedItem {
  pathname: string;
  guid: string;
  content: Uint8Array;
  meta: Uint8Array;
  isDirectory: boolean;
  isLoose: boolean;
}

export function getUniqueGuid(preferredGuid: string | null, existingGuids: Set<string>): string {
  const guid = (preferredGuid ?? generateGuid()).toLowerCase();
  if (!existingGuids.has(guid)) {
    return guid;
  }
  for (let i = 0; i < 4; i++) {
    const nextGuid = generateGuid().toLowerCase();
    if (!existingGuids.has(nextGuid)) {
      return nextGuid;
    }
  }
  throw new Error('GUID collision: Failed to generate a unique GUID after 4 retries.');
}

export function updateMetaBytesGuid(metaBytes: Uint8Array, newGuid: string): Uint8Array {
  const text = new TextDecoder().decode(metaBytes);
  let updatedText = text;
  if (/guid:\s*[0-9a-fA-F]{32}/.test(text)) {
    updatedText = text.replace(/guid:\s*[0-9a-fA-F]{32}/, `guid: ${newGuid}`);
  } else {
    updatedText = `guid: ${newGuid}\n` + text;
  }
  return new TextEncoder().encode(updatedText);
}

export function pairDroppedItems(
  dropped: RawDroppedFile[],
  existingGuids: Set<string>,
): PairedDroppedItem[] {
  const results: PairedDroppedItem[] = [];
  const usedGuidsInBatch = new Set<string>(existingGuids);

  // Normalize paths (backslashes to forward slashes, trim)
  const normalized = dropped.map(d => ({
    ...d,
    relativePath: d.relativePath.replace(/\\/g, '/').trim(),
  }));

  // Separate assets (files/folders not ending with .meta) and metas
  const assets = normalized.filter(d => d.isDirectory || !d.relativePath.toLowerCase().endsWith('.meta'));
  const metas = normalized.filter(d => !d.isDirectory && d.relativePath.toLowerCase().endsWith('.meta'));

  for (const asset of assets) {
    const metaPath = `${asset.relativePath}.meta`;
    const matchingMeta = metas.find(m => m.relativePath === metaPath);

    let guid: string;
    let metaBytes: Uint8Array;
    let isLoose = false;

    if (matchingMeta) {
      const parsedGuid = readMetaGuid(matchingMeta.content) ?? undefined;
      
      guid = getUniqueGuid(parsedGuid ?? null, usedGuidsInBatch);
      if (guid !== parsedGuid) {
        metaBytes = updateMetaBytesGuid(matchingMeta.content, guid);
      } else {
        metaBytes = matchingMeta.content;
      }
    } else {
      isLoose = true;
      guid = getUniqueGuid(null, usedGuidsInBatch);
      const metaText = asset.isDirectory
        ? createMinimalFolderMeta(guid)
        : createMinimalMetaFor(guid, asset.relativePath);
      metaBytes = new TextEncoder().encode(metaText);
    }

    usedGuidsInBatch.add(guid);

    results.push({
      pathname: asset.relativePath,
      guid,
      content: asset.content,
      meta: metaBytes,
      isDirectory: asset.isDirectory,
      isLoose,
    });
  }

  return results;
}


