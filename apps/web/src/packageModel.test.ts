/// <reference types="node" />

import { describe, expect, it } from 'vitest';
import type { UnityPackageEntry } from 'unitypackage-core';

import {
  buildExtensionGroups,
  buildTreeRows,
  entriesToRecords,
  filterRecords,
  formatBytes,
  getKeyboardRangeSelection,
  getRecordCategory,
  getSelectionState,
  resolveMetaSidecarSelection,
  simpleMatchRecord,
  sortRecords,
  toSidecarSelectableRecords,
} from './packageModel';

const encoder = new TextEncoder();

function makeRecords() {
  const entries: UnityPackageEntry[] = [
    {
      guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pathname: 'Assets/Scripts/Player.cs',
      asset: encoder.encode('class Player {}'),
      meta: encoder.encode('guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      preview: encoder.encode('png'),
    },
    {
      guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      pathname: 'Assets/Textures/Ground.png',
      asset: encoder.encode('image'),
      meta: encoder.encode('guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
    },
  ];
  return entriesToRecords(entries, []);
}

describe('package model helpers', () => {
  it('creates asset and meta records while dropping Unity preview records', () => {
    const records = makeRecords();

    expect(records).toHaveLength(4);
    expect(records.some(record => record.virtualPath.endsWith('.preview.png'))).toBe(false);
    expect(records.filter(record => getRecordCategory(record) === 'asset')).toHaveLength(2);
    expect(records.filter(record => getRecordCategory(record) === 'meta')).toHaveLength(2);
  });

  it('filters meta records from browsing unless enabled', () => {
    const records = makeRecords();

    expect(filterRecords(records, { query: '', includeMetaSidecars: false })).toHaveLength(2);
    expect(filterRecords(records, { query: '', includeMetaSidecars: true })).toHaveLength(4);
  });

  it('searches case-insensitive file names and paths', () => {
    const [record] = makeRecords();

    expect(record && simpleMatchRecord(record, 'player')).toBe(true);
    expect(record && simpleMatchRecord(record, 'assets scripts')).toBe(true);
    expect(record && simpleMatchRecord(record, 'missing')).toBe(false);
  });

  it('builds sorted tree and extension group models', () => {
    const records = makeRecords();
    const treeRows = buildTreeRows(records);
    const groups = buildExtensionGroups(records);

    expect(treeRows.some(row => row.type === 'folder' && row.path === 'Assets')).toBe(true);
    expect(groups.map(group => group.extension)).toEqual(['cs', 'meta', 'png']);
  });

  it('sorts by size and formats bytes', () => {
    const records = makeRecords();
    const sorted = sortRecords(records, 'size', 'desc');

    expect(sorted[0]?.byteLength).toBeGreaterThanOrEqual(sorted[1]?.byteLength ?? 0);
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('supports selection state and keyboard range selection', () => {
    const ids = ['a', 'b', 'c'];

    expect(getSelectionState(ids, new Set(['a']))).toBe('partial');
    expect(getSelectionState(ids, new Set(ids))).toBe('all');
    expect(getKeyboardRangeSelection(ids, 'a', 'c', new Set(ids), new Set(['a']), 'add')).toEqual(new Set(ids));
  });

  it('adds meta sidecars to asset ZIP selections', () => {
    const records = makeRecords();
    const asset = records.find(record => record.virtualPath === 'Assets/Scripts/Player.cs');
    expect(asset).toBeDefined();

    const result = resolveMetaSidecarSelection(toSidecarSelectableRecords(records), [asset!.id]);

    expect(result.ids).toEqual([
      asset!.id,
      records.find(record => record.virtualPath === 'Assets/Scripts/Player.cs.meta')!.id,
    ]);
  });
});
