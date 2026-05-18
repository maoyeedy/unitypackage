import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createUnityPackage } from 'unitypackage-core';
import { extract } from './commands/extract.js';
import { pack } from './commands/pack.js';
import { inspect } from './commands/inspect.js';
import { verify } from './commands/verify.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'unitypackage-tools-test-'));
  tempDirs.push(dir);
  return dir;
}

function buildMinimalPackage(): Uint8Array {
  return createUnityPackage([
    {
      guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pathname: 'Assets/Scripts/MyScript.cs',
      asset: encoder.encode('public class MyScript {}'),
      meta: encoder.encode('fileFormatVersion: 2\nguid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'),
    },
  ]);
}

afterEach(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('extract', () => {
  it('writes asset and meta files to output dir', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildMinimalPackage());
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

    await writeFile(packagePath, buildMinimalPackage());
    await extract(packagePath, outDir);

    await expect(extract(packagePath, outDir)).rejects.toThrow(/already exist/);
  });

  it('overwrites with --force', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildMinimalPackage());
    await extract(packagePath, outDir);
    await expect(extract(packagePath, outDir, { force: true })).resolves.not.toThrow();
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

    // File must not exist outside outDir
    await expect(readFile(path.join(dir, 'escape.txt'))).rejects.toThrow();
  });
});

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
});

describe('inspect', () => {
  it('returns correct summary for minimal package', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    await writeFile(packagePath, buildMinimalPackage());

    const result = await inspect(packagePath);

    expect(result.schemaVersion).toBe(0);
    expect(result.summary.entries).toBe(1);
    expect(result.summary.withAsset).toBe(1);
    expect(result.summary.withMeta).toBe(1);
    expect(result.summary.folders).toBe(0);
    expect(result.entries[0].guid).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(result.entries[0].pathname).toBe('Assets/Scripts/MyScript.cs');
  });

  it('includes sha256 in package info', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    await writeFile(packagePath, buildMinimalPackage());

    const result = await inspect(packagePath);
    expect(result.package.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('verify', () => {
  it('returns ok for valid package', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    await writeFile(packagePath, buildMinimalPackage());

    const result = await verify(packagePath);
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('returns ok for multi-entry package with unique GUIDs', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'multi.unitypackage');

    const data = createUnityPackage([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/A.cs',
        asset: encoder.encode('A'),
        meta: encoder.encode('guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      },
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: 'Assets/B.cs',
        asset: encoder.encode('B'),
        meta: encoder.encode('guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      },
    ]);
    await writeFile(packagePath, data);

    const result = await verify(packagePath);
    expect(result.ok).toBe(true);
  });

  it('warns for missing meta', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'nometa.unitypackage');

    const data = createUnityPackage([
      {
        guid: 'cccccccccccccccccccccccccccccccc',
        pathname: 'Assets/Foo.cs',
        asset: encoder.encode('foo'),
        meta: encoder.encode('guid: cccccccccccccccccccccccccccccccc'),
      },
    ]);
    await writeFile(packagePath, data);

    // Valid package with meta — should pass
    const result = await verify(packagePath);
    expect(result.ok).toBe(true);
  });
});
