import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { parseUnityPackageEntries } from 'unitypackage-core';
import { info } from '../util/logger.js';

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
  summary: { entries: number; withAsset: number; withMeta: number; folders: number };
  entries: InspectEntry[];
}

export interface InspectOptions {
  json?: boolean;
  format?: 'list' | 'tree';
  filter?: string;
}

interface TreeNode {
  children: Map<string, TreeNode>;
  entry?: InspectEntry;
}

function matchesExtension(pathname: string, ext: string): boolean {
  const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return pathname.toLowerCase().endsWith(normalized);
}

function summarize(entries: InspectEntry[]): InspectResult['summary'] {
  return {
    entries: entries.length,
    withAsset: entries.filter(e => e.hasAsset).length,
    withMeta: entries.filter(e => e.hasMeta).length,
    folders: entries.filter(e => !e.hasAsset).length,
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
  const raw = await readFile(packagePath);
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const { entries } = parseUnityPackageEntries(new Uint8Array(raw));
  const inspectEntries = entries.map(e => ({
    guid: e.guid,
    pathname: e.pathname,
    hasAsset: e.asset !== undefined,
    assetSize: e.asset?.length ?? 0,
    hasMeta: e.meta !== undefined,
  }));
  const filteredEntries = opts.filter ? inspectEntries.filter(e => matchesExtension(e.pathname, opts.filter ?? '')) : inspectEntries;

  const result: InspectResult = {
    schemaVersion: 0,
    package: { path: packagePath, size: raw.length, sha256 },
    summary: summarize(filteredEntries),
    entries: filteredEntries,
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    const { summary, package: pkg } = result;
    info(`Package: ${pkg.path} (${pkg.size.toLocaleString()} bytes)`);
    info(`SHA-256: ${pkg.sha256}`);
    info(`Entries: ${summary.entries} total (${summary.withAsset} with asset, ${summary.withMeta} with meta, ${summary.folders} folders)`);
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
