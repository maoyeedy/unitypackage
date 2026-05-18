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

export async function inspect(packagePath: string, opts: { json?: boolean } = {}): Promise<InspectResult> {
  const raw = await readFile(packagePath);
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const entries = parseUnityPackageEntries(new Uint8Array(raw));

  const result: InspectResult = {
    schemaVersion: 0,
    package: { path: packagePath, size: raw.length, sha256 },
    summary: {
      entries: entries.length,
      withAsset: entries.filter(e => e.asset !== undefined).length,
      withMeta: entries.filter(e => e.meta !== undefined).length,
      folders: entries.filter(e => e.asset === undefined).length,
    },
    entries: entries.map(e => ({
      guid: e.guid,
      pathname: e.pathname,
      hasAsset: e.asset !== undefined,
      assetSize: e.asset?.length ?? 0,
      hasMeta: e.meta !== undefined,
    })),
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
      for (const e of result.entries) {
        const size = e.hasAsset ? ` (${e.assetSize.toLocaleString()} bytes)` : ' [folder]';
        info(`  ${e.pathname}${size}`);
      }
    }
  }

  return result;
}
