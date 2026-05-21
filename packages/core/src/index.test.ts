import { describe, expect, it } from 'vitest';
import { gzipSync } from 'fflate';
import {
  createUnityPackage,
  parseUnityPackage,
  parseUnityPackageEntries,
  type CreateUnityPackageEntry,
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
    expect(parsedEntries[0]).not.toHaveProperty('preview');
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
  });

  it('skips malformed tar entries with invalid size fields', () => {
    const header = new Uint8Array(512);
    header.set(encoder.encode('bad/pathname'), 0);
    header.set(encoder.encode('not-octal'), 124);
    const data = gzipSync(concatUint8Arrays([header, new Uint8Array(1024)]));

    expect(parseUnityPackageEntries(data)).toEqual([]);
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

describe('createUnityPackage', () => {
  it('enforces the ustar 100-byte entry name limit', () => {
    const exactLimitGuid = 'a'.repeat(89);
    const tooLongGuid = 'b'.repeat(90);

    expect(() =>
      createUnityPackage([
        {
          guid: exactLimitGuid,
          pathname: 'Assets/Exact.asset',
          asset: encoder.encode('asset'),
          meta: encoder.encode('meta'),
        },
      ], { gzipLevel: 1 }),
    ).not.toThrow();

    expect(() =>
      createUnityPackage([
        {
          guid: tooLongGuid,
          pathname: 'Assets/TooLong.asset',
          asset: encoder.encode('asset'),
          meta: encoder.encode('meta'),
        },
      ], { gzipLevel: 1 }),
    ).toThrow('Tar entry name is too long');
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
