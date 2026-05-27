import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { guidFromPath, parseUnityPackageEntries, readMetaGuid } from 'unitypackage-core';
import { extract } from './extract.js';
import { inspect } from './inspect.js';
import { pack } from './pack.js';
import { verify } from './verify.js';
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

  it('warns before regenerating sidecar metas with no recognizable GUID', async () => {
    const dir = await makeTempDir();
    const sourceFile = path.join(dir, 'BrokenMeta.cs');
    const packageFile = path.join(dir, 'out.unitypackage');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await writeFile(sourceFile, 'public class BrokenMeta {}');
    await writeFile(sourceFile + '.meta', 'fileFormatVersion: 2\nguid: short\nMonoImporter:\n  custom: yes\n');

    try {
      await pack({ [sourceFile]: 'Assets/BrokenMeta.cs' }, packageFile);

      expect(warnSpy).toHaveBeenCalledWith(
        `WARNING: Sidecar .meta has no recognizable GUID; regenerating: ${sourceFile}.meta`,
      );
      const { entries } = parseUnityPackageEntries(await readFile(packageFile));
      const entry = entries.find(candidate => candidate.pathname === 'Assets/BrokenMeta.cs');
      expect(entry?.guid).toBe(guidFromPath('Assets/BrokenMeta.cs'));
    } finally {
      warnSpy.mockRestore();
    }
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

  it('plans package creation without writing when --dry-run is enabled', async () => {
    const dir = await makeTempDir();
    const sourceFile = path.join(dir, 'DryRun.cs');
    const packageFile = path.join(dir, 'out.unitypackage');

    await writeFile(sourceFile, 'public class DryRun {}');

    const result = await pack({ [sourceFile]: 'Assets/DryRun.cs' }, packageFile, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.summary.entries).toBe(1);
    expect(result.summary.tarBytes).toBeGreaterThan(0);
    expect(result.entries[0]).toMatchObject({
      sourcePath: sourceFile,
      pathname: 'Assets/DryRun.cs',
      hasAsset: true,
      metaSource: 'generated-deterministic',
    });
    await expect(readFile(packageFile)).rejects.toThrow();
  });

  it('writes parseable json for dry-run package plans', async () => {
    const dir = await makeTempDir();
    const sourceFile = path.join(dir, 'DryRun.cs');
    const packageFile = path.join(dir, 'out.unitypackage');
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await writeFile(sourceFile, 'public class DryRun {}');
      await pack({ [sourceFile]: 'Assets/DryRun.cs' }, packageFile, { dryRun: true, json: true });

      const result = JSON.parse(stdoutSpy.mock.calls.map(call => call[0]).join('')) as {
        dryRun: boolean;
        summary: { entries: number };
      };
      expect(result.dryRun).toBe(true);
      expect(result.summary.entries).toBe(1);
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('reports existing meta source in dry-run package plans', async () => {
    const dir = await makeTempDir();
    const sourceFile = path.join(dir, 'DryRun.cs');
    const packageFile = path.join(dir, 'out.unitypackage');

    await writeFile(sourceFile, 'public class DryRun {}');
    await writeFile(sourceFile + '.meta', 'fileFormatVersion: 2\nguid: abcdefabcdefabcdefabcdefabcdefab\n');

    const result = await pack({ [sourceFile]: 'Assets/DryRun.cs' }, packageFile, { dryRun: true });

    expect(result.entries[0]).toMatchObject({
      guid: 'abcdefabcdefabcdefabcdefabcdefab',
      metaSource: 'existing',
    });
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

  describe('--resolve-deps', () => {
    const GUID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const GUID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    it('includes transitive deps in dry-run JSON output', async () => {
      const dir = await makeTempDir();
      const assetsDir = path.join(dir, 'Assets');
      const mainAsset = path.join(assetsDir, 'Main.asset');
      const depAsset = path.join(assetsDir, 'Dep.asset');
      const packageFile = path.join(dir, 'out.unitypackage');

      await mkdir(assetsDir, { recursive: true });
      await writeFile(mainAsset, `{fileID: 11500000, guid: ${GUID_B}, type: 3}`);
      await writeFile(mainAsset + '.meta', `fileFormatVersion: 2\nguid: ${GUID_A}\n`);
      await writeFile(depAsset, '');
      await writeFile(depAsset + '.meta', `fileFormatVersion: 2\nguid: ${GUID_B}\n`);

      const result = await pack({ [mainAsset]: 'Assets/Main.asset' }, packageFile, {
        resolveDeps: true, depRoot: assetsDir, dryRun: true,
      });

      expect(result.resolvedDeps).toBeDefined();
      expect(result.resolvedDeps!.transitiveGuids).toEqual([GUID_B]);
      expect(result.entries.some(e => e.pathname === 'Assets/Dep.asset')).toBe(true);
    });

    it('produces valid .unitypackage that passes verify', async () => {
      const dir = await makeTempDir();
      const assetsDir = path.join(dir, 'Assets');
      const mainAsset = path.join(assetsDir, 'Main.asset');
      const depAsset = path.join(assetsDir, 'Dep.asset');
      const packageFile = path.join(dir, 'out.unitypackage');

      await mkdir(assetsDir, { recursive: true });
      await writeFile(mainAsset, `{fileID: 11500000, guid: ${GUID_B}, type: 3}`);
      await writeFile(mainAsset + '.meta', `fileFormatVersion: 2\nguid: ${GUID_A}\n`);
      await writeFile(depAsset, '');
      await writeFile(depAsset + '.meta', `fileFormatVersion: 2\nguid: ${GUID_B}\n`);

      await pack({ [mainAsset]: 'Assets/Main.asset', [depAsset]: 'Assets/Dep.asset' }, packageFile, {
        resolveDeps: true, depRoot: assetsDir,
      });

      const result = await verify(packageFile);
      expect(result.ok).toBe(true);
    });

    it('auto-detects depRoot from Assets/ ancestor when --dep-root is omitted', async () => {
      const dir = await makeTempDir();
      const assetsDir = path.join(dir, 'Assets');
      const mainAsset = path.join(assetsDir, 'Main.asset');
      const depAsset = path.join(assetsDir, 'Dep.asset');
      const packageFile = path.join(dir, 'out.unitypackage');

      await mkdir(assetsDir, { recursive: true });
      await writeFile(mainAsset, `{fileID: 11500000, guid: ${GUID_B}, type: 3}`);
      await writeFile(mainAsset + '.meta', `fileFormatVersion: 2\nguid: ${GUID_A}\n`);
      await writeFile(depAsset, '');
      await writeFile(depAsset + '.meta', `fileFormatVersion: 2\nguid: ${GUID_B}\n`);

      const result = await pack({ [mainAsset]: 'Assets/Main.asset' }, packageFile, {
        resolveDeps: true, dryRun: true,
      });

      expect(result.resolvedDeps).toBeDefined();
      expect(result.resolvedDeps!.transitiveGuids).toContain(GUID_B);
    });

    it('--dep-root pointing to wrong directory causes resolver error', async () => {
      const dir = await makeTempDir();
      const assetsDir = path.join(dir, 'Assets');
      const mainAsset = path.join(assetsDir, 'Main.asset');
      const depAsset = path.join(assetsDir, 'Dep.asset');
      const packageFile = path.join(dir, 'out.unitypackage');

      await mkdir(assetsDir, { recursive: true });
      await writeFile(mainAsset, `{fileID: 11500000, guid: ${GUID_B}, type: 3}`);
      await writeFile(mainAsset + '.meta', `fileFormatVersion: 2\nguid: ${GUID_A}\n`);
      await writeFile(depAsset, '');
      await writeFile(depAsset + '.meta', `fileFormatVersion: 2\nguid: ${GUID_B}\n`);

      await expect(
        pack({ [mainAsset]: 'Assets/Main.asset' }, packageFile, { resolveDeps: true, depRoot: dir }),
      ).rejects.toThrow();
    });

    it('--max-dep-depth 0 produces same entries as without the flag', async () => {
      const dir = await makeTempDir();
      const sourceFile = path.join(dir, 'Main.asset');
      const packageFile1 = path.join(dir, 'out1.unitypackage');
      const packageFile2 = path.join(dir, 'out2.unitypackage');

      await writeFile(sourceFile, '');
      await writeFile(sourceFile + '.meta', `fileFormatVersion: 2\nguid: ${GUID_A}\n`);

      const resultWithout = await pack({ [sourceFile]: 'Assets/Main.asset' }, packageFile1, { dryRun: true });
      const resultWith = await pack({ [sourceFile]: 'Assets/Main.asset' }, packageFile2, {
        resolveDeps: true, depRoot: dir, maxDepDepth: 0, dryRun: true,
      });

      expect(resultWithout.entries).toEqual(resultWith.entries);
      expect(resultWith.resolvedDeps).toBeDefined();
      expect(resultWith.resolvedDeps!.transitiveGuids).toEqual([]);
    });

    it('pack without --resolve-deps leaves resolvedDeps undefined', async () => {
      const dir = await makeTempDir();
      const sourceFile = path.join(dir, 'Script.cs');
      const packageFile = path.join(dir, 'out.unitypackage');

      await writeFile(sourceFile, 'public class Script {}');
      await writeFile(sourceFile + '.meta', `fileFormatVersion: 2\nguid: ${GUID_A}\n`);

      const result = await pack({ [sourceFile]: 'Assets/Script.cs' }, packageFile, { dryRun: true });

      expect(result.resolvedDeps).toBeUndefined();
    });

    it('dry-run JSON output includes resolvedDeps field', async () => {
      const dir = await makeTempDir();
      const assetsDir = path.join(dir, 'Assets');
      const mainAsset = path.join(assetsDir, 'Main.asset');
      const depAsset = path.join(assetsDir, 'Dep.asset');
      const packageFile = path.join(dir, 'out.unitypackage');
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await mkdir(assetsDir, { recursive: true });
      await writeFile(mainAsset, `{fileID: 11500000, guid: ${GUID_B}, type: 3}`);
      await writeFile(mainAsset + '.meta', `fileFormatVersion: 2\nguid: ${GUID_A}\n`);
      await writeFile(depAsset, '');
      await writeFile(depAsset + '.meta', `fileFormatVersion: 2\nguid: ${GUID_B}\n`);

      try {
        await pack({ [mainAsset]: 'Assets/Main.asset' }, packageFile, {
          resolveDeps: true, depRoot: assetsDir, dryRun: true, json: true,
        });

        const output = stdoutSpy.mock.calls.map(call => call[0]).join('');
        const parsed = JSON.parse(output) as { resolvedDeps: unknown };
        expect(parsed.resolvedDeps).toBeDefined();
        expect((parsed.resolvedDeps as { transitiveGuids: string[] }).transitiveGuids).toContain(GUID_B);
      } finally {
        stdoutSpy.mockRestore();
      }
    });
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
