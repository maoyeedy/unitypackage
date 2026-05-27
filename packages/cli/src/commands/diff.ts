import crypto from 'node:crypto';
import { parseUnityPackageEntries, type ParseUnityPackageOptions, type UnityPackageEntry } from 'unitypackage-core';
import { info } from '../util/logger.js';
import { readPackageBytes } from '../util/package.js';
import { writeJsonResult } from '../util/output.js';

interface DiffEntry {
  guid: string;
  pathname: string;
  assetHash: string | null;
  metaHash: string | null;
  previewHash: string | null;
}

interface ChangedDiffEntry {
  guid: string;
  before: DiffEntry;
  after: DiffEntry;
  changed: DiffChangedComponent[];
}

type DiffChangedComponent = 'pathname' | 'asset' | 'meta' | 'preview';

export interface DiffResult {
  schemaVersion: 0;
  packages: { before: string; after: string };
  summary: { added: number; removed: number; changed: number };
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: ChangedDiffEntry[];
}

export interface DiffOptions {
  json?: boolean;
  parseOptions?: ParseUnityPackageOptions;
}

export async function diff(packageA: string, packageB: string, opts: DiffOptions = {}): Promise<DiffResult> {
  const before = await loadEntries(packageA, opts.parseOptions);
  const after = await loadEntries(packageB, opts.parseOptions);
  const beforeByGuid = new Map(before.map(entry => [entry.guid, toDiffEntry(entry)]));
  const afterByGuid = new Map(after.map(entry => [entry.guid, toDiffEntry(entry)]));
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const changed: ChangedDiffEntry[] = [];

  for (const entry of afterByGuid.values()) {
    if (!beforeByGuid.has(entry.guid)) added.push(entry);
  }

  for (const entry of beforeByGuid.values()) {
    const afterEntry = afterByGuid.get(entry.guid);
    if (!afterEntry) {
      removed.push(entry);
    } else {
      const changedComponents = getChangedComponents(entry, afterEntry);
      if (changedComponents.length > 0) {
        changed.push({ guid: entry.guid, before: entry, after: afterEntry, changed: changedComponents });
      }
    }
  }

  sortEntries(added);
  sortEntries(removed);
  changed.sort((a, b) => a.guid.localeCompare(b.guid));

  const result: DiffResult = {
    schemaVersion: 0,
    packages: { before: packageA, after: packageB },
    summary: { added: added.length, removed: removed.length, changed: changed.length },
    added,
    removed,
    changed,
  };

  if (opts.json) {
    writeJsonResult(result);
  } else {
    printDiff(result);
  }

  return result;
}

async function loadEntries(packagePath: string, parseOptions?: ParseUnityPackageOptions): Promise<UnityPackageEntry[]> {
  const raw = await readPackageBytes(packagePath);
  const { entries } = parseUnityPackageEntries(raw, parseOptions);
  return entries;
}

function toDiffEntry(entry: UnityPackageEntry): DiffEntry {
  return {
    guid: entry.guid,
    pathname: entry.pathname,
    assetHash: hashBytes(entry.asset),
    metaHash: hashBytes(entry.meta),
    previewHash: hashBytes(entry.preview),
  };
}

function hashBytes(bytes: Uint8Array | undefined): string | null {
  return bytes ? crypto.createHash('sha256').update(bytes).digest('hex') : null;
}

function getChangedComponents(before: DiffEntry, after: DiffEntry): DiffChangedComponent[] {
  const changed: DiffChangedComponent[] = [];
  if (before.pathname !== after.pathname) changed.push('pathname');
  if (before.assetHash !== after.assetHash) changed.push('asset');
  if (before.metaHash !== after.metaHash) changed.push('meta');
  if (before.previewHash !== after.previewHash) changed.push('preview');
  return changed;
}

function sortEntries(entries: DiffEntry[]): void {
  entries.sort((a, b) => a.guid.localeCompare(b.guid));
}

function formatEntry(entry: DiffEntry): string {
  return `${entry.guid} ${entry.pathname} asset=${entry.assetHash ?? '<none>'} meta=${entry.metaHash ?? '<none>'} preview=${entry.previewHash ?? '<none>'}`;
}

function printDiff(result: DiffResult): void {
  if (result.added.length === 0 && result.removed.length === 0 && result.changed.length === 0) {
    info('No differences.');
    return;
  }

  info(`Added: ${result.summary.added}`);
  for (const entry of result.added) info(`  + ${formatEntry(entry)}`);

  info(`Removed: ${result.summary.removed}`);
  for (const entry of result.removed) info(`  - ${formatEntry(entry)}`);

  info(`Changed: ${result.summary.changed}`);
  for (const entry of result.changed) {
    info(`  ~ ${entry.guid} changed=${entry.changed.join(',')}`);
    info(`    before ${formatEntry(entry.before)}`);
    info(`    after  ${formatEntry(entry.after)}`);
  }
}
