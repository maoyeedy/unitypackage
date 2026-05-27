import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readMetaGuid, isValidGuid } from 'unitypackage-core';
import type { GuidIndex } from './types.js';

const SKIP_DIRS = new Set(['node_modules', 'Library', 'Temp', 'obj', 'Packages']);

export interface BuildIndexOptions {
  followSymlinks?: boolean;
  signal?: AbortSignal;
}

export interface IndexStats {
  totalMetaFiles: number;
  indexed: number;
  skippedNoGuid: number;
  duplicateGuids: number;
  elapsedMs: number;
}

export function buildPathnameIndex(
  rootDir: string,
  options?: BuildIndexOptions,
): { index: GuidIndex; stats: IndexStats } {
  const start = performance.now();
  const index: GuidIndex = new Map();
  const stats: IndexStats = {
    totalMetaFiles: 0,
    indexed: 0,
    skippedNoGuid: 0,
    duplicateGuids: 0,
    elapsedMs: 0,
  };

  const followSymlinks = options?.followSymlinks ?? false;
  const signal = options?.signal;

  function walk(dir: string): void {
    if (signal?.aborted) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (signal?.aborted) return;

      const fullPath = join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        if (!followSymlinks) continue;
        try {
          const s = statSync(fullPath);
          if (s.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(fullPath);
          } else if (s.isFile() && entry.name.endsWith('.meta')) {
            processMetaFile(fullPath);
          }
        } catch {
          // broken symlink or permission denied
        }
      } else if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith('.meta')) {
        processMetaFile(fullPath);
      }
    }
  }

  function processMetaFile(fullPath: string): void {
    stats.totalMetaFiles++;

    try {
      const content = readFileSync(fullPath, 'utf-8');
      const guid = readMetaGuid(content);

      if (guid && isValidGuid(guid)) {
        const relPath = relative(rootDir, fullPath);
        const assetPath = relPath.slice(0, -5).replace(/\\/g, '/');

        if (index.has(guid)) {
          stats.duplicateGuids++;
        } else {
          index.set(guid, assetPath);
          stats.indexed++;
        }
      } else {
        stats.skippedNoGuid++;
      }
    } catch {
      stats.skippedNoGuid++;
    }
  }

  walk(rootDir);

  stats.elapsedMs = performance.now() - start;
  return { index, stats };
}
