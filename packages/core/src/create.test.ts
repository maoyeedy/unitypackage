import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'fflate';
import {
  createUnityPackage,
  estimateUnityPackageSize,
  parseUnityPackage,
  parseUnityPackageEntries,
  tryCreateUnityPackage,
  type CreateUnityPackageDiagnostic,
  type CreateUnityPackageEntry,
} from './index';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
