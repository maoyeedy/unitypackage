import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createUnityPackage } from 'unitypackage-core';
import { entriesToExtractComponentRecords, extract, resolveExactExtractSelection } from './extract.js';
import {
  buildManyTextAssetsPackage,
  buildRawTarPackage,
  buildScriptAndTexturePackage,
  buildSingleScriptPackage,
  decoder,
  encoder,
  makeTempDir,
} from '../test-utils.js';

describe('extract', () => {
  it('adapts parsed entries to component records for asset, meta, and preview rows', () => {
    const records = entriesToExtractComponentRecords([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/Scripts/MyScript.cs',
        asset: encoder.encode('public class MyScript {}'),
        meta: encoder.encode('fileFormatVersion: 2\nguid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'),
        preview: encoder.encode('preview'),
      },
    ]);

    expect(records.map(record => [record.component, record.virtualPath])).toEqual([
      ['asset', 'Assets/Scripts/MyScript.cs'],
      ['meta', 'Assets/Scripts/MyScript.cs.meta'],
      ['preview', 'Assets/Scripts/MyScript.cs.preview.png'],
    ]);
  });

  it('resolves exact asset selections without expanding matching meta sidecars', () => {
    const selection = resolveExactExtractSelection([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/Scripts/MyScript.cs',
        asset: encoder.encode('public class MyScript {}'),
        meta: encoder.encode('fileFormatVersion: 2\nguid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'),
      },
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: 'Assets/Textures/Icon.png',
        asset: encoder.encode('png'),
        meta: encoder.encode('fileFormatVersion: 2\nguid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'),
      },
    ], ['Assets/Scripts/MyScript.cs']);

    expect(selection.records.map(record => record.virtualPath)).toEqual(['Assets/Scripts/MyScript.cs']);
    expect(selection.explicitRecords.map(record => record.virtualPath)).toEqual(['Assets/Scripts/MyScript.cs']);
    expect(selection.implicitMetaRecords.map(record => record.virtualPath)).toEqual(['Assets/Scripts/MyScript.cs.meta']);
    expect(selection.missingMetaForAssetRecords).toEqual([]);
  });

  it('keeps exact preview selections non-extracting by default', () => {
    const selection = resolveExactExtractSelection([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/Scripts/MyScript.cs',
        asset: encoder.encode('public class MyScript {}'),
        meta: encoder.encode('fileFormatVersion: 2\nguid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'),
        preview: encoder.encode('preview'),
      },
    ], ['Assets/Scripts/MyScript.cs.preview.png']);

    expect(selection.records).toEqual([]);
    expect(selection.sidecars.ids).toEqual([]);
  });

  it('reports exact asset selections with no matching meta sidecar', () => {
    const selection = resolveExactExtractSelection([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/Scripts/MyScript.cs',
        asset: encoder.encode('public class MyScript {}'),
      },
    ], ['Assets/Scripts/MyScript.cs']);

    expect(selection.records.map(record => record.virtualPath)).toEqual(['Assets/Scripts/MyScript.cs']);
    expect(selection.implicitMetaRecords).toEqual([]);
    expect(selection.missingMetaForAssetRecords.map(record => record.virtualPath)).toEqual(['Assets/Scripts/MyScript.cs']);
  });

  it('writes asset and meta files to output dir', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildSingleScriptPackage());
    await extract(packagePath, outDir);

    const asset = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'));
    const meta = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs.meta'));
    expect(decoder.decode(asset)).toBe('public class MyScript {}');
    expect(decoder.decode(meta)).toContain('guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('rejects on collision without --force', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildSingleScriptPackage());
    await extract(packagePath, outDir);

    await expect(extract(packagePath, outDir)).rejects.toThrow(/already exist/);
  });

  it('overwrites with --force', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildSingleScriptPackage());
    await extract(packagePath, outDir);
    await expect(extract(packagePath, outDir, { force: true })).resolves.not.toThrow();
  });

  it('skips meta files with --no-meta', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildSingleScriptPackage());
    await extract(packagePath, outDir, { noMeta: true });

    const asset = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'));
    expect(decoder.decode(asset)).toBe('public class MyScript {}');
    await expect(readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs.meta'))).rejects.toThrow();
  });

  it('extracts only pathnames matching --filter', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildScriptAndTexturePackage());
    await extract(packagePath, outDir, { filter: 'Assets/Scripts/*.cs' });

    const asset = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'));
    expect(decoder.decode(asset)).toBe('public class MyScript {}');
    await expect(readFile(path.join(outDir, 'Assets/Textures/Icon.png'))).rejects.toThrow();
  });

  it('extracts no files when --filter matches nothing', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildScriptAndTexturePackage());
    await extract(packagePath, outDir, { filter: 'Assets/**/*.prefab' });

    await expect(readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'))).rejects.toThrow();
    await expect(readFile(path.join(outDir, 'Assets/Textures/Icon.png'))).rejects.toThrow();
  });

  it('extracts repeated exact asset path selections without implicit meta sidecars', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildScriptAndTexturePackage());
    await extract(packagePath, outDir, {
      paths: ['Assets/Scripts/MyScript.cs', 'Assets/Textures/Icon.png'],
    });

    const script = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'));
    const texture = await readFile(path.join(outDir, 'Assets/Textures/Icon.png'));
    expect(decoder.decode(script)).toBe('public class MyScript {}');
    expect(decoder.decode(texture)).toBe('png');
    await expect(readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs.meta'))).rejects.toThrow();
    await expect(readFile(path.join(outDir, 'Assets/Textures/Icon.png.meta'))).rejects.toThrow();
  });

  it('extracts an explicitly requested meta sidecar only', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildSingleScriptPackage());
    await extract(packagePath, outDir, { paths: ['Assets/Scripts/MyScript.cs.meta'] });

    const meta = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs.meta'));
    expect(decoder.decode(meta)).toContain('guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await expect(readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'))).rejects.toThrow();
  });

  it('expands exact asset path selections with --with-meta', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildSingleScriptPackage());
    await extract(packagePath, outDir, {
      paths: ['Assets/Scripts/MyScript.cs'],
      withMeta: true,
    });

    const asset = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'));
    const meta = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs.meta'));
    expect(decoder.decode(asset)).toBe('public class MyScript {}');
    expect(decoder.decode(meta)).toContain('guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('does not duplicate explicitly selected meta sidecars with --with-meta', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildSingleScriptPackage());
    await extract(packagePath, outDir, {
      paths: ['Assets/Scripts/MyScript.cs', 'Assets/Scripts/MyScript.cs.meta'],
      withMeta: true,
    });

    const asset = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'));
    const meta = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs.meta'));
    expect(decoder.decode(asset)).toBe('public class MyScript {}');
    expect(decoder.decode(meta)).toContain('guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('lets --no-meta override --with-meta for exact asset path selections', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await writeFile(packagePath, buildSingleScriptPackage());
      await extract(packagePath, outDir, {
        paths: ['Assets/Scripts/MyScript.cs'],
        noMeta: true,
        withMeta: true,
      });

      const asset = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'));
      expect(decoder.decode(asset)).toBe('public class MyScript {}');
      await expect(readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs.meta'))).rejects.toThrow();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith('WARNING: extract --no-meta overrides --with-meta; no meta sidecars will be written.');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('lets --no-meta override explicit meta paths when --with-meta is present', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await writeFile(packagePath, buildSingleScriptPackage());
      await extract(packagePath, outDir, {
        paths: ['Assets/Scripts/MyScript.cs', 'Assets/Scripts/MyScript.cs.meta'],
        noMeta: true,
        withMeta: true,
      });

      const asset = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'));
      expect(decoder.decode(asset)).toBe('public class MyScript {}');
      await expect(readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs.meta'))).rejects.toThrow();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('requires --path when --with-meta is enabled', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildSingleScriptPackage());
    await expect(extract(packagePath, outDir, { withMeta: true })).rejects.toThrow(
      'extract --with-meta requires at least one --path selection.',
    );
  });

  it('warns once per selected asset missing a requested meta sidecar', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await writeFile(packagePath, buildRawTarPackage({
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/pathname': 'Assets/Scripts/MyScript.cs',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/asset': 'public class MyScript {}',
      }));
      await extract(packagePath, outDir, {
        paths: ['Assets/Scripts/MyScript.cs'],
        withMeta: true,
      });

      const asset = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'));
      expect(decoder.decode(asset)).toBe('public class MyScript {}');
      expect(warnSpy).toHaveBeenCalledWith('WARNING: Meta sidecar not found for selected path: Assets/Scripts/MyScript.cs');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('warns for missing exact paths when at least one requested path is written', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await writeFile(packagePath, buildSingleScriptPackage());
      await extract(packagePath, outDir, {
        paths: ['Assets/Scripts/MyScript.cs', 'Assets/Missing.cs'],
      });

      expect(warnSpy).toHaveBeenCalledWith('WARNING: Requested path not found: Assets/Missing.cs');
      const asset = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'));
      expect(decoder.decode(asset)).toBe('public class MyScript {}');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('fails when no requested exact paths exist', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await writeFile(packagePath, buildSingleScriptPackage());
      await expect(extract(packagePath, outDir, { paths: ['Assets/Missing.cs'] })).rejects.toThrow(
        'None of the requested extract paths exist.',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('merges into an existing directory and reports changed and skipped files', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await writeFile(packagePath, buildSingleScriptPackage());
      await extract(packagePath, outDir);
      await writeFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'), 'stale');

      await expect(extract(packagePath, outDir, { merge: true })).resolves.not.toThrow();

      const asset = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'));
      expect(decoder.decode(asset)).toBe('public class MyScript {}');
      expect(logSpy).toHaveBeenCalledWith('Changed 1 file(s), skipped 1 unchanged file(s).');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('skips traversal paths', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'traversal.unitypackage');
    const outDir = path.join(dir, 'out');

    const data = createUnityPackage([
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: '../escape.txt',
        asset: encoder.encode('escaped'),
        meta: encoder.encode('guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      },
    ]);
    await writeFile(packagePath, data);
    await extract(packagePath, outDir);

    await expect(readFile(path.join(dir, 'escape.txt'))).rejects.toThrow();
  });

  it('reports skipped traversal entries in the summary', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'traversal.unitypackage');
    const outDir = path.join(dir, 'out');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const data = createUnityPackage([
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: '../escape.txt',
        asset: encoder.encode('escaped'),
        meta: encoder.encode('guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      },
    ]);

    try {
      await writeFile(packagePath, data);
      await extract(packagePath, outDir);
      expect(logSpy).toHaveBeenCalledWith('Skipped 1 traversal entry.');
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('reports stderr progress for packages over 100 write entries', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'large.unitypackage');
    const outDir = path.join(dir, 'out');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await writeFile(packagePath, buildManyTextAssetsPackage(101));
      await extract(packagePath, outDir);

      const stderr = stderrSpy.mock.calls.map(call => call[0]).join('');
      expect(stderr).toContain('Extract progress: checked 100/202 file(s)');
      expect(stderr).toContain('Extract progress: wrote 202/202 file(s)');
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
