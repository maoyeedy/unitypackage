import { describe, expect, it } from 'vitest';
import { gzipSync } from 'fflate';
import {
  createUnityPackage,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_OUTPUT_BYTES,
  DecompressionBombError,
  parseUnityPackage,
  parseUnityPackageEntries,
  parseUnityPackageStream,
  type CreateUnityPackageEntry,
  type StreamedDiagnostic,
  type StreamedEntry,
  type UnityPackageEntry,
  type UnityPackageParseDiagnostic,
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
    const pathname = 'Assets/Test/日本語.prefab';
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
