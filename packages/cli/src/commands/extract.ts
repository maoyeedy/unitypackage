import path from 'node:path';
import { access, readFile, writeFile } from 'node:fs/promises';
import {
  entriesToComponentRecords,
  matchGlob,
  parseUnityPackageEntries,
  resolveMetaSidecarSelection,
  type ParseUnityPackageOptions,
  type ResolveMetaSidecarsResult,
  type SidecarSelectableRecord,
  type UnityPackageComponentRecord,
  type UnityPackageEntry,
  type UnityPackageParseDiagnostic,
} from 'unitypackage-core';
import { sanitizeFsPath, isInside } from '../util/path.js';
import { ensureDir } from '../util/fs.js';

import { info, progress, warn } from '../util/logger.js';
import { CliError, EXIT } from '../util/exit.js';
import { readPackageBytes } from '../util/package.js';

export interface ExtractOptions {
  force?: boolean;
  merge?: boolean;
  skipExisting?: boolean;
  noMeta?: boolean;
  withMeta?: boolean;
  filter?: string;
  paths?: readonly string[];
  parseOptions?: ParseUnityPackageOptions;
}

interface WriteTask {
  dest: string;
  data: Uint8Array;
}

interface PlannedWriteTask extends WriteTask {
  exists: boolean;
  unchanged: boolean;
}

export interface ExactExtractSelectionResult {
  records: UnityPackageComponentRecord[];
  explicitRecords: UnityPackageComponentRecord[];
  implicitMetaRecords: UnityPackageComponentRecord[];
  missingMetaForAssetRecords: UnityPackageComponentRecord[];
  sidecars: ResolveMetaSidecarsResult;
}

const progressThreshold = 100;

function hasTraversalSegment(rawPath: string): boolean {
  return rawPath.split(/[\\/]+/).some(segment => segment === '..');
}

/** @internal */
export function entriesToExtractComponentRecords(
  entries: UnityPackageEntry[],
  diagnostics: UnityPackageParseDiagnostic[] = [],
): UnityPackageComponentRecord[] {
  return entriesToComponentRecords(entries, diagnostics);
}

/** @internal */
export function resolveExactExtractSelection(
  entries: UnityPackageEntry[],
  selectedVirtualPaths: readonly string[],
  diagnostics: UnityPackageParseDiagnostic[] = [],
): ExactExtractSelectionResult {
  const records = entriesToExtractComponentRecords(entries, diagnostics);
  const selectableRecords = records.map(toSidecarSelectableRecord);
  const selectedPathnames = new Set(selectedVirtualPaths);
  const selectedIds = records
    .filter(record => record.component !== 'preview' && selectedPathnames.has(record.virtualPath))
    .map(record => record.id);
  const sidecars = resolveMetaSidecarSelection(selectableRecords, selectedIds);
  const recordById = new Map(records.map(record => [record.id, record]));

  const explicitRecords = sidecars.explicitIds.flatMap(id => {
      const record = recordById.get(id);
      return record === undefined ? [] : [record];
    });

  return {
    records: explicitRecords,
    explicitRecords,
    implicitMetaRecords: sidecars.implicitMetaIds.flatMap(id => {
      const record = recordById.get(id);
      return record === undefined ? [] : [record];
    }),
    missingMetaForAssetRecords: sidecars.missingMetaForAssetIds.flatMap(id => {
      const record = recordById.get(id);
      return record === undefined ? [] : [record];
    }),
    sidecars,
  };
}

function toSidecarSelectableRecord(record: UnityPackageComponentRecord): SidecarSelectableRecord {
  return {
    id: record.id,
    guid: record.guid,
    pathname: record.virtualPath,
    kind: record.component,
  };
}

export async function extract(packagePath: string, outputDir?: string, opts: ExtractOptions = {}): Promise<void> {
  const outDir = path.resolve(outputDir ?? process.cwd());
  const raw = await readPackageBytes(packagePath);
  const { entries } = parseUnityPackageEntries(raw, opts.parseOptions);

  const tasks: WriteTask[] = [];
  let skippedTraversal = 0;
  const requestedPaths = opts.paths ?? [];

  if (requestedPaths.length > 0 && opts.filter !== undefined) {
    throw new CliError('extract --filter and --path cannot be combined.', EXIT.ERROR);
  }

  if (opts.withMeta && requestedPaths.length === 0) {
    throw new CliError('extract --with-meta requires at least one --path selection.', EXIT.ERROR);
  }

  if (opts.withMeta && opts.noMeta) {
    warn('extract --no-meta overrides --with-meta; no meta sidecars will be written.');
  }

  if (requestedPaths.length > 0) {
    const selection = resolveExactExtractSelection(entries, requestedPaths);
    const matchedPathnames = new Set(selection.explicitRecords.map(record => record.virtualPath));
    const selectedRecords = (opts.withMeta && !opts.noMeta
      ? [...selection.explicitRecords, ...selection.implicitMetaRecords]
      : selection.explicitRecords).filter(record => !opts.noMeta || record.component !== 'meta');

    for (const requestedPath of requestedPaths) {
      if (!matchedPathnames.has(requestedPath)) {
        warn(`Requested path not found: ${requestedPath}`);
      }
    }

    if (opts.withMeta && !opts.noMeta) {
      for (const record of selection.missingMetaForAssetRecords) {
        warn(`Meta sidecar not found for selected path: ${record.virtualPath}`);
      }
    }

    for (const record of selectedRecords) {
      if (record.component === 'preview') continue;

      if (hasTraversalSegment(record.virtualPath)) {
        skippedTraversal++;
        warn(`Skipping '${record.virtualPath}' - path escapes output directory`);
        continue;
      }

      const safePath = sanitizeFsPath(record.virtualPath);
      const dest = path.join(outDir, safePath);

      if (!isInside(outDir, dest)) {
        skippedTraversal++;
        warn(`Skipping '${record.virtualPath}' - path escapes output directory`);
        continue;
      }

      tasks.push({ dest, data: record.content });
    }

    if (tasks.length === 0) {
      throw new CliError('None of the requested extract paths exist.', EXIT.ERROR);
    }
  } else {

    for (const entry of entries) {
      if (opts.filter && !matchGlob(opts.filter, entry.pathname)) {
        continue;
      }

      if (hasTraversalSegment(entry.pathname)) {
        skippedTraversal++;
        warn(`Skipping '${entry.pathname}' - path escapes output directory`);
        continue;
      }

      const safePath = sanitizeFsPath(entry.pathname);
      const dest = path.join(outDir, safePath);

      if (!isInside(outDir, dest)) {
        skippedTraversal++;
        warn(`Skipping '${entry.pathname}' - path escapes output directory`);
        continue;
      }

      if (!entry.asset) {
        // Folder entry - just ensure directory exists and write meta if present.
        await ensureDir(dest);
        if (entry.meta && !opts.noMeta) {
          tasks.push({ dest: dest + '.meta', data: entry.meta });
        }
        continue;
      }

      tasks.push({ dest, data: entry.asset });
      if (entry.meta && !opts.noMeta) {
        tasks.push({ dest: dest + '.meta', data: entry.meta });
      }
    }
  }

  const planned: PlannedWriteTask[] = [];
  const conflicts: string[] = [];
  const showProgress = tasks.length > progressThreshold;

  for (const [index, task] of tasks.entries()) {
    let exists = false;
    let unchanged = false;

    try {
      if (opts.merge) {
        const existing = await readFile(task.dest);
        exists = true;
        unchanged = Buffer.compare(existing, task.data) === 0;
      } else {
        await access(task.dest);
        exists = true;
      }
    } catch {
      // Missing files are written below.
    }

    if (exists && !opts.force && !opts.skipExisting && !opts.merge) {
      conflicts.push(task.dest);
    }

    planned.push({ ...task, exists, unchanged });

    const processed = index + 1;
    if (showProgress && (processed === tasks.length || processed % progressThreshold === 0)) {
      progress(`Extract progress: checked ${processed}/${tasks.length} file(s)`);
    }
  }

  if (conflicts.length > 0) {
    const lines = conflicts.map(c => `  ${c}`).join('\n');
    throw new CliError(
      `${conflicts.length} file(s) already exist. Use --force to overwrite or --skip-existing to skip:\n${lines}`,
      EXIT.ERROR,
    );
  }

  let written = 0;
  let skipped = 0;
  let changed = 0;
  let unchanged = 0;

  for (const [index, task] of planned.entries()) {
    const processed = index + 1;
    if (opts.skipExisting && task.exists) {
      skipped++;
      if (showProgress && (processed === planned.length || processed % progressThreshold === 0)) {
        progress(`Extract progress: wrote ${processed}/${planned.length} file(s)`);
      }
      continue;
    }

    if (opts.merge && task.unchanged) {
      unchanged++;
      if (showProgress && (processed === planned.length || processed % progressThreshold === 0)) {
        progress(`Extract progress: wrote ${processed}/${planned.length} file(s)`);
      }
      continue;
    }

    await ensureDir(path.dirname(task.dest));
    await writeFile(task.dest, task.data);
    written++;
    if (opts.merge) changed++;

    if (showProgress && (processed === planned.length || processed % progressThreshold === 0)) {
      progress(`Extract progress: wrote ${processed}/${planned.length} file(s)`);
    }
  }

  if (skipped > 0) info(`Skipped ${skipped} existing file(s).`);
  if (opts.merge) info(`Changed ${changed} file(s), skipped ${unchanged} unchanged file(s).`);
  if (skippedTraversal > 0) info(`Skipped ${skippedTraversal} traversal entr${skippedTraversal === 1 ? 'y' : 'ies'}.`);
  info(`Extracted ${written} file(s) to ${outDir}`);
}
