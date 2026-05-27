import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMetaGuid } from 'unitypackage-core';
import { scanGuids } from './guidScanner.js';
import type { ResolveOptions, ResolveResult, DepEdge } from './types.js';

interface QueueEntry {
  guid: string;
  depth: number;
  parentGuid: string | null;
  parentPath: string | null;
}

export function resolveDependencies(options: ResolveOptions): ResolveResult {
  const { explicitPaths, depRoot, index, maxDepth = Infinity } = options;
  const start = performance.now();

  const explicitGuids = new Set<string>();
  const transitiveGuids = new Set<string>();
  const edges: DepEdge[] = [];
  const visited = new Set<string>();
  const queue: QueueEntry[] = [];

  for (const path of explicitPaths) {
    const metaPath = join(depRoot, path + '.meta');
    const content = readFileSync(metaPath, 'utf-8');
    const guid = readMetaGuid(content);
    if (guid) {
      explicitGuids.add(guid);
      queue.push({ guid, depth: 0, parentGuid: null, parentPath: null });
    }
  }

  let skipped = 0;
  let maxDepthReached = 0;

  while (queue.length > 0) {
    const { guid, depth, parentGuid, parentPath } = queue.shift()!;

    if (visited.has(guid)) continue;
    visited.add(guid);

    maxDepthReached = Math.max(maxDepthReached, depth);

    if (parentGuid !== null) {
      transitiveGuids.add(guid);
      edges.push({
        from: parentGuid,
        to: guid,
        fromPath: parentPath!,
        toPath: index.get(guid) ?? '',
      });
    }

    if (depth >= maxDepth) continue;

    const assetPath = index.get(guid);
    if (assetPath === undefined) continue;

    let content: string;
    try {
      content = readFileSync(join(depRoot, assetPath), 'utf-8');
    } catch {
      continue;
    }

    const scanResult = scanGuids(content, assetPath);

    if (scanResult.skipped) {
      skipped++;
      continue;
    }

    for (const refGuid of scanResult.references) {
      queue.push({ guid: refGuid, depth: depth + 1, parentGuid: guid, parentPath: assetPath });
    }
  }

  return {
    explicitGuids,
    transitiveGuids,
    edges,
    stats: {
      scanned: visited.size,
      skipped,
      maxDepthReached,
      elapsedMs: performance.now() - start,
    },
  };
}
