import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createUnityPackage, type CreateUnityPackageEntry } from 'unitypackage-core';
import { type Meta, parseMeta, generateMeta, serializeMeta } from '../util/meta.js';
import { sanitizePackagePath } from '../util/path.js';
import { safeReadFile, safeGetStats } from '../util/fs.js';
import { info, warn } from '../util/logger.js';

async function getExistingMeta(assetPath: string): Promise<Meta | null> {
  const content = await safeReadFile(assetPath + '.meta');
  if (!content) return null;
  return parseMeta(content);
}

async function createPackageEntry(
  sourcePath: string,
  pathInPackage: string,
  isDirectory: boolean,
): Promise<CreateUnityPackageEntry> {
  const meta = (await getExistingMeta(sourcePath)) ?? generateMeta(pathInPackage, isDirectory);

  const entry: CreateUnityPackageEntry = {
    guid: meta.guid,
    pathname: pathInPackage,
    meta: serializeMeta(meta),
  };

  if (!isDirectory) {
    entry.asset = await readFile(sourcePath);
  }

  return entry;
}

async function collectDirectoryEntries(
  sourceDir: string,
  pathInPackageRoot: string,
): Promise<CreateUnityPackageEntry[]> {
  const dirEntries = await readdir(sourceDir, { withFileTypes: true });
  const promises: Promise<CreateUnityPackageEntry[]>[] = [];

  for (const entry of dirEntries) {
    const fullSourcePath = path.join(sourceDir, entry.name);
    if (entry.name.endsWith('.meta')) {
      info(`Skipping source meta file: ${fullSourcePath}`);
      continue;
    }

    const entryPathInPackage = path.posix.join(pathInPackageRoot, entry.name);
    const isDirectory = entry.isDirectory();

    const promise = (async (): Promise<CreateUnityPackageEntry[]> => {
      const packageEntries = [await createPackageEntry(fullSourcePath, entryPathInPackage, isDirectory)];
      if (isDirectory) {
        packageEntries.push(...(await collectDirectoryEntries(fullSourcePath, entryPathInPackage)));
      }
      return packageEntries;
    })();

    promises.push(promise);
  }

  return (await Promise.all(promises)).flat();
}

export async function pack(filesToPack: Record<string, string>, outputFile: string): Promise<void> {
  const startTime = performance.now();

  const sanitized = Object.fromEntries(
    Object.entries(filesToPack).map(([src, dest]) => [src, sanitizePackagePath(dest)]),
  );

  const processPromises = Object.entries(sanitized).map(async ([sourcePath, pathInPackage]) => {
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
    const entries = [await createPackageEntry(absoluteSourcePath, pathInPackage, isDirectory)];

    if (isDirectory) {
      entries.push(...(await collectDirectoryEntries(absoluteSourcePath, pathInPackage)));
    }

    return entries;
  });

  const packageEntries = (await Promise.all(processPromises)).flat();
  const data = createUnityPackage(packageEntries, { gzipLevel: 1 });
  await writeFile(outputFile, data);

  const elapsed = (performance.now() - startTime).toFixed(2);
  info(`Package created at ${outputFile} (${elapsed}ms)`);
}
