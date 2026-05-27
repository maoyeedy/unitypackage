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

  it.each(['.png', '.fbx', '.cs', '.mp3', '.cg', '.bytes', '.meta'])('skips %s files by extension', (ext) => {
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

  it('returns empty set for {fileID: 400000} without guid field', () => {
    const result = scanGuids('{fileID: 400000}');
    expect(result.references).toEqual(new Set());
    expect(result.skipped).toBe(false);
  });

  it('handles empty string input gracefully', () => {
    const result = scanGuids('');
    expect(result.references).toEqual(new Set());
    expect(result.skipped).toBe(false);
  });

  it('handles undefined filename without crashing', () => {
    const result = scanGuids('{fileID: 11500000, guid: abcdef1234567890abcdef1234567890, type: 3}', undefined);
    expect(result.references).toEqual(new Set(['abcdef1234567890abcdef1234567890']));
    expect(result.skipped).toBe(false);
  });

  it('skipBuiltin: false keeps built-in GUIDs in result', () => {
    const content = '{fileID: 11500000, guid: 0000000000000000e000000000000000, type: 3}';
    const result = scanGuids(content, undefined, { skipBuiltin: false });
    expect(result.references).toEqual(new Set(['0000000000000000e000000000000000']));
    expect(result.skipped).toBe(false);
  });

  it('skipBinaryYaml: false scans binary YAML content', () => {
    const longLine = 'x'.repeat(3000);
    const content = `%YAML 1.1\n{fileID: 11500000, guid: abcdef1234567890abcdef1234567890, type: 3}\n${longLine}`;
    const result = scanGuids(content, 'test.asset', { skipBinaryYaml: false });
    expect(result.skipped).toBe(false);
    expect(result.references).toEqual(new Set(['abcdef1234567890abcdef1234567890']));
  });

  it('multi-dot filename Foo.ext.cs correctly extracts .cs extension', () => {
    const content = '{fileID: 11500000, guid: abcdef1234567890abcdef1234567890, type: 3}';
    const result = scanGuids(content, 'Foo.ext.cs');
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('extension');
  });

  it('filename without extension (Makefile) is scanned normally', () => {
    const result = scanGuids('{fileID: 11500000, guid: abcdef1234567890abcdef1234567890, type: 3}', 'Makefile');
    expect(result.skipped).toBe(false);
    expect(result.references).toEqual(new Set(['abcdef1234567890abcdef1234567890']));
  });

  it('matches references with multiple distinct type values', () => {
    const content = [
      '{fileID: 11500000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 0}',
      '{fileID: 11500000, guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, type: 2}',
      '{fileID: 11500000, guid: cccccccccccccccccccccccccccccccc, type: 3}',
    ].join('\n');
    const result = scanGuids(content);
    expect(result.references).toEqual(new Set([
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'cccccccccccccccccccccccccccccccc',
    ]));
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
