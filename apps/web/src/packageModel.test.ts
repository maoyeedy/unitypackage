/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { UnityPackageEntry, UnityPackageParseDiagnostic } from 'unitypackage-core';

import {
  buildExtensionGroups,
  buildTreeRows,
  entriesToRecords,
  getPreviewKind,
  validatePackDraft,
} from './packageModel';

const encoder = new TextEncoder();
const fixturePng = new URL('../../../fixtures/static/texture_02.png', import.meta.url);
const fixturePngMeta = new URL('../../../fixtures/static/texture_02.png.meta', import.meta.url);

describe('package model helpers', () => {
  it('creates records with derived metadata and duplicate path counts', () => {
    const entries: UnityPackageEntry[] = [
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/Scripts/Player.cs',
        asset: encoder.encode('class Player {}'),
        meta: encoder.encode('guid: a'),
      },
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: 'Assets/Scripts/Player.cs',
        asset: encoder.encode('class Player2 {}'),
        meta: encoder.encode('guid: b'),
        preview: encoder.encode('png'),
      },
    ];
    const diagnostics: UnityPackageParseDiagnostic[] = [
      {
        code: 'ignored-preview',
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        path: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/preview.png',
        message: 'preview.png is exposed on entries and ignored by flat parsing.',
      },
    ];

    const records = entriesToRecords(entries, diagnostics);

    expect(records).toHaveLength(5);
    expect(records.filter(record => record.kind === 'asset')).toHaveLength(2);
    expect(records.every(record => record.duplicatePathCount === 2)).toBe(true);
    expect(records.find(record => record.kind === 'preview')?.diagnostics[0]?.code).toBe('ignored-preview');
    expect(records.find(record => record.kind === 'asset' && record.guid.startsWith('b'))?.diagnostics).toEqual([]);
  });

  it('treats real png and png meta fixture records as separate preview types', () => {
    const png = readFileSync(fixturePng);
    const pngMeta = readFileSync(fixturePngMeta);
    const records = entriesToRecords([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/Textures/texture_02.png',
        asset: png,
        meta: pngMeta,
      },
    ], []);

    const pngRecord = records.find(record => record.virtualPath === 'Assets/Textures/texture_02.png');
    const metaRecord = records.find(record => record.virtualPath === 'Assets/Textures/texture_02.png.meta');

    expect(pngRecord?.kind).toBe('asset');
    expect(pngRecord?.previewKind).toBe('image');
    expect(pngRecord?.mimeType).toBe('image/png');
    expect(pngRecord?.byteLength).toBe(png.byteLength);
    expect(metaRecord?.kind).toBe('meta');
    expect(metaRecord?.previewKind).toBe('text');
    expect(metaRecord?.mimeType).toBe('text/plain;charset=utf-8');
    expect(metaRecord?.byteLength).toBe(pngMeta.byteLength);
  });

  it('builds deterministic tree rows', () => {
    const records = entriesToRecords([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/Scripts/Player.cs',
        asset: encoder.encode('class Player {}'),
        meta: encoder.encode('guid: a'),
      },
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: 'Packages/Tool/package.json',
        asset: encoder.encode('{}'),
        meta: encoder.encode('guid: b'),
      },
    ], []);

    const rows = buildTreeRows(records);

    expect(rows.map(row => row.type === 'folder' ? row.path : row.record.virtualPath)).toEqual([
      'Assets',
      'Assets/Scripts',
      'Assets/Scripts/Player.cs',
      'Assets/Scripts/Player.cs.meta',
      'Packages',
      'Packages/Tool',
      'Packages/Tool/package.json',
      'Packages/Tool/package.json.meta',
    ]);
  });

  it('builds extension groups with total byte counts', () => {
    const records = entriesToRecords([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/A.prefab',
        asset: encoder.encode('prefab'),
        meta: encoder.encode('meta'),
      },
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: 'Assets/B.cs',
        asset: encoder.encode('code'),
      },
    ], []);

    const groups = buildExtensionGroups(records);

    expect(groups.map(group => group.extension)).toEqual(['cs', 'meta', 'prefab']);
    expect(groups.find(group => group.extension === 'meta')?.totalBytes).toBe(4);
  });

  it('detects native preview kinds', () => {
    expect(getPreviewKind('Assets/Image.png')).toBe('image');
    expect(getPreviewKind('Assets/Manual.pdf')).toBe('pdf');
    expect(getPreviewKind('Assets/Sound.wav')).toBe('audio');
    expect(getPreviewKind('Assets/Movie.mp4')).toBe('video');
    expect(getPreviewKind('Assets/Data.asset')).toBe('text');
    expect(getPreviewKind('Assets/Data.bytes', new Uint8Array([0, 1, 2]))).toBe('unsupported');
  });

  it('keeps pack export blocked until the creation API plan lands', () => {
    const records = entriesToRecords([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/A.prefab',
        asset: encoder.encode('prefab'),
      },
    ], []);

    const validation = validatePackDraft(records);

    expect(validation.status).toBe('blocked');
    expect(validation.createEntryCount).toBe(1);
    expect(validation.messages).toContain('Assets/A.prefab is missing metadata.');
    expect(validation.messages.at(-1)).toContain('docs/plans/web/new-api.md');
  });
});
