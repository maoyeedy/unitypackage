import { describe, it, expect } from 'vitest';
import { scanGuids, PPTR_REF_PATTERN, BUILT_IN_GUIDS } from './guidScanner.js';

describe('scanGuids', () => {
  it('extracts GUID from valid PPtr reference', () => {
    const result = scanGuids('{fileID: 11500000, guid: abcdef1234567890abcdef1234567890, type: 3}');
    expect(result.references).toEqual(new Set(['abcdef1234567890abcdef1234567890']));
    expect(result.skipped).toBe(false);
  });

  it('returns empty set when no fileID anchor present', () => {
    const result = scanGuids('guid: abcdef1234567890abcdef1234567890');
    expect(result.references).toEqual(new Set());
    expect(result.skipped).toBe(false);
  });

  it.each(['.png', '.fbx', '.cs', '.mp3'])('skips %s files by extension', (ext) => {
    const result = scanGuids('{fileID: 11500000, guid: abcdef1234567890abcdef1234567890, type: 3}', `file${ext}`);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('extension');
  });

  it('filters built-in GUIDs', () => {
    const content = [
      '{fileID: 11500000, guid: 0000000000000000e000000000000000, type: 3}',
      '{fileID: 11500000, guid: 0000000000000000f000000000000000, type: 3}',
      '{fileID: 11500000, guid: abcdef1234567890abcdef1234567890, type: 3}',
    ].join('\n');
    const result = scanGuids(content);
    expect(result.references).toEqual(new Set(['abcdef1234567890abcdef1234567890']));
    expect(result.skipped).toBe(false);
  });

  it('detects binary YAML content', () => {
    const longLine = 'x'.repeat(3000);
    const content = `%YAML 1.1\n${longLine}`;
    const result = scanGuids(content);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('binary-yaml');
  });

  it('deduplicates same GUID referenced multiple times', () => {
    const content = [
      '{fileID: 11500000, guid: abcdef1234567890abcdef1234567890, type: 3}',
      '{fileID: 2100000, guid: abcdef1234567890abcdef1234567890, type: 2}',
    ].join('\n');
    const result = scanGuids(content);
    expect(result.references).toEqual(new Set(['abcdef1234567890abcdef1234567890']));
  });
});

describe('PPTR_REF_PATTERN', () => {
  it('matches standard PPtr format', () => {
    const content = '{fileID: 11500000, guid: abcdef1234567890abcdef1234567890, type: 3}';
    PPTR_REF_PATTERN.lastIndex = 0;
    const match = PPTR_REF_PATTERN.exec(content);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('abcdef1234567890abcdef1234567890');
  });

  it('does not match meta identity lines', () => {
    const content = 'guid: abcdef1234567890abcdef1234567890';
    PPTR_REF_PATTERN.lastIndex = 0;
    const match = PPTR_REF_PATTERN.exec(content);
    expect(match).toBeNull();
  });

  it('matches with varying whitespace', () => {
    const content = '{fileID:4300000,guid:abcdef1234567890abcdef1234567890,type:3}';
    PPTR_REF_PATTERN.lastIndex = 0;
    const match = PPTR_REF_PATTERN.exec(content);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('abcdef1234567890abcdef1234567890');
  });
});

describe('BUILT_IN_GUIDS', () => {
  it('contains the two known built-in GUIDs', () => {
    expect(BUILT_IN_GUIDS).toEqual(new Set([
      '0000000000000000e000000000000000',
      '0000000000000000f000000000000000',
    ]));
  });
});
