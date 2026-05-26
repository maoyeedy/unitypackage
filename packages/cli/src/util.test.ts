import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { sanitizePackagePath, sanitizeFsPath, isInside } from './util/path.js';
import { createGuid, parseMeta, generateMeta } from './util/meta.js';

describe('sanitizePackagePath', () => {
  it('preserves valid path', () => {
    expect(sanitizePackagePath('Assets/Scripts/MyScript.cs')).toBe('Assets/Scripts/MyScript.cs');
  });

  it('strips leading slashes', () => {
    expect(sanitizePackagePath('/Assets/Foo')).toBe('Assets/Foo');
  });

  it('strips trailing slashes', () => {
    expect(sanitizePackagePath('Assets/Foo/')).toBe('Assets/Foo');
  });

  it('normalizes backslashes', () => {
    expect(sanitizePackagePath('Assets\\Scripts\\Foo.cs')).toBe('Assets/Scripts/Foo.cs');
  });

  it('strips dot-dot components', () => {
    const result = sanitizePackagePath('../../etc/passwd');
    expect(result).not.toContain('..');
    expect(result).not.toContain('/etc/passwd');
  });

  it('strips empty segments', () => {
    expect(sanitizePackagePath('Assets//Scripts')).toBe('Assets/Scripts');
  });
});

describe('sanitizeFsPath', () => {
  it('falls back to underscore for empty segment after sanitize', () => {
    const result = sanitizeFsPath('/<>/foo');
    expect(result).not.toBe('');
    expect(result).toContain('foo');
  });

  it('replaces reserved dot path segments', () => {
    expect(sanitizeFsPath('Assets/./Foo.cs')).toBe(['Assets', '_', 'Foo.cs'].join(path.sep));
  });

  it('replaces Windows reserved path segments', () => {
    expect(sanitizeFsPath('Assets/CON/Foo.cs')).toBe(['Assets', '_', 'Foo.cs'].join(path.sep));
  });

  it('strips trailing dots from path segments', () => {
    expect(sanitizeFsPath('Assets/Foo./Bar.cs')).toBe(['Assets', 'Foo', 'Bar.cs'].join(path.sep));
  });
});

describe('isInside', () => {
  it('returns true for child inside parent', () => {
    expect(isInside('/tmp/out', '/tmp/out/file.txt')).toBe(true);
  });

  it('returns true for parent === child', () => {
    expect(isInside('/tmp/out', '/tmp/out')).toBe(true);
  });

  it('returns false for path outside parent', () => {
    expect(isInside('/tmp/out', '/tmp/other/file.txt')).toBe(false);
  });

  it('returns false for parent-prefix-but-not-inside (dir boundary)', () => {
    expect(isInside('/tmp/out', '/tmp/outX/file.txt')).toBe(false);
  });
});

describe('createGuid', () => {
  it('returns 32-char uppercase hex string', () => {
    const guid = createGuid('Assets/Test.cs');
    expect(guid).toMatch(/^[0-9A-F]{32}$/);
  });

  it('is deterministic', () => {
    expect(createGuid('Assets/Test.cs')).toBe(createGuid('Assets/Test.cs'));
  });

  it('differs for different inputs', () => {
    expect(createGuid('Assets/A.cs')).not.toBe(createGuid('Assets/B.cs'));
  });
});

describe('parseMeta', () => {
  it('parses valid YAML meta with guid', () => {
    const meta = parseMeta('fileFormatVersion: 2\nguid: abcdef1234567890abcdef1234567890\n');
    expect(meta?.guid).toBe('abcdef1234567890abcdef1234567890');
  });

  it('returns null for missing guid', () => {
    expect(parseMeta('fileFormatVersion: 2\n')).toBeNull();
  });

  it('returns null for invalid YAML', () => {
    expect(parseMeta('{')).toBeNull();
  });
});

describe('generateMeta', () => {
  it('generates meta for file with 32-char guid', () => {
    const meta = generateMeta('Assets/Foo.cs', false);
    expect(meta.fileFormatVersion).toBe(2);
    expect(meta.guid).toMatch(/^[0-9A-F]{32}$/);
    expect(meta.folderAsset).toBeUndefined();
  });

  it('marks folders with folderAsset: true', () => {
    const meta = generateMeta('Assets/Scripts', true);
    expect(meta.folderAsset).toBe(true);
  });
});
