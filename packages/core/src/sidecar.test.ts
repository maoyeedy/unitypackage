import { describe, expect, it } from 'vitest';
import {
  resolveMetaSidecarSelection,
  type SidecarSelectableRecord,
} from './index';

const record = (
  id: string,
  kind: SidecarSelectableRecord['kind'],
  guid: string,
  pathname: string,
): SidecarSelectableRecord => ({
  id,
  kind,
  guid,
  pathname,
});

describe('resolveMetaSidecarSelection', () => {
  it('adds an existing meta sidecar for a selected asset', () => {
    const records = [
      record('asset-a', 'asset', 'guid-a', 'Assets/A.png'),
      record('meta-a', 'meta', 'guid-a', 'Assets/A.png.meta'),
    ];

    expect(resolveMetaSidecarSelection(records, ['asset-a'])).toEqual({
      ids: ['asset-a', 'meta-a'],
      explicitIds: ['asset-a'],
      implicitMetaIds: ['meta-a'],
      missingMetaForAssetIds: [],
    });
  });

  it('does not duplicate a meta sidecar selected explicitly', () => {
    const records = [
      record('asset-a', 'asset', 'guid-a', 'Assets/A.png'),
      record('meta-a', 'meta', 'guid-a', 'Assets/A.png.meta'),
    ];

    expect(resolveMetaSidecarSelection(records, ['asset-a', 'meta-a'])).toEqual({
      ids: ['asset-a', 'meta-a'],
      explicitIds: ['asset-a', 'meta-a'],
      implicitMetaIds: [],
      missingMetaForAssetIds: [],
    });
  });

  it('reports selected assets with no matching meta sidecar', () => {
    const records = [record('asset-a', 'asset', 'guid-a', 'Assets/A.png')];

    expect(resolveMetaSidecarSelection(records, ['asset-a'])).toEqual({
      ids: ['asset-a'],
      explicitIds: ['asset-a'],
      implicitMetaIds: [],
      missingMetaForAssetIds: ['asset-a'],
    });
  });

  it('does not expand selected previews', () => {
    const records = [
      record('preview-a', 'preview', 'guid-a', 'Assets/A.png.preview.png'),
      record('meta-a', 'meta', 'guid-a', 'Assets/A.png.meta'),
    ];

    expect(resolveMetaSidecarSelection(records, ['preview-a'])).toEqual({
      ids: ['preview-a'],
      explicitIds: ['preview-a'],
      implicitMetaIds: [],
      missingMetaForAssetIds: [],
    });
  });

  it('prefers same-guid meta sidecars when duplicate pathnames exist', () => {
    const records = [
      record('asset-a', 'asset', 'guid-a', 'Assets/Duplicate.png'),
      record('meta-wrong-guid', 'meta', 'guid-b', 'Assets/Duplicate.png.meta'),
      record('meta-a', 'meta', 'guid-a', 'Assets/Duplicate.png.meta'),
    ];

    expect(resolveMetaSidecarSelection(records, ['asset-a']).implicitMetaIds).toEqual(['meta-a']);
  });

  it('does not treat selected meta records as sidecar sources', () => {
    const records = [
      record('meta-a', 'meta', 'guid-a', 'Assets/A.png.meta'),
      record('nested-meta', 'meta', 'guid-a', 'Assets/A.png.meta.meta'),
    ];

    expect(resolveMetaSidecarSelection(records, ['meta-a'])).toEqual({
      ids: ['meta-a'],
      explicitIds: ['meta-a'],
      implicitMetaIds: [],
      missingMetaForAssetIds: [],
    });
  });

  it('keeps explicit IDs first and appends implicit metas in selected asset order', () => {
    const records = [
      record('asset-b', 'asset', 'guid-b', 'Assets/B.png'),
      record('asset-a', 'asset', 'guid-a', 'Assets/A.png'),
      record('meta-a', 'meta', 'guid-a', 'Assets/A.png.meta'),
      record('meta-b', 'meta', 'guid-b', 'Assets/B.png.meta'),
    ];

    expect(resolveMetaSidecarSelection(records, ['asset-a', 'asset-b']).ids).toEqual([
      'asset-a',
      'asset-b',
      'meta-a',
      'meta-b',
    ]);
  });

  it('deduplicates duplicate selected IDs before expanding sidecars', () => {
    const records = [
      record('asset-a', 'asset', 'guid-a', 'Assets/A.png'),
      record('meta-a', 'meta', 'guid-a', 'Assets/A.png.meta'),
    ];

    expect(resolveMetaSidecarSelection(records, ['asset-a', 'asset-a'])).toEqual({
      ids: ['asset-a', 'meta-a'],
      explicitIds: ['asset-a'],
      implicitMetaIds: ['meta-a'],
      missingMetaForAssetIds: [],
    });
  });

  it('falls back to matching a meta sidecar by pathname when guid does not match (single candidate)', () => {
    const records = [
      record('asset-a', 'asset', 'guid-a', 'Assets/A.png'),
      record('meta-other-guid', 'meta', 'guid-b', 'Assets/A.png.meta'),
    ];

    expect(resolveMetaSidecarSelection(records, ['asset-a'])).toEqual({
      ids: ['asset-a', 'meta-other-guid'],
      explicitIds: ['asset-a'],
      implicitMetaIds: ['meta-other-guid'],
      missingMetaForAssetIds: [],
    });
  });

  it('does not attach a mismatched-guid meta when multiple candidates share the same pathname', () => {
    const records = [
      record('asset-c', 'asset', 'guid-c', 'Assets/X'),
      record('meta-a', 'meta', 'guid-a', 'Assets/X.meta'),
      record('meta-b', 'meta', 'guid-b', 'Assets/X.meta'),
    ];

    expect(resolveMetaSidecarSelection(records, ['asset-c'])).toEqual({
      ids: ['asset-c'],
      explicitIds: ['asset-c'],
      implicitMetaIds: [],
      missingMetaForAssetIds: ['asset-c'],
    });
  });
});
