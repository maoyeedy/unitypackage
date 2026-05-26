import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { inspect } from './inspect.js';
import { buildRawTarPackage, buildScriptAndTexturePackage, buildSingleScriptPackage, encoder, makeTempDir } from '../test-utils.js';

describe('inspect', () => {
  it('returns correct summary for minimal package with core summary fields', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    await writeFile(packagePath, buildSingleScriptPackage());

    const result = await inspect(packagePath);

    expect(result.schemaVersion).toBe(0);
    expect(result.summary.entries).toBe(1);
    expect(result.summary.withAsset).toBe(1);
    expect(result.summary.withMeta).toBe(1);
    expect(result.summary.folders).toBe(0);
    expect(result.summary.entryCount).toBe(1);
    expect(result.summary.fileCount).toBe(1);
    expect(result.summary.folderCount).toBe(0);
    expect(result.summary.totalAssetBytes).toBe(24);
    expect(result.summary.totalMetaBytes).toBe(60);
    expect(result.summary.totalPreviewBytes).toBe(0);
    expect(result.summary.previewCount).toBe(0);
    expect(result.summary.uniqueGuidCount).toBe(1);
    expect(result.summary.duplicateGuidCount).toBe(0);
    expect(result.summary.byExtension).toEqual([{ extension: 'cs', count: 1, assetBytes: 24 }]);
    expect(result.entries[0].guid).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(result.entries[0].pathname).toBe('Assets/Scripts/MyScript.cs');
  });

  it('writes json as a superset of the old summary fields', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await writeFile(packagePath, buildRawTarPackage({
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/pathname': 'Assets/Scripts/MyScript.cs',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/asset': encoder.encode('public class MyScript {}'),
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/asset.meta': 'fileFormatVersion: 2\nguid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/preview.png': 'preview',
      }));

      await inspect(packagePath, { json: true });

      const output = stdoutSpy.mock.calls[0]?.[0];
      expect(typeof output).toBe('string');
      const result = JSON.parse(output as string);
      expect(result.summary.entries).toBe(1);
      expect(result.summary.withAsset).toBe(1);
      expect(result.summary.withMeta).toBe(1);
      expect(result.summary.folders).toBe(0);
      expect(result.summary.totalAssetBytes).toBe(24);
      expect(result.summary.totalMetaBytes).toBe(60);
      expect(result.summary.totalPreviewBytes).toBe(7);
      expect(result.summary.previewCount).toBe(1);
      expect(result.summary.uniqueGuidCount).toBe(1);
      expect(result.summary.duplicateGuidCount).toBe(0);
      expect(result.summary.byExtension).toEqual([{ extension: 'cs', count: 1, assetBytes: 24 }]);
      expect(result.components.map((component: { component: string; virtualPath: string }) => [
        component.component,
        component.virtualPath,
      ])).toEqual([
        ['asset', 'Assets/Scripts/MyScript.cs'],
        ['meta', 'Assets/Scripts/MyScript.cs.meta'],
        ['preview', 'Assets/Scripts/MyScript.cs.preview.png'],
      ]);
      expect(result.components[0]).toMatchObject({
        byteLength: 24,
        extension: 'cs',
        mimeType: 'text/plain;charset=utf-8',
        previewKind: 'text',
        syntaxLanguage: 'csharp',
      });
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('includes sha256 in package info', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    await writeFile(packagePath, buildSingleScriptPackage());

    const result = await inspect(packagePath);
    expect(result.package.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('renders tree format instead of a flat list', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await writeFile(packagePath, buildScriptAndTexturePackage());
      await inspect(packagePath, { format: 'tree' });

      expect(logSpy).toHaveBeenCalledWith('  Assets/');
      expect(logSpy).toHaveBeenCalledWith('    Scripts/');
      expect(logSpy).toHaveBeenCalledWith('    Textures/');
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringMatching(/^ {2}Assets\/Scripts\/MyScript\.cs/));
    } finally {
      logSpy.mockRestore();
    }
  });

  it('filters displayed entries by extension', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    await writeFile(packagePath, buildScriptAndTexturePackage());

    const result = await inspect(packagePath, { filter: 'cs' });

    expect(result.entries.map(e => e.pathname)).toEqual(['Assets/Scripts/MyScript.cs']);
    expect(result.summary.entries).toBe(1);
  });

  it('filters displayed entries by glob and exclude glob', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    await writeFile(packagePath, buildScriptAndTexturePackage());

    const scriptOnly = await inspect(packagePath, { filter: 'Assets/**/*.cs' });
    const withoutScripts = await inspect(packagePath, { exclude: 'Assets/Scripts/**' });

    expect(scriptOnly.entries.map(e => e.pathname)).toEqual(['Assets/Scripts/MyScript.cs']);
    expect(withoutScripts.entries.map(e => e.pathname)).toEqual(['Assets/Textures/Icon.png']);
  });

  it('scopes json summary and entries to the filter', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await writeFile(packagePath, buildScriptAndTexturePackage());
      await inspect(packagePath, { filter: 'cs', json: true });

      const result = JSON.parse(stdoutSpy.mock.calls[0]?.[0] as string);
      expect(result.entries.map((entry: { pathname: string }) => entry.pathname)).toEqual(['Assets/Scripts/MyScript.cs']);
      expect(result.summary.entries).toBe(1);
      expect(result.summary.entryCount).toBe(1);
      expect(result.summary.totalAssetBytes).toBe(24);
      expect(result.summary.byExtension).toEqual([{ extension: 'cs', count: 1, assetBytes: 24 }]);
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('prints top extensions in human output', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await writeFile(packagePath, buildScriptAndTexturePackage());
      await inspect(packagePath);

      expect(logSpy).toHaveBeenCalledWith('Top extensions:');
      expect(logSpy).toHaveBeenCalledWith('  .cs: 1 (24 bytes)');
      expect(logSpy).toHaveBeenCalledWith('  .png: 1 (3 bytes)');
    } finally {
      logSpy.mockRestore();
    }
  });
});
