import { describe, expect, it } from 'vitest';
import { entriesToComponentRecords, type UnityPackageEntry, type UnityPackageParseDiagnostic } from './index';

const encoder = new TextEncoder();

describe('entry component records', () => {
  it('creates asset, meta, and preview component records with stable virtual paths', () => {
    const entries: UnityPackageEntry[] = [{
      guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pathname: 'Assets/Texture.png',
      asset: encoder.encode('asset'),
      meta: encoder.encode('meta'),
      preview: encoder.encode('preview'),
    }];

    const records = entriesToComponentRecords(entries);

    expect(records.map(record => [record.component, record.virtualPath])).toEqual([
      ['asset', 'Assets/Texture.png'],
      ['meta', 'Assets/Texture.png.meta'],
      ['preview', 'Assets/Texture.png.preview.png'],
    ]);
    expect(records.map(record => record.id)).toEqual([
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:asset:Assets/Texture.png',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:meta:Assets/Texture.png.meta',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:preview:Assets/Texture.png.preview.png',
    ]);
  });

  it('routes diagnostics to the relevant component', () => {
    const entries: UnityPackageEntry[] = [{
      guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      pathname: 'Assets/Empty.bytes',
      asset: new Uint8Array(0),
      meta: encoder.encode('meta'),
      preview: encoder.encode('preview'),
    }];
    const diagnostics: UnityPackageParseDiagnostic[] = [
      {
        code: 'zero-byte-asset',
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        path: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/asset',
        message: 'Asset file is present but has zero bytes.',
        severity: 'warning',
      },
      {
        code: 'ignored-preview',
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        path: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/preview.png',
        message: 'preview.png is exposed on entries and ignored by flat parsing.',
        severity: 'info',
      },
    ];

    const records = entriesToComponentRecords(entries, diagnostics);

    expect(records.find(record => record.component === 'asset')?.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['zero-byte-asset']);
    expect(records.find(record => record.component === 'meta')?.diagnostics).toEqual([]);
    expect(records.find(record => record.component === 'preview')?.diagnostics).toEqual([]);
  });
});
