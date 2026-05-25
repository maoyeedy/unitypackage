import { describe, expect, it } from 'vitest';
import {
  detectPathnameCollisions,
  tryCreateUnityPackage,
  validatePathname,
} from './index';

const encoder = new TextEncoder();

describe('validatePathname', () => {
  it('accepts a normal asset pathname', () => {
    expect(validatePathname('Assets/Scripts/MyScript.cs')).toEqual({ ok: true });
  });

  it('accepts a pathname with a single segment', () => {
    expect(validatePathname('Assets')).toEqual({ ok: true });
  });

  // empty
  it('rejects empty string with reason "empty"', () => {
    const result = validatePathname('');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('empty');
  });

  // absolute
  it('rejects absolute path (leading slash) with reason "absolute"', () => {
    const result = validatePathname('/Assets/Foo.cs');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('absolute');
  });

  // drive-or-unc
  it('rejects Windows drive letter path with reason "drive-or-unc"', () => {
    const result = validatePathname('C:\\Users\\foo.cs');
    // backslash is caught first; test a drive path without backslash
    const result2 = validatePathname('C:/Users/foo.cs');
    expect(result2.ok).toBe(false);
    expect(result2.reason).toBe('drive-or-unc');
    // backslash variant also fails (backslash reason comes first)
    expect(result.ok).toBe(false);
    expect(['drive-or-unc', 'backslash']).toContain(result.reason);
  });

  it('rejects lowercase drive letter with reason "drive-or-unc"', () => {
    const result = validatePathname('c:/path/to/file.cs');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('drive-or-unc');
  });

  it('rejects forward-slash UNC-like paths with reason "drive-or-unc"', () => {
    const result = validatePathname('//server/share/Foo.cs');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('drive-or-unc');
  });

  // parent-traversal
  it('rejects pathname containing ".." segment with reason "parent-traversal"', () => {
    const result = validatePathname('Assets/../etc/passwd');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('parent-traversal');
  });

  it('rejects pathname starting with ".." with reason "parent-traversal"', () => {
    const result = validatePathname('../etc/passwd');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('parent-traversal');
  });

  it('accepts ".." that is only a substring of a segment (not the full segment)', () => {
    // "..hidden" is a valid segment name, not a parent-traversal
    expect(validatePathname('Assets/..hidden/file.cs')).toEqual({ ok: true });
  });

  // backslash
  it('rejects pathname with backslash with reason "backslash"', () => {
    const result = validatePathname('Assets\\Foo.cs');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('backslash');
  });

  // control-character
  it('rejects pathname containing a control character (< 0x20) with reason "control-character"', () => {
    const result = validatePathname('Assets/\x01Foo.cs');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('control-character');
  });

  it('rejects pathname containing a tab character (0x09) with reason "control-character"', () => {
    const result = validatePathname('Assets/\tFoo.cs');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('control-character');
  });

  it('rejects pathname containing a newline (0x0A) with reason "control-character"', () => {
    const result = validatePathname('Assets/Foo\nBar.cs');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('control-character');
  });

  // oversized-tar-entry
  it('returns ok:true when guid + fixed names fit within 100 bytes', () => {
    // "<32>/asset.meta" = 32 + 1 + 10 = 43 bytes -- well under 100
    const guid = 'a'.repeat(32);
    expect(validatePathname('Assets/Foo.cs', { guid })).toEqual({ ok: true });
  });

  it('rejects when guid makes "<guid>/asset.meta" exceed 100 bytes', () => {
    // guid of 90 chars: "b".repeat(90) + "/asset.meta" = 101 bytes
    const longGuid = 'b'.repeat(90);
    const result = validatePathname('Assets/Foo.cs', { guid: longGuid });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('oversized-tar-entry');
    expect(result.detail).toBe('101');
  });

  it('accepts when "<guid>/asset.meta" is exactly 100 bytes', () => {
    // guid of 89 chars: 89 + 1 + 10 = 100 bytes -- exactly at limit
    const atLimitGuid = 'a'.repeat(89);
    const result = validatePathname('Assets/Foo.cs', { guid: atLimitGuid });
    expect(result.ok).toBe(true);
  });

  it('oversized-tar-entry detail matches actual UTF-8 byte length of "<guid>/asset.meta"', () => {
    // guid of 90 chars => 101 bytes
    const longGuid = 'c'.repeat(90);
    const result = validatePathname('Assets/Bar.cs', { guid: longGuid });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('oversized-tar-entry');
    const reportedLength = Number(result.detail);
    const expected = new TextEncoder().encode(`${longGuid}/asset.meta`).length;
    expect(reportedLength).toBe(expected);
  });

  it('oversized-tar-entry check aligns with tryCreateUnityPackage for the same input', () => {
    // Use a 90-char guid: tryCreateUnityPackage should emit oversized-pathname
    // and validatePathname should emit oversized-tar-entry
    const longGuid = 'd'.repeat(90);
    const createResult = tryCreateUnityPackage([
      {
        guid: longGuid,
        pathname: 'Assets/Align.cs',
        asset: encoder.encode('content'),
        meta: encoder.encode('meta'),
      },
    ]);
    const createOversized = createResult.diagnostics.filter(d => d.code === 'oversized-pathname');
    expect(createOversized.length).toBeGreaterThan(0);

    const validateResult = validatePathname('Assets/Align.cs', { guid: longGuid });
    expect(validateResult.ok).toBe(false);
    expect(validateResult.reason).toBe('oversized-tar-entry');
  });

  it('does not check oversized-tar-entry when no guid is provided', () => {
    // Even a long pathname alone should not trigger oversized-tar-entry
    const longPathname = 'Assets/' + 'X'.repeat(200);
    const result = validatePathname(longPathname);
    // No oversized-tar-entry without a guid; other checks should pass (it's a valid path)
    expect(result.reason).not.toBe('oversized-tar-entry');
  });
});

describe('detectPathnameCollisions', () => {
  it('returns empty array for empty input', () => {
    expect(detectPathnameCollisions([])).toEqual([]);
  });

  it('returns empty array when there are no collisions', () => {
    const entries = [
      { guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', pathname: 'Assets/A.cs' },
      { guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', pathname: 'Assets/B.cs' },
      { guid: 'cccccccccccccccccccccccccccccccc', pathname: 'Assets/Sub/C.cs' },
    ];
    expect(detectPathnameCollisions(entries)).toEqual([]);
  });

  it('detects an exact-duplicate pair and sets exactDuplicates: true', () => {
    const entries = [
      { guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', pathname: 'Assets/Dup.asset' },
      { guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', pathname: 'Assets/Dup.asset' },
    ];
    const result = detectPathnameCollisions(entries);
    expect(result).toHaveLength(1);
    expect(result[0].pathname).toBe('Assets/Dup.asset');
    expect(result[0].caseFolded).toBe('assets/dup.asset');
    expect(result[0].guids).toEqual([
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ]);
    expect(result[0].exactDuplicates).toBe(true);
  });

  it('detects a case-only collision pair and sets exactDuplicates: false', () => {
    const entries = [
      { guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', pathname: 'Assets/Script.cs' },
      { guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', pathname: 'Assets/SCRIPT.CS' },
    ];
    const result = detectPathnameCollisions(entries);
    expect(result).toHaveLength(1);
    expect(result[0].pathname).toBe('Assets/Script.cs'); // first-seen casing
    expect(result[0].caseFolded).toBe('assets/script.cs');
    expect(result[0].guids).toHaveLength(2);
    expect(result[0].exactDuplicates).toBe(false);
  });

  it('detects a three-way collision with mixed exact and case-only matches', () => {
    const entries = [
      { guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', pathname: 'Assets/Foo.cs' },
      { guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', pathname: 'Assets/FOO.CS' },
      { guid: 'cccccccccccccccccccccccccccccccc', pathname: 'Assets/Foo.cs' }, // exact dup of first
    ];
    const result = detectPathnameCollisions(entries);
    expect(result).toHaveLength(1);
    expect(result[0].guids).toHaveLength(3);
    // Two entries share the exact bytes 'Assets/Foo.cs'
    expect(result[0].exactDuplicates).toBe(true);
  });

  it('includes folder entries alongside file entries in collision detection', () => {
    // A folder entry (no asset payload implied) using the same pathname as a file
    const entries = [
      { guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', pathname: 'Assets/MyFolder' },
      { guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', pathname: 'Assets/MyFolder' },
    ];
    const result = detectPathnameCollisions(entries);
    expect(result).toHaveLength(1);
    expect(result[0].exactDuplicates).toBe(true);
    expect(result[0].guids).toHaveLength(2);
  });
});
