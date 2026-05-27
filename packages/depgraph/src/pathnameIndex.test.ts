import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPathnameIndex } from './pathnameIndex.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pathname-index-test-'));
}

function writeMeta(dir: string, relPath: string, guid: string): void {
  const fullPath = join(dir, relPath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, `guid: ${guid}\n`, 'utf-8');
}

describe('buildPathnameIndex', () => {
  it('indexes valid .meta files with correct relative paths', () => {
    const dir = createTempDir();
    try {
      writeMeta(dir, 'Assets/Foo.cs.meta', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      writeMeta(dir, 'Assets/Sub/Bar.png.meta', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      writeMeta(dir, 'Assets/Sub/Nested/Baz.txt.meta', 'cccccccccccccccccccccccccccccccc');

      const result = buildPathnameIndex(dir);

      expect(result.index.size).toBe(3);
      expect(result.index.get('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe('Assets/Foo.cs');
      expect(result.index.get('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toBe('Assets/Sub/Bar.png');
      expect(result.index.get('cccccccccccccccccccccccccccccccc')).toBe('Assets/Sub/Nested/Baz.txt');
      expect(result.stats.totalMetaFiles).toBe(3);
      expect(result.stats.indexed).toBe(3);
      expect(result.stats.skippedNoGuid).toBe(0);
      expect(result.stats.duplicateGuids).toBe(0);
      expect(result.stats.elapsedMs).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles duplicate GUIDs (first wins)', () => {
    const dir = createTempDir();
    try {
      writeMeta(dir, 'Assets/First.cs.meta', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      writeMeta(dir, 'Assets/Sub/Second.cs.meta', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

      const result = buildPathnameIndex(dir);

      expect(result.index.size).toBe(1);
      expect(result.index.get('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe('Assets/First.cs');
      expect(result.stats.totalMetaFiles).toBe(2);
      expect(result.stats.indexed).toBe(1);
      expect(result.stats.duplicateGuids).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips malformed and empty .meta files without crashing', () => {
    const dir = createTempDir();
    try {
      writeMeta(dir, 'Assets/Good.cs.meta', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      writeFileSync(join(dir, 'Assets/NoGuid.txt.meta'), 'some random text\n', 'utf-8');
      writeFileSync(join(dir, 'Assets/Empty.meta'), '', 'utf-8');

      const result = buildPathnameIndex(dir);

      expect(result.index.size).toBe(1);
      expect(result.index.get('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe('Assets/Good.cs');
      expect(result.stats.totalMetaFiles).toBe(3);
      expect(result.stats.indexed).toBe(1);
      expect(result.stats.skippedNoGuid).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips node_modules, Library, Temp, obj, and Packages directories', () => {
    const dir = createTempDir();
    try {
      writeMeta(dir, 'Assets/Good.cs.meta', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      writeMeta(dir, 'node_modules/Foo.meta', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      writeMeta(dir, 'Library/Foo.meta', 'cccccccccccccccccccccccccccccccc');
      writeMeta(dir, 'Temp/Foo.meta', 'dddddddddddddddddddddddddddddddd');
      writeMeta(dir, 'obj/Foo.meta', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
      writeMeta(dir, 'Packages/Foo.meta', 'ffffffffffffffffffffffffffffffff');

      const result = buildPathnameIndex(dir);

      expect(result.index.size).toBe(1);
      expect(result.stats.totalMetaFiles).toBe(1);
      expect(result.stats.indexed).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('normalizes paths to forward slashes', () => {
    const dir = createTempDir();
    try {
      writeMeta(dir, 'Assets/Foo.cs.meta', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

      const result = buildPathnameIndex(dir);
      const path = result.index.get('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(path).toBe('Assets/Foo.cs');
      expect(path).not.toContain('\\');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
