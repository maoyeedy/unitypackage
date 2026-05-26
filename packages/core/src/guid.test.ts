import { describe, expect, it } from 'vitest';
import { generateGuid, guidFromPath, isValidGuid } from './index';

describe('isValidGuid', () => {
  it('accepts a 32-character lowercase hex string', () => {
    expect(isValidGuid('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(isValidGuid('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isValidGuid('006f7fc78b046e2408cecc07a80417b5')).toBe(true);
  });

  it('rejects a 31-character string', () => {
    expect(isValidGuid('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('rejects a 33-character string', () => {
    expect(isValidGuid('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('accepts uppercase and mixed-case hex', () => {
    expect(isValidGuid('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
    expect(isValidGuid('Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(isValidGuid('0123456789ABCDEF0123456789abcdef')).toBe(true);
  });

  it('rejects non-hex characters', () => {
    expect(isValidGuid('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaag!')).toBe(false);
    expect(isValidGuid('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaz1')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidGuid('')).toBe(false);
  });
});

describe('generateGuid', () => {
  it('returns a 32-character lowercase hex string', () => {
    const guid = generateGuid();
    expect(guid).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(guid)).toBe(true);
  });

  it('returns a value accepted by isValidGuid', () => {
    expect(isValidGuid(generateGuid())).toBe(true);
  });

  it('produces no duplicates across 1000 sequential calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const guid = generateGuid();
      expect(seen.has(guid)).toBe(false);
      seen.add(guid);
    }
    expect(seen.size).toBe(1000);
  });
});

describe('guidFromPath', () => {
  // Reference values computed with Node.js:
  //   Buffer.from(pathname, 'utf16le') -> md5 -> hex
  it('returns expected hash for empty string', () => {
    expect(guidFromPath('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('returns expected hash for a simple asset path', () => {
    expect(guidFromPath('Assets/MyScript.cs')).toBe('bd0c9ec9a6f34f28778814e1f699b30e');
  });

  it('returns expected hash for a deep asset path', () => {
    expect(guidFromPath('Assets/FronkonGames/Artistic/OneBit/Demo/Textures/Light/texture_01.png')).toBe(
      '8d61aaa1707e31e43193856b1aba884d',
    );
  });

  it('returns expected hash for a UTF-16LE path with CJK characters', () => {
    expect(guidFromPath('Assets/日本語.prefab')).toBe('b110d44211d1e3f4c3c93c3a079966a9');
  });

  it('is deterministic -- two calls with the same input return the same value', () => {
    const a = guidFromPath('Assets/Foo/Bar.cs');
    const b = guidFromPath('Assets/Foo/Bar.cs');
    expect(a).toBe(b);
  });

  it('returns a 32-character lowercase hex string', () => {
    const guid = guidFromPath('Assets/Test.prefab');
    expect(guid).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(guid)).toBe(true);
  });

  it('produces different values for different inputs', () => {
    expect(guidFromPath('Assets/A.cs')).not.toBe(guidFromPath('Assets/B.cs'));
  });
});
