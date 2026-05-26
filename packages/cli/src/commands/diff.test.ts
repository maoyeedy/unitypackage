import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createUnityPackage } from 'unitypackage-core';
import { diff } from './diff.js';
import { buildSingleScriptPackage, encoder, makeTempDir } from '../test-utils.js';

describe('diff', () => {
  it('reports added, removed, and changed entries by GUID, pathname, and asset hash', async () => {
    const dir = await makeTempDir();
    const beforePath = path.join(dir, 'before.unitypackage');
    const afterPath = path.join(dir, 'after.unitypackage');

    await writeFile(
      beforePath,
      createUnityPackage([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/Changed.cs',
          asset: encoder.encode('before'),
          meta: encoder.encode('guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
        },
        {
          guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          pathname: 'Assets/Removed.cs',
          asset: encoder.encode('removed'),
          meta: encoder.encode('guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
        },
      ]),
    );
    await writeFile(
      afterPath,
      createUnityPackage([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/Changed.cs',
          asset: encoder.encode('after'),
          meta: encoder.encode('guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
        },
        {
          guid: 'cccccccccccccccccccccccccccccccc',
          pathname: 'Assets/Added.cs',
          asset: encoder.encode('added'),
          meta: encoder.encode('guid: cccccccccccccccccccccccccccccccc'),
        },
      ]),
    );

    const result = await diff(beforePath, afterPath);

    expect(result.added).toMatchObject([{ guid: 'cccccccccccccccccccccccccccccccc', pathname: 'Assets/Added.cs' }]);
    expect(result.removed).toMatchObject([{ guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', pathname: 'Assets/Removed.cs' }]);
    expect(result.changed[0].guid).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(result.changed[0].before.assetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.changed[0].after.assetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.changed[0].before.assetHash).not.toBe(result.changed[0].after.assetHash);
    expect(result.changed[0].changed).toEqual(['asset']);
  });

  it('reports meta-only and preview-only changes', async () => {
    const dir = await makeTempDir();
    const beforePath = path.join(dir, 'before.unitypackage');
    const afterPath = path.join(dir, 'after.unitypackage');

    await writeFile(
      beforePath,
      createUnityPackage([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/MetaOnly.cs',
          asset: encoder.encode('same'),
          meta: encoder.encode('guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nbefore: true\n'),
        },
        {
          guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          pathname: 'Assets/PreviewOnly.png',
          asset: encoder.encode('same'),
          meta: encoder.encode('guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'),
          preview: encoder.encode('before-preview'),
        },
      ]),
    );
    await writeFile(
      afterPath,
      createUnityPackage([
        {
          guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pathname: 'Assets/MetaOnly.cs',
          asset: encoder.encode('same'),
          meta: encoder.encode('guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nafter: true\n'),
        },
        {
          guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          pathname: 'Assets/PreviewOnly.png',
          asset: encoder.encode('same'),
          meta: encoder.encode('guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'),
          preview: encoder.encode('after-preview'),
        },
      ]),
    );

    const result = await diff(beforePath, afterPath);

    expect(result.changed.map(entry => [entry.guid, entry.changed])).toEqual([
      ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ['meta']],
      ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', ['preview']],
    ]);
    expect(result.changed[0].before.metaHash).not.toBe(result.changed[0].after.metaHash);
    expect(result.changed[1].before.previewHash).not.toBe(result.changed[1].after.previewHash);
  });

  it('emits parseable JSON', async () => {
    const dir = await makeTempDir();
    const beforePath = path.join(dir, 'before.unitypackage');
    const afterPath = path.join(dir, 'after.unitypackage');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await writeFile(beforePath, buildSingleScriptPackage());
      await writeFile(afterPath, buildSingleScriptPackage());

      await diff(beforePath, afterPath, { json: true });

      const output = writeSpy.mock.calls.map(call => call[0]).join('');
      expect(JSON.parse(output).summary).toEqual({ added: 0, removed: 0, changed: 0 });
    } finally {
      writeSpy.mockRestore();
    }
  });
});
