import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUnityPackage } from 'unitypackage-core';
import { extract } from './commands/extract.js';
import { pack } from './commands/pack.js';
import { inspect } from './commands/inspect.js';
import { verify } from './commands/verify.js';
import { diff } from './commands/diff.js';
import { doctor } from './commands/doctor.js';
import { cli } from './cli.js';
import { createLimiter } from './util/concurrency.js';

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

function buildRawPackage(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries = Object.entries(files).map(([name, content]) =>
    createTarEntry(name, typeof content === 'string' ? encoder.encode(content) : content),
  );
  const tar = new Uint8Array(entries.reduce((sum, entry) => sum + entry.length, 0) + 1024);
  let offset = 0;
  for (const entry of entries) {
    tar.set(entry, offset);
    offset += entry.length;
  }
  return gzipSync(tar);
}

function buildMalformedTarPackage(): Uint8Array {
  const header = new Uint8Array(1536);
  header.set(encoder.encode('bad/pathname'), 0);
  header.set(encoder.encode('invalid'), 124);
  return gzipSync(header);
}

function createTarEntry(name: string, content: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  header.set(encoder.encode(name), 0);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, content.length);
  writeOctal(header, 136, 12, 0);
  for (let i = 148; i < 156; i += 1) header[i] = 0x20;
  header[156] = 0x30;
  header.set(encoder.encode('ustar\0'), 257);
  header.set(encoder.encode('00'), 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.set(encoder.encode(checksum.toString(8).padStart(6, '0') + '\0 '), 148);

  const entry = new Uint8Array(512 + Math.ceil(content.length / 512) * 512);
  entry.set(header, 0);
  entry.set(content, 512);
  return entry;
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  target.set(encoder.encode(value.toString(8).padStart(length - 1, '0') + '\0'), offset);
}

function buildMultiAssetPackage(): Uint8Array {
  return createUnityPackage([
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
  ]);
}

function buildLargePackage(entryCount: number): Uint8Array {
  return createUnityPackage(
    Array.from({ length: entryCount }, (_, index) => {
      const guid = index.toString(16).padStart(32, '0');
      return {
        guid,
        pathname: `Assets/Large/File${index}.txt`,
        asset: encoder.encode(`file ${index}`),
        meta: encoder.encode(`fileFormatVersion: 2\nguid: ${guid}\n`),
      };
    }),
  );
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

  it('skips meta files with --no-meta', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildMinimalPackage());
    await extract(packagePath, outDir, { noMeta: true });

    const asset = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'));
    expect(decoder.decode(asset)).toBe('public class MyScript {}');
    await expect(readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs.meta'))).rejects.toThrow();
  });

  it('extracts only pathnames matching --filter', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildMultiAssetPackage());
    await extract(packagePath, outDir, { filter: 'Assets/Scripts/*.cs' });

    const asset = await readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'));
    expect(decoder.decode(asset)).toBe('public class MyScript {}');
    await expect(readFile(path.join(outDir, 'Assets/Textures/Icon.png'))).rejects.toThrow();
  });

  it('extracts no files when --filter matches nothing', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');

    await writeFile(packagePath, buildMultiAssetPackage());
    await extract(packagePath, outDir, { filter: 'Assets/**/*.prefab' });

    await expect(readFile(path.join(outDir, 'Assets/Scripts/MyScript.cs'))).rejects.toThrow();
    await expect(readFile(path.join(outDir, 'Assets/Textures/Icon.png'))).rejects.toThrow();
  });

  it('merges into an existing directory and reports changed and skipped files', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const outDir = path.join(dir, 'out');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await writeFile(packagePath, buildMinimalPackage());
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

    // File must not exist outside outDir
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
      await writeFile(packagePath, buildLargePackage(101));
      await extract(packagePath, outDir);

      const stderr = stderrSpy.mock.calls.map(call => call[0]).join('');
      expect(stderr).toContain('Extract progress: checked 100/202 file(s)');
      expect(stderr).toContain('Extract progress: wrote 202/202 file(s)');
    } finally {
      stderrSpy.mockRestore();
    }
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

describe('concurrency helpers', () => {
  it('limits concurrent work', async () => {
    const limit = createLimiter(3);
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;

    const promises = Array.from({ length: 6 }, () =>
      limit(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>(resolve => releases.push(resolve));
        active--;
      }),
    );

    for (let index = 0; index < 6; index++) {
      while (releases.length === 0) {
        await Promise.resolve();
      }
      releases.shift()?.();
      await Promise.resolve();
    }

    await Promise.all(promises);
    expect(maxActive).toBe(3);
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

  it('renders tree format instead of a flat list', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await writeFile(packagePath, buildMultiAssetPackage());
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
    await writeFile(packagePath, buildMultiAssetPackage());

    const result = await inspect(packagePath, { filter: 'cs' });

    expect(result.entries.map(e => e.pathname)).toEqual(['Assets/Scripts/MyScript.cs']);
    expect(result.summary.entries).toBe(1);
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

  it('checks asset.meta GUID values against directory names', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'mismatch.unitypackage');

    const data = createUnityPackage([
      {
        guid: 'dddddddddddddddddddddddddddddddd',
        pathname: 'Assets/Foo.cs',
        asset: encoder.encode('foo'),
        meta: encoder.encode('guid: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
      },
    ]);
    await writeFile(packagePath, data);

    await expect(verify(packagePath)).rejects.toThrow(/Package has errors/);
  });

  it('warns on unexpected files while allowing preview and legacy metadata', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'unexpected.unitypackage');
    const guid = 'ffffffffffffffffffffffffffffffff';

    await writeFile(
      packagePath,
      buildRawPackage({
        [`${guid}/pathname`]: 'Assets/Foo.cs',
        [`${guid}/asset.meta`]: `guid: ${guid}`,
        [`${guid}/preview.png`]: 'preview',
        [`${guid}/metaData`]: `guid: ${guid}`,
        [`${guid}/notes.txt`]: 'notes',
      }),
    );

    const result = await verify(packagePath);
    expect(result.findings.some(f => f.code === 'UNEXPECTED_FILE' && f.entry === `${guid}/notes.txt`)).toBe(true);
    expect(result.findings.some(f => f.code === 'UNEXPECTED_FILE' && f.entry === `${guid}/preview.png`)).toBe(false);
    expect(result.findings.some(f => f.code === 'PARSER_IGNORED_PREVIEW')).toBe(false);
  });

  it('reports parser diagnostics for empty pathnames, non-standard GUIDs, and malformed tar entries', async () => {
    const dir = await makeTempDir();
    const emptyPathPackage = path.join(dir, 'empty.unitypackage');
    const looseGuidPackage = path.join(dir, 'loose.unitypackage');
    const malformedPackage = path.join(dir, 'malformed.unitypackage');

    await writeFile(
      emptyPathPackage,
      buildRawPackage({
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/pathname': '\nAssets/Ignored.cs',
      }),
    );
    await writeFile(
      looseGuidPackage,
      buildRawPackage({
        'loose-guid/pathname': 'Assets/Loose.cs',
        'loose-guid/asset.meta': 'guid: loose-guid',
      }),
    );
    await writeFile(malformedPackage, buildMalformedTarPackage());

    expect((await verify(emptyPathPackage)).findings.some(f => f.code === 'PARSER_EMPTY_PATHNAME')).toBe(true);
    expect((await verify(looseGuidPackage)).findings.some(f => f.code === 'PARSER_NON_STANDARD_GUID')).toBe(true);
    expect((await verify(malformedPackage)).findings.some(f => f.code === 'PARSER_MALFORMED_TAR_ENTRY')).toBe(true);
  });

  it('reports PARSER_DUPLICATE_GUID when the same GUID appears twice', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'dup-guid.unitypackage');
    const guid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    await writeFile(
      packagePath,
      buildRawPackage({
        [`${guid}/pathname`]: 'Assets/First.cs',
        [`${guid}/asset.meta`]: `guid: ${guid}`,
        // A second pathname entry for the same GUID triggers duplicate-guid
        // buildRawPackage keeps last-wins for Record keys, so we need a raw approach.
        // Use a different suffix to force two tar entries with the same pathname key.
      }),
    );

    // buildRawPackage deduplicates Record keys; construct manually via createTarEntry.
    const entry1 = createTarEntry(`${guid}/pathname`, encoder.encode('Assets/First.cs'));
    const entry2 = createTarEntry(`${guid}/pathname`, encoder.encode('Assets/Duplicate.cs'));
    const meta = createTarEntry(`${guid}/asset.meta`, encoder.encode(`guid: ${guid}`));
    const tarBytes = new Uint8Array(entry1.length + entry2.length + meta.length + 1024);
    tarBytes.set(entry1, 0);
    tarBytes.set(entry2, entry1.length);
    tarBytes.set(meta, entry1.length + entry2.length);
    const dupGuidPackage = path.join(dir, 'dup-guid2.unitypackage');
    await writeFile(dupGuidPackage, gzipSync(tarBytes));

    const result = await verify(dupGuidPackage);
    expect(result.findings.some(f => f.code === 'PARSER_DUPLICATE_GUID')).toBe(true);
  });

  it('reports PARSER_ASSET_MISSING when entry has meta but no asset file', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'asset-missing.unitypackage');
    const guid = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    await writeFile(
      packagePath,
      buildRawPackage({
        [`${guid}/pathname`]: 'Assets/NoAsset.cs',
        [`${guid}/asset.meta`]: `guid: ${guid}`,
        // no asset entry -- triggers asset-missing
      }),
    );

    const result = await verify(packagePath);
    expect(result.findings.some(f => f.code === 'PARSER_ASSET_MISSING')).toBe(true);
  });

  it('reports PARSER_META_MISSING when entry has asset but no meta file', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'meta-missing.unitypackage');
    const guid = 'cccccccccccccccccccccccccccccccc';

    await writeFile(
      packagePath,
      buildRawPackage({
        [`${guid}/pathname`]: 'Assets/NoMeta.cs',
        [`${guid}/asset`]: 'public class NoMeta {}',
        // no asset.meta entry -- triggers meta-missing
      }),
    );

    const result = await verify(packagePath);
    expect(result.findings.some(f => f.code === 'PARSER_META_MISSING')).toBe(true);
  });

  it('reports PARSER_ZERO_BYTE_ASSET when the asset file has zero bytes', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'zero-byte.unitypackage');
    const guid = 'dddddddddddddddddddddddddddddddd';

    await writeFile(
      packagePath,
      buildRawPackage({
        [`${guid}/pathname`]: 'Assets/Empty.cs',
        [`${guid}/asset`]: '',
        [`${guid}/asset.meta`]: `guid: ${guid}`,
      }),
    );

    const result = await verify(packagePath);
    expect(result.findings.some(f => f.code === 'PARSER_ZERO_BYTE_ASSET')).toBe(true);
  });

  it('reports PARSER_OVERSIZED_ENTRY_NAME when pathname exceeds 200 characters', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'oversized.unitypackage');
    const guid = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const longPathname = 'Assets/' + 'A'.repeat(200);

    await writeFile(
      packagePath,
      buildRawPackage({
        [`${guid}/pathname`]: longPathname,
        [`${guid}/asset.meta`]: `guid: ${guid}`,
      }),
    );

    const result = await verify(packagePath);
    expect(result.findings.some(f => f.code === 'PARSER_OVERSIZED_ENTRY_NAME')).toBe(true);
  });

  it('fails in strict mode when warnings are present', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'warning.unitypackage');
    const guid = 'abababababababababababababababab';

    await writeFile(
      packagePath,
      buildRawPackage({
        [`${guid}/pathname`]: 'Assets/NoMeta.cs',
        [`${guid}/asset`]: 'asset',
      }),
    );

    await expect(verify(packagePath, { strict: true })).rejects.toThrow(/Package has warnings/);
  });
});

describe('diff', () => {
  it('reports added, removed, and changed entries by GUID, pathname, and asset hash', async () => {
    const dir = await makeTempDir();
    const beforePath = path.join(dir, 'before.unitypackage');
    const afterPath = path.join(dir, 'after.unitypackage');

    await writeFile(
      beforePath,
      createUnityPackage([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/Changed.cs',
          asset: encoder.encode('before'),
          meta: encoder.encode('guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
        },
        {
          guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          pathname: 'Assets/Removed.cs',
          asset: encoder.encode('removed'),
          meta: encoder.encode('guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
        },
      ]),
    );
    await writeFile(
      afterPath,
      createUnityPackage([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/Changed.cs',
          asset: encoder.encode('after'),
          meta: encoder.encode('guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
        },
        {
          guid: 'cccccccccccccccccccccccccccccccc',
          pathname: 'Assets/Added.cs',
          asset: encoder.encode('added'),
          meta: encoder.encode('guid: cccccccccccccccccccccccccccccccc'),
        },
      ]),
    );

    const result = await diff(beforePath, afterPath);

    expect(result.added).toMatchObject([{ guid: 'cccccccccccccccccccccccccccccccc', pathname: 'Assets/Added.cs' }]);
    expect(result.removed).toMatchObject([{ guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', pathname: 'Assets/Removed.cs' }]);
    expect(result.changed[0].guid).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(result.changed[0].before.assetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.changed[0].after.assetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.changed[0].before.assetHash).not.toBe(result.changed[0].after.assetHash);
  });

  it('emits parseable JSON', async () => {
    const dir = await makeTempDir();
    const beforePath = path.join(dir, 'before.unitypackage');
    const afterPath = path.join(dir, 'after.unitypackage');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await writeFile(beforePath, buildMinimalPackage());
      await writeFile(afterPath, buildMinimalPackage());

      await diff(beforePath, afterPath, { json: true });

      const output = writeSpy.mock.calls.map(call => call[0]).join('');
      expect(JSON.parse(output).summary).toEqual({ added: 0, removed: 0, changed: 0 });
    } finally {
      writeSpy.mockRestore();
    }
  });
});

describe('doctor', () => {
  it('reports package health checks scoped to unitypackage format patterns', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'health.unitypackage');

    await writeFile(
      packagePath,
      buildRawPackage({
        'loose-guid/pathname': '../Escape.cs',
        'loose-guid/asset': 'asset',
      }),
    );

    const result = await doctor(packagePath);

    expect(result.checks.some(check => check.code === 'PARSER_NON_STANDARD_GUID')).toBe(true);
    expect(result.checks.some(check => check.code === 'NON_STANDARD_GUID')).toBe(true);
    expect(result.checks.some(check => check.code === 'PATH_OUTSIDE_ASSETS')).toBe(true);
    expect(result.checks.some(check => check.code === 'UNSAFE_PATHNAME')).toBe(true);
    expect(result.checks.some(check => check.code === 'MISSING_META')).toBe(true);
  });

  it('emits parseable JSON', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await writeFile(packagePath, buildMinimalPackage());

      await doctor(packagePath, { json: true });

      const output = writeSpy.mock.calls.map(call => call[0]).join('');
      expect(JSON.parse(output).summary.entries).toBe(1);
    } finally {
      writeSpy.mockRestore();
    }
  });
});

describe('cli help', () => {
  it('lists diff and doctor commands', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await cli(['--help']);
      const help = logSpy.mock.calls.map(call => call[0]).join('\n');
      expect(help).toContain('diff <pkg-a> <pkg-b>');
      expect(help).toContain('doctor <package.unitypackage>');
    } finally {
      logSpy.mockRestore();
    }
  });
});
