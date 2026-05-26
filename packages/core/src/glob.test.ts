import { describe, expect, it } from 'vitest';
import { matchGlob } from './glob';

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

  it('** without trailing slash matches any characters including slashes', () => {
    expect(matchGlob('Assets/**', 'Assets/Player.cs')).toBe(true);
    expect(matchGlob('Assets/**', 'Assets/Scripts/Player.cs')).toBe(true);
    expect(matchGlob('**', 'Assets/Scripts/Player.cs')).toBe(true);
  });

  it('* does not match slashes (root-only pattern)', () => {
    expect(matchGlob('*.cs', 'Assets/Player.cs')).toBe(false);
  });

  it('? matches exactly one character', () => {
    expect(matchGlob('Player?.cs', 'Player1.cs')).toBe(true);
    expect(matchGlob('Player?.cs', 'Player.cs')).toBe(false);
    expect(matchGlob('Player?.cs', 'Player12.cs')).toBe(false);
    expect(matchGlob('Player?.cs', 'Player/.cs')).toBe(false);
  });

  it('escapes regex special characters in literal parts', () => {
    expect(matchGlob('Assets/A+B.cs', 'Assets/A+B.cs')).toBe(true);
    expect(matchGlob('Assets/A+B.cs', 'Assets/AxB.cs')).toBe(false);
    expect(matchGlob('Assets/A.B.cs', 'Assets/A.B.cs')).toBe(true);
    expect(matchGlob('Assets/A.B.cs', 'Assets/AxB.cs')).toBe(false);
    expect(matchGlob('Assets/A$B.cs', 'Assets/A$B.cs')).toBe(true);
    expect(matchGlob('Assets/A$B.cs', 'Assets/AxB.cs')).toBe(false);
  });

  it('is anchored at both ends', () => {
    expect(matchGlob('Assets/Player.cs', 'SubAssets/Player.cs')).toBe(false);
    expect(matchGlob('Assets/Player.cs', 'Assets/Player.cs/Suffix')).toBe(false);
  });
});
