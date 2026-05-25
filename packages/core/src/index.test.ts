import { describe, expect, it } from 'vitest';
import { gzipSync, gunzipSync } from 'fflate';
import {
  createUnityPackage,
  tryCreateUnityPackage,
  estimateUnityPackageSize,
  parseUnityPackage,
  parseUnityPackageEntries,
  type CreateUnityPackageEntry,
  type CreateUnityPackageDiagnostic,
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

    const parsedEntries = parseUnityPackageEntries(data);
    const parsedFiles = parseUnityPackage(data);

    expect(parsedEntries).toHaveLength(1);
    expect(decoder.decode(parsedEntries[0].preview!)).toBe('thumbnail');
    expect(parsedEntries.diagnostics).toEqual([
      {
        code: 'ignored-preview',
        message: 'preview.png is exposed on entries and ignored by flat parsing.',
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

    const parsedEntries = parseUnityPackageEntries(data);
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

    const parsedEntries = parseUnityPackageEntries(data);
    const parsedFiles = parseUnityPackage(data);

    expect(parsedEntries).toEqual([]);
    expect(parsedEntries.diagnostics).toEqual([
      {
        code: 'empty-pathname',
        message: 'Skipped record with an empty pathname.',
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

    const parsedEntries = parseUnityPackageEntries(data);
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

    const parsedEntries = parseUnityPackageEntries(data);
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

    const parsedEntries = parseUnityPackageEntries(data);

    expect(parsedEntries).toHaveLength(1);
    expect(parsedEntries[0].guid).toBe(guid);
    expect(parsedEntries[0].pathname).toBe('Assets/LooseGuid.asset');
    expect(parsedEntries.diagnostics).toEqual([
      {
        code: 'non-standard-guid',
        message: 'Record prefix is not a 32-character hexadecimal GUID.',
        path: `${guid}/pathname`,
        guid,
      },
      {
        code: 'meta-missing',
        message: 'Entry has a pathname and asset but no asset.meta or metaData file.',
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

    const parsedEntries = parseUnityPackageEntries(data);

    expect(parsedEntries).toEqual([]);
    expect(parsedEntries.diagnostics).toEqual([
      {
        code: 'malformed-tar-entry',
        message: 'Skipped tar entry with an invalid size field.',
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

    const parsedEntries = parseUnityPackageEntries(dupData);
    const dupDiag = parsedEntries.diagnostics.filter(d => d.code === 'duplicate-guid');
    expect(dupDiag).toHaveLength(1);
    expect(dupDiag[0].guid).toBe(guid);
    expect(dupDiag[0].path).toBe(`${guid}/pathname`);
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

    const parsedEntries = parseUnityPackageEntries(data);
    const diag = parsedEntries.diagnostics.filter(d => d.code === 'asset-missing');
    expect(diag).toHaveLength(1);
    expect(diag[0].guid).toBe(guid);
    expect(diag[0].path).toBe(`${guid}/asset`);
  });

  it('emits meta-missing when entry has asset but no meta file', () => {
    const guid = 'cccccccccccccccccccccccccccccccc';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/NoMeta.cs',
      [`${guid}/asset`]: 'some content',
    });

    const parsedEntries = parseUnityPackageEntries(data);
    const diag = parsedEntries.diagnostics.filter(d => d.code === 'meta-missing');
    expect(diag).toHaveLength(1);
    expect(diag[0].guid).toBe(guid);
    expect(diag[0].path).toBe(`${guid}/asset.meta`);
  });

  it('does not emit asset-missing or meta-missing for folder entries (asset-only with meta, no asset file)', () => {
    // Folder entries have meta but no asset -- asset-missing should fire
    // But folder entry with neither asset nor meta should fire neither
    const guid = 'dddddddddddddddddddddddddddddddd';
    const data = createLegacyUnityPackage({
      [`${guid}/pathname`]: 'Assets/Folder',
    });

    const parsedEntries = parseUnityPackageEntries(data);
    const codes = parsedEntries.diagnostics.map(d => d.code);
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

    const parsedEntries = parseUnityPackageEntries(data);
    const diag = parsedEntries.diagnostics.filter(d => d.code === 'zero-byte-asset');
    expect(diag).toHaveLength(1);
    expect(diag[0].guid).toBe(guid);
    expect(diag[0].path).toBe(`${guid}/asset`);
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

    const parsedEntries = parseUnityPackageEntries(data);
    const diag = parsedEntries.diagnostics.filter(d => d.code === 'oversized-entry-name');
    expect(diag).toHaveLength(1);
    expect(diag[0].guid).toBe(guid);
    expect(diag[0].path).toBe(`${guid}/pathname`);
    expect(diag[0].message).toContain(`${longPathname.length}`);
    // Entry is still added despite diagnostic
    expect(parsedEntries).toHaveLength(1);
    expect(parsedEntries[0].pathname).toBe(longPathname);
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
    const parsedEntries = parseUnityPackageEntries(data);
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
