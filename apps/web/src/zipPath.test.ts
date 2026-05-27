import { describe, expect, it } from 'vitest';
import { buildZipPayload } from './zipPath';
import type { PackageFileRecord } from './packageModel';

describe('buildZipPayload', () => {
  it('filters by ID-set and handles content retrievals', () => {
    const records: Partial<PackageFileRecord>[] = [
      { id: '1', fileName: 'file1.txt', virtualPath: 'Assets/file1.txt' },
      { id: '2', fileName: 'file2.txt', virtualPath: 'Assets/file2.txt' },
      { id: '3', fileName: 'file3.txt', virtualPath: 'Assets/file3.txt' },
    ];
    const recordIds = ['1', '3'];
    const contents: Record<string, Uint8Array> = {
      '1': new Uint8Array([97]),
      '2': new Uint8Array([98]),
      '3': new Uint8Array([99]),
    };
    const getContent = (id: string) => contents[id] as Uint8Array<ArrayBuffer> | undefined;

    const result = buildZipPayload({
      records: records as PackageFileRecord[],
      recordIds,
      maintainStructure: true,
      getContent,
    });

    expect(result.files).toHaveLength(2);
    expect(result.files[0]?.path).toBe('Assets/file1.txt');
    expect(result.files[0]?.content).toEqual(new Uint8Array([97]));
    expect(result.files[1]?.path).toBe('Assets/file3.txt');
    expect(result.files[1]?.content).toEqual(new Uint8Array([99]));
    expect(result.transfer).toHaveLength(2);
    expect(result.transfer[0]).toBe(result.files[0]?.content.buffer);
  });

  it('skips records when getContent returns undefined', () => {
    const records: Partial<PackageFileRecord>[] = [
      { id: '1', fileName: 'file1.txt', virtualPath: 'Assets/file1.txt' },
      { id: '2', fileName: 'file2.txt', virtualPath: 'Assets/file2.txt' },
    ];
    const recordIds = ['1', '2'];
    const contents: Record<string, Uint8Array | undefined> = {
      '1': undefined,
      '2': new Uint8Array([100]),
    };
    const getContent = (id: string) => contents[id] as Uint8Array<ArrayBuffer> | undefined;

    const result = buildZipPayload({
      records: records as PackageFileRecord[],
      recordIds,
      maintainStructure: true,
      getContent,
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe('Assets/file2.txt');
    expect(result.files[0]?.content).toEqual(new Uint8Array([100]));
    expect(result.transfer).toHaveLength(1);
  });

  it('disambiguates duplicate paths', () => {
    const records: Partial<PackageFileRecord>[] = [
      { id: '1', fileName: 'file.txt', virtualPath: 'Assets/file.txt' },
      { id: '2', fileName: 'file.txt', virtualPath: 'Assets/file.txt' },
      { id: '3', fileName: 'file.txt', virtualPath: 'Assets/file.txt' },
    ];
    const recordIds = ['1', '2', '3'];
    const contents: Record<string, Uint8Array> = {
      '1': new Uint8Array([1]),
      '2': new Uint8Array([2]),
      '3': new Uint8Array([3]),
    };
    const getContent = (id: string) => contents[id] as Uint8Array<ArrayBuffer> | undefined;

    const result = buildZipPayload({
      records: records as PackageFileRecord[],
      recordIds,
      maintainStructure: true,
      getContent,
    });

    expect(result.files).toHaveLength(3);
    expect(result.files[0]?.path).toBe('Assets/file.txt');
    expect(result.files[1]?.path).toBe('Assets/file (2).txt');
    expect(result.files[2]?.path).toBe('Assets/file (3).txt');
  });

  it('correctly handles flat (no-maintain-structure) filenames and duplicates', () => {
    const records: Partial<PackageFileRecord>[] = [
      { id: '1', fileName: 'file.txt', virtualPath: 'Assets/Sub/file.txt' },
      { id: '2', fileName: 'file.txt', virtualPath: 'Assets/Other/file.txt' },
    ];
    const recordIds = ['1', '2'];
    const contents: Record<string, Uint8Array> = {
      '1': new Uint8Array([1]),
      '2': new Uint8Array([2]),
    };
    const getContent = (id: string) => contents[id] as Uint8Array<ArrayBuffer> | undefined;

    const result = buildZipPayload({
      records: records as PackageFileRecord[],
      recordIds,
      maintainStructure: false,
      getContent,
    });

    expect(result.files).toHaveLength(2);
    expect(result.files[0]?.path).toBe('file.txt');
    expect(result.files[1]?.path).toBe('file (2).txt');
  });
});
