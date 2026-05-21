import path from 'node:path';
import { access, readFile, writeFile } from 'node:fs/promises';
import { parseUnityPackageEntries } from 'unitypackage-core';
import { sanitizeFsPath, isInside } from '../util/path.js';
import { ensureDir } from '../util/fs.js';
import { matchesGlob } from '../util/glob.js';
import { info, progress, warn } from '../util/logger.js';
import { CliError, EXIT } from '../util/exit.js';

export interface ExtractOptions {
  force?: boolean;
  merge?: boolean;
  skipExisting?: boolean;
  noMeta?: boolean;
  filter?: string;
}

interface WriteTask {
  dest: string;
  data: Uint8Array;
}

interface PlannedWriteTask extends WriteTask {
  exists: boolean;
  unchanged: boolean;
}

const progressThreshold = 100;

function hasTraversalSegment(rawPath: string): boolean {
  return rawPath.split(/[\\/]+/).some(segment => segment === '..');
}

export async function extract(packagePath: string, outputDir?: string, opts: ExtractOptions = {}): Promise<void> {
  const outDir = path.resolve(outputDir ?? process.cwd());
  const raw = await readFile(packagePath);
  const entries = parseUnityPackageEntries(new Uint8Array(raw));

  const tasks: WriteTask[] = [];
  let skippedTraversal = 0;

  for (const entry of entries) {
    if (opts.filter && !matchesGlob(entry.pathname, opts.filter)) {
      continue;
    }

    if (hasTraversalSegment(entry.pathname)) {
      skippedTraversal++;
      warn(`Skipping '${entry.pathname}' — path escapes output directory`);
      continue;
    }

    const safePath = sanitizeFsPath(entry.pathname);
    const dest = path.join(outDir, safePath);

    if (!isInside(outDir, dest)) {
      skippedTraversal++;
      warn(`Skipping '${entry.pathname}' — path escapes output directory`);
      continue;
    }

    if (!entry.asset) {
      // Folder entry — just ensure directory exists and write meta if present
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
