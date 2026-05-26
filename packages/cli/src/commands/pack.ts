import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createMinimalMetaFor,
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

export interface PackOptions {
  manifestPath?: string;
  gzipLevel?: number;
  randomGuids?: boolean;
}

const packConcurrency = 16;
const progressThreshold = 100;
const textEncoder = new TextEncoder();

interface EntryMeta {
  guid: string;
  bytes: Uint8Array;
}

async function getExistingMeta(assetPath: string, limitRead: <T>(task: () => Promise<T>) => Promise<T>): Promise<EntryMeta | null> {
  const content = await limitRead(async () => {
    try {
      return await readFile(assetPath + '.meta');
    } catch {
      return null;
    }
  });
  if (!content) return null;
  const guid = readMetaGuid(content);
  return guid === null ? null : { guid, bytes: content };
}

function createGeneratedMeta(pathInPackage: string, isDirectory: boolean, randomGuids: boolean): EntryMeta {
  const guid = randomGuids ? generateGuid() : guidFromPath(pathInPackage);
  return {
    guid,
    bytes: textEncoder.encode(createMinimalMetaFor(guid, pathInPackage, isDirectory)),
  };
}

async function createPackageEntry(
  sourcePath: string,
  pathInPackage: string,
  isDirectory: boolean,
  limitRead: <T>(task: () => Promise<T>) => Promise<T>,
  onEntry: () => void,
  randomGuids: boolean,
): Promise<CreateUnityPackageEntry> {
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
  return entry;
}

async function collectDirectoryEntries(
  sourceDir: string,
  pathInPackageRoot: string,
  limitRead: <T>(task: () => Promise<T>) => Promise<T>,
  onEntry: () => void,
  randomGuids: boolean,
): Promise<CreateUnityPackageEntry[]> {
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

export async function pack(filesToPack: Record<string, string>, outputFile: string, opts: PackOptions = {}): Promise<void> {
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

  const packageEntries = processedEntries.flat();
  if (packageEntries.length > progressThreshold) {
    progress(`Pack progress: writing ${packageEntries.length} entries`);
  }
  const result = tryCreateUnityPackage(packageEntries, { gzipLevel });
  if (result.bytes === null) {
    for (const diagnostic of result.diagnostics) {
      console.error(formatCreateDiagnostic(diagnostic));
    }
    throw new CliError('Package validation failed.', EXIT.ERROR);
  }
  const data = result.bytes;
  await writeFile(outputFile, data);

  const elapsed = (performance.now() - startTime).toFixed(2);
  info(`Package created at ${outputFile} (${elapsed}ms)`);
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
