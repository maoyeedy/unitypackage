import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createMinimalMetaFor,
  estimateUnityPackageSize,
  generateGuid,
  guidFromPath,
  readMetaGuid,
  tryCreateUnityPackage,
  type CreateUnityPackageEntry,
  type CreateUnityPackageDiagnostic,
} from 'unitypackage-core';
import { sanitizePackagePath } from '../util/path.js';
import { safeGetStats } from '../util/fs.js';
import { createLimiter, mapConcurrent } from '../util/concurrency.js';
import { info, progress, warn } from '../util/logger.js';
import { EXIT, CliError } from '../util/exit.js';
import { writeJsonResult } from '../util/output.js';

export interface PackOptions {
  manifestPath?: string;
  gzipLevel?: number;
  randomGuids?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

const packConcurrency = 16;
const progressThreshold = 100;
const textEncoder = new TextEncoder();

interface EntryMeta {
  guid: string;
  bytes: Uint8Array;
  source: 'existing' | 'generated-deterministic' | 'generated-random';
}

interface CollectedPackageEntry {
  entry: CreateUnityPackageEntry;
  plan: PackPlanEntry;
}

export interface PackPlanEntry {
  sourcePath: string;
  pathname: string;
  guid: string;
  hasAsset: boolean;
  assetBytes: number;
  metaBytes: number;
  metaSource: EntryMeta['source'];
}

export interface PackResult {
  schemaVersion: 0;
  outputFile: string;
  dryRun: boolean;
  summary: {
    entries: number;
    tarBytes: number;
    tarMembers: number;
    diagnostics: number;
    missingSources: number;
  };
  entries: PackPlanEntry[];
  diagnostics: CreateUnityPackageDiagnostic[];
  missingSources: string[];
}

async function getExistingMeta(assetPath: string, limitRead: <T>(task: () => Promise<T>) => Promise<T>): Promise<EntryMeta | null> {
  const metaPath = assetPath + '.meta';
  const content = await limitRead(async () => {
    try {
      return await readFile(metaPath);
    } catch {
      return null;
    }
  });
  if (!content) return null;
  const guid = readMetaGuid(content);
  if (guid === null) {
    warn(`Sidecar .meta has no recognizable GUID; regenerating: ${metaPath}`);
    return null;
  }
  return { guid, bytes: content, source: 'existing' };
}

function createGeneratedMeta(pathInPackage: string, isDirectory: boolean, randomGuids: boolean): EntryMeta {
  const guid = randomGuids ? generateGuid() : guidFromPath(pathInPackage);
  return {
    guid,
    bytes: textEncoder.encode(createMinimalMetaFor(guid, pathInPackage, isDirectory)),
    source: randomGuids ? 'generated-random' : 'generated-deterministic',
  };
}

async function createPackageEntry(
  sourcePath: string,
  pathInPackage: string,
  isDirectory: boolean,
  limitRead: <T>(task: () => Promise<T>) => Promise<T>,
  onEntry: () => void,
  randomGuids: boolean,
): Promise<CollectedPackageEntry> {
  const meta = (await getExistingMeta(sourcePath, limitRead)) ?? createGeneratedMeta(pathInPackage, isDirectory, randomGuids);

  const entry: CreateUnityPackageEntry = {
    guid: meta.guid,
    pathname: pathInPackage,
    meta: meta.bytes,
  };

  if (!isDirectory) {
    entry.asset = await limitRead(() => readFile(sourcePath));
  }

  onEntry();
  return {
    entry,
    plan: toPackPlanEntry(entry, sourcePath, meta.source),
  };
}

function toPackPlanEntry(entry: CreateUnityPackageEntry, sourcePath: string, metaSource: EntryMeta['source']): PackPlanEntry {
  return {
    sourcePath,
    pathname: entry.pathname,
    guid: entry.guid,
    hasAsset: entry.asset !== undefined,
    assetBytes: entry.asset?.byteLength ?? 0,
    metaBytes: entry.meta.byteLength,
    metaSource,
  };
}

async function collectDirectoryEntries(
  sourceDir: string,
  pathInPackageRoot: string,
  limitRead: <T>(task: () => Promise<T>) => Promise<T>,
  onEntry: () => void,
  randomGuids: boolean,
): Promise<CollectedPackageEntry[]> {
  const dirEntries = await readdir(sourceDir, { withFileTypes: true });

  const entries = await mapConcurrent(dirEntries, packConcurrency, async entry => {
    const fullSourcePath = path.join(sourceDir, entry.name);
    if (entry.name.endsWith('.meta')) {
      info(`Skipping source meta file: ${fullSourcePath}`);
      return [];
    }

    const entryPathInPackage = path.posix.join(pathInPackageRoot, entry.name);
    const isDirectory = entry.isDirectory();

    const packageEntries = [
      await createPackageEntry(fullSourcePath, entryPathInPackage, isDirectory, limitRead, onEntry, randomGuids),
    ];
    if (isDirectory) {
      packageEntries.push(
        ...(await collectDirectoryEntries(fullSourcePath, entryPathInPackage, limitRead, onEntry, randomGuids)),
      );
    }
    return packageEntries;
  });

  return entries.flat();
}

export async function pack(filesToPack: Record<string, string>, outputFile: string, opts: PackOptions = {}): Promise<PackResult> {
  const startTime = performance.now();
  const gzipLevel = validateGzipLevel(opts.gzipLevel);
  const randomGuids = opts.randomGuids === true;
  const manifestEntries = opts.manifestPath ? await readManifest(opts.manifestPath) : {};
  const allFilesToPack = { ...manifestEntries, ...filesToPack };

  const sanitized = Object.fromEntries(
    Object.entries(allFilesToPack).map(([src, dest]) => [src, sanitizePackagePath(dest)]),
  );

  const limitRead = createLimiter(packConcurrency);
  let collected = 0;
  const onEntry = (): void => {
    collected++;
    if (collected > progressThreshold && (collected === progressThreshold + 1 || collected % progressThreshold === 0)) {
      progress(`Pack progress: collected ${collected} entr${collected === 1 ? 'y' : 'ies'}`);
    }
  };

  const missingSources: string[] = [];
  const processedEntries = await mapConcurrent(Object.entries(sanitized), packConcurrency, async ([sourcePath, pathInPackage]) => {
    const absoluteSourcePath = path.resolve(sourcePath);

    if (path.basename(sourcePath).endsWith('.meta')) {
      info(`Skipping source meta file: ${absoluteSourcePath}`);
      return [];
    }

    if (!pathInPackage.startsWith('Assets/')) {
      warn(`pathInPackage '${pathInPackage}' does not start with 'Assets/'`);
    }

    const stats = await safeGetStats(absoluteSourcePath);

    if (!stats) {
      console.error(`Error: Source path not found: ${sourcePath}`);
      missingSources.push(sourcePath);
      return [];
    }

    const isDirectory = stats.isDirectory();
    const entries = [
      await createPackageEntry(absoluteSourcePath, pathInPackage, isDirectory, limitRead, onEntry, randomGuids),
    ];

    if (isDirectory) {
      entries.push(...(await collectDirectoryEntries(absoluteSourcePath, pathInPackage, limitRead, onEntry, randomGuids)));
    }

    return entries;
  });

  const collectedEntries = processedEntries.flat();
  const packageEntries = collectedEntries.map(collected => collected.entry);
  const planEntries = collectedEntries.map(collected => collected.plan);
  if (packageEntries.length > progressThreshold) {
    progress(`Pack progress: writing ${packageEntries.length} entries`);
  }
  const estimate = estimateUnityPackageSize(packageEntries);
  const result = tryCreateUnityPackage(packageEntries, { gzipLevel });
  const packResult = createPackResult(outputFile, opts.dryRun === true, estimate, planEntries, result.diagnostics, missingSources);
  if (result.bytes === null) {
    for (const diagnostic of result.diagnostics) {
      console.error(formatCreateDiagnostic(diagnostic));
    }
    if (opts.json) writeJsonResult(packResult);
    throw new CliError('Package validation failed.', EXIT.ERROR);
  }

  if (!opts.dryRun) {
    const data = result.bytes;
    await writeFile(outputFile, data);
  }

  const elapsed = (performance.now() - startTime).toFixed(2);
  if (opts.json) {
    writeJsonResult(packResult);
  } else {
    info(opts.dryRun
      ? `Package plan OK for ${outputFile} (${elapsed}ms)`
      : `Package created at ${outputFile} (${elapsed}ms)`);
  }
  return packResult;
}

function createPackResult(
  outputFile: string,
  dryRun: boolean,
  estimate: { tarBytes: number; entryCount: number },
  entries: PackPlanEntry[],
  diagnostics: CreateUnityPackageDiagnostic[],
  missingSources: string[],
): PackResult {
  return {
    schemaVersion: 0,
    outputFile,
    dryRun,
    summary: {
      entries: entries.length,
      tarBytes: estimate.tarBytes,
      tarMembers: estimate.entryCount,
      diagnostics: diagnostics.length,
      missingSources: missingSources.length,
    },
    entries,
    diagnostics,
    missingSources,
  };
}

function formatCreateDiagnostic(diagnostic: CreateUnityPackageDiagnostic): string {
  const details = [
    `ERROR: [${diagnostic.code}] ${diagnostic.message}`,
    diagnostic.guid === undefined ? undefined : `guid=${diagnostic.guid}`,
    diagnostic.path === undefined ? undefined : `path=${diagnostic.path}`,
  ].filter((part): part is string => part !== undefined);
  return details.join(' ');
}

async function readManifest(manifestPath: string): Promise<Record<string, string>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf-8'));
  } catch (err) {
    throw new CliError(`Cannot read manifest: ${err instanceof Error ? err.message : String(err)}`, EXIT.IO);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError('Manifest must be a JSON object of source paths to package paths.', EXIT.ERROR);
  }

  for (const [src, dest] of Object.entries(parsed)) {
    if (typeof dest !== 'string') {
      throw new CliError(`Manifest entry for '${src}' must be a string.`, EXIT.ERROR);
    }
  }

  return parsed as Record<string, string>;
}

function validateGzipLevel(level: number | undefined): 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 {
  if (level === undefined) return 1;
  if (!Number.isInteger(level) || level < 0 || level > 9) {
    throw new CliError(`Invalid gzip level: ${level}`, EXIT.ERROR);
  }
  return level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}
