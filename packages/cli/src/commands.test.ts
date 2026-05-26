import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { cli, parseGlobalParseOptions } from './cli.js';
import { buildSingleScriptPackage, makeTempDir } from './test-utils.js';
import { EXIT } from './util/exit.js';
import { createLimiter } from './util/concurrency.js';
import { parseArgs } from './util/args.js';

describe('cli help', () => {
  it('groups command forms with command-specific flags', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await cli(['--help']);
      const help = logSpy.mock.calls.map(call => call[0]).join('\n');
      expect(help).toContain('extract <package.unitypackage> [output-dir]');
      expect(help).toContain('--filter <glob>    Match full package pathnames');
      expect(help).toContain('--exclude <glob>   Exclude full package pathnames');
      expect(help).toContain('--path <pathname>  Extract one exact package pathname; repeatable');
      expect(help).toContain('--path-file <file> Read exact package pathnames');
      expect(help).toContain('--with-meta        Include sidecars for exact --path asset selections');
      expect(help).toContain('--dry-run          Plan extraction without writing files');
      expect(help).toContain('inspect <package.unitypackage>');
      expect(help).toContain('--json             Write inspect result as JSON');
      expect(help).toContain('verify <package.unitypackage>');
      expect(help).toContain('--json             Write verify result as JSON');
      expect(help).toContain('diff <before.unitypackage> <after.unitypackage>');
      expect(help).toContain('--json             Write diff result as JSON');
      expect(help).toContain('web [--port <n>] [--host <host>]');
      expect(help).toContain('--max-output-bytes <n>');
      expect(help).toContain('Safety limit for decompressed package bytes');
      expect(help).toContain('--max-entries <n>   Safety limit for parsed package entries');
      expect(help).not.toContain('health <package.unitypackage>');
      expect(help).not.toContain('Write health checks as JSON');
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('cli extract path options', () => {
  it('parses repeated --path values', () => {
    const parsed = parseArgs(['extract', 'fixture.unitypackage', 'out', '--path', 'Assets/A.cs', '--path', 'Assets/B.cs']);

    expect(parsed.flags.path).toEqual(['Assets/A.cs', 'Assets/B.cs']);
  });

  it('parses --with-meta', () => {
    const parsed = parseArgs(['extract', 'fixture.unitypackage', 'out', '--path', 'Assets/A.cs', '--with-meta']);

    expect(parsed.flags['with-meta']).toBe(true);
  });

  it('parses --path-file, --exclude, and --dry-run', () => {
    const parsed = parseArgs([
      'extract',
      'fixture.unitypackage',
      'out',
      '--path-file',
      'paths.txt',
      '--exclude',
      'Assets/Ignore/**',
      '--dry-run',
    ]);

    expect(parsed.flags['path-file']).toBe('paths.txt');
    expect(parsed.flags.exclude).toBe('Assets/Ignore/**');
    expect(parsed.flags['dry-run']).toBe(true);
  });

  it('rejects --with-meta without --path after reading package bytes', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    await writeFile(packagePath, buildSingleScriptPackage());
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`exit ${String(code)}`);
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(cli(['extract', packagePath, path.join(dir, 'out'), '--with-meta'])).rejects.toThrow(`exit ${EXIT.ERROR}`);
      const stderr = errorSpy.mock.calls.map(call => call[0]).join('\n');
      expect(stderr).toContain('extract --with-meta requires at least one --path selection.');
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('rejects --filter combined with --path before reading package bytes', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`exit ${String(code)}`);
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(cli([
        'extract',
        'missing.unitypackage',
        'out',
        '--filter',
        '**/*.cs',
        '--path',
        'Assets/A.cs',
      ])).rejects.toThrow(`exit ${EXIT.ERROR}`);
      const stderr = errorSpy.mock.calls.map(call => call[0]).join('\n');
      expect(stderr).toContain('extract --filter and --path cannot be combined.');
      expect(stderr).not.toContain('Cannot read file');
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe('cli web options', () => {
  it('parses --host', () => {
    const parsed = parseArgs(['web', '--port', '4173', '--host', '127.0.0.1']);

    expect(parsed.flags.port).toBe('4173');
    expect(parsed.flags.host).toBe('127.0.0.1');
  });
});

describe('cli parse guard options', () => {
  it('parses global safety limits into shared parser options', () => {
    const parseOptions = parseGlobalParseOptions({
      'max-output-bytes': '1024',
      'max-entries': '25',
    });

    expect(parseOptions).toEqual({ maxOutputBytes: 1024, maxEntries: 25 });
  });

  it('rejects invalid guard values before reading package bytes', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`exit ${String(code)}`);
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(cli(['inspect', 'missing.unitypackage', '--max-entries', '1.5'])).rejects.toThrow(`exit ${EXIT.ERROR}`);
      expect(errorSpy.mock.calls.map(call => call[0]).join('\n')).toContain('Invalid --max-entries: 1.5');
      expect(errorSpy.mock.calls.map(call => call[0]).join('\n')).not.toContain('Cannot read file');
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('maps byte guard failures to EXIT.BOMB and reports observed bytes', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    await writeFile(packagePath, buildSingleScriptPackage());
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`exit ${String(code)}`);
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(cli(['inspect', packagePath, '--max-output-bytes', '1'])).rejects.toThrow(`exit ${EXIT.BOMB}`);
      const stderr = errorSpy.mock.calls.map(call => call[0]).join('\n');
      expect(stderr).toContain('kind=output-bytes');
      expect(stderr).toContain('observed=');
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('maps entry guard failures to EXIT.BOMB and reports observed entries', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    await writeFile(packagePath, buildSingleScriptPackage());
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`exit ${String(code)}`);
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(cli(['verify', packagePath, '--max-entries', '0'])).rejects.toThrow(`exit ${EXIT.BOMB}`);
      const stderr = errorSpy.mock.calls.map(call => call[0]).join('\n');
      expect(stderr).toContain('kind=entry-count');
      expect(stderr).toContain('observed=1');
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('applies the same entry guard plumbing to other parse-consuming commands', async () => {
    const dir = await makeTempDir();
    const packagePath = path.join(dir, 'fixture.unitypackage');
    await writeFile(packagePath, buildSingleScriptPackage());
    const cases = [
      ['extract', packagePath, path.join(dir, 'out'), '--max-entries', '0'],
      ['diff', packagePath, packagePath, '--max-entries', '0'],
    ];

    for (const args of cases) {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
        throw new Error(`exit ${String(code)}`);
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        await expect(cli(args)).rejects.toThrow(`exit ${EXIT.BOMB}`);
        expect(errorSpy.mock.calls.map(call => call[0]).join('\n')).toContain('kind=entry-count');
      } finally {
        exitSpy.mockRestore();
        errorSpy.mockRestore();
      }
    }
  });
});

describe('concurrency helpers', () => {
  it('limits concurrent work', async () => {
    const limit = createLimiter(3);
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;

    const promises = Array.from({ length: 6 }, () =>
      limit(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>(resolve => releases.push(resolve));
        active--;
      }),
    );

    for (let index = 0; index < 6; index++) {
      while (releases.length === 0) {
        await Promise.resolve();
      }
      releases.shift()?.();
      await Promise.resolve();
    }

    await Promise.all(promises);
    expect(maxActive).toBe(3);
  });
});
