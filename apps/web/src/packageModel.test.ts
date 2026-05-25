/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { UnityPackageEntry, UnityPackageParseDiagnostic } from 'unitypackage-core';

import {
  buildExtensionGroups,
  buildTreeRows,
  entriesToRecords,
  getExtensionFileRecordIds,
  getFolderRecordIds,
  getPreviewKind,
  getRangeRecordIds,
  getRecordCategory,
  getSelectionState,
  getSyntaxLanguage,
  getTreeFileRecordIds,
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
    expect(records.filter(record => getRecordCategory(record) === 'asset')).toHaveLength(2);
    expect(records.every(record => record.duplicatePathCount === 2)).toBe(true);
    expect(records.find(record => record.isUnityPreview)?.diagnostics).toEqual([]);
    expect(records.find(record => getRecordCategory(record) === 'asset' && record.guid.startsWith('b'))?.diagnostics).toEqual([]);
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

    expect(pngRecord && getRecordCategory(pngRecord)).toBe('asset');
    expect(pngRecord?.isUnityPreview).toBe(false);
    expect(pngRecord?.previewKind).toBe('image');
    expect(pngRecord?.mimeType).toBe('image/png');
    expect(pngRecord?.byteLength).toBe(png.byteLength);
    expect(metaRecord && getRecordCategory(metaRecord)).toBe('meta');
    expect(metaRecord?.isUnityPreview).toBe(false);
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

  it('builds selection orders for tree, extension, folder, and ranges', () => {
    const records = entriesToRecords([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/Scripts/Player.cs',
        asset: encoder.encode('class Player {}'),
        meta: encoder.encode('guid: a'),
      },
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: 'Assets/Textures/Icon.png',
        asset: encoder.encode('png'),
      },
      {
        guid: 'cccccccccccccccccccccccccccccccc',
        pathname: 'Packages/Tool/package.json',
        asset: encoder.encode('{}'),
      },
    ], []);

    const treeRows = buildTreeRows(records);
    const extensionGroups = buildExtensionGroups(records);
    const treeIds = getTreeFileRecordIds(treeRows);
    const extensionIds = getExtensionFileRecordIds(extensionGroups);
    const scriptIds = getFolderRecordIds(records, 'Assets/Scripts');
    const assetsIds = getFolderRecordIds(records, 'Assets');

    expect(treeIds.map(id => records.find(record => record.id === id)?.virtualPath)).toEqual([
      'Assets/Scripts/Player.cs',
      'Assets/Scripts/Player.cs.meta',
      'Assets/Textures/Icon.png',
      'Packages/Tool/package.json',
    ]);
    expect(extensionIds.map(id => records.find(record => record.id === id)?.virtualPath)).toEqual([
      'Assets/Scripts/Player.cs',
      'Packages/Tool/package.json',
      'Assets/Scripts/Player.cs.meta',
      'Assets/Textures/Icon.png',
    ]);
    expect(scriptIds.map(id => records.find(record => record.id === id)?.virtualPath)).toEqual([
      'Assets/Scripts/Player.cs',
      'Assets/Scripts/Player.cs.meta',
    ]);
    expect(assetsIds).toHaveLength(3);
    expect(getRangeRecordIds(treeIds, treeIds[0] ?? null, treeIds[2] ?? '')).toEqual(treeIds.slice(0, 3));
    expect(getRangeRecordIds(treeIds, 'missing', treeIds[2] ?? '')).toEqual([treeIds[2]]);
  });

  it('reports selection state for group controls', () => {
    const ids = ['a', 'b', 'c'];

    expect(getSelectionState(ids, new Set())).toBe('none');
    expect(getSelectionState(ids, new Set(['a']))).toBe('partial');
    expect(getSelectionState(ids, new Set(ids))).toBe('all');
    expect(getSelectionState([], new Set(ids))).toBe('none');
  });

  it('uses collapsed tree visibility for range order but filtered records for folder scope', () => {
    const records = entriesToRecords([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/Scripts/Player.cs',
        asset: encoder.encode('class Player {}'),
      },
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: 'Assets/Textures/Icon.png',
        asset: encoder.encode('png'),
      },
    ], []);

    const collapsedRows = buildTreeRows(records, new Set(['Assets']));
    const folderIds = getFolderRecordIds(records, 'Assets');

    expect(getTreeFileRecordIds(collapsedRows)).toEqual([]);
    expect(folderIds).toHaveLength(2);
  });

  it('detects native preview kinds', () => {
    expect(getPreviewKind('Assets/Image.png')).toBe('image');
    expect(getPreviewKind('Assets/Manual.pdf')).toBe('pdf');
    expect(getPreviewKind('Assets/Sound.wav')).toBe('audio');
    expect(getPreviewKind('Assets/Movie.mp4')).toBe('video');
    expect(getPreviewKind('Assets/Data.asset')).toBe('text');
    expect(getPreviewKind('Assets/Graph.shadergraph')).toBe('text');
    expect(getPreviewKind('Assets/Input.inputactions')).toBe('text');
    expect(getPreviewKind('Assets/Layout.uxml')).toBe('text');
    expect(getPreviewKind('Assets/Theme.tss')).toBe('text');
    expect(getPreviewKind('Assets/Data.bytes', new Uint8Array([0, 1, 2]))).toBe('unsupported');
  });

  it('maps Unity text assets to Shiki languages', () => {
    for (const extension of [
      'meta',
      'unity',
      'prefab',
      'asset',
      'mat',
      'anim',
      'controller',
      'overrideController',
      'physicMaterial',
      'physicsMaterial2D',
      'playable',
      'mask',
      'brush',
      'flare',
      'fontsettings',
      'guiskin',
      'giparams',
      'renderTexture',
      'spriteatlas',
      'spriteatlasv2',
      'terrainlayer',
      'mixer',
      'shadervariants',
      'preset',
      'lighting',
      'dwlt',
      'vfx',
      'vfxblock',
      'vfxoperator',
    ]) {
      expect(getSyntaxLanguage(`Assets/File.${extension}`)).toBe('yaml');
    }

    for (const extension of ['asmdef', 'asmref', 'inputactions', 'shadergraph', 'shadersubgraph']) {
      expect(getSyntaxLanguage(`Assets/File.${extension}`)).toBe('json');
    }

    expect(getSyntaxLanguage('Assets/Layout.uxml')).toBe('xml');
    expect(getSyntaxLanguage('Assets/Styles.uss')).toBe('css');
    expect(getSyntaxLanguage('Assets/Styles.tss')).toBe('css');
    expect(getSyntaxLanguage('Assets/Script.CS')).toBe('csharp');
    expect(getSyntaxLanguage('Assets/Unknown.txt')).toBe('text');
  });

  it('routes duplicate-guid diagnostic to the asset record', () => {
    const entries: UnityPackageEntry[] = [
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/A.prefab',
        asset: encoder.encode('prefab'),
        meta: encoder.encode('meta'),
      },
    ];
    const diagnostics: UnityPackageParseDiagnostic[] = [
      {
        code: 'duplicate-guid',
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        path: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/pathname',
        message: 'GUID appears more than once in the archive.',
      },
    ];

    const records = entriesToRecords(entries, diagnostics);
    const assetRecord = records.find(r => r.virtualPath === 'Assets/A.prefab');
    const metaRecord = records.find(r => r.virtualPath === 'Assets/A.prefab.meta');

    expect(assetRecord?.diagnostics).toHaveLength(1);
    expect(assetRecord?.diagnostics[0]?.code).toBe('duplicate-guid');
    expect(metaRecord?.diagnostics).toHaveLength(0);
  });

  it('routes asset-missing diagnostic to the meta record', () => {
    const entries: UnityPackageEntry[] = [
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: 'Assets/B.cs',
        asset: undefined,
        meta: encoder.encode('meta'),
      },
    ];
    const diagnostics: UnityPackageParseDiagnostic[] = [
      {
        code: 'asset-missing',
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        path: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/asset',
        message: 'Entry has a pathname and meta but no asset file.',
      },
    ];

    const records = entriesToRecords(entries, diagnostics);
    // No asset record exists; only meta record is created
    const metaRecord = records.find(r => r.virtualPath === 'Assets/B.cs.meta');

    expect(records).toHaveLength(1);
    expect(metaRecord?.diagnostics).toHaveLength(1);
    expect(metaRecord?.diagnostics[0]?.code).toBe('asset-missing');
  });

  it('routes meta-missing diagnostic to the asset record', () => {
    const entries: UnityPackageEntry[] = [
      {
        guid: 'cccccccccccccccccccccccccccccccc',
        pathname: 'Assets/C.png',
        asset: encoder.encode('png'),
        meta: undefined,
      },
    ];
    const diagnostics: UnityPackageParseDiagnostic[] = [
      {
        code: 'meta-missing',
        guid: 'cccccccccccccccccccccccccccccccc',
        path: 'cccccccccccccccccccccccccccccccc/asset.meta',
        message: 'Entry has a pathname and asset but no asset.meta or metaData file.',
      },
    ];

    const records = entriesToRecords(entries, diagnostics);
    // No meta record exists; only asset record is created
    const assetRecord = records.find(r => r.virtualPath === 'Assets/C.png');

    expect(records).toHaveLength(1);
    expect(assetRecord?.diagnostics).toHaveLength(1);
    expect(assetRecord?.diagnostics[0]?.code).toBe('meta-missing');
  });

  it('routes zero-byte-asset diagnostic to the asset record', () => {
    const entries: UnityPackageEntry[] = [
      {
        guid: 'dddddddddddddddddddddddddddddddd',
        pathname: 'Assets/D.bytes',
        asset: new Uint8Array(0),
        meta: encoder.encode('meta'),
      },
    ];
    const diagnostics: UnityPackageParseDiagnostic[] = [
      {
        code: 'zero-byte-asset',
        guid: 'dddddddddddddddddddddddddddddddd',
        path: 'dddddddddddddddddddddddddddddddd/asset',
        message: 'Asset file is present but has zero bytes.',
      },
    ];

    const records = entriesToRecords(entries, diagnostics);
    const assetRecord = records.find(r => r.virtualPath === 'Assets/D.bytes');
    const metaRecord = records.find(r => r.virtualPath === 'Assets/D.bytes.meta');

    expect(assetRecord?.diagnostics).toHaveLength(1);
    expect(assetRecord?.diagnostics[0]?.code).toBe('zero-byte-asset');
    expect(metaRecord?.diagnostics).toHaveLength(0);
  });

  it('routes oversized-entry-name diagnostic to asset when asset exists, meta otherwise', () => {
    const longName = 'A'.repeat(201);
    const entriesWithAsset: UnityPackageEntry[] = [
      {
        guid: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        pathname: `Assets/${longName}.cs`,
        asset: encoder.encode('code'),
        meta: encoder.encode('meta'),
      },
    ];
    const diagWithAsset: UnityPackageParseDiagnostic[] = [
      {
        code: 'oversized-entry-name',
        guid: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        path: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/pathname',
        message: `Pathname exceeds 200 characters (${longName.length + 13}).`,
      },
    ];

    const recordsWithAsset = entriesToRecords(entriesWithAsset, diagWithAsset);
    const assetRecord = recordsWithAsset.find(r => !r.virtualPath.endsWith('.meta'));
    const metaRecord = recordsWithAsset.find(r => r.virtualPath.endsWith('.meta'));

    expect(assetRecord?.diagnostics).toHaveLength(1);
    expect(assetRecord?.diagnostics[0]?.code).toBe('oversized-entry-name');
    expect(metaRecord?.diagnostics).toHaveLength(0);

    // Fallback: no asset present, only meta
    const entriesMetaOnly: UnityPackageEntry[] = [
      {
        guid: 'ffffffffffffffffffffffffffffffff',
        pathname: `Assets/${longName}.cs`,
        asset: undefined,
        meta: encoder.encode('meta'),
      },
    ];
    const diagMetaOnly: UnityPackageParseDiagnostic[] = [
      {
        code: 'oversized-entry-name',
        guid: 'ffffffffffffffffffffffffffffffff',
        path: 'ffffffffffffffffffffffffffffffff/pathname',
        message: `Pathname exceeds 200 characters (${longName.length + 13}).`,
      },
    ];

    const recordsMetaOnly = entriesToRecords(entriesMetaOnly, diagMetaOnly);
    const metaOnlyRecord = recordsMetaOnly.find(r => r.virtualPath.endsWith('.meta'));

    expect(recordsMetaOnly).toHaveLength(1);
    expect(metaOnlyRecord?.diagnostics).toHaveLength(1);
    expect(metaOnlyRecord?.diagnostics[0]?.code).toBe('oversized-entry-name');
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
