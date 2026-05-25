import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { parseUnityPackageEntries, type UnityPackageEntry } from 'unitypackage-core';
import { CliError, EXIT } from '../util/exit.js';
import { info } from '../util/logger.js';

export interface DiffEntry {
  guid: string;
  pathname: string;
  assetHash: string | null;
}

export interface ChangedDiffEntry {
  guid: string;
  before: DiffEntry;
  after: DiffEntry;
}

export interface DiffResult {
  schemaVersion: 0;
  packages: { before: string; after: string };
  summary: { added: number; removed: number; changed: number };
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: ChangedDiffEntry[];
}

export async function diff(packageA: string, packageB: string, opts: { json?: boolean } = {}): Promise<DiffResult> {
  const before = await loadEntries(packageA);
  const after = await loadEntries(packageB);
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
    } else if (entry.pathname !== afterEntry.pathname || entry.assetHash !== afterEntry.assetHash) {
      changed.push({ guid: entry.guid, before: entry, after: afterEntry });
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
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printDiff(result);
  }

  return result;
}

async function loadEntries(packagePath: string): Promise<UnityPackageEntry[]> {
  const raw = await readFile(packagePath).catch(() => {
    throw new CliError(`Cannot read file: ${packagePath}`, EXIT.IO);
  });
  const { entries } = parseUnityPackageEntries(new Uint8Array(raw));
  return entries;
}

function toDiffEntry(entry: UnityPackageEntry): DiffEntry {
  return {
    guid: entry.guid,
    pathname: entry.pathname,
    assetHash: entry.asset ? crypto.createHash('sha256').update(entry.asset).digest('hex') : null,
  };
}

function sortEntries(entries: DiffEntry[]): void {
  entries.sort((a, b) => a.guid.localeCompare(b.guid));
}

function formatEntry(entry: DiffEntry): string {
  return `${entry.guid} ${entry.pathname} asset=${entry.assetHash ?? '<none>'}`;
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
    info(`  ~ ${entry.guid}`);
    info(`    before ${entry.before.pathname} asset=${entry.before.assetHash ?? '<none>'}`);
    info(`    after  ${entry.after.pathname} asset=${entry.after.assetHash ?? '<none>'}`);
  }
}
