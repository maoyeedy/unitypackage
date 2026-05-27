import crypto from 'node:crypto';
import {
  entriesToComponentRecords,
  matchGlob,
  summarizePackage,
  parseUnityPackageEntries,
  isUnityYamlBinary,
  yamlExtensions,
  type ParseUnityPackageOptions,
  type UnityPackageComponentRecord,
  type UnityPackageEntryComponent,
  type UnityPackageEntry,
  type UnityPackageParseDiagnostic,
  type UnityPackageSummary,
  type PreviewKind,
  type SyntaxLanguage,
} from 'unitypackage-core';
import { info } from '../util/logger.js';
import { readPackageBytes } from '../util/package.js';
import { writeJsonResult } from '../util/output.js';

interface InspectEntry {
  guid: string;
  pathname: string;
  hasAsset: boolean;
  assetSize: number;
  hasMeta: boolean;
}

interface InspectComponent {
  id: string;
  guid: string;
  pathname: string;
  virtualPath: string;
  component: UnityPackageEntryComponent;
  byteLength: number;
  extension: string;
  mimeType: string;
  previewKind: PreviewKind;
  syntaxLanguage: SyntaxLanguage;
  diagnostics: UnityPackageParseDiagnostic[];
  hasAsset: boolean;
  hasMeta: boolean;
  hasPreview: boolean;
  assetSize?: number;
  metaSize?: number;
  previewSize?: number;
  duplicatePathCount: number;
}

export interface InspectResult {
  schemaVersion: 0;
  package: { path: string; size: number; sha256: string };
  summary: InspectSummary;
  entries: InspectEntry[];
  components: InspectComponent[];
}

export interface InspectOptions {
  json?: boolean;
  format?: 'list' | 'tree';
  filter?: string;
  exclude?: string;
  parseOptions?: ParseUnityPackageOptions;
}

interface InspectSummary extends UnityPackageSummary {
  entries: number;
  withAsset: number;
  withMeta: number;
  folders: number;
}

interface TreeNode {
  entry?: InspectEntry;
  children: Map<string, TreeNode>;
}

function matchesExtension(pathname: string, ext: string): boolean {
  return pathname.toLowerCase().endsWith(`.${ext.toLowerCase()}`);
}

function matchesInspectFilter(pathname: string, filter: string): boolean {
  return /[*?[\]{}]/.test(filter) || filter.includes('/')
    ? matchGlob(filter, pathname)
    : matchesExtension(pathname, filter);
}

function summarize(entries: UnityPackageEntry[], diagnostics?: UnityPackageParseDiagnostic[]): InspectSummary {
  const coreSummary = summarizePackage(entries, diagnostics);
  return {
    ...coreSummary,
    entries: coreSummary.entryCount,
    withAsset: coreSummary.fileCount,
    withMeta: entries.filter(e => e.meta !== undefined).length,
    folders: coreSummary.folderCount,
  };
}

const PREVIEW_SIZE_LIMIT_BYTES = 1 * 1024 * 1024;

const BINARY_ASSET_FILENAME_PATTERNS: RegExp[] = [
  /[Tt]errain.*\.asset$/,
  /TerrainData.*\.asset$/,
  /LightingData.*\.asset$/,
  /LightmapSnapshot.*\.asset$/,
  /NavMesh.*\.asset$/,
  /NavMeshData.*\.asset$/,
  /OcclusionCulling.*\.asset$/,
  /OcclusionCullingData.*\.asset$/,
  /SDF.*\.asset$/,
  /ProbeVolumeStreamable.*\.asset$/,
  /ProbeVolumeData.*\.asset$/,
];

function hasBinaryAssetFilename(pathname: string): boolean {
  const fileName = pathname.split('/').pop() ?? pathname;
  for (const pattern of BINARY_ASSET_FILENAME_PATTERNS) {
    if (pattern.test(fileName)) return true;
  }
  return false;
}

function getPreviewKind(record: UnityPackageComponentRecord): PreviewKind {
  const ext = record.extension;
  if (ext === 'pdf') return 'pdf';
  if (record.mimeType.startsWith('image/')) return 'image';
  if (record.mimeType.startsWith('audio/')) return 'audio';
  if (record.mimeType.startsWith('video/')) return 'video';
  if (record.byteLength > PREVIEW_SIZE_LIMIT_BYTES) return 'unsupported';
  if (ext === 'yaml' || ext === 'yml') return 'text';
  if (yamlExtensions.has(ext)) {
    if (hasBinaryAssetFilename(record.virtualPath)) return 'unsupported';
    return isUnityYamlBinary(record.content) ? 'unsupported' : 'text';
  }
  if (record.mimeType.startsWith('text/') || record.mimeType === 'application/json') return 'text';
  return 'unsupported';
}

const jsonExtensions = new Set(['json', 'asmdef', 'asmref', 'inputactions', 'shadergraph', 'shadersubgraph']);
const xmlExtensions = new Set(['xml', 'uxml']);
const cssExtensions = new Set(['css', 'uss', 'tss']);
const csharpExtensions = new Set(['cs']);
const shaderlabExtensions = new Set(['shader']);
const hlslExtensions = new Set(['hlsl', 'cginc', 'compute']);
const glslExtensions = new Set(['glsl']);
const typescriptExtensions = new Set(['ts', 'tsx']);
const javascriptExtensions = new Set(['js', 'jsx']);
const markdownExtensions = new Set(['md']);
const htmlExtensions = new Set(['html']);

function getSyntaxLanguage(record: UnityPackageComponentRecord): SyntaxLanguage {
  const ext = record.extension;
  if (ext === 'meta' || yamlExtensions.has(ext)) return 'yaml';
  if (jsonExtensions.has(ext)) return 'json';
  if (xmlExtensions.has(ext)) return 'xml';
  if (cssExtensions.has(ext)) return 'css';
  if (csharpExtensions.has(ext)) return 'csharp';
  if (shaderlabExtensions.has(ext)) return 'shaderlab';
  if (hlslExtensions.has(ext)) return 'hlsl';
  if (glslExtensions.has(ext)) return 'glsl';
  if (typescriptExtensions.has(ext)) return 'typescript';
  if (javascriptExtensions.has(ext)) return 'javascript';
  if (markdownExtensions.has(ext)) return 'markdown';
  if (htmlExtensions.has(ext)) return 'html';
  return 'text';
}

function toInspectComponent(record: UnityPackageComponentRecord): InspectComponent {
  return {
    id: record.id,
    guid: record.guid,
    pathname: record.pathname,
    virtualPath: record.virtualPath,
    component: record.component,
    byteLength: record.byteLength,
    extension: record.extension,
    mimeType: record.mimeType,
    previewKind: getPreviewKind(record),
    syntaxLanguage: getSyntaxLanguage(record),
    diagnostics: record.diagnostics,
    hasAsset: record.hasAsset,
    hasMeta: record.hasMeta,
    hasPreview: record.hasPreview,
    ...(record.assetSize !== undefined && { assetSize: record.assetSize }),
    ...(record.metaSize !== undefined && { metaSize: record.metaSize }),
    ...(record.previewSize !== undefined && { previewSize: record.previewSize }),
    duplicatePathCount: record.duplicatePathCount,
  };
}

function formatEntry(entry: InspectEntry): string {
  return entry.hasAsset ? ` (${entry.assetSize.toLocaleString()} bytes)` : ' [folder]';
}

function buildTree(entries: InspectEntry[]): TreeNode {
  const root: TreeNode = { children: new Map() };

  for (const entry of entries) {
    const parts = entry.pathname.split('/').filter(Boolean);
    let node = root;
    for (const part of parts) {
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map() };
        node.children.set(part, child);
      }
      node = child;
    }
    node.entry = entry;
  }

  return root;
}

function printTree(node: TreeNode, depth = 1): void {
  const names = [...node.children.keys()].sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    const child = node.children.get(name);
    if (!child) continue;
    const label = child.entry ? `${name}${formatEntry(child.entry)}` : `${name}/`;
    info(`${'  '.repeat(depth)}${label}`);
    printTree(child, depth + 1);
  }
}

export async function inspect(packagePath: string, opts: InspectOptions = {}): Promise<InspectResult> {
  const raw = await readPackageBytes(packagePath);
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const { entries, diagnostics } = parseUnityPackageEntries(raw, opts.parseOptions);
  const inspectEntries = entries.map(e => ({
    guid: e.guid,
    pathname: e.pathname,
    hasAsset: e.asset !== undefined,
    assetSize: e.asset?.byteLength ?? 0,
    hasMeta: e.meta !== undefined,
  }));
  const filterEntry = (pathname: string): boolean => {
    if (opts.filter !== undefined && !matchesInspectFilter(pathname, opts.filter)) return false;
    if (opts.exclude !== undefined && matchGlob(opts.exclude, pathname)) return false;
    return true;
  };
  const filteredEntries = inspectEntries.filter(e => filterEntry(e.pathname));
  const filteredPackageEntries = entries.filter(e => filterEntry(e.pathname));
  const filteredComponents = entriesToComponentRecords(filteredPackageEntries, diagnostics)
    .map(toInspectComponent);
  const summary = opts.filter
    ? summarize(filteredPackageEntries)
    : summarize(filteredPackageEntries, diagnostics);

  const result: InspectResult = {
    schemaVersion: 0,
    package: { path: packagePath, size: raw.length, sha256 },
    summary,
    entries: filteredEntries,
    components: filteredComponents,
  };

  if (opts.json) {
    writeJsonResult(result);
  } else {
    const { summary, package: pkg } = result;
    info(`Package: ${pkg.path} (${pkg.size.toLocaleString()} bytes)`);
    info(`SHA-256: ${pkg.sha256}`);
    info(`Entries: ${summary.entries} total (${summary.withAsset} with asset, ${summary.withMeta} with meta, ${summary.folders} folders)`);
    if (summary.byExtension.length > 0) {
      info('Top extensions:');
      for (const ext of summary.byExtension.slice(0, 5)) {
        const label = ext.extension === '' ? '[none]' : `.${ext.extension}`;
        info(`  ${label}: ${ext.count} (${ext.assetBytes.toLocaleString()} bytes)`);
      }
    }
    if (result.entries.length > 0) {
      info('');
      if (opts.format === 'tree') {
        printTree(buildTree(result.entries));
      } else {
        for (const e of result.entries) {
          info(`  ${e.pathname}${formatEntry(e)}`);
        }
      }
    }
  }

  return result;
}
