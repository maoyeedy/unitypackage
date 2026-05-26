import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { sanitizePackagePath, sanitizeFsPath, isInside } from './util/path.js';
import { readMetaGuid } from 'unitypackage-core';
import { EXIT, mapCliError } from './util/exit.js';

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

describe('readMetaGuid', () => {
  it('reads a valid meta guid', () => {
    const guid = readMetaGuid('fileFormatVersion: 2\nguid: abcdef1234567890abcdef1234567890\n');
    expect(guid).toBe('abcdef1234567890abcdef1234567890');
  });

  it('returns null for missing guid', () => {
    expect(readMetaGuid('fileFormatVersion: 2\n')).toBeNull();
  });

  it('returns null for malformed text', () => {
    expect(readMetaGuid('{')).toBeNull();
  });
});

describe('mapCliError', () => {
  it('maps core decompression bomb errors to the stable CLI bomb exit', () => {
    const mapped = mapCliError({
      name: 'DecompressionBombError',
      kind: 'entry-count',
      observed: 2,
    });

    expect(mapped).toEqual({
      code: EXIT.BOMB,
      message: 'Decompression bomb guard triggered: kind=entry-count observed=2',
    });
  });
});
