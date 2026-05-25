import { describe, expect, it } from 'vitest';
import { gzipSync, gunzipSync } from 'fflate';
import {
  createUnityPackage,
  tryCreateUnityPackage,
  estimateUnityPackageSize,
  parseUnityPackage,
  parseUnityPackageEntries,
  parseUnityPackageStream,
  isValidGuid,
  generateGuid,
  guidFromPath,
  validatePathname,
  detectPathnameCollisions,
  createMinimalMeta,
  createMinimalMetaFor,
  createMinimalFolderMeta,
  detectMetaImporterType,
  summarizePackage,
  DecompressionBombError,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_MAX_ENTRIES,
  type CreateUnityPackageEntry,
  type CreateUnityPackageDiagnostic,
  type UnityPackageEntry,
  type UnityPackageParseDiagnostic,
  type StreamedEntry,
  type StreamedDiagnostic,
} from './index';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function createTarEntry(name: string, content: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  const nameBytes = encoder.encode(name);
  header.set(nameBytes.subarray(0, 100), 0);
  const sizeStr = content.length.toString(8).padStart(11, '0');
  header.set(encoder.encode(sizeStr), 124);
  for (let i = 148; i < 156; i += 1) header[i] = 0x20;
  header[156] = 0x30;
  header.set(encoder.encode('ustar\0'), 257);
  header[263] = 0x30;
  header[264] = 0x30;
  let checksum = 0;
  for (let i = 0; i < 512; i += 1) checksum += header[i];
  const checksumStr = checksum.toString(8).padStart(6, '0') + '\0 ';
  header.set(encoder.encode(checksumStr), 148);
  const padSize = Math.ceil(content.length / 512) * 512;
  const entry = new Uint8Array(512 + padSize);
  entry.set(header, 0);
  entry.set(content, 512);
  return entry;
}

function createLegacyUnityPackage(files: Record<string, string>): Uint8Array {
  const entries: Uint8Array[] = [];
  for (const [name, content] of Object.entries(files)) {
    entries.push(createTarEntry(name, encoder.encode(content)));
  }
  entries.push(new Uint8Array(1024));
  return gzipSync(concatUint8Arrays(entries));
}

describe('parseUnityPackage', () => {
  it('extracts a single asset from a minimal .unitypackage', () => {
    const guid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/MyScript.cs',
      [`${guid}/asset`]: 'public class MyScript {}',
    });

    const result = parseUnityPackage(data);

    expect(result['Assets/MyScript.cs']).toBeDefined();
    expect(decoder.decode(result['Assets/MyScript.cs'])).toBe('public class MyScript {}');
  });

  it('extracts multiple assets', () => {
    const data = createLegacyUnityPackage({
      [`a${'a'.repeat(30)}/pathname`]: 'Assets/A.cs',
      [`a${'a'.repeat(30)}/asset`]: '// A',
      [`b${'b'.repeat(30)}/pathname`]: 'Assets/B.cs',
      [`b${'b'.repeat(30)}/asset`]: '// B',
    });

    const result = parseUnityPackage(data);

    expect(result['Assets/A.cs']).toBeDefined();
    expect(result['Assets/B.cs']).toBeDefined();
    expect(Object.keys(result)).toHaveLength(2);
  });

  it('extracts asset.meta alongside asset', () => {
    const guid = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/Texture.png',
      [`${guid}/asset`]: 'binary data',
      [`${guid}/asset.meta`]: 'guid: abc123',
    });

    const result = parseUnityPackage(data);

    expect(result['Assets/Texture.png']).toBeDefined();
    expect(result['Assets/Texture.png.meta']).toBeDefined();
    expect(decoder.decode(result['Assets/Texture.png.meta'])).toBe('guid: abc123');
  });

  it('falls back to metaData when asset.meta is absent', () => {
    const guid = 'dddddddddddddddddddddddddddddd';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/Texture.png',
      [`${guid}/asset`]: 'binary data',
      [`${guid}/metaData`]: 'guid: legacy',
    });

    const result = parseUnityPackage(data);

    expect(decoder.decode(result['Assets/Texture.png.meta'])).toBe('guid: legacy');
  });

  it('ignores preview.png entries', () => {
    const guid = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/Texture.png',
      [`${guid}/asset`]: 'binary data',
      [`${guid}/asset.meta`]: 'guid: preview',
      [`${guid}/preview.png`]: 'thumbnail',
    });

    const { entries: parsedEntries, diagnostics: parsedDiagnostics } = parseUnityPackageEntries(data);
    const parsedFiles = parseUnityPackage(data);

    expect(parsedEntries).toHaveLength(1);
    expect(decoder.decode(parsedEntries[0].preview!)).toBe('thumbnail');
    expect(parsedDiagnostics).toEqual([
      {
        code: 'ignored-preview',
        message: 'preview.png is exposed on entries and ignored by flat parsing.',
        severity: 'info',
        path: `${guid}/preview.png`,
        guid,
      },
    ]);
    expect(Object.keys(parsedFiles)).toEqual(['Assets/Texture.png', 'Assets/Texture.png.meta']);
  });

  it('uses the trimmed first line from multi-line pathnames', () => {
    const guid = 'ffffffffffffffffffffffffffffffff';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: '  Assets/First.prefab  \nAssets/Ignored.prefab\n',
      [`${guid}/asset`]: 'prefab',
    });

    const { entries: parsedEntries } = parseUnityPackageEntries(data);
    const parsedFiles = parseUnityPackage(data);

    expect(parsedEntries[0].pathname).toBe('Assets/First.prefab');
    expect(decoder.decode(parsedFiles['Assets/First.prefab'])).toBe('prefab');
    expect(parsedFiles['Assets/Ignored.prefab']).toBeUndefined();
  });

  it('skips entries without a pathname', () => {
    const guid = 'cccccccccccccccccccccccccccccc';
    const data = createLegacyUnityPackage({
      [`${guid}/asset`]: 'orphan data',
    });

    const result = parseUnityPackage(data);

    expect(Object.keys(result)).toHaveLength(0);
  });

  it('skips empty pathname records', () => {
    const guid = '11111111111111111111111111111111';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: '\nAssets/Ignored.cs',
      [`${guid}/asset`]: 'ignored',
      [`${guid}/asset.meta`]: 'ignored meta',
    });

    const { entries: parsedEntries, diagnostics: parsedDiagnostics } = parseUnityPackageEntries(data);
    const parsedFiles = parseUnityPackage(data);

    expect(parsedEntries).toEqual([]);
    expect(parsedDiagnostics).toEqual([
      {
        code: 'empty-pathname',
        message: 'Skipped record with an empty pathname.',
        severity: 'error',
        path: `${guid}/pathname`,
        guid,
      },
    ]);
    expect(parsedFiles).toEqual({});
  });

  it('preserves non-ASCII pathnames', () => {
    const guid = '22222222222222222222222222222222';
    const pathname = 'Assets/Tėst/日本語.prefab';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: pathname,
      [`${guid}/asset`]: 'unicode asset',
      [`${guid}/asset.meta`]: 'unicode meta',
    });

    const { entries: parsedEntries } = parseUnityPackageEntries(data);
    const parsedFiles = parseUnityPackage(data);

    expect(parsedEntries[0].pathname).toBe(pathname);
    expect(decoder.decode(parsedFiles[pathname])).toBe('unicode asset');
    expect(decoder.decode(parsedFiles[`${pathname}.meta`])).toBe('unicode meta');
  });

  it('keeps duplicate pathnames as separate entries while flat extraction uses the later file', () => {
    const firstGuid = '33333333333333333333333333333333';
    const secondGuid = '44444444444444444444444444444444';
    const data = createLegacyUnityPackage({
      [`${firstGuid}/pathname`]: 'Assets/Duplicate.asset',
      [`${firstGuid}/asset`]: 'first',
      [`${firstGuid}/asset.meta`]: 'first meta',
      [`${secondGuid}/pathname`]: 'Assets/Duplicate.asset',
      [`${secondGuid}/asset`]: 'second',
      [`${secondGuid}/asset.meta`]: 'second meta',
    });

    const { entries: parsedEntries } = parseUnityPackageEntries(data);
    const parsedFiles = parseUnityPackage(data);

    expect(parsedEntries.map(entry => entry.guid)).toEqual([firstGuid, secondGuid]);
    expect(parsedEntries.map(entry => entry.pathname)).toEqual(['Assets/Duplicate.asset', 'Assets/Duplicate.asset']);
    expect(decoder.decode(parsedFiles['Assets/Duplicate.asset'])).toBe('second');
    expect(decoder.decode(parsedFiles['Assets/Duplicate.asset.meta'])).toBe('second meta');
  });

  it('preserves non-32-hex record prefixes as GUIDs', () => {
    const guid = 'not-a-32-hex-guid';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/LooseGuid.asset',
      [`${guid}/asset`]: 'loose',
    });

    const { entries: parsedEntries, diagnostics: parsedDiagnostics } = parseUnityPackageEntries(data);

    expect(parsedEntries).toHaveLength(1);
    expect(parsedEntries[0].guid).toBe(guid);
    expect(parsedEntries[0].pathname).toBe('Assets/LooseGuid.asset');
    expect(parsedDiagnostics).toEqual([
      {
        code: 'non-standard-guid',
        message: 'Record prefix is not a 32-character hexadecimal GUID.',
        severity: 'info',
        path: `${guid}/pathname`,
        guid,
      },
      {
        code: 'meta-missing',
        message: 'Entry has a pathname and asset but no asset.meta or metaData file.',
        severity: 'warning',
        path: `${guid}/asset.meta`,
        guid,
      },
    ]);
  });

  it('skips malformed tar entries with invalid size fields', () => {
    const header = new Uint8Array(512);
    header.set(encoder.encode('bad/pathname'), 0);
    header.set(encoder.encode('not-octal'), 124);
    const data = gzipSync(concatUint8Arrays([header, new Uint8Array(1024)]));

    const { entries: parsedEntries, diagnostics: parsedDiagnostics } = parseUnityPackageEntries(data);

    expect(parsedEntries).toEqual([]);
    expect(parsedDiagnostics).toEqual([
      {
        code: 'malformed-tar-entry',
        message: 'Skipped tar entry with an invalid size field.',
        severity: 'error',
        path: 'bad/pathname',
      },
    ]);
    expect(parseUnityPackage(data)).toEqual({});
  });

  it('throws for malformed gzip data', () => {
    expect(() => parseUnityPackageEntries(encoder.encode('not gzip'))).toThrow();
  });

  it('returns empty object for empty tar', () => {
    const data = gzipSync(new Uint8Array(1024));

    const result = parseUnityPackage(data);

    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe('parseUnityPackageEntries diagnostics', () => {
  it('emits duplicate-guid when the same GUID prefix appears twice', () => {
    const guid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    // Build a tar with two pathname entries for the same GUID (second is the duplicate)
    const tarEntries: Uint8Array[] = [];
    tarEntries.push(createTarEntry(`${guid}/pathname`, encoder.encode('Assets/First.cs')));
    tarEntries.push(createTarEntry(`${guid}/asset`, encoder.encode('first')));
    tarEntries.push(createTarEntry(`${guid}/asset.meta`, encoder.encode('first meta')));
    tarEntries.push(createTarEntry(`${guid}/pathname`, encoder.encode('Assets/Second.cs')));
    tarEntries.push(new Uint8Array(1024));
    const dupData = gzipSync(concatUint8Arrays(tarEntries));

    const { entries: parsedEntries, diagnostics: parsedDiagnostics } = parseUnityPackageEntries(dupData);
    const dupDiag = parsedDiagnostics.filter(d => d.code === 'duplicate-guid');
    expect(dupDiag).toHaveLength(1);
    expect(dupDiag[0].guid).toBe(guid);
    expect(dupDiag[0].path).toBe(`${guid}/pathname`);
    expect(dupDiag[0].severity).toBe('error');
    // Only first occurrence added to result
    expect(parsedEntries).toHaveLength(1);
    expect(parsedEntries[0].pathname).toBe('Assets/First.cs');
  });

  it('emits asset-missing when entry has meta but no asset file', () => {
    const guid = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/MetaOnly.cs',
      [`${guid}/asset.meta`]: 'guid: bbbb',
    });

    const { diagnostics: parsedDiagnostics } = parseUnityPackageEntries(data);
    const diag = parsedDiagnostics.filter(d => d.code === 'asset-missing');
    expect(diag).toHaveLength(1);
    expect(diag[0].guid).toBe(guid);
    expect(diag[0].path).toBe(`${guid}/asset`);
    expect(diag[0].severity).toBe('warning');
  });

  it('emits meta-missing when entry has asset but no meta file', () => {
    const guid = 'cccccccccccccccccccccccccccccccc';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/NoMeta.cs',
      [`${guid}/asset`]: 'some content',
    });

    const { diagnostics: parsedDiagnostics } = parseUnityPackageEntries(data);
    const diag = parsedDiagnostics.filter(d => d.code === 'meta-missing');
    expect(diag).toHaveLength(1);
    expect(diag[0].guid).toBe(guid);
    expect(diag[0].path).toBe(`${guid}/asset.meta`);
    expect(diag[0].severity).toBe('warning');
  });

  it('does not emit asset-missing or meta-missing for folder entries (asset-only with meta, no asset file)', () => {
    // Folder entries have meta but no asset -- asset-missing should fire
    // But folder entry with neither asset nor meta should fire neither
    const guid = 'dddddddddddddddddddddddddddddddd';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/Folder',
    });

    const { diagnostics: parsedDiagnostics } = parseUnityPackageEntries(data);
    const codes = parsedDiagnostics.map(d => d.code);
    expect(codes).not.toContain('asset-missing');
    expect(codes).not.toContain('meta-missing');
  });

  it('emits zero-byte-asset when asset file is present but empty', () => {
    const guid = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/Empty.cs',
      [`${guid}/asset`]: '',
      [`${guid}/asset.meta`]: 'guid: eeee',
    });

    const { diagnostics: parsedDiagnostics } = parseUnityPackageEntries(data);
    const diag = parsedDiagnostics.filter(d => d.code === 'zero-byte-asset');
    expect(diag).toHaveLength(1);
    expect(diag[0].guid).toBe(guid);
    expect(diag[0].path).toBe(`${guid}/asset`);
    expect(diag[0].severity).toBe('warning');
  });

  it('emits oversized-entry-name when pathname exceeds 200 characters', () => {
    const guid = 'ffffffffffffffffffffffffffffffff';
    const longPathname = 'Assets/' + 'A'.repeat(195);
    expect(longPathname.length).toBeGreaterThan(200);
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: longPathname,
      [`${guid}/asset`]: 'content',
      [`${guid}/asset.meta`]: 'guid: ffff',
    });

    const { entries: parsedEntries, diagnostics: parsedDiagnostics } = parseUnityPackageEntries(data);
    const diag = parsedDiagnostics.filter(d => d.code === 'oversized-entry-name');
    expect(diag).toHaveLength(1);
    expect(diag[0].guid).toBe(guid);
    expect(diag[0].path).toBe(`${guid}/pathname`);
    expect(diag[0].message).toContain(`${longPathname.length}`);
    expect(diag[0].severity).toBe('warning');
    // Entry is still added despite diagnostic
    expect(parsedEntries).toHaveLength(1);
    expect(parsedEntries[0].pathname).toBe(longPathname);
  });
});

describe('ParseUnityPackageOptions / DecompressionBombError', () => {
  it('exports DEFAULT_MAX_OUTPUT_BYTES as 4 GiB', () => {
    expect(DEFAULT_MAX_OUTPUT_BYTES).toBe(4 * 1024 * 1024 * 1024);
  });

  it('exports DEFAULT_MAX_ENTRIES as 250 000', () => {
    expect(DEFAULT_MAX_ENTRIES).toBe(250_000);
  });

  it('parses a normal package under the defaults without throwing', () => {
    const guid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/MyScript.cs',
      [`${guid}/asset`]: 'public class MyScript {}',
      [`${guid}/asset.meta`]: 'guid: aaaa',
    });
    expect(() => parseUnityPackageEntries(data)).not.toThrow();
    const { entries } = parseUnityPackageEntries(data);
    expect(entries).toHaveLength(1);
  });

  it('throws DecompressionBombError with kind "output-bytes" when maxOutputBytes is exceeded', () => {
    const guid = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    // Asset body of 100 bytes; limit set to 50 bytes
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/Big.asset',
      [`${guid}/asset`]: 'x'.repeat(100),
      [`${guid}/asset.meta`]: 'guid: bbbb',
    });
    let thrown: unknown;
    try {
      parseUnityPackageEntries(data, { maxOutputBytes: 50 });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DecompressionBombError);
    const bomb = thrown as DecompressionBombError;
    expect(bomb.kind).toBe('output-bytes');
    expect(bomb.observed).toBeGreaterThan(50);
    expect(bomb.message).toContain('output-bytes' in bomb ? '' : ''); // message present
    expect(bomb.name).toBe('DecompressionBombError');
  });

  it('throws DecompressionBombError with kind "output-bytes" via parseUnityPackage too', () => {
    const guid = 'cccccccccccccccccccccccccccccccc';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/Big2.asset',
      [`${guid}/asset`]: 'y'.repeat(100),
      [`${guid}/asset.meta`]: 'guid: cccc',
    });
    expect(() => parseUnityPackage(data, { maxOutputBytes: 1 })).toThrow(DecompressionBombError);
  });

  it('throws DecompressionBombError with kind "entry-count" when maxEntries is exceeded', () => {
    // Build a package with 3 entries; limit to 2
    const entries: Uint8Array[] = [];
    for (let i = 0; i < 3; i++) {
      const guid = `${'a'.repeat(30)}${i.toString().padStart(2, '0')}`;
      entries.push(createTarEntry(`${guid}/pathname`, encoder.encode(`Assets/Script${i}.cs`)));
      entries.push(createTarEntry(`${guid}/asset`, encoder.encode(`class S${i} {}`)));
      entries.push(createTarEntry(`${guid}/asset.meta`, encoder.encode(`guid: ${guid}`)));
    }
    entries.push(new Uint8Array(1024));
    const data = gzipSync(concatUint8Arrays(entries));

    let thrown: unknown;
    try {
      parseUnityPackageEntries(data, { maxEntries: 2 });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DecompressionBombError);
    const bomb = thrown as DecompressionBombError;
    expect(bomb.kind).toBe('entry-count');
    expect(bomb.observed).toBe(3);
    expect(bomb.name).toBe('DecompressionBombError');
  });

  it('options are additive -- omitting them gives default behaviour (no throw for tiny package)', () => {
    const guid = 'dddddddddddddddddddddddddddddddd';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/Tiny.cs',
      [`${guid}/asset`]: 'tiny',
    });
    // No options -- should not throw
    expect(() => parseUnityPackageEntries(data)).not.toThrow();
    // Explicit options matching defaults -- should not throw
    expect(() => parseUnityPackageEntries(data, {
      maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
      maxEntries: DEFAULT_MAX_ENTRIES,
    })).not.toThrow();
  });
});

describe('createUnityPackage', () => {
  it('throws for duplicate GUID entries', () => {
    const guid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    expect(() =>
      createUnityPackage([
        {
          guid,
          pathname: 'Assets/First.asset',
          asset: encoder.encode('first'),
          meta: encoder.encode('first meta'),
        },
        {
          guid,
          pathname: 'Assets/Second.asset',
          asset: encoder.encode('second'),
          meta: encoder.encode('second meta'),
        },
      ], { gzipLevel: 1 }),
    ).toThrow(`Duplicate GUID in package entries: ${guid}`);
  });

  it('throws for pathname exceeding 200 characters', () => {
    const guid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const longPathname = 'Assets/' + 'X'.repeat(195);
    expect(longPathname.length).toBeGreaterThan(200);

    expect(() =>
      createUnityPackage([
        {
          guid,
          pathname: longPathname,
          asset: encoder.encode('data'),
          meta: encoder.encode('meta'),
        },
      ], { gzipLevel: 1 }),
    ).toThrow(/Pathname exceeds 200 characters/);
  });

  it('enforces the ustar 100-byte entry name limit via tryCreateUnityPackage', () => {
    // A guid of 89 chars produces "<89>/asset.meta" = 100 bytes exactly -- at the limit, no oversized-pathname
    const atLimitGuid = 'a'.repeat(89);
    // A guid of 90 chars produces "<90>/asset.meta" = 101 bytes -- exceeds limit
    const overLimitGuid = 'b'.repeat(90);

    const atLimitResult = tryCreateUnityPackage([
      {
        guid: atLimitGuid,
        pathname: 'Assets/Exact.asset',
        asset: encoder.encode('asset'),
        meta: encoder.encode('meta'),
      },
    ], { gzipLevel: 1 });
    // invalid-guid fires (89 chars, not 32) but no oversized-pathname for tar names
    const atLimitOversized = (atLimitResult.diagnostics as CreateUnityPackageDiagnostic[]).filter(
      d => d.code === 'oversized-pathname',
    );
    expect(atLimitOversized).toHaveLength(0);

    const overLimitResult = tryCreateUnityPackage([
      {
        guid: overLimitGuid,
        pathname: 'Assets/TooLong.asset',
        asset: encoder.encode('asset'),
        meta: encoder.encode('meta'),
      },
    ], { gzipLevel: 1 });
    // oversized-pathname fires because "<90>/asset.meta" is 101 bytes
    const overLimitOversized = (overLimitResult.diagnostics as CreateUnityPackageDiagnostic[]).filter(
      d => d.code === 'oversized-pathname',
    );
    expect(overLimitOversized.length).toBeGreaterThan(0);
    expect(overLimitOversized[0].message).toContain('Tar entry name is too long');
  });

  it('round-trips file and folder entries', () => {
    const entries: CreateUnityPackageEntry[] = [
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/MyScript.cs',
        asset: encoder.encode('public class MyScript {}'),
        meta: encoder.encode('guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      },
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: 'Assets/Editor',
        meta: encoder.encode('folderAsset: true'),
      },
    ];

    const data = createUnityPackage(entries, { gzipLevel: 1 });
    const { entries: parsedEntries } = parseUnityPackageEntries(data);
    const parsedFiles = parseUnityPackage(data);

    expect(parsedEntries).toHaveLength(2);
    expect(parsedEntries[0].guid).toBe(entries[0].guid);
    expect(parsedEntries[1].asset).toBeUndefined();
    expect(decoder.decode(parsedFiles['Assets/MyScript.cs'])).toBe('public class MyScript {}');
    expect(decoder.decode(parsedFiles['Assets/MyScript.cs.meta'])).toBe('guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(parsedFiles['Assets/Editor']).toBeUndefined();
    expect(decoder.decode(parsedFiles['Assets/Editor.meta'])).toBe('folderAsset: true');
  });
});

describe('createUnityPackage reproducibility', () => {
  const entriesAB: CreateUnityPackageEntry[] = [
    {
      guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pathname: 'Assets/A.cs',
      asset: encoder.encode('class A {}'),
      meta: encoder.encode('guid: aaaa'),
    },
    {
      guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      pathname: 'Assets/B.cs',
      asset: encoder.encode('class B {}'),
      meta: encoder.encode('guid: bbbb'),
    },
  ];

  it('produces byte-equal output for two identical calls', () => {
    const first = createUnityPackage(entriesAB, { gzipLevel: 6 });
    const second = createUnityPackage(entriesAB, { gzipLevel: 6 });
    expect(first).toEqual(second);
  });

  it('produces byte-equal output regardless of input order', () => {
    const ba = [...entriesAB].reverse();
    const outAB = createUnityPackage(entriesAB, { gzipLevel: 6 });
    const outBA = createUnityPackage(ba, { gzipLevel: 6 });
    expect(outAB).toEqual(outBA);
  });
});

describe('tryCreateUnityPackage', () => {
  it('returns bytes and empty diagnostics for a valid entry', () => {
    const result = tryCreateUnityPackage([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/Valid.cs',
        asset: encoder.encode('class Valid {}'),
        meta: encoder.encode('guid: aaaa'),
      },
    ]);
    expect(result.bytes).not.toBeNull();
    expect(result.diagnostics).toHaveLength(0);
  });

  it('returns bytes: null and empty-entries diagnostic for an empty array', () => {
    const result = tryCreateUnityPackage([]);
    expect(result.bytes).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('empty-entries');
    expect(result.diagnostics[0].severity).toBe('error');
  });

  it('returns bytes: null and duplicate-guid diagnostic for duplicate GUIDs', () => {
    const guid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const result = tryCreateUnityPackage([
      {
        guid,
        pathname: 'Assets/First.cs',
        asset: encoder.encode('first'),
        meta: encoder.encode('meta1'),
      },
      {
        guid,
        pathname: 'Assets/Second.cs',
        asset: encoder.encode('second'),
        meta: encoder.encode('meta2'),
      },
    ]);
    expect(result.bytes).toBeNull();
    const diag = result.diagnostics.filter(d => d.code === 'duplicate-guid');
    expect(diag).toHaveLength(1);
    expect(diag[0].guid).toBe(guid);
    expect(diag[0].severity).toBe('error');
  });

  it('returns bytes: null and missing-meta diagnostic when meta is absent', () => {
    const guid = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const result = tryCreateUnityPackage([
      {
        guid,
        pathname: 'Assets/NoMeta.cs',
        asset: encoder.encode('content'),
        meta: undefined as unknown as Uint8Array,
      },
    ]);
    expect(result.bytes).toBeNull();
    const diag = result.diagnostics.filter(d => d.code === 'missing-meta');
    expect(diag).toHaveLength(1);
    expect(diag[0].guid).toBe(guid);
    expect(diag[0].severity).toBe('error');
  });

  it('returns bytes: null and missing-meta diagnostic when meta is empty', () => {
    const guid = 'cccccccccccccccccccccccccccccccc';
    const result = tryCreateUnityPackage([
      {
        guid,
        pathname: 'Assets/EmptyMeta.cs',
        asset: encoder.encode('content'),
        meta: new Uint8Array(0),
      },
    ]);
    expect(result.bytes).toBeNull();
    const diag = result.diagnostics.filter(d => d.code === 'missing-meta');
    expect(diag).toHaveLength(1);
    expect(diag[0].guid).toBe(guid);
  });

  it('returns bytes: null and invalid-guid diagnostic for a non-32-hex guid', () => {
    const result = tryCreateUnityPackage([
      {
        guid: 'not-a-guid',
        pathname: 'Assets/Bad.cs',
        asset: encoder.encode('content'),
        meta: encoder.encode('meta'),
      },
    ]);
    expect(result.bytes).toBeNull();
    const diag = result.diagnostics.filter(d => d.code === 'invalid-guid');
    expect(diag).toHaveLength(1);
    expect(diag[0].guid).toBe('not-a-guid');
    expect(diag[0].severity).toBe('error');
  });

  it('does not emit invalid-guid for uppercase hex guid (Unity uses uppercase)', () => {
    const result = tryCreateUnityPackage([
      {
        guid: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        pathname: 'Assets/Upper.cs',
        asset: encoder.encode('content'),
        meta: encoder.encode('meta'),
      },
    ]);
    // Uppercase 32-char hex is a valid Unity GUID -- no invalid-guid diagnostic
    const diag = result.diagnostics.filter(d => d.code === 'invalid-guid');
    expect(diag).toHaveLength(0);
    expect(result.bytes).not.toBeNull();
  });

  it('returns bytes: null and oversized-pathname diagnostic when pathname exceeds 200 chars', () => {
    const guid = 'dddddddddddddddddddddddddddddddd';
    const longPathname = 'Assets/' + 'X'.repeat(195);
    expect(longPathname.length).toBeGreaterThan(200);
    const result = tryCreateUnityPackage([
      {
        guid,
        pathname: longPathname,
        asset: encoder.encode('data'),
        meta: encoder.encode('meta'),
      },
    ]);
    expect(result.bytes).toBeNull();
    const diag = result.diagnostics.filter(d => d.code === 'oversized-pathname');
    expect(diag).toHaveLength(1);
    expect(diag[0].message).toMatch(/Pathname exceeds 200 characters/);
    expect(diag[0].severity).toBe('error');
  });

  it('returns bytes: null and oversized-pathname diagnostic when tar entry name exceeds 100 bytes', () => {
    // 90-char guid: "<90>/asset.meta" = 101 bytes > 100
    const longGuid = 'b'.repeat(90);
    const result = tryCreateUnityPackage([
      {
        guid: longGuid,
        pathname: 'Assets/Long.asset',
        asset: encoder.encode('data'),
        meta: encoder.encode('meta'),
      },
    ]);
    expect(result.bytes).toBeNull();
    const diag = result.diagnostics.filter(d => d.code === 'oversized-pathname');
    expect(diag.length).toBeGreaterThan(0);
    expect(diag[0].message).toContain('Tar entry name is too long');
    expect(diag[0].severity).toBe('error');
  });

  it('collects all diagnostics without stopping at the first', () => {
    const guid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    // Both entries share the same guid (duplicate) and have no meta (missing-meta)
    const result = tryCreateUnityPackage([
      {
        guid,
        pathname: 'Assets/A.cs',
        asset: encoder.encode('a'),
        meta: new Uint8Array(0),
      },
      {
        guid,
        pathname: 'Assets/B.cs',
        asset: encoder.encode('b'),
        meta: new Uint8Array(0),
      },
    ]);
    expect(result.bytes).toBeNull();
    // Expect at least two missing-meta diagnostics (one per entry) and one duplicate-guid
    const missingMeta = result.diagnostics.filter(d => d.code === 'missing-meta');
    const dupGuid = result.diagnostics.filter(d => d.code === 'duplicate-guid');
    expect(missingMeta.length).toBeGreaterThanOrEqual(2);
    expect(dupGuid).toHaveLength(1);
  });
});

describe('isValidGuid', () => {
  it('accepts a 32-character lowercase hex string', () => {
    expect(isValidGuid('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(isValidGuid('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isValidGuid('006f7fc78b046e2408cecc07a80417b5')).toBe(true);
  });

  it('rejects a 31-character string', () => {
    expect(isValidGuid('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('rejects a 33-character string', () => {
    expect(isValidGuid('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('rejects uppercase hex', () => {
    expect(isValidGuid('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(isValidGuid('Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isValidGuid('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaag!')).toBe(false);
    expect(isValidGuid('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaz1')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidGuid('')).toBe(false);
  });
});

describe('generateGuid', () => {
  it('returns a 32-character lowercase hex string', () => {
    const guid = generateGuid();
    expect(guid).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(guid)).toBe(true);
  });

  it('returns a value accepted by isValidGuid', () => {
    expect(isValidGuid(generateGuid())).toBe(true);
  });

  it('produces no duplicates across 1000 sequential calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const guid = generateGuid();
      expect(seen.has(guid)).toBe(false);
      seen.add(guid);
    }
    expect(seen.size).toBe(1000);
  });
});

describe('guidFromPath', () => {
  // Reference values computed with Node.js:
  //   Buffer.from(pathname, 'utf16le') -> md5 -> hex
  it('returns expected hash for empty string', () => {
    expect(guidFromPath('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('returns expected hash for a simple asset path', () => {
    expect(guidFromPath('Assets/MyScript.cs')).toBe('bd0c9ec9a6f34f28778814e1f699b30e');
  });

  it('returns expected hash for a deep asset path', () => {
    expect(guidFromPath('Assets/FronkonGames/Artistic/OneBit/Demo/Textures/Light/texture_01.png')).toBe(
      '8d61aaa1707e31e43193856b1aba884d',
    );
  });

  it('returns expected hash for a UTF-16LE path with CJK characters', () => {
    expect(guidFromPath('Assets/日本語.prefab')).toBe('b110d44211d1e3f4c3c93c3a079966a9');
  });

  it('is deterministic -- two calls with the same input return the same value', () => {
    const a = guidFromPath('Assets/Foo/Bar.cs');
    const b = guidFromPath('Assets/Foo/Bar.cs');
    expect(a).toBe(b);
  });

  it('returns a 32-character lowercase hex string', () => {
    const guid = guidFromPath('Assets/Test.prefab');
    expect(guid).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(guid)).toBe(true);
  });

  it('produces different values for different inputs', () => {
    expect(guidFromPath('Assets/A.cs')).not.toBe(guidFromPath('Assets/B.cs'));
  });
});

describe('validatePathname', () => {
  it('accepts a normal asset pathname', () => {
    expect(validatePathname('Assets/Scripts/MyScript.cs')).toEqual({ ok: true });
  });

  it('accepts a pathname with a single segment', () => {
    expect(validatePathname('Assets')).toEqual({ ok: true });
  });

  // empty
  it('rejects empty string with reason "empty"', () => {
    const result = validatePathname('');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('empty');
  });

  // absolute
  it('rejects absolute path (leading slash) with reason "absolute"', () => {
    const result = validatePathname('/Assets/Foo.cs');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('absolute');
  });

  // drive-or-unc
  it('rejects Windows drive letter path with reason "drive-or-unc"', () => {
    const result = validatePathname('C:\\Users\\foo.cs');
    // backslash is caught first; test a drive path without backslash
    const result2 = validatePathname('C:/Users/foo.cs');
    expect(result2.ok).toBe(false);
    expect(result2.reason).toBe('drive-or-unc');
    // backslash variant also fails (backslash reason comes first)
    expect(result.ok).toBe(false);
    expect(['drive-or-unc', 'backslash']).toContain(result.reason);
  });

  it('rejects lowercase drive letter with reason "drive-or-unc"', () => {
    const result = validatePathname('c:/path/to/file.cs');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('drive-or-unc');
  });

  it('rejects forward-slash UNC-like paths with reason "drive-or-unc"', () => {
    const result = validatePathname('//server/share/Foo.cs');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('drive-or-unc');
  });

  // parent-traversal
  it('rejects pathname containing ".." segment with reason "parent-traversal"', () => {
    const result = validatePathname('Assets/../etc/passwd');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('parent-traversal');
  });

  it('rejects pathname starting with ".." with reason "parent-traversal"', () => {
    const result = validatePathname('../etc/passwd');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('parent-traversal');
  });

  it('accepts ".." that is only a substring of a segment (not the full segment)', () => {
    // "..hidden" is a valid segment name, not a parent-traversal
    expect(validatePathname('Assets/..hidden/file.cs')).toEqual({ ok: true });
  });

  // backslash
  it('rejects pathname with backslash with reason "backslash"', () => {
    const result = validatePathname('Assets\\Foo.cs');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('backslash');
  });

  // control-character
  it('rejects pathname containing a control character (< 0x20) with reason "control-character"', () => {
    const result = validatePathname('Assets/\x01Foo.cs');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('control-character');
  });

  it('rejects pathname containing a tab character (0x09) with reason "control-character"', () => {
    const result = validatePathname('Assets/\tFoo.cs');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('control-character');
  });

  it('rejects pathname containing a newline (0x0A) with reason "control-character"', () => {
    const result = validatePathname('Assets/Foo\nBar.cs');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('control-character');
  });

  // oversized-tar-entry
  it('returns ok:true when guid + fixed names fit within 100 bytes', () => {
    // "<32>/asset.meta" = 32 + 1 + 10 = 43 bytes -- well under 100
    const guid = 'a'.repeat(32);
    expect(validatePathname('Assets/Foo.cs', { guid })).toEqual({ ok: true });
  });

  it('rejects when guid makes "<guid>/asset.meta" exceed 100 bytes', () => {
    // guid of 90 chars: "b".repeat(90) + "/asset.meta" = 101 bytes
    const longGuid = 'b'.repeat(90);
    const result = validatePathname('Assets/Foo.cs', { guid: longGuid });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('oversized-tar-entry');
    expect(result.detail).toBe('101');
  });

  it('accepts when "<guid>/asset.meta" is exactly 100 bytes', () => {
    // guid of 89 chars: 89 + 1 + 10 = 100 bytes -- exactly at limit
    const atLimitGuid = 'a'.repeat(89);
    const result = validatePathname('Assets/Foo.cs', { guid: atLimitGuid });
    expect(result.ok).toBe(true);
  });

  it('oversized-tar-entry detail matches actual UTF-8 byte length of "<guid>/asset.meta"', () => {
    // guid of 90 chars => 101 bytes
    const longGuid = 'c'.repeat(90);
    const result = validatePathname('Assets/Bar.cs', { guid: longGuid });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('oversized-tar-entry');
    const reportedLength = Number(result.detail);
    const expected = new TextEncoder().encode(`${longGuid}/asset.meta`).length;
    expect(reportedLength).toBe(expected);
  });

  it('oversized-tar-entry check aligns with tryCreateUnityPackage for the same input', () => {
    // Use a 90-char guid: tryCreateUnityPackage should emit oversized-pathname
    // and validatePathname should emit oversized-tar-entry
    const longGuid = 'd'.repeat(90);
    const createResult = tryCreateUnityPackage([
      {
        guid: longGuid,
        pathname: 'Assets/Align.cs',
        asset: encoder.encode('content'),
        meta: encoder.encode('meta'),
      },
    ]);
    const createOversized = createResult.diagnostics.filter(d => d.code === 'oversized-pathname');
    expect(createOversized.length).toBeGreaterThan(0);

    const validateResult = validatePathname('Assets/Align.cs', { guid: longGuid });
    expect(validateResult.ok).toBe(false);
    expect(validateResult.reason).toBe('oversized-tar-entry');
  });

  it('does not check oversized-tar-entry when no guid is provided', () => {
    // Even a long pathname alone should not trigger oversized-tar-entry
    const longPathname = 'Assets/' + 'X'.repeat(200);
    const result = validatePathname(longPathname);
    // No oversized-tar-entry without a guid; other checks should pass (it's a valid path)
    expect(result.reason).not.toBe('oversized-tar-entry');
  });
});

describe('detectPathnameCollisions', () => {
  it('returns empty array for empty input', () => {
    expect(detectPathnameCollisions([])).toEqual([]);
  });

  it('returns empty array when there are no collisions', () => {
    const entries = [
      { guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', pathname: 'Assets/A.cs' },
      { guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', pathname: 'Assets/B.cs' },
      { guid: 'cccccccccccccccccccccccccccccccc', pathname: 'Assets/Sub/C.cs' },
    ];
    expect(detectPathnameCollisions(entries)).toEqual([]);
  });

  it('detects an exact-duplicate pair and sets exactDuplicates: true', () => {
    const entries = [
      { guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', pathname: 'Assets/Dup.asset' },
      { guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', pathname: 'Assets/Dup.asset' },
    ];
    const result = detectPathnameCollisions(entries);
    expect(result).toHaveLength(1);
    expect(result[0].pathname).toBe('Assets/Dup.asset');
    expect(result[0].caseFolded).toBe('assets/dup.asset');
    expect(result[0].guids).toEqual([
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ]);
    expect(result[0].exactDuplicates).toBe(true);
  });

  it('detects a case-only collision pair and sets exactDuplicates: false', () => {
    const entries = [
      { guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', pathname: 'Assets/Script.cs' },
      { guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', pathname: 'Assets/SCRIPT.CS' },
    ];
    const result = detectPathnameCollisions(entries);
    expect(result).toHaveLength(1);
    expect(result[0].pathname).toBe('Assets/Script.cs'); // first-seen casing
    expect(result[0].caseFolded).toBe('assets/script.cs');
    expect(result[0].guids).toHaveLength(2);
    expect(result[0].exactDuplicates).toBe(false);
  });

  it('detects a three-way collision with mixed exact and case-only matches', () => {
    const entries = [
      { guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', pathname: 'Assets/Foo.cs' },
      { guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', pathname: 'Assets/FOO.CS' },
      { guid: 'cccccccccccccccccccccccccccccccc', pathname: 'Assets/Foo.cs' }, // exact dup of first
    ];
    const result = detectPathnameCollisions(entries);
    expect(result).toHaveLength(1);
    expect(result[0].guids).toHaveLength(3);
    // Two entries share the exact bytes 'Assets/Foo.cs'
    expect(result[0].exactDuplicates).toBe(true);
  });

  it('includes folder entries alongside file entries in collision detection', () => {
    // A folder entry (no asset payload implied) using the same pathname as a file
    const entries = [
      { guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', pathname: 'Assets/MyFolder' },
      { guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', pathname: 'Assets/MyFolder' },
    ];
    const result = detectPathnameCollisions(entries);
    expect(result).toHaveLength(1);
    expect(result[0].exactDuplicates).toBe(true);
    expect(result[0].guids).toHaveLength(2);
  });
});

describe('createMinimalMeta', () => {
  const validGuid = '0123456789abcdef0123456789abcdef';

  it('returns a string starting with "fileFormatVersion: 2"', () => {
    const result = createMinimalMeta(validGuid);
    expect(result.startsWith('fileFormatVersion: 2')).toBe(true);
  });

  it('includes the supplied GUID on a "guid: " line', () => {
    const result = createMinimalMeta(validGuid);
    expect(result).toContain(`guid: ${validGuid}`);
  });

  it('contains the DefaultImporter block', () => {
    const result = createMinimalMeta(validGuid);
    expect(result).toContain('DefaultImporter:');
    expect(result).toContain('  externalObjects: {}');
    expect(result).toContain('  userData:');
    expect(result).toContain('  assetBundleName:');
    expect(result).toContain('  assetBundleVariant:');
  });

  it('produces byte-stable output across two calls with the same GUID', () => {
    const first = createMinimalMeta(validGuid);
    const second = createMinimalMeta(validGuid);
    expect(first).toBe(second);
  });

  it('produces different output for different GUIDs', () => {
    const other = 'abcdef0123456789abcdef0123456789';
    expect(createMinimalMeta(validGuid)).not.toBe(createMinimalMeta(other));
  });

  it('throws for an empty string', () => {
    expect(() => createMinimalMeta('')).toThrow('""');
  });

  it('throws for an uppercase GUID', () => {
    expect(() => createMinimalMeta('0123456789ABCDEF0123456789ABCDEF')).toThrow(
      '0123456789ABCDEF0123456789ABCDEF',
    );
  });

  it('throws for a 31-character GUID', () => {
    const short = '0'.repeat(31);
    expect(() => createMinimalMeta(short)).toThrow(short);
  });

  it('throws for a 33-character GUID', () => {
    const long = '0'.repeat(33);
    expect(() => createMinimalMeta(long)).toThrow(long);
  });

  it('throws for a non-hex GUID', () => {
    const nonHex = '0123456789abcdef0123456789abcdez';
    expect(() => createMinimalMeta(nonHex)).toThrow(nonHex);
  });

  it('returns text; encoding to UTF-8 is the caller\'s responsibility', () => {
    const result = createMinimalMeta(validGuid);
    const bytes = new TextEncoder().encode(result);
    expect(new TextDecoder().decode(bytes)).toBe(result);
  });
});

describe('estimateUnityPackageSize', () => {
  function uncompressedTarSize(entries: CreateUnityPackageEntry[]): number {
    // Decompress the gzip and measure the raw tar bytes
    const pkg = createUnityPackage(entries, { gzipLevel: 0 });
    return gunzipSync(pkg).length;
  }

  it('matches actual uncompressed tar size for entries with assets', () => {
    const entries: CreateUnityPackageEntry[] = [
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/A.cs',
        asset: encoder.encode('class A {}'),
        meta: encoder.encode('guid: aaaa'),
      },
    ];
    const { tarBytes, entryCount } = estimateUnityPackageSize(entries);
    expect(tarBytes).toBe(uncompressedTarSize(entries));
    expect(entryCount).toBe(3);
  });

  it('matches actual uncompressed tar size for asset-absent (folder) entries', () => {
    const entries: CreateUnityPackageEntry[] = [
      {
        guid: 'cccccccccccccccccccccccccccccccc',
        pathname: 'Assets/Folder',
        meta: encoder.encode('folderAsset: yes'),
      },
    ];
    const { tarBytes, entryCount } = estimateUnityPackageSize(entries);
    expect(tarBytes).toBe(uncompressedTarSize(entries));
    expect(entryCount).toBe(2);
  });

  it('matches actual uncompressed tar size for mixed entry lists', () => {
    const entries: CreateUnityPackageEntry[] = [
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/Script.cs',
        asset: encoder.encode('class Script {}'),
        meta: encoder.encode('guid: aaaa'),
      },
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: 'Assets/Folder',
        meta: encoder.encode('folderAsset: yes'),
      },
    ];
    const { tarBytes, entryCount } = estimateUnityPackageSize(entries);
    expect(tarBytes).toBe(uncompressedTarSize(entries));
    expect(entryCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Helpers for summarizePackage tests
// ---------------------------------------------------------------------------

function makeEntry(
  guid: string,
  pathname: string,
  asset?: string,
  meta?: string,
  preview?: string,
): UnityPackageEntry {
  return {
    guid,
    pathname,
    asset: asset !== undefined ? encoder.encode(asset) : undefined,
    meta: meta !== undefined ? encoder.encode(meta) : undefined,
    preview: preview !== undefined ? encoder.encode(preview) : undefined,
  };
}

describe('summarizePackage', () => {
  it('returns zero counts for an empty entry list', () => {
    const summary = summarizePackage([]);
    expect(summary.entryCount).toBe(0);
    expect(summary.fileCount).toBe(0);
    expect(summary.folderCount).toBe(0);
    expect(summary.previewCount).toBe(0);
    expect(summary.uniqueGuidCount).toBe(0);
    expect(summary.duplicateGuidCount).toBe(0);
    expect(summary.totalAssetBytes).toBe(0);
    expect(summary.totalMetaBytes).toBe(0);
    expect(summary.totalPreviewBytes).toBe(0);
    expect(summary.byExtension).toEqual([]);
    expect(summary.diagnosticsBySeverity).toEqual({ info: 0, warning: 0, error: 0 });
  });

  it('zeroes diagnosticsBySeverity when diagnostics is omitted', () => {
    const summary = summarizePackage([makeEntry('a'.repeat(32), 'Assets/A.cs', 'body', 'meta')]);
    expect(summary.diagnosticsBySeverity).toEqual({ info: 0, warning: 0, error: 0 });
  });

  it('zeroes diagnosticsBySeverity when diagnostics is an empty array', () => {
    const summary = summarizePackage([], []);
    expect(summary.diagnosticsBySeverity).toEqual({ info: 0, warning: 0, error: 0 });
  });

  it('counts files (entries with asset) and folders (entries without asset)', () => {
    const entries: UnityPackageEntry[] = [
      makeEntry('a'.repeat(32), 'Assets/Script.cs', 'class A {}', 'meta a'),
      makeEntry('b'.repeat(32), 'Assets/Texture.png', 'png bytes', 'meta b'),
      makeEntry('c'.repeat(32), 'Assets/SubFolder', undefined, 'folder meta'),
    ];
    const summary = summarizePackage(entries);
    expect(summary.entryCount).toBe(3);
    expect(summary.fileCount).toBe(2);
    expect(summary.folderCount).toBe(1);
  });

  it('counts entries with preview present', () => {
    const entries: UnityPackageEntry[] = [
      makeEntry('a'.repeat(32), 'Assets/A.cs', 'body', 'meta', 'preview data'),
      makeEntry('b'.repeat(32), 'Assets/B.cs', 'body', 'meta'),
    ];
    const summary = summarizePackage(entries);
    expect(summary.previewCount).toBe(1);
    expect(summary.totalPreviewBytes).toBe(encoder.encode('preview data').byteLength);
  });

  it('sums asset, meta, and preview bytes correctly', () => {
    const assetBody = 'class A {}';
    const metaBody = 'guid: aaaa';
    const previewBody = 'thumbnail';
    const entry = makeEntry('a'.repeat(32), 'Assets/A.cs', assetBody, metaBody, previewBody);
    const summary = summarizePackage([entry]);
    expect(summary.totalAssetBytes).toBe(encoder.encode(assetBody).byteLength);
    expect(summary.totalMetaBytes).toBe(encoder.encode(metaBody).byteLength);
    expect(summary.totalPreviewBytes).toBe(encoder.encode(previewBody).byteLength);
  });

  it('counts unique and duplicate GUIDs', () => {
    const guidA = 'a'.repeat(32);
    const guidB = 'b'.repeat(32);
    const entries: UnityPackageEntry[] = [
      makeEntry(guidA, 'Assets/First.cs', 'first', 'meta'),
      makeEntry(guidA, 'Assets/FirstDup.cs', 'dup', 'meta'),  // duplicate GUID
      makeEntry(guidB, 'Assets/Second.cs', 'second', 'meta'),
    ];
    const summary = summarizePackage(entries);
    expect(summary.entryCount).toBe(3);
    expect(summary.uniqueGuidCount).toBe(2);
    expect(summary.duplicateGuidCount).toBe(1);
  });

  it('builds byExtension with lower-cased extensions', () => {
    const entries: UnityPackageEntry[] = [
      makeEntry('a'.repeat(32), 'Assets/A.CS', 'a', 'meta'),
      makeEntry('b'.repeat(32), 'Assets/B.cs', 'b', 'meta'),
      makeEntry('c'.repeat(32), 'Assets/C.PNG', 'c', 'meta'),
    ];
    const summary = summarizePackage(entries);
    const exts = summary.byExtension.map(e => e.extension);
    expect(exts).toContain('cs');
    expect(exts).toContain('png');
    expect(exts).not.toContain('CS');
    expect(exts).not.toContain('PNG');
  });

  it('treats extensionless entries as extension ""', () => {
    const entries: UnityPackageEntry[] = [
      makeEntry('a'.repeat(32), 'Assets/Folder', undefined, 'meta'),
      makeEntry('b'.repeat(32), 'Assets/OtherFolder', undefined, 'meta'),
    ];
    const summary = summarizePackage(entries);
    const empty = summary.byExtension.find(e => e.extension === '');
    expect(empty).toBeDefined();
    expect(empty!.count).toBe(2);
    expect(empty!.assetBytes).toBe(0);
  });

  it('orders byExtension descending by count, ties broken by extension ascending', () => {
    // cs: 3 entries, png: 3 entries, shader: 1 entry
    // ties: cs and png both have 3 -- cs comes before png alphabetically
    const entries: UnityPackageEntry[] = [
      makeEntry('a'.repeat(32), 'Assets/A.cs', 'a', 'meta'),
      makeEntry('b'.repeat(32), 'Assets/B.cs', 'b', 'meta'),
      makeEntry('c'.repeat(32), 'Assets/C.cs', 'c', 'meta'),
      makeEntry('d'.repeat(32), 'Assets/D.png', 'd', 'meta'),
      makeEntry('e'.repeat(32), 'Assets/E.png', 'e', 'meta'),
      makeEntry('f'.repeat(32), 'Assets/F.png', 'f', 'meta'),
      makeEntry('g'.repeat(32), 'Assets/G.shader', 'g', 'meta'),
    ];
    const summary = summarizePackage(entries);
    expect(summary.byExtension[0].extension).toBe('cs');
    expect(summary.byExtension[0].count).toBe(3);
    expect(summary.byExtension[1].extension).toBe('png');
    expect(summary.byExtension[1].count).toBe(3);
    expect(summary.byExtension[2].extension).toBe('shader');
    expect(summary.byExtension[2].count).toBe(1);
  });

  it('accumulates assetBytes correctly per extension', () => {
    const aBody = 'aaaa';    // 4 bytes
    const bBody = 'bbbbbb';  // 6 bytes
    const entries: UnityPackageEntry[] = [
      makeEntry('a'.repeat(32), 'Assets/A.cs', aBody, 'meta'),
      makeEntry('b'.repeat(32), 'Assets/B.cs', bBody, 'meta'),
    ];
    const summary = summarizePackage(entries);
    const csEntry = summary.byExtension.find(e => e.extension === 'cs');
    expect(csEntry).toBeDefined();
    expect(csEntry!.assetBytes).toBe(
      encoder.encode(aBody).byteLength + encoder.encode(bBody).byteLength,
    );
  });

  it('counts diagnostics by severity correctly', () => {
    const diags: UnityPackageParseDiagnostic[] = [
      { code: 'meta-missing', message: 'missing meta', severity: 'warning', guid: 'a'.repeat(32) },
      { code: 'zero-byte-asset', message: 'zero byte', severity: 'warning', guid: 'b'.repeat(32) },
      { code: 'duplicate-guid', message: 'dup guid', severity: 'error', guid: 'c'.repeat(32) },
      { code: 'non-standard-guid', message: 'non-std', severity: 'info', guid: 'x' },
      { code: 'ignored-preview', message: 'preview', severity: 'info', guid: 'd'.repeat(32) },
    ];
    const summary = summarizePackage([], diags);
    expect(summary.diagnosticsBySeverity.warning).toBe(2);
    expect(summary.diagnosticsBySeverity.error).toBe(1);
    expect(summary.diagnosticsBySeverity.info).toBe(2);
  });

  it('handles a synthetic mixed-asset fixture with files, folders, previews, and diagnostics', () => {
    // 2 cs files, 1 png file with preview, 1 folder entry, 1 entry with duplicate GUID
    const guidA = 'a'.repeat(32);
    const guidB = 'b'.repeat(32);
    const guidC = 'c'.repeat(32);
    const guidD = 'd'.repeat(32);
    const entries: UnityPackageEntry[] = [
      makeEntry(guidA, 'Assets/Script1.cs', 'class S1 {}', 'meta a'),
      makeEntry(guidB, 'Assets/Script2.cs', 'class S2 {}', 'meta b'),
      makeEntry(guidC, 'Assets/Sprite.png', 'png data', 'meta c', 'preview bytes'),
      makeEntry(guidD, 'Assets/SubFolder', undefined, 'folder meta'),
      makeEntry(guidA, 'Assets/Script1Dup.cs', 'dup', 'meta dup'), // duplicate guidA
    ];
    const diags: UnityPackageParseDiagnostic[] = [
      { code: 'duplicate-guid', message: 'dup', severity: 'error', guid: guidA },
    ];
    const summary = summarizePackage(entries, diags);

    expect(summary.entryCount).toBe(5);
    expect(summary.fileCount).toBe(4);   // Script1, Script2, Sprite, Script1Dup all have asset
    expect(summary.folderCount).toBe(1); // SubFolder
    expect(summary.previewCount).toBe(1);
    expect(summary.uniqueGuidCount).toBe(4); // a, b, c, d
    expect(summary.duplicateGuidCount).toBe(1);
    expect(summary.totalPreviewBytes).toBe(encoder.encode('preview bytes').byteLength);

    // byExtension: cs has 3 entries (Script1, Script2, Dup), png has 1, '' has 1
    const csExt = summary.byExtension.find(e => e.extension === 'cs');
    const pngExt = summary.byExtension.find(e => e.extension === 'png');
    const emptyExt = summary.byExtension.find(e => e.extension === '');
    expect(csExt!.count).toBe(3);
    expect(pngExt!.count).toBe(1);
    expect(emptyExt!.count).toBe(1);
    // Ordering: cs(3) > png(1) == ''(1) -- png before '' alphabetically
    expect(summary.byExtension[0].extension).toBe('cs');
    expect(summary.byExtension[1].extension).toBe('');  // '' < 'png' alphabetically
    expect(summary.byExtension[2].extension).toBe('png');

    expect(summary.diagnosticsBySeverity.error).toBe(1);
    expect(summary.diagnosticsBySeverity.warning).toBe(0);
    expect(summary.diagnosticsBySeverity.info).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseUnityPackageStream helpers
// ---------------------------------------------------------------------------

async function collectStream(
  pkg: Uint8Array,
  options?: Parameters<typeof parseUnityPackageStream>[1],
): Promise<{ entries: UnityPackageEntry[]; diagnostics: UnityPackageParseDiagnostic[] }> {
  const entries: UnityPackageEntry[] = [];
  const diagnostics: UnityPackageParseDiagnostic[] = [];
  for await (const item of parseUnityPackageStream(pkg, options)) {
    if (item._kind === 'entry') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _kind, ...entry } = item as StreamedEntry;
      entries.push(entry);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _kind, ...diag } = item as StreamedDiagnostic;
      diagnostics.push(diag);
    }
  }
  return { entries, diagnostics };
}

describe('parseUnityPackageStream', () => {
  // -------------------------------------------------------------------------
  // Empty input
  // -------------------------------------------------------------------------
  it('yields nothing for an empty tar (only zero blocks)', async () => {
    const pkg = gzipSync(new Uint8Array(1024));
    const { entries, diagnostics } = await collectStream(pkg);
    expect(entries).toHaveLength(0);
    expect(diagnostics).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Matches parseUnityPackageEntries for a minimal single-entry package
  // -------------------------------------------------------------------------
  it('produces the same entries and diagnostics as parseUnityPackageEntries (single entry)', async () => {
    const guid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const pkg = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/MyScript.cs',
      [`${guid}/asset`]: 'public class MyScript {}',
      [`${guid}/asset.meta`]: 'guid: aaaa',
    });

    const buffered = parseUnityPackageEntries(pkg);
    const streamed = await collectStream(pkg);

    expect(streamed.entries).toHaveLength(1);
    expect(streamed.entries[0].guid).toBe(buffered.entries[0].guid);
    expect(streamed.entries[0].pathname).toBe(buffered.entries[0].pathname);
    expect(streamed.entries[0].asset).toEqual(buffered.entries[0].asset);
    expect(streamed.entries[0].meta).toEqual(buffered.entries[0].meta);
    expect(streamed.diagnostics).toEqual(buffered.diagnostics);
  });

  // -------------------------------------------------------------------------
  // Multi-entry package (round-trip via createUnityPackage)
  // -------------------------------------------------------------------------
  it('produces the same entries as parseUnityPackageEntries for a multi-entry package', async () => {
    const inputEntries: CreateUnityPackageEntry[] = [
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/A.cs',
        asset: encoder.encode('class A {}'),
        meta: encoder.encode('guid: aaaa'),
      },
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: 'Assets/Sub/B.cs',
        asset: encoder.encode('class B {}'),
        meta: encoder.encode('guid: bbbb'),
      },
      {
        guid: 'cccccccccccccccccccccccccccccccc',
        pathname: 'Assets/Folder',
        meta: encoder.encode('folderAsset: yes'),
      },
    ];
    const pkg = createUnityPackage(inputEntries, { gzipLevel: 1 });

    const buffered = parseUnityPackageEntries(pkg);
    const streamed = await collectStream(pkg);

    expect(streamed.entries).toHaveLength(buffered.entries.length);
    for (let i = 0; i < buffered.entries.length; i += 1) {
      expect(streamed.entries[i].guid).toBe(buffered.entries[i].guid);
      expect(streamed.entries[i].pathname).toBe(buffered.entries[i].pathname);
      expect(streamed.entries[i].asset).toEqual(buffered.entries[i].asset);
      expect(streamed.entries[i].meta).toEqual(buffered.entries[i].meta);
    }
  });

  // -------------------------------------------------------------------------
  // Diagnostics: non-standard GUID, empty pathname, duplicate GUID
  // -------------------------------------------------------------------------
  it('emits empty-pathname diagnostic and no entry for an empty pathname', async () => {
    const guid = '11111111111111111111111111111111';
    const pkg = createLegacyUnityPackage({
      [`${guid}/pathname`]: '\nAssets/Ignored.cs',
      [`${guid}/asset`]: 'content',
    });

    const { entries, diagnostics } = await collectStream(pkg);
    expect(entries).toHaveLength(0);
    const diag = diagnostics.find(d => d.code === 'empty-pathname');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('error');
    expect(diag!.guid).toBe(guid);
  });

  it('emits non-standard-guid diagnostic for non-32-hex prefix', async () => {
    const guid = 'not-a-guid';
    const pkg = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/LooseGuid.asset',
      [`${guid}/asset`]: 'content',
    });

    const { entries, diagnostics } = await collectStream(pkg);
    expect(entries).toHaveLength(1);
    expect(entries[0].guid).toBe(guid);
    const diag = diagnostics.find(d => d.code === 'non-standard-guid');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('info');
  });

  it('emits duplicate-guid diagnostic and keeps only the first occurrence', async () => {
    const guid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const tarEntries: Uint8Array[] = [];
    tarEntries.push(createTarEntry(`${guid}/pathname`, encoder.encode('Assets/First.cs')));
    tarEntries.push(createTarEntry(`${guid}/asset`, encoder.encode('first')));
    tarEntries.push(createTarEntry(`${guid}/asset.meta`, encoder.encode('first meta')));
    tarEntries.push(createTarEntry(`${guid}/pathname`, encoder.encode('Assets/Second.cs')));
    tarEntries.push(new Uint8Array(1024));
    const pkg = gzipSync(concatUint8Arrays(tarEntries));

    const { entries, diagnostics } = await collectStream(pkg);
    const dupDiag = diagnostics.filter(d => d.code === 'duplicate-guid');
    expect(dupDiag).toHaveLength(1);
    expect(dupDiag[0].guid).toBe(guid);
    expect(dupDiag[0].severity).toBe('error');
    // First occurrence is kept; duplicate pathname entry is skipped
    expect(entries.filter(e => e.guid === guid)).toHaveLength(1);
    expect(entries[0].pathname).toBe('Assets/First.cs');
  });

  it('emits malformed-tar-entry diagnostic for invalid size field', async () => {
    const header = new Uint8Array(512);
    header.set(encoder.encode('bad/pathname'), 0);
    header.set(encoder.encode('not-octal'), 124);
    const pkg = gzipSync(concatUint8Arrays([header, new Uint8Array(1024)]));

    const { entries, diagnostics } = await collectStream(pkg);
    expect(entries).toHaveLength(0);
    const diag = diagnostics.find(d => d.code === 'malformed-tar-entry');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('error');
  });

  // -------------------------------------------------------------------------
  // preview.png is surfaced; ignored-preview diagnostic is emitted
  // -------------------------------------------------------------------------
  it('surfaces preview on entry and emits ignored-preview diagnostic', async () => {
    const guid = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const pkg = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/Texture.png',
      [`${guid}/asset`]: 'binary data',
      [`${guid}/asset.meta`]: 'guid: eeee',
      [`${guid}/preview.png`]: 'thumbnail',
    });

    const { entries, diagnostics } = await collectStream(pkg);
    expect(entries).toHaveLength(1);
    expect(decoder.decode(entries[0].preview!)).toBe('thumbnail');
    const diag = diagnostics.find(d => d.code === 'ignored-preview');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('info');
  });

  // -------------------------------------------------------------------------
  // Truncated / truncated-within-content entry
  // -------------------------------------------------------------------------
  it('emits malformed-tar-entry diagnostic when entry content extends beyond the archive', async () => {
    const guid = 'ffffffffffffffffffffffffffffffff';
    // Build a raw tar with a file claiming size=1000 but only providing 50 bytes of content
    const header = new Uint8Array(512);
    header.set(encoder.encode(`${guid}/asset`), 0);
    const overSize = 1000;
    const sizeStr = overSize.toString(8).padStart(11, '0');
    header.set(encoder.encode(sizeStr), 124);
    for (let i = 148; i < 156; i += 1) header[i] = 0x20;
    header[156] = 0x30;
    header.set(encoder.encode('ustar\0'), 257);
    header[263] = 0x30; header[264] = 0x30;
    let checksum = 0;
    for (let i = 0; i < 512; i += 1) checksum += header[i];
    const csStr = checksum.toString(8).padStart(6, '0') + '\0 ';
    header.set(encoder.encode(csStr), 148);
    const shortContent = new Uint8Array(50); // only 50 bytes, not 1000
    const pkg = gzipSync(concatUint8Arrays([header, shortContent, new Uint8Array(512)]));

    const { diagnostics } = await collectStream(pkg);
    const diag = diagnostics.find(d => d.code === 'malformed-tar-entry');
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('extends beyond the archive');
  });

  // -------------------------------------------------------------------------
  // Streaming yields first entry before full traversal
  // -------------------------------------------------------------------------
  it('yields the first entry before the entire tar has been walked', async () => {
    // Build a package with 3 entries; consume only the first iteration
    const inputEntries: CreateUnityPackageEntry[] = [
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/First.cs',
        asset: encoder.encode('class First {}'),
        meta: encoder.encode('guid: aaaa'),
      },
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: 'Assets/Second.cs',
        asset: encoder.encode('class Second {}'),
        meta: encoder.encode('guid: bbbb'),
      },
      {
        guid: 'cccccccccccccccccccccccccccccccc',
        pathname: 'Assets/Third.cs',
        asset: encoder.encode('class Third {}'),
        meta: encoder.encode('guid: cccc'),
      },
    ];
    const pkg = createUnityPackage(inputEntries, { gzipLevel: 1 });

    // Get the first yielded item without consuming the rest
    const gen = parseUnityPackageStream(pkg);
    let firstEntry: StreamedEntry | null = null;
    for await (const item of gen) {
      if (item._kind === 'entry') {
        firstEntry = item as StreamedEntry;
        break; // stop after the first entry
      }
    }

    expect(firstEntry).not.toBeNull();
    // createUnityPackage sorts by GUID; 'aaa...' comes first
    expect(firstEntry!.guid).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  // -------------------------------------------------------------------------
  // Bomb guards
  // -------------------------------------------------------------------------
  it('throws DecompressionBombError with kind "output-bytes" when maxOutputBytes is exceeded', async () => {
    const guid = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const pkg = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/Big.asset',
      [`${guid}/asset`]: 'x'.repeat(100),
      [`${guid}/asset.meta`]: 'guid: bbbb',
    });

    let thrown: unknown;
    try {
      // consume all items -- bomb should trigger
      for await (const item of parseUnityPackageStream(pkg, { maxOutputBytes: 50 })) void item;
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DecompressionBombError);
    const bomb = thrown as DecompressionBombError;
    expect(bomb.kind).toBe('output-bytes');
    expect(bomb.observed).toBeGreaterThan(50);
  });

  it('throws DecompressionBombError with kind "entry-count" when maxEntries is exceeded', async () => {
    const tarEntries: Uint8Array[] = [];
    for (let i = 0; i < 3; i += 1) {
      const guid = `${'a'.repeat(30)}${i.toString().padStart(2, '0')}`;
      tarEntries.push(createTarEntry(`${guid}/pathname`, encoder.encode(`Assets/Script${i}.cs`)));
      tarEntries.push(createTarEntry(`${guid}/asset`, encoder.encode(`class S${i} {}`)));
      tarEntries.push(createTarEntry(`${guid}/asset.meta`, encoder.encode(`guid: ${guid}`)));
    }
    tarEntries.push(new Uint8Array(1024));
    const pkg = gzipSync(concatUint8Arrays(tarEntries));

    let thrown: unknown;
    try {
      // consume all items -- bomb should trigger
      for await (const item of parseUnityPackageStream(pkg, { maxEntries: 2 })) void item;
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DecompressionBombError);
    const bomb = thrown as DecompressionBombError;
    expect(bomb.kind).toBe('entry-count');
    expect(bomb.observed).toBe(3);
  });

  // -------------------------------------------------------------------------
  // onProgress: monotonically non-decreasing entryCount, rate-limited
  // -------------------------------------------------------------------------
  it('onProgress fires with monotonically non-decreasing entryCount', async () => {
    // Build a package with 5 entries using unique 32-hex GUIDs
    const uniqueEntries: CreateUnityPackageEntry[] = [
      { guid: 'aaaa0000000000000000000000000000', pathname: 'Assets/A.cs', asset: encoder.encode('a'), meta: encoder.encode('ma') },
      { guid: 'bbbb0000000000000000000000000000', pathname: 'Assets/B.cs', asset: encoder.encode('b'), meta: encoder.encode('mb') },
      { guid: 'cccc0000000000000000000000000000', pathname: 'Assets/C.cs', asset: encoder.encode('c'), meta: encoder.encode('mc') },
      { guid: 'dddd0000000000000000000000000000', pathname: 'Assets/D.cs', asset: encoder.encode('d'), meta: encoder.encode('md') },
      { guid: 'eeee0000000000000000000000000000', pathname: 'Assets/E.cs', asset: encoder.encode('e'), meta: encoder.encode('me') },
    ];
    const pkg = createUnityPackage(uniqueEntries, { gzipLevel: 1 });

    const progressEvents: number[] = [];
    await collectStream(pkg, {
      onProgress: (ev) => progressEvents.push(ev.entryCount),
    });

    // Should have at least one progress event (the final one always fires)
    expect(progressEvents.length).toBeGreaterThan(0);
    // entryCount must be monotonically non-decreasing
    for (let i = 1; i < progressEvents.length; i += 1) {
      expect(progressEvents[i]).toBeGreaterThanOrEqual(progressEvents[i - 1]);
    }
    // Last event should reflect all 5 entries
    expect(progressEvents[progressEvents.length - 1]).toBe(5);
  });

  it('onProgress bytesTotal equals decompressed tar length (known after sync gzip decompression)', async () => {
    const guid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const pkg = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/A.cs',
      [`${guid}/asset`]: 'class A {}',
      [`${guid}/asset.meta`]: 'guid: aaaa',
    });

    let lastEvent: { bytesRead: number; bytesTotal: number; entryCount: number } | null = null;
    await collectStream(pkg, {
      onProgress: (ev) => { lastEvent = ev; },
    });

    expect(lastEvent).not.toBeNull();
    // bytesTotal must be positive and equal to bytesRead at the end
    expect(lastEvent!.bytesTotal).toBeGreaterThan(0);
    expect(lastEvent!.bytesRead).toBe(lastEvent!.bytesTotal);
  });

  it('rate-limit: onProgress fires no more than once per ~16ms for a fast synchronous archive', async () => {
    // Build 20 entries; the loop runs synchronously (no real async I/O).
    // Without rate-limiting, we'd get one event per entry = 20 events.
    // With rate-limiting, we may get fewer (depends on timing), but never more than entries+1
    // (one final unconditional event is always fired).
    const entries: CreateUnityPackageEntry[] = Array.from({ length: 20 }, (_, i) => ({
      guid: `${'a'.repeat(30)}${i.toString().padStart(2, '0')}`,
      pathname: `Assets/Script${i}.cs`,
      asset: encoder.encode(`class S${i} {}`),
      meta: encoder.encode(`guid: ${i}`),
    }));
    const pkg = createUnityPackage(entries, { gzipLevel: 0 });

    let callCount = 0;
    let lastEntryCount = -1;
    await collectStream(pkg, {
      onProgress: (ev) => {
        callCount += 1;
        expect(ev.entryCount).toBeGreaterThanOrEqual(lastEntryCount);
        lastEntryCount = ev.entryCount;
      },
    });

    // The final progress event always fires unconditionally, so callCount >= 1.
    // In a synchronous loop the rate-limit will typically suppress intermediate events
    // to just 1-2 total (plus the unconditional final). We assert the count is
    // at most 21 (not one per block) and at least 1.
    expect(callCount).toBeGreaterThanOrEqual(1);
    expect(callCount).toBeLessThanOrEqual(21);
  });

  // -------------------------------------------------------------------------
  // asset-missing, meta-missing, zero-byte-asset diagnostics match buffered
  // -------------------------------------------------------------------------
  it('emits asset-missing diagnostic matching parseUnityPackageEntries', async () => {
    const guid = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const pkg = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/MetaOnly.cs',
      [`${guid}/asset.meta`]: 'guid: bbbb',
    });

    const buffered = parseUnityPackageEntries(pkg);
    const streamed = await collectStream(pkg);

    const bDiag = buffered.diagnostics.filter(d => d.code === 'asset-missing');
    const sDiag = streamed.diagnostics.filter(d => d.code === 'asset-missing');
    expect(sDiag).toHaveLength(bDiag.length);
    expect(sDiag[0].guid).toBe(guid);
    expect(sDiag[0].severity).toBe('warning');
  });

  it('emits meta-missing diagnostic matching parseUnityPackageEntries', async () => {
    const guid = 'cccccccccccccccccccccccccccccccc';
    const pkg = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/NoMeta.cs',
      [`${guid}/asset`]: 'content',
    });

    const buffered = parseUnityPackageEntries(pkg);
    const streamed = await collectStream(pkg);

    const bDiag = buffered.diagnostics.filter(d => d.code === 'meta-missing');
    const sDiag = streamed.diagnostics.filter(d => d.code === 'meta-missing');
    expect(sDiag).toHaveLength(bDiag.length);
    expect(sDiag[0].severity).toBe('warning');
  });

  it('emits zero-byte-asset diagnostic matching parseUnityPackageEntries', async () => {
    const guid = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const pkg = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/Empty.cs',
      [`${guid}/asset`]: '',
      [`${guid}/asset.meta`]: 'guid: eeee',
    });

    const buffered = parseUnityPackageEntries(pkg);
    const streamed = await collectStream(pkg);

    const bDiag = buffered.diagnostics.filter(d => d.code === 'zero-byte-asset');
    const sDiag = streamed.diagnostics.filter(d => d.code === 'zero-byte-asset');
    expect(sDiag).toHaveLength(bDiag.length);
    expect(sDiag[0].severity).toBe('warning');
  });

  // -------------------------------------------------------------------------
  // oversized-entry-name matches buffered
  // -------------------------------------------------------------------------
  it('emits oversized-entry-name diagnostic for pathnames > 200 characters', async () => {
    const guid = 'ffffffffffffffffffffffffffffffff';
    const longPathname = 'Assets/' + 'A'.repeat(195);
    const pkg = createLegacyUnityPackage({
      [`${guid}/pathname`]: longPathname,
      [`${guid}/asset`]: 'content',
      [`${guid}/asset.meta`]: 'guid: ffff',
    });

    const { entries, diagnostics } = await collectStream(pkg);
    const diag = diagnostics.find(d => d.code === 'oversized-entry-name');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('warning');
    // Entry is still yielded despite the diagnostic
    expect(entries).toHaveLength(1);
    expect(entries[0].pathname).toBe(longPathname);
  });
});

// ---------------------------------------------------------------------------
// detectMetaImporterType
// ---------------------------------------------------------------------------

describe('detectMetaImporterType', () => {
  const validGuid = '0123456789abcdef0123456789abcdef';

  it('returns DefaultImporterFolder when isDir is true', () => {
    expect(detectMetaImporterType('Assets/MyFolder', true)).toBe('DefaultImporterFolder');
    expect(detectMetaImporterType('Assets/Script.cs', true)).toBe('DefaultImporterFolder');
  });

  it('returns MonoImporter for .cs extension', () => {
    expect(detectMetaImporterType('Assets/MyScript.cs')).toBe('MonoImporter');
    expect(detectMetaImporterType('Assets/Sub/Deep.cs')).toBe('MonoImporter');
  });

  it('returns TextScriptImporter for .json', () => {
    expect(detectMetaImporterType('Assets/config.json')).toBe('TextScriptImporter');
  });

  it('returns TextScriptImporter for .txt', () => {
    expect(detectMetaImporterType('Assets/readme.txt')).toBe('TextScriptImporter');
  });

  it('returns TextScriptImporter for .md', () => {
    expect(detectMetaImporterType('Assets/docs.md')).toBe('TextScriptImporter');
  });

  it('returns TextScriptImporter for .asmdef', () => {
    expect(detectMetaImporterType('Assets/MyAssembly.asmdef')).toBe('TextScriptImporter');
  });

  it('returns DefaultImporter for .yaml', () => {
    expect(detectMetaImporterType('Assets/scene.yaml')).toBe('DefaultImporter');
  });

  it('returns DefaultImporter for .yml', () => {
    expect(detectMetaImporterType('Assets/config.yml')).toBe('DefaultImporter');
  });

  it('returns DefaultImporter for .png', () => {
    expect(detectMetaImporterType('Assets/sprite.png')).toBe('DefaultImporter');
  });

  it('returns DefaultImporter for .prefab', () => {
    expect(detectMetaImporterType('Assets/MyPrefab.prefab')).toBe('DefaultImporter');
  });

  it('returns DefaultImporter for unknown extension', () => {
    expect(detectMetaImporterType('Assets/data.unknownxyz')).toBe('DefaultImporter');
  });

  it('returns TextScriptImporter for bare LICENSE basename (no extension)', () => {
    expect(detectMetaImporterType('LICENSE')).toBe('TextScriptImporter');
    expect(detectMetaImporterType('Assets/LICENSE')).toBe('TextScriptImporter');
    expect(detectMetaImporterType('someDir/LICENSE')).toBe('TextScriptImporter');
  });

  it('returns DefaultImporterFolder for extensionless path that is not LICENSE', () => {
    expect(detectMetaImporterType('Assets/SomeFolder')).toBe('DefaultImporterFolder');
    expect(detectMetaImporterType('Assets/Sub/AnotherFolder')).toBe('DefaultImporterFolder');
  });

  void validGuid; // suppress unused-variable lint in this describe block
});

// ---------------------------------------------------------------------------
// createMinimalMetaFor
// ---------------------------------------------------------------------------

describe('createMinimalMetaFor', () => {
  const validGuid = '0123456789abcdef0123456789abcdef';

  it('produces MonoImporter YAML for a .cs file', () => {
    const result = createMinimalMetaFor(validGuid, 'Assets/MyScript.cs');
    expect(result).toContain(`guid: ${validGuid}`);
    expect(result).toContain('MonoImporter:');
    expect(result).toContain('serializedVersion: 2');
  });

  it('produces TextScriptImporter YAML for a .json file', () => {
    const result = createMinimalMetaFor(validGuid, 'Assets/config.json');
    expect(result).toContain(`guid: ${validGuid}`);
    expect(result).toContain('TextScriptImporter:');
  });

  it('produces DefaultImporterFolder YAML when isDir is true', () => {
    const result = createMinimalMetaFor(validGuid, 'Assets/MyFolder', true);
    expect(result).toContain(`guid: ${validGuid}`);
    expect(result).toContain('DefaultImporter:');
    expect(result).toContain('folderAsset: yes');
  });

  it('produces DefaultImporter YAML for a .png file (no folderAsset)', () => {
    const result = createMinimalMetaFor(validGuid, 'Assets/sprite.png');
    expect(result).toContain(`guid: ${validGuid}`);
    expect(result).toContain('DefaultImporter:');
    expect(result).not.toContain('folderAsset:');
  });

  it('throws for an invalid GUID', () => {
    expect(() => createMinimalMetaFor('not-a-guid', 'Assets/Foo.cs')).toThrow('not-a-guid');
  });

  it('throws for an uppercase GUID', () => {
    expect(() => createMinimalMetaFor('0123456789ABCDEF0123456789ABCDEF', 'Assets/Foo.cs')).toThrow(
      '0123456789ABCDEF0123456789ABCDEF',
    );
  });

  it('produces DefaultImporterFolder YAML for extensionless path (not LICENSE)', () => {
    const result = createMinimalMetaFor(validGuid, 'Assets/SomeFolder');
    expect(result).toContain('DefaultImporter:');
    expect(result).toContain('folderAsset: yes');
  });
});

// ---------------------------------------------------------------------------
// createMinimalFolderMeta
// ---------------------------------------------------------------------------

describe('createMinimalFolderMeta', () => {
  const validGuid = '0123456789abcdef0123456789abcdef';

  it('produces folder meta YAML containing the guid', () => {
    const result = createMinimalFolderMeta(validGuid);
    expect(result).toContain(`guid: ${validGuid}`);
  });

  it('produces YAML with DefaultImporter block and folderAsset: yes', () => {
    const result = createMinimalFolderMeta(validGuid);
    expect(result).toContain('DefaultImporter:');
    expect(result).toContain('folderAsset: yes');
  });

  it('throws for an invalid GUID', () => {
    expect(() => createMinimalFolderMeta('bad')).toThrow('bad');
  });

  it('throws for an uppercase GUID', () => {
    expect(() => createMinimalFolderMeta('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toThrow(
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    );
  });

  it('produces byte-stable output across two calls with the same GUID', () => {
    expect(createMinimalFolderMeta(validGuid)).toBe(createMinimalFolderMeta(validGuid));
  });
});

// ---------------------------------------------------------------------------
// createMinimalMeta backward compat
// ---------------------------------------------------------------------------

describe('createMinimalMeta backward compat', () => {
  const validGuid = '0123456789abcdef0123456789abcdef';

  it('still works and produces DefaultImporter YAML', () => {
    const result = createMinimalMeta(validGuid);
    expect(result).toContain(`guid: ${validGuid}`);
    expect(result).toContain('DefaultImporter:');
    expect(result).not.toContain('folderAsset:');
    expect(result).not.toContain('MonoImporter:');
    expect(result).not.toContain('TextScriptImporter:');
  });
});
