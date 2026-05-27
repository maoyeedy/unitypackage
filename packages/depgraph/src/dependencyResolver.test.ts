import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveDependencies } from './dependencyResolver.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dep-resolver-test-'));
}

function writeMeta(dir: string, relPath: string, guid: string): void {
  const fullPath = join(dir, relPath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, `guid: ${guid}\n`, 'utf-8');
}

function writeAsset(dir: string, relPath: string, content: string): void {
  const fullPath = join(dir, relPath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}

const GUID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const GUID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const GUID_C = 'cccccccccccccccccccccccccccccccc';

function pptrRef(guid: string): string {
  return `{fileID: 11500000, guid: ${guid}, type: 3}`;
}

describe('resolveDependencies', () => {
  it('returns empty result for empty explicitPaths', () => {
    const dir = createTempDir();
    try {
      const result = resolveDependencies({
        explicitPaths: [],
        depRoot: dir,
        index: new Map(),
      });
      expect(result.explicitGuids.size).toBe(0);
      expect(result.transitiveGuids.size).toBe(0);
      expect(result.edges).toEqual([]);
      expect(result.stats.scanned).toBe(0);
      expect(result.stats.skipped).toBe(0);
      expect(result.stats.maxDepthReached).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('with maxDepth: 0 returns only explicit GUIDs, no transitive deps', () => {
    const dir = createTempDir();
    try {
      writeMeta(dir, 'Assets/A.asset.meta', GUID_A);
      writeAsset(dir, 'Assets/A.asset', pptrRef(GUID_B));
      writeMeta(dir, 'Assets/B.asset.meta', GUID_B);
      writeAsset(dir, 'Assets/B.asset', '');

      const index = new Map<string, string>([
        [GUID_A, 'Assets/A.asset'],
        [GUID_B, 'Assets/B.asset'],
      ]);

      const result = resolveDependencies({
        explicitPaths: ['Assets/A.asset'],
        depRoot: dir,
        index,
        maxDepth: 0,
      });
      expect(result.explicitGuids).toEqual(new Set([GUID_A]));
      expect(result.transitiveGuids.size).toBe(0);
      expect(result.edges).toEqual([]);
      expect(result.stats.scanned).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('with maxDepth: 1 returns direct deps of explicit files', () => {
    const dir = createTempDir();
    try {
      writeMeta(dir, 'Assets/A.asset.meta', GUID_A);
      writeAsset(dir, 'Assets/A.asset', pptrRef(GUID_B));
      writeMeta(dir, 'Assets/B.asset.meta', GUID_B);
      writeAsset(dir, 'Assets/B.asset', pptrRef(GUID_C));
      writeMeta(dir, 'Assets/C.asset.meta', GUID_C);
      writeAsset(dir, 'Assets/C.asset', '');

      const index = new Map<string, string>([
        [GUID_A, 'Assets/A.asset'],
        [GUID_B, 'Assets/B.asset'],
        [GUID_C, 'Assets/C.asset'],
      ]);

      const result = resolveDependencies({
        explicitPaths: ['Assets/A.asset'],
        depRoot: dir,
        index,
        maxDepth: 1,
      });
      expect(result.explicitGuids).toEqual(new Set([GUID_A]));
      expect(result.transitiveGuids).toEqual(new Set([GUID_B]));
      expect(result.edges).toEqual([
        { from: GUID_A, to: GUID_B, fromPath: 'Assets/A.asset', toPath: 'Assets/B.asset' },
      ]);
      expect(result.stats.scanned).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cycle (A->B->A) terminates with each GUID included once', () => {
    const dir = createTempDir();
    try {
      writeMeta(dir, 'Assets/A.asset.meta', GUID_A);
      writeAsset(dir, 'Assets/A.asset', pptrRef(GUID_B));
      writeMeta(dir, 'Assets/B.asset.meta', GUID_B);
      writeAsset(dir, 'Assets/B.asset', pptrRef(GUID_A));

      const index = new Map<string, string>([
        [GUID_A, 'Assets/A.asset'],
        [GUID_B, 'Assets/B.asset'],
      ]);

      const result = resolveDependencies({
        explicitPaths: ['Assets/A.asset'],
        depRoot: dir,
        index,
      });
      expect(result.explicitGuids).toEqual(new Set([GUID_A]));
      expect(result.transitiveGuids).toEqual(new Set([GUID_B]));
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].from).toBe(GUID_A);
      expect(result.edges[0].to).toBe(GUID_B);
      expect(result.stats.scanned).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('external GUIDs (not in index) are silently skipped', () => {
    const dir = createTempDir();
    try {
      const externalGuid = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
      writeMeta(dir, 'Assets/A.asset.meta', GUID_A);
      writeAsset(dir, 'Assets/A.asset', pptrRef(externalGuid));

      const index = new Map<string, string>([
        [GUID_A, 'Assets/A.asset'],
      ]);

      const result = resolveDependencies({
        explicitPaths: ['Assets/A.asset'],
        depRoot: dir,
        index,
      });
      expect(result.explicitGuids).toEqual(new Set([GUID_A]));
      expect(result.transitiveGuids).toEqual(new Set([externalGuid]));
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].from).toBe(GUID_A);
      expect(result.edges[0].to).toBe(externalGuid);
      expect(result.stats.scanned).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('binary leaf files break the chain (no further resolution)', () => {
    const dir = createTempDir();
    try {
      writeMeta(dir, 'Assets/A.asset.meta', GUID_A);
      writeAsset(dir, 'Assets/A.asset', pptrRef(GUID_B));
      writeMeta(dir, 'Assets/B.png.meta', GUID_B);
      writeAsset(dir, 'Assets/B.png', 'dummy content');

      const index = new Map<string, string>([
        [GUID_A, 'Assets/A.asset'],
        [GUID_B, 'Assets/B.png'],
      ]);

      const result = resolveDependencies({
        explicitPaths: ['Assets/A.asset'],
        depRoot: dir,
        index,
      });
      expect(result.explicitGuids).toEqual(new Set([GUID_A]));
      expect(result.transitiveGuids).toEqual(new Set([GUID_B]));
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].from).toBe(GUID_A);
      expect(result.edges[0].to).toBe(GUID_B);
      expect(result.stats.scanned).toBe(2);
      expect(result.stats.skipped).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('self-referencing file does not create self-loop edge', () => {
    const dir = createTempDir();
    try {
      writeMeta(dir, 'Assets/A.asset.meta', GUID_A);
      writeAsset(dir, 'Assets/A.asset', pptrRef(GUID_A));

      const index = new Map<string, string>([
        [GUID_A, 'Assets/A.asset'],
      ]);

      const result = resolveDependencies({
        explicitPaths: ['Assets/A.asset'],
        depRoot: dir,
        index,
      });
      expect(result.explicitGuids).toEqual(new Set([GUID_A]));
      expect(result.transitiveGuids.size).toBe(0);
      expect(result.edges).toEqual([]);
      expect(result.stats.scanned).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('missing asset file for a referenced GUID is handled gracefully', () => {
    const dir = createTempDir();
    try {
      writeMeta(dir, 'Assets/A.asset.meta', GUID_A);
      writeAsset(dir, 'Assets/A.asset', pptrRef(GUID_B));
      writeMeta(dir, 'Assets/B.asset.meta', GUID_B);

      const index = new Map<string, string>([
        [GUID_A, 'Assets/A.asset'],
        [GUID_B, 'Assets/B.asset'],
      ]);

      const result = resolveDependencies({
        explicitPaths: ['Assets/A.asset'],
        depRoot: dir,
        index,
      });
      expect(result.explicitGuids).toEqual(new Set([GUID_A]));
      expect(result.transitiveGuids).toEqual(new Set([GUID_B]));
      expect(result.edges).toHaveLength(1);
      expect(result.stats.scanned).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
