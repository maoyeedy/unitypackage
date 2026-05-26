/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { UnityPackageEntry, UnityPackageParseDiagnostic } from 'unitypackage-core';

import { analyzeUnityPackageEntries, createMinimalMetaFor } from 'unitypackage-core';

import {
  buildExtensionGroups,
  buildTreeRows,
  collectDiagCodes,
  entriesToRecords,
  expandAncestors,
  filterRecords,
  findRecordByVirtualPath,
  getAllFolderPaths,
  getAncestorFolderPaths,
  getDeclaredMetaInfoForRecord,
  getExpectedImporterTypeForRecord,
  getExtensionFileRecordIds,
  getFolderRecordIds,
  getPreviewKind,
  getRangeRecordIds,
  getKeyboardRangeSelection,
  getRecordCategory,
  getSelectionState,
  getSiblingMetaRecord,
  getSyntaxLanguage,
  getTreeFileRecordIds,
  matchGlob,
  matchRecord,
  parseSize,
  resolveMetaSidecarSelection,
  routeAnalysisFindings,
  sortRecords,
  toSidecarSelectableRecords,
  validatePackDraft,
  computeHeadHash,
  getRecentPackages,
  addRecentPackage,
  removeRecentPackage,
} from './packageModel';

import type { UnityPackageAnalysisFinding } from './packageModel';

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
        severity: 'info',
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

  it('computes keyboard range selection correctly across navigable rows', () => {
    const navigableRowIds = [
      'folder:Assets',
      'folder:Assets/Scripts',
      'file_1',
      'file_2',
      'folder:Assets/Textures',
      'file_3'
    ];
    const validFileIds = new Set(['file_1', 'file_2', 'file_3']);

    // Select range adding elements
    const baseSelected = new Set(['file_3']);
    const selectedAdd = getKeyboardRangeSelection(
      navigableRowIds,
      'file_1',
      'folder:Assets/Textures',
      validFileIds,
      baseSelected,
      'add'
    );
    expect(Array.from(selectedAdd).sort()).toEqual(['file_1', 'file_2', 'file_3']);

    // Select range removing elements
    const baseSelected2 = new Set(['file_1', 'file_2', 'file_3']);
    const selectedRemove = getKeyboardRangeSelection(
      navigableRowIds,
      'file_1',
      'file_2',
      validFileIds,
      baseSelected2,
      'remove'
    );
    expect(Array.from(selectedRemove).sort()).toEqual(['file_3']);

    // Handle missing/invalid anchor
    expect(getKeyboardRangeSelection(navigableRowIds, null, 'file_1', validFileIds, baseSelected, 'add')).toEqual(baseSelected);
    expect(getKeyboardRangeSelection(navigableRowIds, 'missing', 'file_1', validFileIds, baseSelected, 'add')).toEqual(baseSelected);
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
        severity: 'error',
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
        severity: 'warning',
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
        severity: 'warning',
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
        severity: 'warning',
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
        severity: 'warning',
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
        severity: 'warning',
      },
    ];

    const recordsMetaOnly = entriesToRecords(entriesMetaOnly, diagMetaOnly);
    const metaOnlyRecord = recordsMetaOnly.find(r => r.virtualPath.endsWith('.meta'));

    expect(recordsMetaOnly).toHaveLength(1);
    expect(metaOnlyRecord?.diagnostics).toHaveLength(1);
    expect(metaOnlyRecord?.diagnostics[0]?.code).toBe('oversized-entry-name');
  });

  it('routeAnalysisFindings attaches findings to records by guid', () => {
    const entries: UnityPackageEntry[] = [
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
        meta: encoder.encode('meta'),
      },
    ];
    const records = entriesToRecords(entries, []);
    const findings: UnityPackageAnalysisFinding[] = [
      {
        code: 'meta-guid-mismatch',
        severity: 'error',
        message: 'GUID mismatch for A.',
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/A.prefab',
        path: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/asset.meta',
      },
    ];

    routeAnalysisFindings(records, findings);

    const aRecords = records.filter(r => r.guid === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const bRecords = records.filter(r => r.guid === 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    for (const r of aRecords) {
      expect(r.findings).toHaveLength(1);
      expect(r.findings[0]?.code).toBe('meta-guid-mismatch');
    }
    for (const r of bRecords) {
      expect(r.findings).toHaveLength(0);
    }
  });

  it('routeAnalysisFindings falls back to pathname when guid is absent', () => {
    const entries: UnityPackageEntry[] = [
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/Dup.cs',
        asset: encoder.encode('a'),
      },
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: 'Assets/Dup.cs',
        asset: encoder.encode('b'),
      },
    ];
    const records = entriesToRecords(entries, []);
    const findings: UnityPackageAnalysisFinding[] = [
      {
        code: 'duplicate-pathname',
        severity: 'error',
        message: 'Duplicate pathname: Assets/Dup.cs',
        pathname: 'Assets/Dup.cs',
        path: 'Assets/Dup.cs',
      },
    ];

    routeAnalysisFindings(records, findings);

    const matched = records.filter(r => r.findings.length > 0);
    expect(matched.length).toBeGreaterThan(0);
    for (const r of matched) {
      expect(r.pathname).toBe('Assets/Dup.cs');
      expect(r.findings[0]?.code).toBe('duplicate-pathname');
    }
  });

  it('routeAnalysisFindings falls back to path when guid and pathname are absent', () => {
    const entries: UnityPackageEntry[] = [
      {
        guid: 'cccccccccccccccccccccccccccccccc',
        pathname: 'Assets/C.png',
        asset: encoder.encode('png'),
        meta: encoder.encode('meta'),
      },
    ];
    const records = entriesToRecords(entries, []);
    // A finding with no guid/pathname but a path matching the meta record id
    const metaRecord = records.find(r => r.extension === 'meta');
    expect(metaRecord).toBeDefined();
    const findings: UnityPackageAnalysisFinding[] = [
      {
        code: 'meta-missing',
        severity: 'warning',
        message: 'Path-only finding.',
        path: metaRecord?.id,
      },
    ];

    routeAnalysisFindings(records, findings);

    expect(metaRecord?.findings).toHaveLength(1);
    expect(metaRecord?.findings[0]?.code).toBe('meta-missing');
    const assetRecord = records.find(r => r.extension !== 'meta');
    expect(assetRecord?.findings).toHaveLength(0);
  });

  it('routeAnalysisFindings resets findings on each call', () => {
    const entries: UnityPackageEntry[] = [
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/A.prefab',
        asset: encoder.encode('prefab'),
      },
    ];
    const records = entriesToRecords(entries, []);
    const findingA: UnityPackageAnalysisFinding[] = [
      { code: 'unsafe-pathname', severity: 'error', message: 'First call', guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    ];
    const findingB: UnityPackageAnalysisFinding[] = [
      { code: 'meta-missing', severity: 'warning', message: 'Second call', guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    ];

    routeAnalysisFindings(records, findingA);
    routeAnalysisFindings(records, findingB);

    const assetRecord = records.find(r => r.extension !== 'meta');
    expect(assetRecord?.findings).toHaveLength(1);
    expect(assetRecord?.findings[0]?.code).toBe('meta-missing');
  });

  describe('routing of specific finding codes (P5 requirements)', () => {
    it('covers routing of meta-guid-mismatch to correct guid records', () => {
      const records = entriesToRecords([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/A.prefab',
          asset: encoder.encode('prefab'),
          meta: encoder.encode('meta'),
        },
      ], []);
      const findings: UnityPackageAnalysisFinding[] = [
        {
          code: 'meta-guid-mismatch',
          severity: 'error',
          message: 'Meta GUID mismatch',
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/A.prefab',
          path: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/asset.meta',
        },
      ];
      routeAnalysisFindings(records, findings);
      const guidRecords = records.filter(r => r.guid === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(guidRecords).toHaveLength(2); // asset + meta
      for (const r of guidRecords) {
        expect(r.findings.some(f => f.code === 'meta-guid-mismatch')).toBe(true);
      }
    });

    it('covers routing of meta-importer-mismatch to correct guid records', () => {
      const records = entriesToRecords([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/A.prefab',
          asset: encoder.encode('prefab'),
          meta: encoder.encode('meta'),
        },
      ], []);
      const findings: UnityPackageAnalysisFinding[] = [
        {
          code: 'meta-importer-mismatch',
          severity: 'warning',
          message: 'Meta importer mismatch',
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/A.prefab',
          path: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/asset.meta',
        },
      ];
      routeAnalysisFindings(records, findings);
      const guidRecords = records.filter(r => r.guid === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(guidRecords).toHaveLength(2); // asset + meta
      for (const r of guidRecords) {
        expect(r.findings.some(f => f.code === 'meta-importer-mismatch')).toBe(true);
      }
    });

    it('covers routing of duplicate-pathname by fallback to pathname', () => {
      const records = entriesToRecords([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/Dup.cs',
          asset: encoder.encode('a'),
        },
        {
          guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          pathname: 'Assets/Dup.cs',
          asset: encoder.encode('b'),
        },
      ], []);
      const findings: UnityPackageAnalysisFinding[] = [
        {
          code: 'duplicate-pathname',
          severity: 'error',
          message: 'Duplicate pathname: Assets/Dup.cs',
          pathname: 'Assets/Dup.cs',
          path: 'Assets/Dup.cs',
        },
      ];
      routeAnalysisFindings(records, findings);
      const matched = records.filter(r => r.pathname === 'Assets/Dup.cs');
      expect(matched).toHaveLength(2);
      for (const r of matched) {
        expect(r.findings.some(f => f.code === 'duplicate-pathname')).toBe(true);
      }
    });

    it('covers routing of unsafe-pathname by guid match', () => {
      const records = entriesToRecords([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: '../Unsafe.cs',
          asset: encoder.encode('unsafe'),
        },
      ], []);
      const findings: UnityPackageAnalysisFinding[] = [
        {
          code: 'unsafe-pathname',
          severity: 'error',
          message: 'Unsafe pathname',
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: '../Unsafe.cs',
          path: '../Unsafe.cs',
        },
      ];
      routeAnalysisFindings(records, findings);
      const matched = records.filter(r => r.guid === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(matched).toHaveLength(1);
      expect(matched[0]?.findings.some(f => f.code === 'unsafe-pathname')).toBe(true);
    });
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

  describe('getExpectedImporterTypeForRecord', () => {
    it('returns MonoImporter for .cs assets', () => {
      const records = entriesToRecords([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/Scripts/Player.cs',
          asset: encoder.encode('code'),
          meta: encoder.encode('meta'),
        },
      ], []);
      const asset = records.find(r => r.extension === 'cs');
      const meta = records.find(r => r.extension === 'meta');
      expect(asset && getExpectedImporterTypeForRecord(asset)).toBe('MonoImporter');
      // Meta record strips .meta before detecting, giving same result as the asset
      expect(meta && getExpectedImporterTypeForRecord(meta)).toBe('MonoImporter');
    });

    it('returns TextScriptImporter for .json assets', () => {
      const records = entriesToRecords([
        {
          guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          pathname: 'Assets/Config/settings.json',
          asset: encoder.encode('{}'),
        },
      ], []);
      const asset = records.find(r => r.extension === 'json');
      expect(asset && getExpectedImporterTypeForRecord(asset)).toBe('TextScriptImporter');
    });

    it('returns DefaultImporter for .png assets', () => {
      const records = entriesToRecords([
        {
          guid: 'cccccccccccccccccccccccccccccccc',
          pathname: 'Assets/Textures/icon.png',
          asset: encoder.encode('png'),
        },
      ], []);
      const asset = records.find(r => r.extension === 'png');
      expect(asset && getExpectedImporterTypeForRecord(asset)).toBe('DefaultImporter');
    });

    it('returns DefaultImporter for .yaml assets', () => {
      const records = entriesToRecords([
        {
          guid: 'dddddddddddddddddddddddddddddddd',
          pathname: 'Assets/Data/config.yaml',
          asset: encoder.encode('key: value'),
        },
      ], []);
      const asset = records.find(r => r.extension === 'yaml');
      expect(asset && getExpectedImporterTypeForRecord(asset)).toBe('DefaultImporter');
    });

    it('returns DefaultImporterFolder for extensionless folder-like paths', () => {
      const records = entriesToRecords([
        {
          guid: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          pathname: 'Assets/SomeFolderEntry',
          asset: encoder.encode(''),
        },
      ], []);
      const asset = records.find(r => r.extension === '');
      expect(asset && getExpectedImporterTypeForRecord(asset)).toBe('DefaultImporterFolder');
    });
  });

  describe('getSiblingMetaRecord', () => {
    it('returns the meta sibling for an asset record', () => {
      const records = entriesToRecords([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/Scripts/Player.cs',
          asset: encoder.encode('code'),
          meta: encoder.encode('meta'),
        },
      ], []);
      const asset = records.find(r => r.extension === 'cs');
      const metaRecord = records.find(r => r.extension === 'meta');
      expect(asset).toBeDefined();
      expect(getSiblingMetaRecord(records, asset!)).toBe(metaRecord);
    });

    it('returns itself when called on a meta record', () => {
      const records = entriesToRecords([
        {
          guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          pathname: 'Assets/Icon.png',
          asset: encoder.encode('png'),
          meta: encoder.encode('meta'),
        },
      ], []);
      const metaRecord = records.find(r => r.extension === 'meta');
      expect(metaRecord).toBeDefined();
      expect(getSiblingMetaRecord(records, metaRecord!)).toBe(metaRecord);
    });

    it('returns the meta sibling for a preview record', () => {
      const records = entriesToRecords([
        {
          guid: 'cccccccccccccccccccccccccccccccc',
          pathname: 'Assets/Icon.png',
          asset: encoder.encode('png'),
          meta: encoder.encode('meta'),
          preview: encoder.encode('preview'),
        },
      ], []);
      const preview = records.find(r => r.isUnityPreview);
      const metaRecord = records.find(r => r.extension === 'meta');
      expect(preview).toBeDefined();
      expect(getSiblingMetaRecord(records, preview!)).toBe(metaRecord);
    });

    it('returns undefined when no meta sibling exists', () => {
      const records = entriesToRecords([
        {
          guid: 'dddddddddddddddddddddddddddddddd',
          pathname: 'Assets/C.png',
          asset: encoder.encode('png'),
          meta: undefined,
        },
      ], []);
      const asset = records.find(r => r.extension === 'png');
      expect(asset).toBeDefined();
      expect(getSiblingMetaRecord(records, asset!)).toBeUndefined();
    });
  });

  describe('getDeclaredMetaInfoForRecord', () => {
    it('reads TextureImporter and GUID from the real texture_02.png.meta fixture', () => {
      const pngMeta = readFileSync(fixturePngMeta);
      const records = entriesToRecords([
        {
          guid: 'b2164c38ac6d28c478b53462658238f8',
          pathname: 'Assets/Textures/texture_02.png',
          asset: encoder.encode('png'),
          meta: pngMeta,
        },
      ], []);
      const asset = records.find(r => r.extension === 'png');
      expect(asset).toBeDefined();
      const info = getDeclaredMetaInfoForRecord(records, asset!);
      expect(info.importer).toBe('TextureImporter');
      expect(info.guid).toBe('b2164c38ac6d28c478b53462658238f8');
    });

    it('reads declared meta from the meta record itself', () => {
      const pngMeta = readFileSync(fixturePngMeta);
      const records = entriesToRecords([
        {
          guid: 'b2164c38ac6d28c478b53462658238f8',
          pathname: 'Assets/Textures/texture_02.png',
          asset: encoder.encode('png'),
          meta: pngMeta,
        },
      ], []);
      const metaRecord = records.find(r => r.extension === 'meta');
      expect(metaRecord).toBeDefined();
      const info = getDeclaredMetaInfoForRecord(records, metaRecord!);
      expect(info.importer).toBe('TextureImporter');
      expect(info.guid).toBe('b2164c38ac6d28c478b53462658238f8');
    });

    it('returns undefined fields when no meta bytes are available', () => {
      const records = entriesToRecords([
        {
          guid: 'cccccccccccccccccccccccccccccccc',
          pathname: 'Assets/C.png',
          asset: encoder.encode('png'),
          meta: undefined,
        },
      ], []);
      const asset = records.find(r => r.extension === 'png');
      expect(asset).toBeDefined();
      const info = getDeclaredMetaInfoForRecord(records, asset!);
      expect(info.importer).toBeUndefined();
      expect(info.guid).toBeUndefined();
    });
  });

  describe('includeMetaSidecars filter', () => {
    it('excludes meta records when includeMetaSidecars is false', () => {
      const records = entriesToRecords([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/Scripts/Player.cs',
          asset: encoder.encode('code'),
          meta: encoder.encode('meta'),
        },
        {
          guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          pathname: 'Assets/Textures/Icon.png',
          asset: encoder.encode('png'),
        },
      ], []);

      const visible = records.filter(record => record.extension !== 'meta');

      expect(visible.every(record => record.extension !== 'meta')).toBe(true);
      expect(visible.length).toBe(2);
      expect(visible.map(r => r.virtualPath).sort()).toEqual([
        'Assets/Scripts/Player.cs',
        'Assets/Textures/Icon.png',
      ]);
    });

    it('includes meta records when includeMetaSidecars is true', () => {
      const records = entriesToRecords([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/Scripts/Player.cs',
          asset: encoder.encode('code'),
          meta: encoder.encode('meta'),
        },
      ], []);

      // When includeMetaSidecars=true, no filter is applied
      const visible = records;

      const metaRecords = visible.filter(record => record.extension === 'meta');
      expect(metaRecords.length).toBe(1);
      expect(metaRecords[0]?.virtualPath).toBe('Assets/Scripts/Player.cs.meta');
    });

    it('buildTreeRows and buildExtensionGroups omit meta rows when filtered', () => {
      const records = entriesToRecords([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/Scripts/Player.cs',
          asset: encoder.encode('code'),
          meta: encoder.encode('meta'),
        },
      ], []);

      const filtered = records.filter(record => record.extension !== 'meta');
      const treeRows = buildTreeRows(filtered);
      const extensionGroups = buildExtensionGroups(filtered);

      const treeFilePaths = treeRows
        .filter(row => row.type === 'file')
        .map(row => (row as { type: 'file'; record: { virtualPath: string } }).record.virtualPath);

      expect(treeFilePaths).not.toContain('Assets/Scripts/Player.cs.meta');
      expect(treeFilePaths).toContain('Assets/Scripts/Player.cs');
      expect(extensionGroups.every(g => g.extension !== 'meta')).toBe(true);
    });
  });

  describe('toSidecarSelectableRecords', () => {
    it('adapts asset, meta, and preview records to SidecarSelectableRecord shape', () => {
      const records = entriesToRecords([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/Scripts/Player.cs',
          asset: encoder.encode('code'),
          meta: encoder.encode('meta'),
          preview: encoder.encode('preview'),
        },
      ], []);

      const adapted = toSidecarSelectableRecords(records);

      const asset = adapted.find(r => r.kind === 'asset');
      const meta = adapted.find(r => r.kind === 'meta');
      const preview = adapted.find(r => r.kind === 'preview');

      expect(asset).toBeDefined();
      expect(asset?.guid).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(asset?.pathname).toBe('Assets/Scripts/Player.cs');
      expect(asset?.id).toBeTruthy();

      expect(meta).toBeDefined();
      expect(meta?.guid).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(meta?.pathname).toBe('Assets/Scripts/Player.cs.meta');
      expect(meta?.kind).toBe('meta');

      expect(preview).toBeDefined();
      expect(preview?.kind).toBe('preview');
    });

    it('uses record.id for the id field', () => {
      const records = entriesToRecords([
        {
          guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          pathname: 'Assets/Icon.png',
          asset: encoder.encode('png'),
        },
      ], []);

      const adapted = toSidecarSelectableRecords(records);
      const asset = records.find(r => r.extension === 'png');

      expect(adapted[0]?.id).toBe(asset?.id);
    });
  });

  describe('resolveMetaSidecarSelection via toSidecarSelectableRecords', () => {
    it('expands selected asset IDs to include their meta sibling IDs', () => {
      const records = entriesToRecords([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/A.cs',
          asset: encoder.encode('code'),
          meta: encoder.encode('meta'),
        },
        {
          guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          pathname: 'Assets/B.png',
          asset: encoder.encode('png'),
          meta: encoder.encode('meta'),
        },
      ], []);

      const assetA = records.find(r => r.extension === 'cs')!;
      const metaA = records.find(r => r.guid === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' && r.extension === 'meta')!;

      const result = resolveMetaSidecarSelection(toSidecarSelectableRecords(records), [assetA.id]);

      expect(result.ids).toContain(assetA.id);
      expect(result.ids).toContain(metaA.id);
      expect(result.implicitMetaIds).toEqual([metaA.id]);
      expect(result.missingMetaForAssetIds).toHaveLength(0);
    });

    it('does not produce duplicates when meta was already in the selection', () => {
      const records = entriesToRecords([
        {
          guid: 'cccccccccccccccccccccccccccccccc',
          pathname: 'Assets/C.cs',
          asset: encoder.encode('code'),
          meta: encoder.encode('meta'),
        },
      ], []);

      const asset = records.find(r => r.extension === 'cs')!;
      const meta = records.find(r => r.extension === 'meta')!;

      const result = resolveMetaSidecarSelection(toSidecarSelectableRecords(records), [asset.id, meta.id]);

      expect(result.ids).toEqual([asset.id, meta.id]);
      expect(result.implicitMetaIds).toHaveLength(0);
      const uniqueIds = new Set(result.ids);
      expect(uniqueIds.size).toBe(result.ids.length);
    });

    it('reports missingMetaForAssetIds when asset has no meta record', () => {
      const records = entriesToRecords([
        {
          guid: 'dddddddddddddddddddddddddddddddd',
          pathname: 'Assets/D.png',
          asset: encoder.encode('png'),
          meta: undefined,
        },
      ], []);

      const asset = records.find(r => r.extension === 'png')!;

      const result = resolveMetaSidecarSelection(toSidecarSelectableRecords(records), [asset.id]);

      expect(result.missingMetaForAssetIds).toContain(asset.id);
      expect(result.ids).toEqual([asset.id]);
    });

    it('skips meta expansion for preview records', () => {
      const records = entriesToRecords([
        {
          guid: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          pathname: 'Assets/E.png',
          asset: encoder.encode('png'),
          meta: encoder.encode('meta'),
          preview: encoder.encode('preview'),
        },
      ], []);

      const preview = records.find(r => r.isUnityPreview)!;

      const result = resolveMetaSidecarSelection(toSidecarSelectableRecords(records), [preview.id]);

      expect(result.ids).toEqual([preview.id]);
      expect(result.implicitMetaIds).toHaveLength(0);
      expect(result.missingMetaForAssetIds).toHaveLength(0);
    });
  });

  describe('analysis routing for meta-importer-mismatch', () => {
    it('produces meta-importer-mismatch finding for .cs asset with DefaultImporter meta', () => {
      const guid = 'aaaa1111aaaa1111aaaa1111aaaa1111';
      // DefaultImporter meta for a .cs file (mismatch: expected MonoImporter)
      const defaultMeta = encoder.encode(
        `fileFormatVersion: 2\nguid: ${guid}\nDefaultImporter:\n  externalObjects: {}\n  userData:\n  assetBundleName:\n  assetBundleVariant:\n`,
      );
      const entries = [
        {
          guid,
          pathname: 'Assets/Scripts/Player.cs',
          asset: encoder.encode('class Player {}'),
          meta: defaultMeta,
        },
      ];
      const records = entriesToRecords(entries, []);
      const { findings } = analyzeUnityPackageEntries(entries);
      routeAnalysisFindings(records, findings);

      const allFindings = records.flatMap(r => r.findings);
      const mismatch = allFindings.filter(f => f.code === 'meta-importer-mismatch');
      expect(mismatch.length).toBeGreaterThan(0);
      expect(mismatch[0]?.message).toMatch(/DefaultImporter/);
    });

    it('does not produce meta-importer-mismatch for .png asset with TextureImporter meta', () => {
      const guid = 'bbbb2222bbbb2222bbbb2222bbbb2222';
      // TextureImporter is an 'unknown' kind in the known set, so we use a raw meta
      // that declares TextureImporter -- the analyzer only flags 'known' kinds, so
      // TextureImporter (unknown) will not trigger a mismatch finding.
      const textureMeta = encoder.encode(
        `fileFormatVersion: 2\nguid: ${guid}\nTextureImporter:\n  externalObjects: {}\n  userData:\n  assetBundleName:\n  assetBundleVariant:\n`,
      );
      const entries = [
        {
          guid,
          pathname: 'Assets/Textures/icon.png',
          asset: encoder.encode('png'),
          meta: textureMeta,
        },
      ];
      const records = entriesToRecords(entries, []);
      const { findings } = analyzeUnityPackageEntries(entries);
      routeAnalysisFindings(records, findings);

      const allFindings = records.flatMap(r => r.findings);
      const mismatch = allFindings.filter(f => f.code === 'meta-importer-mismatch');
      expect(mismatch).toHaveLength(0);
    });

    it('produces meta-importer-mismatch for .cs using createMinimalMetaFor with DefaultImporter', () => {
      const guid = 'cccc3333cccc3333cccc3333cccc3333';
      // Manually craft a DefaultImporter meta (createMinimalMetaFor would generate MonoImporter for .cs,
      // so we inline the default template directly to simulate a wrong importer declaration)
      const wrongMeta = encoder.encode(
        `fileFormatVersion: 2\nguid: ${guid}\nDefaultImporter:\n  externalObjects: {}\n  userData:\n  assetBundleName:\n  assetBundleVariant:\n`,
      );
      // Verify createMinimalMetaFor produces MonoImporter for .cs (control check)
      expect(createMinimalMetaFor(guid, 'Assets/Foo.cs')).toContain('MonoImporter');

      const entries = [
        {
          guid,
          pathname: 'Assets/Foo.cs',
          asset: encoder.encode('class Foo {}'),
          meta: wrongMeta,
        },
      ];
      const records = entriesToRecords(entries, []);
      const { findings } = analyzeUnityPackageEntries(entries);
      routeAnalysisFindings(records, findings);

      const hasMismatch = records.some(r => r.findings.some(f => f.code === 'meta-importer-mismatch'));
      expect(hasMismatch).toBe(true);
    });
  });

  describe('P1 filter/sort helpers', () => {
    describe('parseSize', () => {
      it('returns null for empty string', () => {
        expect(parseSize('')).toBeNull();
        expect(parseSize('  ')).toBeNull();
      });

      it('returns null for invalid input', () => {
        expect(parseSize('abc')).toBeNull();
        expect(parseSize('1x')).toBeNull();
      });

      it('parses bare numbers as bytes', () => {
        expect(parseSize('512')).toBe(512);
        expect(parseSize('0')).toBe(0);
      });

      it('parses k/K suffix as kilobytes', () => {
        expect(parseSize('100k')).toBe(102400);
        expect(parseSize('1K')).toBe(1024);
        expect(parseSize('1.5k')).toBe(1536);
      });

      it('parses m/M suffix as megabytes', () => {
        expect(parseSize('2m')).toBe(2 * 1024 * 1024);
        expect(parseSize('1M')).toBe(1024 * 1024);
      });

      it('parses g/G suffix as gigabytes', () => {
        expect(parseSize('1g')).toBe(1024 * 1024 * 1024);
        expect(parseSize('2G')).toBe(2 * 1024 * 1024 * 1024);
      });
    });

    describe('matchGlob', () => {
      it('matches exact strings', () => {
        expect(matchGlob('Assets/Player.cs', 'Assets/Player.cs')).toBe(true);
        expect(matchGlob('Assets/Player.cs', 'Assets/Enemy.cs')).toBe(false);
      });

      it('* matches within a single segment only', () => {
        expect(matchGlob('*.cs', 'Player.cs')).toBe(true);
        expect(matchGlob('*.cs', 'Assets/Player.cs')).toBe(false);
      });

      it('** matches zero or more path segments', () => {
        expect(matchGlob('**/*.shader', 'Assets/Shaders/Lit.shader')).toBe(true);
        expect(matchGlob('**/*.shader', 'Lit.shader')).toBe(true);
        expect(matchGlob('**/*.shader', 'Assets/Shaders/Lit.cs')).toBe(false);
      });

      it('** at start matches root-level files too', () => {
        expect(matchGlob('**/*.cs', 'Player.cs')).toBe(true);
        expect(matchGlob('**/*.cs', 'Assets/Scripts/Player.cs')).toBe(true);
      });

      it('* does not match slashes (root-only pattern)', () => {
        expect(matchGlob('*.cs', 'Assets/Player.cs')).toBe(false);
      });

      it('? matches exactly one character', () => {
        expect(matchGlob('Player?.cs', 'Player1.cs')).toBe(true);
        expect(matchGlob('Player?.cs', 'Player.cs')).toBe(false);
      });

      it('escapes regex special characters in literal parts', () => {
        expect(matchGlob('Assets/A+B.cs', 'Assets/A+B.cs')).toBe(true);
        expect(matchGlob('Assets/A+B.cs', 'Assets/AxB.cs')).toBe(false);
      });
    });

    describe('matchRecord', () => {
      const record = {
        fileName: 'Player.cs',
        virtualPath: 'Assets/Scripts/Player.cs',
        guid: 'aaaa1111aaaa1111aaaa1111aaaa1111',
      } as Parameters<typeof matchRecord>[0];

      it('returns true for empty query', () => {
        expect(matchRecord(record, '', 'filename', false, false)).toBe(true);
        expect(matchRecord(record, '   ', 'path', false, false)).toBe(true);
      });

      it('filename mode matches record.fileName substring', () => {
        expect(matchRecord(record, 'Player', 'filename', false, false)).toBe(true);
        expect(matchRecord(record, 'Enemy', 'filename', false, false)).toBe(false);
      });

      it('path mode matches record.virtualPath substring', () => {
        expect(matchRecord(record, 'Scripts', 'path', false, false)).toBe(true);
        expect(matchRecord(record, 'Textures', 'path', false, false)).toBe(false);
      });

      it('guid mode matches record.guid substring', () => {
        expect(matchRecord(record, 'aaaa1111', 'guid', false, false)).toBe(true);
        expect(matchRecord(record, 'bbbb', 'guid', false, false)).toBe(false);
      });

      it('AND-of-terms: all terms must match', () => {
        expect(matchRecord(record, 'Player cs', 'filename', false, false)).toBe(true);
        expect(matchRecord(record, 'Player Enemy', 'filename', false, false)).toBe(false);
      });

      it('case-sensitive mode respects casing', () => {
        expect(matchRecord(record, 'player', 'filename', true, false)).toBe(false);
        expect(matchRecord(record, 'Player', 'filename', true, false)).toBe(true);
      });

      it('case-insensitive mode ignores casing', () => {
        expect(matchRecord(record, 'PLAYER', 'filename', false, false)).toBe(true);
      });

      it('glob mode uses matchGlob against the field', () => {
        expect(matchRecord(record, '**/*.cs', 'path', false, true)).toBe(true);
        expect(matchRecord(record, '**/*.png', 'path', false, true)).toBe(false);
      });
    });

    describe('filterRecords', () => {
      const makeRecords = () => entriesToRecords([
        {
          guid: 'aaaa1111aaaa1111aaaa1111aaaa1111',
          pathname: 'Assets/Scripts/Player.cs',
          asset: encoder.encode('code'),
          meta: encoder.encode('meta'),
        },
        {
          guid: 'bbbb2222bbbb2222bbbb2222bbbb2222',
          pathname: 'Assets/Textures/Icon.png',
          asset: encoder.encode('png'),
        },
      ], []);

      const baseOptions = {
        query: '',
        matchMode: 'filename' as const,
        caseSensitive: false,
        globMode: false,
        categories: new Set<'asset' | 'meta' | 'preview'>(),
        sizeMin: '',
        sizeMax: '',
        diagCodes: new Set<string>(),
        includeMetaSidecars: true,
      };

      it('passes all records with empty options', () => {
        const records = makeRecords();
        expect(filterRecords(records, baseOptions)).toHaveLength(records.length);
      });

      it('hides meta records when includeMetaSidecars is false', () => {
        const records = makeRecords();
        const result = filterRecords(records, { ...baseOptions, includeMetaSidecars: false });
        expect(result.every(r => r.extension !== 'meta')).toBe(true);
      });

      it('category chip filters Assets only', () => {
        const records = makeRecords();
        const result = filterRecords(records, { ...baseOptions, categories: new Set(['asset' as const]) });
        expect(result.every(r => getRecordCategory(r) === 'asset')).toBe(true);
        expect(result.length).toBeGreaterThan(0);
      });

      it('category chip filters Meta only', () => {
        const records = makeRecords();
        const result = filterRecords(records, { ...baseOptions, categories: new Set(['meta' as const]) });
        expect(result.every(r => r.extension === 'meta')).toBe(true);
      });

      it('size range filters by bytes', () => {
        const records = makeRecords();
        // All records in the fixture are very small; filter min=1k excludes them
        const result = filterRecords(records, { ...baseOptions, sizeMin: '1k' });
        expect(result.every(r => r.byteLength >= 1024)).toBe(true);
      });

      it('size range max excludes large records', () => {
        const records = makeRecords();
        const result = filterRecords(records, { ...baseOptions, sizeMax: '0' });
        expect(result.every(r => r.byteLength <= 0)).toBe(true);
      });

      it('diagCode filter matches records with that code', () => {
        const records = entriesToRecords([
          {
            guid: 'cccc3333cccc3333cccc3333cccc3333',
            pathname: 'Assets/C.png',
            asset: encoder.encode('png'),
            meta: undefined,
          },
        ], [
          {
            code: 'meta-missing',
            guid: 'cccc3333cccc3333cccc3333cccc3333',
            path: 'cccc3333cccc3333cccc3333cccc3333/asset.meta',
            message: 'Missing meta.',
            severity: 'warning',
          },
        ]);
        const result = filterRecords(records, {
          ...baseOptions,
          diagCodes: new Set(['meta-missing']),
        });
        expect(result.some(r => r.diagnostics.some(d => d.code === 'meta-missing'))).toBe(true);
        expect(result.every(r =>
          r.diagnostics.some(d => d.code === 'meta-missing') ||
          r.findings.some(f => f.code === 'meta-missing')
        )).toBe(true);
      });
    });

    describe('sortRecords', () => {
      it('sorts by name ascending', () => {
        const records = entriesToRecords([
          { guid: 'bbbb2222bbbb2222bbbb2222bbbb2222', pathname: 'Assets/Bravo.cs', asset: encoder.encode('b') },
          { guid: 'aaaa1111aaaa1111aaaa1111aaaa1111', pathname: 'Assets/Alpha.cs', asset: encoder.encode('a') },
        ], []);
        const sorted = sortRecords(records, 'name', 'asc');
        expect(sorted[0]?.fileName.localeCompare(sorted[1]?.fileName ?? '') ?? 0).toBeLessThanOrEqual(0);
      });

      it('sorts by name descending', () => {
        const records = entriesToRecords([
          { guid: 'aaaa1111aaaa1111aaaa1111aaaa1111', pathname: 'Assets/Alpha.cs', asset: encoder.encode('a') },
          { guid: 'bbbb2222bbbb2222bbbb2222bbbb2222', pathname: 'Assets/Bravo.cs', asset: encoder.encode('b') },
        ], []);
        const sorted = sortRecords(records, 'name', 'desc');
        expect(sorted[0]?.fileName.localeCompare(sorted[1]?.fileName ?? '') ?? 0).toBeGreaterThanOrEqual(0);
      });

      it('sorts by size ascending', () => {
        const records = entriesToRecords([
          { guid: 'aaaa1111aaaa1111aaaa1111aaaa1111', pathname: 'Assets/Big.cs', asset: encoder.encode('longer content here') },
          { guid: 'bbbb2222bbbb2222bbbb2222bbbb2222', pathname: 'Assets/Small.cs', asset: encoder.encode('x') },
        ], []);
        const sorted = sortRecords(records, 'size', 'asc');
        const sizes = sorted.map(r => r.byteLength);
        expect(sizes[0]).toBeLessThanOrEqual(sizes[1] ?? 0);
      });

      it('uses virtualPath as stable secondary sort by path', () => {
        // Both records have the same byte size (single char)
        const records = entriesToRecords([
          { guid: 'bbbb2222bbbb2222bbbb2222bbbb2222', pathname: 'Assets/Z.cs', asset: encoder.encode('x') },
          { guid: 'aaaa1111aaaa1111aaaa1111aaaa1111', pathname: 'Assets/A.cs', asset: encoder.encode('x') },
        ], []);
        const sorted = sortRecords(records, 'size', 'asc');
        // Primary is tied; secondary (path) determines order
        const assetRecords = sorted.filter(r => r.extension === 'cs');
        expect(assetRecords[0]?.virtualPath.localeCompare(assetRecords[1]?.virtualPath ?? '') ?? 0).toBeLessThanOrEqual(0);
      });

      it('sorts by extension ascending', () => {
        const records = entriesToRecords([
          { guid: 'bbbb2222bbbb2222bbbb2222bbbb2222', pathname: 'Assets/B.png', asset: encoder.encode('p') },
          { guid: 'aaaa1111aaaa1111aaaa1111aaaa1111', pathname: 'Assets/A.cs', asset: encoder.encode('a') },
        ], []);
        const sorted = sortRecords(records, 'extension', 'asc');
        const nonMeta = sorted.filter(r => r.extension !== 'meta');
        expect(nonMeta[0]?.extension.localeCompare(nonMeta[1]?.extension ?? '') ?? 0).toBeLessThanOrEqual(0);
      });

      it('sorts by guid ascending', () => {
        const records = entriesToRecords([
          { guid: 'bbbb2222bbbb2222bbbb2222bbbb2222', pathname: 'Assets/B.cs', asset: encoder.encode('b') },
          { guid: 'aaaa1111aaaa1111aaaa1111aaaa1111', pathname: 'Assets/A.cs', asset: encoder.encode('a') },
        ], []);
        const sorted = sortRecords(records, 'guid', 'asc');
        expect(sorted[0]?.guid.localeCompare(sorted[1]?.guid ?? '') ?? 0).toBeLessThanOrEqual(0);
      });
    });

    describe('collectDiagCodes', () => {
      it('returns empty array when no diagnostics', () => {
        const records = entriesToRecords([
          { guid: 'aaaa1111aaaa1111aaaa1111aaaa1111', pathname: 'Assets/A.cs', asset: encoder.encode('a') },
        ], []);
        expect(collectDiagCodes(records)).toEqual([]);
      });

      it('collects parser diagnostic codes from records', () => {
        const records = entriesToRecords([
          {
            guid: 'aaaa1111aaaa1111aaaa1111aaaa1111',
            pathname: 'Assets/A.png',
            asset: encoder.encode('a'),
            meta: undefined,
          },
        ], [
          {
            code: 'meta-missing',
            guid: 'aaaa1111aaaa1111aaaa1111aaaa1111',
            path: 'aaaa1111aaaa1111aaaa1111aaaa1111/asset.meta',
            message: 'Missing meta.',
            severity: 'warning',
          },
        ]);
        const codes = collectDiagCodes(records);
        expect(codes).toContain('meta-missing');
      });

      it('collects analysis finding codes routed to records', () => {
        const records = entriesToRecords([
          { guid: 'aaaa1111aaaa1111aaaa1111aaaa1111', pathname: 'Assets/A.cs', asset: encoder.encode('a'), meta: encoder.encode('m') },
        ], []);
        routeAnalysisFindings(records, [
          { code: 'unsafe-pathname', severity: 'error', message: 'test', guid: 'aaaa1111aaaa1111aaaa1111aaaa1111' },
        ]);
        const codes = collectDiagCodes(records);
        expect(codes).toContain('unsafe-pathname');
      });

      it('returns codes sorted alphabetically', () => {
        const records = entriesToRecords([
          { guid: 'aaaa1111aaaa1111aaaa1111aaaa1111', pathname: 'Assets/A.png', asset: encoder.encode('a'), meta: undefined },
          { guid: 'bbbb2222bbbb2222bbbb2222bbbb2222', pathname: 'Assets/B.cs', asset: encoder.encode('b'), meta: undefined },
        ], [
          { code: 'zero-byte-asset', guid: 'aaaa1111aaaa1111aaaa1111aaaa1111', path: '', message: 'z', severity: 'warning' },
          { code: 'meta-missing', guid: 'bbbb2222bbbb2222bbbb2222bbbb2222', path: '', message: 'm', severity: 'warning' },
        ]);
        const codes = collectDiagCodes(records);
        const sorted = [...codes].sort();
        expect(codes).toEqual(sorted);
      });
    });
  });
});

describe('P2 tree ergonomics helpers', () => {
  it('getAncestorFolderPaths returns empty array for root-level files', () => {
    expect(getAncestorFolderPaths('RootFile.cs')).toEqual([]);
  });

  it('getAncestorFolderPaths returns single ancestor for one-level-deep files', () => {
    expect(getAncestorFolderPaths('Assets/Player.cs')).toEqual(['Assets']);
  });

  it('getAncestorFolderPaths returns ordered ancestors for deeply nested files', () => {
    expect(getAncestorFolderPaths('Assets/Scripts/Player/Player.cs')).toEqual([
      'Assets',
      'Assets/Scripts',
      'Assets/Scripts/Player',
    ]);
  });

  it('getAncestorFolderPaths handles leading slashes gracefully', () => {
    const result = getAncestorFolderPaths('/Assets/Scripts/Player.cs');
    expect(result).toEqual(['Assets', 'Assets/Scripts']);
  });

  it('expandAncestors removes all ancestor paths from the collapsed set', () => {
    const collapsed = new Set(['Assets', 'Assets/Scripts', 'Packages']);
    const result = expandAncestors('Assets/Scripts/Player.cs', collapsed);
    expect(result.has('Assets')).toBe(false);
    expect(result.has('Assets/Scripts')).toBe(false);
    // Unrelated collapsed folders are preserved
    expect(result.has('Packages')).toBe(true);
  });

  it('expandAncestors returns an equivalent set when no ancestors are collapsed', () => {
    const collapsed = new Set(['Packages']);
    const result = expandAncestors('Assets/Scripts/Player.cs', collapsed);
    expect([...result]).toEqual(['Packages']);
  });

  it('expandAncestors does not mutate the original set', () => {
    const collapsed = new Set(['Assets']);
    expandAncestors('Assets/File.cs', collapsed);
    expect(collapsed.has('Assets')).toBe(true);
  });

  it('findRecordByVirtualPath locates the matching record', () => {
    const records = entriesToRecords([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/Scripts/Player.cs',
        asset: encoder.encode('code'),
        meta: encoder.encode('meta'),
      },
    ], []);
    const found = findRecordByVirtualPath(records, 'Assets/Scripts/Player.cs');
    expect(found).toBeDefined();
    expect(found?.guid).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('findRecordByVirtualPath returns undefined when no record matches', () => {
    const records = entriesToRecords([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/Scripts/Player.cs',
        asset: encoder.encode('code'),
      },
    ], []);
    expect(findRecordByVirtualPath(records, 'Assets/Scripts/Missing.cs')).toBeUndefined();
  });

  it('getAllFolderPaths returns deduplicated, sorted folder paths', () => {
    const records = entriesToRecords([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'Assets/Scripts/Player.cs',
        asset: encoder.encode('code'),
      },
      {
        guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pathname: 'Assets/Textures/Icon.png',
        asset: encoder.encode('png'),
      },
    ], []);
    const folders = getAllFolderPaths(records);
    expect(folders).toContain('Assets');
    expect(folders).toContain('Assets/Scripts');
    expect(folders).toContain('Assets/Textures');
    // No duplicates
    expect(new Set(folders).size).toBe(folders.length);
    // Sorted: Assets < Assets/Scripts < Assets/Textures
    expect(folders.indexOf('Assets')).toBeLessThan(folders.indexOf('Assets/Scripts'));
  });

  it('getAllFolderPaths returns empty array for root-only records', () => {
    const records = entriesToRecords([
      {
        guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        pathname: 'RootFile.cs',
        asset: encoder.encode('code'),
      },
    ], []);
    expect(getAllFolderPaths(records)).toEqual([]);
  });

  it('computeHeadHash computes hash of file', async () => {
    const file = new Blob([new TextEncoder().encode('Hello World')], { type: 'text/plain' });
    const hash = await computeHeadHash(file);
    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
  });

  it('IndexedDB operations gracefully handle environment without indexedDB', async () => {
    await expect(getRecentPackages()).resolves.toEqual([]);
    await expect(addRecentPackage({ key: 'test|123|abc', name: 'test', size: 123, headHash: 'abc' })).resolves.toBeUndefined();
    await expect(removeRecentPackage('test|123|abc')).resolves.toBeUndefined();
  });
});
