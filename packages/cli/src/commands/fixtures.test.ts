import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { parseUnityPackageEntries, readMetaGuid } from 'unitypackage-core';
import { diff } from './diff.js';
import { extract } from './extract.js';
import { inspect, type InspectResult } from './inspect.js';
import { pack } from './pack.js';
import { verify, type VerifyResult } from './verify.js';
import { makeTempDir } from '../test-utils.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const generatedFixturesDir = path.join(repoRoot, 'fixtures/generated');
const staticFixturesDir = path.join(repoRoot, 'fixtures/static');
const goldenDir = path.join(repoRoot, 'fixtures/src/golden');

describe('cli fixture integration', () => {
  it('keeps generated minimal inspect output aligned with the golden fixture', async () => {
    const result = await withoutHumanOutput(() => inspect(generatedFixture('minimal'), { json: false }));
    const expected = await readJson<InspectResult>(path.join(goldenDir, 'minimal.inspect.json'));

    const normalized = {
      ...result,
      package: {
        size: result.package.size,
        sha256: result.package.sha256,
      },
    };

    expect(normalized).toEqual(expected);
  });

  it('inspects the real editor-exported package with filters and component metadata', async () => {
    const result = await withoutHumanOutput(() => inspect(staticFixture('editor-packed.unitypackage'), {
      filter: '**/*.shader',
    }));

    expect(result.summary.entries).toBe(1);
    expect(result.entries).toEqual([
      expect.objectContaining({
        pathname: 'Assets/FronkonGames/Artistic/OneBit/Resources/Shaders/ArtisticOneBit_URP.shader',
        hasAsset: true,
        hasMeta: true,
      }),
    ]);
    expect(result.components).toEqual([
      expect.objectContaining({
        component: 'asset',
        extension: 'shader',
        previewKind: 'text',
        syntaxLanguage: 'shaderlab',
      }),
      expect.objectContaining({
        component: 'meta',
        extension: 'meta',
        syntaxLanguage: 'yaml',
      }),
    ]);
  });

  it('verifies generated fixtures across valid and malformed package cases', async () => {
    await expect(readVerifyJson(generatedFixture('minimal'))).resolves.toMatchObject({
      ok: true,
      findings: [],
    });
    await expect(readVerifyJson(generatedFixture('nested'))).resolves.toMatchObject({
      ok: true,
      findings: [],
    });
    await expect(readVerifyJson(generatedFixture('binary'))).resolves.toMatchObject({
      ok: true,
      findings: [],
    });
    await expect(readVerifyJson(generatedFixture('legacy-metadata'))).resolves.toMatchObject({
      ok: true,
      findings: [],
    });

    await expect(readVerifyJson(generatedFixture('traversal'))).resolves.toMatchObject({
      ok: false,
      findings: expect.arrayContaining([
        expect.objectContaining({ level: 'error', code: 'UNSAFE_PATHNAME', entry: '../../etc/passwd' }),
        expect.objectContaining({ level: 'warn', code: 'PATH_OUTSIDE_ASSETS', entry: '../../etc/passwd' }),
      ]),
    });
    await expect(readVerifyJson(generatedFixture('duplicate-guid'))).resolves.toMatchObject({
      ok: false,
      findings: expect.arrayContaining([
        expect.objectContaining({ level: 'error', code: 'PARSER_DUPLICATE_GUID' }),
      ]),
    });
    await expect(readVerifyJson(generatedFixture('truncated'))).resolves.toMatchObject({
      ok: false,
      findings: expect.arrayContaining([
        expect.objectContaining({ level: 'error', code: 'PARSE_FAILED' }),
      ]),
    });
  });

  it('extracts nested generated fixtures by exact path with meta sidecar expansion', async () => {
    const outDir = path.join(await makeTempDir(), 'out');
    const result = await withoutHumanOutput(() => extract(generatedFixture('nested'), outDir, {
      paths: ['Assets/Level1/Level2/Level3/Deep.cs'],
      withMeta: true,
    }));

    expect(result.summary).toMatchObject({
      planned: 2,
      written: 2,
      skippedTraversal: 0,
    });
    await expect(readFile(path.join(outDir, 'Assets/Level1/Level2/Level3/Deep.cs'), 'utf-8')).resolves.toBe(
      '// deep\n',
    );
    await expect(readFile(path.join(outDir, 'Assets/Level1/Level2/Level3/Deep.cs.meta'), 'utf-8')).resolves.toContain(
      'guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb01',
    );
  });

  it('diffs generated fixtures with deterministic added and removed pathnames', async () => {
    const result = await captureJson(() => diff(generatedFixture('minimal'), generatedFixture('nested'), {
      json: true,
    }));

    expect(result.summary).toEqual({ added: 3, removed: 1, changed: 0 });
    expect(result.added.map(entry => entry.pathname)).toEqual([
      'Assets/Level1/Level2/Level3/Deep.cs',
      'Assets/Level1/Level2/Mid.txt',
      'Assets/Level1/Top.prefab',
    ]);
    expect(result.removed.map(entry => entry.pathname)).toEqual(['Assets/Minimal.cs']);
  });

  it('packs static fixture assets while preserving adjacent meta bytes exactly', async () => {
    const dir = await makeTempDir();
    const outputFile = path.join(dir, 'texture.unitypackage');
    const sourceFile = path.join(dir, 'texture_02.png');
    const sourceMeta = sourceFile + '.meta';

    await mkdir(dir, { recursive: true });
    await writeFile(sourceFile, await readFile(staticFixture('texture_02.png')));
    await writeFile(sourceMeta, await readFile(staticFixture('texture_02.png.meta')));

    await withoutHumanOutput(() => pack({ [sourceFile]: 'Assets/Textures/texture_02.png' }, outputFile));

    const { entries } = parseUnityPackageEntries(await readFile(outputFile));
    const entry = entries.find(candidate => candidate.pathname === 'Assets/Textures/texture_02.png');
    const expectedMeta = await readFile(staticFixture('texture_02.png.meta'));
    expect(entry?.guid).toBe(readMetaGuid(expectedMeta));
    expect(Array.from(entry?.meta ?? [])).toEqual(Array.from(expectedMeta));
    expect(Array.from(entry?.asset?.slice(0, 4) ?? [])).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

function generatedFixture(name: string): string {
  return path.join(generatedFixturesDir, `${name}.unitypackage`);
}

function staticFixture(name: string): string {
  return path.join(staticFixturesDir, name);
}

async function withoutHumanOutput<T>(fn: () => Promise<T>): Promise<T> {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    return await fn();
  } finally {
    logSpy.mockRestore();
  }
}

async function captureJson<T>(fn: () => Promise<unknown>): Promise<T> {
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await fn().catch(() => undefined);
    return JSON.parse(stdoutSpy.mock.calls.map(call => call[0]).join('')) as T;
  } finally {
    stdoutSpy.mockRestore();
  }
}

async function readVerifyJson(packagePath: string): Promise<VerifyResult> {
  return await captureJson(() => verify(packagePath, { json: true }));
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf-8')) as T;
}
