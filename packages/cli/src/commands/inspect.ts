import crypto from 'node:crypto';
import {
  summarizePackage,
  type ParseUnityPackageOptions,
  type UnityPackageEntry,
  type UnityPackageSummary,
} from 'unitypackage-core';
import { info } from '../util/logger.js';
import { parsePackageBytes, readPackageBytes } from '../util/package.js';
import { writeJsonResult } from '../util/output.js';

export interface InspectEntry {
  guid: string;
  pathname: string;
  hasAsset: boolean;
  assetSize: number;
  hasMeta: boolean;
}

export interface InspectResult {
  schemaVersion: 0;
  package: { path: string; size: number; sha256: string };
  summary: InspectSummary;
  entries: InspectEntry[];
}

export interface InspectOptions {
  json?: boolean;
  format?: 'list' | 'tree';
  filter?: string;
  parseOptions?: ParseUnityPackageOptions;
}

interface TreeNode {
  children: Map<string, TreeNode>;
  entry?: InspectEntry;
}

type InspectSummary = UnityPackageSummary & {
  entries: number;
  withAsset: number;
  withMeta: number;
  folders: number;
};

function matchesExtension(pathname: string, ext: string): boolean {
  const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return pathname.toLowerCase().endsWith(normalized);
}

function summarize(entries: UnityPackageEntry[], diagnostics?: ReturnType<typeof parsePackageBytes>['diagnostics']): InspectSummary {
  const coreSummary = summarizePackage(entries, diagnostics);
  return {
    ...coreSummary,
    entries: coreSummary.entryCount,
    withAsset: coreSummary.fileCount,
    withMeta: entries.filter(e => e.meta !== undefined).length,
    folders: coreSummary.folderCount,
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
  const { entries, diagnostics } = parsePackageBytes(raw, opts.parseOptions);
  const inspectEntries = entries.map(e => ({
    guid: e.guid,
    pathname: e.pathname,
    hasAsset: e.asset !== undefined,
    assetSize: e.asset?.byteLength ?? 0,
    hasMeta: e.meta !== undefined,
  }));
  const filteredEntries = opts.filter
    ? inspectEntries.filter(e => matchesExtension(e.pathname, opts.filter ?? ''))
    : inspectEntries;
  const filteredPackageEntries = opts.filter
    ? entries.filter(e => matchesExtension(e.pathname, opts.filter ?? ''))
    : entries;
  const summary = opts.filter
    ? summarize(filteredPackageEntries)
    : summarize(filteredPackageEntries, diagnostics);

  const result: InspectResult = {
    schemaVersion: 0,
    package: { path: packagePath, size: raw.length, sha256 },
    summary,
    entries: filteredEntries,
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
