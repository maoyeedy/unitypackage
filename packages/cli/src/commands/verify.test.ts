import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { createUnityPackage } from 'unitypackage-core';
import { verify } from './verify.js';
import {
  buildMalformedTarPackage,
  buildRawTarPackage,
  buildSingleScriptPackage,
  createTarEntry,
  encoder,
  makeTempDir,
} from '../test-utils.js';

describe('verify', () => {
  async function readVerifyJson(packagePath: string): Promise<{ findings: Array<{ code: string; level: string }> }> {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await verify(packagePath, { json: true }).catch(() => undefined);
      return JSON.parse(writeSpy.mock.calls.map(call => call[0]).join('')) as {
        findings: Array<{ code: string; level: string }>;
      };
    } finally {
      writeSpy.mockRestore();
    }
  }

  it('returns ok for valid package', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    await writeFile(packagePath, buildSingleScriptPackage());

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
    const guid = 'cccccccccccccccccccccccccccccccc';

    await writeFile(
      packagePath,
      buildRawTarPackage({
        [`${guid}/pathname`]: 'Assets/Foo.cs',
        [`${guid}/asset`]: 'foo',
      }),
    );

    const result = await verify(packagePath);
    expect(result.ok).toBe(true);
    expect(result.findings.some(f => f.code === 'PARSER_META_MISSING')).toBe(true);
    expect(result.findings.some(f => f.code === 'MISSING_META')).toBe(true);
  });

  it('reports migrated format health checks', async () => {
    const dir = await makeTempDir();
    const unsafePackage = path.join(dir, 'unsafe.unitypackage');
    const backslashPackage = path.join(dir, 'backslash.unitypackage');
    const emptyPackage = path.join(dir, 'empty.unitypackage');

    await writeFile(
      unsafePackage,
      buildRawTarPackage({
        'loose-guid/pathname': '../Escape.cs',
        'loose-guid/asset': 'asset',
      }),
    );
    await writeFile(
      backslashPackage,
      buildRawTarPackage({
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/pathname': 'Assets\\Backslash.cs',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/asset': 'asset',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/asset.meta': 'guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    );
    await writeFile(emptyPackage, gzipSync(new Uint8Array(1024)));

    const unsafeWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await verify(unsafePackage, { json: true }).catch(() => undefined);
      const json = JSON.parse(unsafeWriteSpy.mock.calls.map(call => call[0]).join('')) as {
        findings: Array<{ code: string }>;
      };
      expect(json.findings.some(f => f.code === 'PARSER_NON_STANDARD_GUID')).toBe(true);
      expect(json.findings.some(f => f.code === 'PATH_OUTSIDE_ASSETS')).toBe(true);
      expect(json.findings.some(f => f.code === 'UNSAFE_PATHNAME')).toBe(true);
      expect(json.findings.some(f => f.code === 'MISSING_META')).toBe(true);
    } finally {
      unsafeWriteSpy.mockRestore();
    }

    const backslashJson = await readVerifyJson(backslashPackage);
    expect(backslashJson.findings.some(f => f.code === 'UNSAFE_PATHNAME')).toBe(true);
    expect(backslashJson.findings.some(f => f.code === 'BACKSLASH_PATH')).toBe(true);

    const emptyResult = await verify(emptyPackage);
    expect(emptyResult.findings.some(f => f.code === 'NO_ENTRIES')).toBe(true);
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

    const json = await readVerifyJson(packagePath);
    expect(json.findings.some(f => f.code === 'GUID_MISMATCH' && f.level === 'error')).toBe(true);
  });

  it('reports duplicate pathnames from core analysis', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'duplicate-path.unitypackage');

    await writeFile(
      packagePath,
      buildRawTarPackage({
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/pathname': 'Assets/Duplicate.cs',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/asset': 'first',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/asset.meta': 'guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/pathname': 'Assets/Duplicate.cs',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/asset': 'second',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/asset.meta': 'guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    );

    const json = await readVerifyJson(packagePath);
    expect(json.findings.some(f => f.code === 'DUPLICATE_PATH' && f.level === 'error')).toBe(true);
  });

  it('reports meta importer mismatch as warning by default and strict-fatal under strict mode', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'importer-mismatch.unitypackage');
    const guid = 'dddddddddddddddddddddddddddddddd';

    await writeFile(
      packagePath,
      buildRawTarPackage({
        [`${guid}/pathname`]: 'Assets/Foo.cs',
        [`${guid}/asset`]: 'public class Foo {}',
        [`${guid}/asset.meta`]: `fileFormatVersion: 2\nguid: ${guid}\nDefaultImporter:\n  externalObjects: {}\n`,
      }),
    );

    const result = await verify(packagePath);
    expect(result.ok).toBe(true);
    expect(result.findings.some(f => f.code === 'IMPORTER_MISMATCH' && f.level === 'warn')).toBe(true);
    await expect(verify(packagePath, { strict: true })).rejects.toThrow(/Package has warnings/);
  });

  it('warns on unexpected files while allowing preview and legacy metadata', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'unexpected.unitypackage');
    const guid = 'ffffffffffffffffffffffffffffffff';

    await writeFile(
      packagePath,
      buildRawTarPackage({
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

  it('reports UNEXPECTED_FILE when a file is outside any GUID directory', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'outside-guid.unitypackage');
    const guid = 'ffffffffffffffffffffffffffffffff';

    await writeFile(
      packagePath,
      buildRawTarPackage({
        [`${guid}/pathname`]: 'Assets/Foo.cs',
        [`${guid}/asset.meta`]: `guid: ${guid}`,
        'stray_at_root.txt': 'hello',
      }),
    );

    const result = await verify(packagePath);
    expect(result.findings.some(f => f.code === 'UNEXPECTED_FILE' && f.entry === 'stray_at_root.txt')).toBe(true);
  });

  it('reports parser diagnostics for empty pathnames, non-standard GUIDs, and malformed tar entries', async () => {
    const dir = await makeTempDir();
    const emptyPathPackage = path.join(dir, 'empty.unitypackage');
    const looseGuidPackage = path.join(dir, 'loose.unitypackage');
    const malformedPackage = path.join(dir, 'malformed.unitypackage');

    await writeFile(
      emptyPathPackage,
      buildRawTarPackage({
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/pathname': '\nAssets/Ignored.cs',
      }),
    );
    await writeFile(
      looseGuidPackage,
      buildRawTarPackage({
        'loose-guid/pathname': 'Assets/Loose.cs',
        'loose-guid/asset.meta': 'guid: loose-guid',
      }),
    );
    await writeFile(malformedPackage, buildMalformedTarPackage());

    const emptyWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await verify(emptyPathPackage, { json: true }).catch(() => undefined);
      const emptyJson = JSON.parse(emptyWriteSpy.mock.calls.map(call => call[0]).join('')) as {
        findings: Array<{ code: string }>;
      };
      expect(emptyJson.findings.some(f => f.code === 'PARSER_EMPTY_PATHNAME')).toBe(true);
    } finally {
      emptyWriteSpy.mockRestore();
    }

    expect((await verify(looseGuidPackage)).findings.some(f => f.code === 'PARSER_NON_STANDARD_GUID')).toBe(true);

    const malformedWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await verify(malformedPackage, { json: true }).catch(() => undefined);
      const malformedJson = JSON.parse(malformedWriteSpy.mock.calls.map(call => call[0]).join('')) as {
        findings: Array<{ code: string }>;
      };
      expect(malformedJson.findings.some(f => f.code === 'PARSER_MALFORMED_TAR_ENTRY')).toBe(true);
    } finally {
      malformedWriteSpy.mockRestore();
    }
  });

  it('reports PARSER_DUPLICATE_GUID when the same GUID appears twice', async () => {
    const dir = await makeTempDir();
    const guid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const entry1 = createTarEntry(`${guid}/pathname`, encoder.encode('Assets/First.cs'));
    const entry2 = createTarEntry(`${guid}/pathname`, encoder.encode('Assets/Duplicate.cs'));
    const meta = createTarEntry(`${guid}/asset.meta`, encoder.encode(`guid: ${guid}`));
    const tarBytes = new Uint8Array(entry1.length + entry2.length + meta.length + 1024);
    tarBytes.set(entry1, 0);
    tarBytes.set(entry2, entry1.length);
    tarBytes.set(meta, entry1.length + entry2.length);
    const dupGuidPackage = path.join(dir, 'dup-guid.unitypackage');
    await writeFile(dupGuidPackage, gzipSync(tarBytes));

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await verify(dupGuidPackage, { json: true }).catch(() => undefined);
      const json = JSON.parse(writeSpy.mock.calls.map(call => call[0]).join('')) as {
        findings: Array<{ code: string }>;
      };
      expect(json.findings.some(f => f.code === 'PARSER_DUPLICATE_GUID')).toBe(true);
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('reports PARSER_ASSET_MISSING when entry has meta but no asset file', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'asset-missing.unitypackage');
    const guid = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    await writeFile(
      packagePath,
      buildRawTarPackage({
        [`${guid}/pathname`]: 'Assets/NoAsset.cs',
        [`${guid}/asset.meta`]: `guid: ${guid}`,
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
      buildRawTarPackage({
        [`${guid}/pathname`]: 'Assets/NoMeta.cs',
        [`${guid}/asset`]: 'public class NoMeta {}',
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
      buildRawTarPackage({
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
      buildRawTarPackage({
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
      buildRawTarPackage({
        [`${guid}/pathname`]: 'Assets/NoMeta.cs',
        [`${guid}/asset`]: 'asset',
      }),
    );

    await expect(verify(packagePath, { strict: true })).rejects.toThrow(/Package has warnings/);
  });

  it('exits non-zero when an error-severity parse diagnostic is present', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'empty-pathname.unitypackage');
    const guid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    await writeFile(
      packagePath,
      buildRawTarPackage({
        [`${guid}/pathname`]: '\nAssets/Ignored.cs',
      }),
    );

    await expect(verify(packagePath)).rejects.toThrow(/Package has errors/);
  });

  it('exits zero for packages with only warning-severity diagnostics (no strict)', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'warning-only.unitypackage');
    const guid = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    await writeFile(
      packagePath,
      buildRawTarPackage({
        [`${guid}/pathname`]: 'Assets/NoMeta.cs',
        [`${guid}/asset`]: 'asset',
      }),
    );

    const result = await verify(packagePath);
    expect(result.ok).toBe(true);
    expect(result.findings.some(f => f.code === 'PARSER_META_MISSING')).toBe(true);
  });

  it('propagates parse option decompression bomb errors to top-level handling', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    await writeFile(packagePath, buildSingleScriptPackage());

    await expect(verify(packagePath, { parseOptions: { maxEntries: 0 } })).rejects.toMatchObject({
      name: 'DecompressionBombError',
      kind: 'entry-count',
      observed: 1,
    });
  });
});
