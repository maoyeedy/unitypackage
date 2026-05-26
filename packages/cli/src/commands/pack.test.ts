import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { guidFromPath, parseUnityPackageEntries, readMetaGuid } from 'unitypackage-core';
import { extract } from './extract.js';
import { inspect } from './inspect.js';
import { pack } from './pack.js';
import { decoder, makeTempDir } from '../test-utils.js';

describe('pack', () => {
  it('packs a file with existing meta and round-trips with extract', async () => {
    const dir = await makeTempDir();
    const sourceFile = path.join(dir, 'MyScript.cs');
    const sourceFileMeta = sourceFile + '.meta';
    const packageFile = path.join(dir, 'out.unitypackage');
    const outDir = path.join(dir, 'extracted');

    await writeFile(sourceFile, 'public class MyScript {}');
    await writeFile(sourceFileMeta, 'fileFormatVersion: 2\nguid: abcdefabcdefabcdefabcdefabcdefab\n');

    await pack({ [sourceFile]: 'Assets/Scripts/MyScript.cs' }, packageFile);
    await extract(packageFile, outDir);

    const asset = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'), 'utf-8');
    const meta = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs.meta'), 'utf-8');
    expect(asset).toBe('public class MyScript {}');
    expect(meta).toContain('guid: abcdefabcdefabcdefabcdefabcdefab');
  });

  it('preserves existing sidecar meta bytes exactly when random GUIDs are enabled', async () => {
    const dir = await makeTempDir();
    const sourceFile = path.join(dir, 'MyScript.cs');
    const packageFile = path.join(dir, 'out.unitypackage');
    const sidecarBytes = new TextEncoder().encode(
      'fileFormatVersion: 2\r\n# user-authored spacing\r\nguid: abcdefabcdefabcdefabcdefabcdefab\r\nMonoImporter:\r\n  custom: yes\r\n',
    );

    await writeFile(sourceFile, 'public class MyScript {}');
    await writeFile(sourceFile + '.meta', sidecarBytes);

    await pack({ [sourceFile]: 'Assets/Scripts/MyScript.cs' }, packageFile, { randomGuids: true });

    const { entries } = parseUnityPackageEntries(await readFile(packageFile));
    const entry = entries.find(candidate => candidate.pathname === 'Assets/Scripts/MyScript.cs');
    expect(entry?.guid).toBe('abcdefabcdefabcdefabcdefabcdefab');
    expect(entry?.meta).toEqual(sidecarBytes);
  });

  it('generates importer-aware metas for scripts, text assets, binary assets, and folders', async () => {
    const dir = await makeTempDir();
    const sourceDir = path.join(dir, 'Generated');
    const packageFile = path.join(dir, 'out.unitypackage');

    await mkdir(sourceDir);
    await writeFile(path.join(sourceDir, 'Tool.cs'), 'public class Tool {}');
    await writeFile(path.join(sourceDir, 'config.json'), '{"enabled":true}');
    await writeFile(path.join(sourceDir, 'Icon.png'), new Uint8Array([137, 80, 78, 71]));

    await pack({ [sourceDir]: 'Assets/Generated' }, packageFile);

    const { entries } = parseUnityPackageEntries(await readFile(packageFile));
    const metaByPath = new Map(entries.map(entry => [entry.pathname, decoder.decode(entry.meta)]));
    expect(metaByPath.get('Assets/Generated/Tool.cs')).toContain('MonoImporter:');
    expect(metaByPath.get('Assets/Generated/config.json')).toContain('TextScriptImporter:');
    expect(metaByPath.get('Assets/Generated/Icon.png')).toContain('DefaultImporter:');
    expect(metaByPath.get('Assets/Generated')).toContain('folderAsset: yes');
  });

  it('uses stable path-derived GUIDs for generated metas', async () => {
    const dir = await makeTempDir();
    const sourceFile = path.join(dir, 'Data.json');
    const packageFile = path.join(dir, 'out.unitypackage');

    await writeFile(sourceFile, '{}');

    await pack({ [sourceFile]: 'Assets/Data.json' }, packageFile);

    const { entries } = parseUnityPackageEntries(await readFile(packageFile));
    const entry = entries.find(candidate => candidate.pathname === 'Assets/Data.json');
    expect(entry?.guid).toBe(guidFromPath('Assets/Data.json'));
    expect(readMetaGuid(entry?.meta ?? new Uint8Array())).toBe(guidFromPath('Assets/Data.json'));
  });

  it('uses different lowercase 32-hex GUIDs for generated metas when random GUIDs are enabled', async () => {
    const dir = await makeTempDir();
    const sourceFile = path.join(dir, 'Data.json');
    const firstPackage = path.join(dir, 'first.unitypackage');
    const secondPackage = path.join(dir, 'second.unitypackage');

    await writeFile(sourceFile, '{}');

    await pack({ [sourceFile]: 'Assets/Data.json' }, firstPackage, { randomGuids: true });
    await pack({ [sourceFile]: 'Assets/Data.json' }, secondPackage, { randomGuids: true });

    const firstGuid = await readGuidForPath(firstPackage, 'Assets/Data.json');
    const secondGuid = await readGuidForPath(secondPackage, 'Assets/Data.json');

    expect(firstGuid).toMatch(/^[0-9a-f]{32}$/);
    expect(secondGuid).toMatch(/^[0-9a-f]{32}$/);
    expect(firstGuid).not.toBe(guidFromPath('Assets/Data.json'));
    expect(firstGuid).not.toBe(secondGuid);
  });

  it('prints every create diagnostic before failing pack validation', async () => {
    const dir = await makeTempDir();
    const firstFile = path.join(dir, 'First.cs');
    const secondFile = path.join(dir, 'Second.cs');
    const packageFile = path.join(dir, 'out.unitypackage');
    const duplicateGuid = 'abcdefabcdefabcdefabcdefabcdefab';
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await writeFile(firstFile, 'public class First {}');
    await writeFile(secondFile, 'public class Second {}');
    await writeFile(firstFile + '.meta', `fileFormatVersion: 2\nguid: ${duplicateGuid}\n`);
    await writeFile(secondFile + '.meta', `fileFormatVersion: 2\nguid: ${duplicateGuid}\n`);

    try {
      await expect(
        pack({
          [firstFile]: 'Assets/Duplicate/First.cs',
          [secondFile]: 'Assets/Duplicate/Second.cs',
        }, packageFile),
      ).rejects.toThrow('Package validation failed.');

      const stderr = stderrSpy.mock.calls.map(call => call[0]).join('\n');
      expect(stderr).toContain('[duplicate-guid]');
      expect(stderr).toContain(`guid=${duplicateGuid}`);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('packs a directory with generated meta', async () => {
    const dir = await makeTempDir();
    const sourceDir = path.join(dir, 'Editor');
    const packageFile = path.join(dir, 'out.unitypackage');

    await mkdir(sourceDir);
    await writeFile(path.join(sourceDir, 'Tool.cs'), 'public class Tool {}');

    await pack({ [sourceDir]: 'Assets/Editor' }, packageFile);

    const { entries } = await inspect(packageFile);
    expect(entries.some(e => e.pathname === 'Assets/Editor' && !e.hasAsset)).toBe(true);
    expect(entries.some(e => e.pathname === 'Assets/Editor/Tool.cs' && e.hasAsset)).toBe(true);
  });

  it('warns when pathInPackage does not start with Assets/', async () => {
    const dir = await makeTempDir();
    const sourceFile = path.join(dir, 'MyScript.cs');
    const packageFile = path.join(dir, 'out.unitypackage');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await writeFile(sourceFile, 'public class MyScript {}');

    try {
      await pack({ [sourceFile]: 'Scripts/MyScript.cs' }, packageFile);
      expect(warnSpy).toHaveBeenCalledWith(
        "WARNING: pathInPackage 'Scripts/MyScript.cs' does not start with 'Assets/'",
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('logs skipped source meta files', async () => {
    const dir = await makeTempDir();
    const sourceDir = path.join(dir, 'Editor');
    const metaFile = path.join(sourceDir, 'Tool.cs.meta');
    const packageFile = path.join(dir, 'out.unitypackage');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await mkdir(sourceDir);
    await writeFile(path.join(sourceDir, 'Tool.cs'), 'public class Tool {}');
    await writeFile(metaFile, 'fileFormatVersion: 2\nguid: abcdefabcdefabcdefabcdefabcdefab\n');

    try {
      await pack({ [sourceDir]: 'Assets/Editor' }, packageFile);
      expect(logSpy).toHaveBeenCalledWith(`Skipping source meta file: ${metaFile}`);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('packs entries from a manifest file', async () => {
    const dir = await makeTempDir();
    const sourceFile = path.join(dir, 'ManifestScript.cs');
    const manifestFile = path.join(dir, 'manifest.json');
    const packageFile = path.join(dir, 'out.unitypackage');

    await writeFile(sourceFile, 'public class ManifestScript {}');
    await writeFile(manifestFile, JSON.stringify({ [sourceFile]: 'Assets/ManifestScript.cs' }));

    await pack({}, packageFile, { manifestPath: manifestFile });

    const { entries } = await inspect(packageFile);
    expect(entries.some(e => e.pathname === 'Assets/ManifestScript.cs' && e.hasAsset)).toBe(true);
  });

  it('rejects invalid manifest entries', async () => {
    const dir = await makeTempDir();
    const manifestFile = path.join(dir, 'manifest.json');
    const packageFile = path.join(dir, 'out.unitypackage');

    await writeFile(manifestFile, JSON.stringify({ 'src.cs': 42 }));

    await expect(pack({}, packageFile, { manifestPath: manifestFile })).rejects.toThrow(/must be a string/);
  });

  it('uses the configured gzip level', async () => {
    const dir = await makeTempDir();
    const sourceFile = path.join(dir, 'Big.txt');
    const fastPackage = path.join(dir, 'fast.unitypackage');
    const smallPackage = path.join(dir, 'small.unitypackage');

    await writeFile(sourceFile, 'repeat\n'.repeat(10_000));

    await pack({ [sourceFile]: 'Assets/Big.txt' }, fastPackage, { gzipLevel: 0 });
    await pack({ [sourceFile]: 'Assets/Big.txt' }, smallPackage, { gzipLevel: 9 });

    expect((await readFile(fastPackage)).length).toBeGreaterThan((await readFile(smallPackage)).length);
  });

  it('rejects gzip levels outside 0-9', async () => {
    const dir = await makeTempDir();
    const sourceFile = path.join(dir, 'MyScript.cs');
    const packageFile = path.join(dir, 'out.unitypackage');

    await writeFile(sourceFile, 'public class MyScript {}');

    await expect(pack({ [sourceFile]: 'Assets/MyScript.cs' }, packageFile, { gzipLevel: 10 })).rejects.toThrow(
      /Invalid gzip level/,
    );
  });

  it('reports stderr progress for source trees over 100 entries', async () => {
    const dir = await makeTempDir();
    const sourceDir = path.join(dir, 'Large');
    const packageFile = path.join(dir, 'out.unitypackage');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await mkdir(sourceDir);
    await Promise.all(
      Array.from({ length: 101 }, (_, index) => writeFile(path.join(sourceDir, `File${index}.txt`), `file ${index}`)),
    );

    try {
      await pack({ [sourceDir]: 'Assets/Large' }, packageFile);

      const stderr = stderrSpy.mock.calls.map(call => call[0]).join('');
      expect(stderr).toContain('Pack progress: collected 101 entries');
      expect(stderr).toContain('Pack progress: writing 102 entries');
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

async function readGuidForPath(packageFile: string, pathname: string): Promise<string> {
  const { entries } = parseUnityPackageEntries(await readFile(packageFile));
  const entry = entries.find(candidate => candidate.pathname === pathname);
  if (!entry) {
    throw new Error(`Missing package entry: ${pathname}`);
  }
  return entry.guid;
}
