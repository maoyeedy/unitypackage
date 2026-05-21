import path from 'node:path';
import { access, readFile, writeFile } from 'node:fs/promises';
import { parseUnityPackageEntries } from 'unitypackage-core';
import { sanitizeFsPath, isInside } from '../util/path.js';
import { ensureDir } from '../util/fs.js';
import { info, warn } from '../util/logger.js';
import { CliError, EXIT } from '../util/exit.js';

export interface ExtractOptions {
  force?: boolean;
  skipExisting?: boolean;
  noMeta?: boolean;
}

interface WriteTask {
  dest: string;
  data: Uint8Array;
}

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

  // Collision check (unless --force or --skip-existing)
  if (!opts.force && !opts.skipExisting) {
    const conflicts: string[] = [];
    for (const task of tasks) {
      try {
        await access(task.dest);
        conflicts.push(task.dest);
      } catch {
        // File doesn't exist — no conflict
      }
    }
    if (conflicts.length > 0) {
      const lines = conflicts.map(c => `  ${c}`).join('\n');
      throw new CliError(
        `${conflicts.length} file(s) already exist. Use --force to overwrite or --skip-existing to skip:\n${lines}`,
        EXIT.ERROR,
      );
    }
  }

  let written = 0;
  let skipped = 0;

  for (const task of tasks) {
    if (opts.skipExisting) {
      try {
        await access(task.dest);
        skipped++;
        continue;
      } catch {
        // Doesn't exist, write it
      }
    }

    await ensureDir(path.dirname(task.dest));
    await writeFile(task.dest, task.data);
    written++;
  }

  if (skipped > 0) info(`Skipped ${skipped} existing file(s).`);
  if (skippedTraversal > 0) info(`Skipped ${skippedTraversal} traversal entr${skippedTraversal === 1 ? 'y' : 'ies'}.`);
  info(`Extracted ${written} file(s) to ${outDir}`);
}
