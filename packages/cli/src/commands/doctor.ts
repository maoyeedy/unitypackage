import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseUnityPackageEntries } from 'unitypackage-core';
import { CliError, EXIT } from '../util/exit.js';
import { info, warn, error } from '../util/logger.js';
import { sanitizeFsPath } from '../util/path.js';

export type DoctorCheckLevel = 'ok' | 'warn' | 'error';

export interface DoctorCheck {
  level: DoctorCheckLevel;
  code: string;
  message: string;
  entry?: string;
}

export interface DoctorResult {
  schemaVersion: 0;
  package: { path: string; size: number };
  summary: { entries: number; ok: number; warnings: number; errors: number };
  checks: DoctorCheck[];
}

const UNITY_GUID_PATTERN = /^[0-9a-fA-F]{32}$/;

export async function doctor(packagePath: string, opts: { json?: boolean } = {}): Promise<DoctorResult> {
  const raw = await readFile(packagePath).catch(() => {
    throw new CliError(`Cannot read file: ${packagePath}`, EXIT.IO);
  });
  const checks: DoctorCheck[] = [];

  function check(level: DoctorCheckLevel, code: string, message: string, entry?: string): void {
    checks.push({ level, code, message, ...(entry !== undefined && { entry }) });
  }

  let entries;
  try {
    entries = parseUnityPackageEntries(new Uint8Array(raw));
  } catch (err) {
    check('error', 'PARSE_FAILED', `Failed to parse package: ${err instanceof Error ? err.message : String(err)}`);
    return output(packagePath, raw.length, 0, checks, opts);
  }

  for (const diagnostic of entries.diagnostics) {
    check(
      'warn',
      `PARSER_${diagnostic.code.toUpperCase().replaceAll('-', '_')}`,
      diagnostic.message,
      diagnostic.path,
    );
  }

  if (entries.length === 0) {
    check('warn', 'NO_ENTRIES', 'Package contains no asset records.');
  }

  const seenPaths = new Set<string>();
  for (const entry of entries) {
    if (!UNITY_GUID_PATTERN.test(entry.guid)) {
      check('warn', 'NON_STANDARD_GUID', `GUID is not 32 hexadecimal characters: ${entry.guid}`, entry.guid);
    }

    if (!entry.pathname.startsWith('Assets/')) {
      check('warn', 'PATH_OUTSIDE_ASSETS', `Pathname does not start with Assets/: ${entry.pathname}`, entry.pathname);
    }

    if (entry.pathname.includes('\\')) {
      check('warn', 'BACKSLASH_PATH', `Pathname should use forward slashes: ${entry.pathname}`, entry.pathname);
    }

    if (hasUnsafePathname(entry.pathname)) {
      check('error', 'UNSAFE_PATHNAME', `Pathname is absolute or contains traversal: ${entry.pathname}`, entry.pathname);
    }

    if (!entry.meta) {
      check('warn', 'MISSING_META', 'Entry has no asset.meta or legacy metaData file.', entry.pathname);
    }

    const sanitized = sanitizeFsPath(entry.pathname).toLowerCase();
    if (seenPaths.has(sanitized)) {
      check('warn', 'DUPLICATE_OUTPUT_PATH', `Pathname collides after filesystem sanitization: ${entry.pathname}`, entry.pathname);
    } else {
      seenPaths.add(sanitized);
    }
  }

  if (checks.length === 0) {
    check('ok', 'PACKAGE_HEALTHY', 'No package health issues found.');
  }

  return output(packagePath, raw.length, entries.length, checks, opts);
}

function hasUnsafePathname(pathname: string): boolean {
  const normalized = path.posix.normalize(pathname.replaceAll('\\', '/'));
  return (
    pathname.startsWith('/') ||
    pathname.startsWith('\\') ||
    /^[/\\]{2}/.test(pathname) ||
    /^[A-Za-z]:[\\/]/.test(pathname) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  );
}

function output(
  packagePath: string,
  size: number,
  entries: number,
  checks: DoctorCheck[],
  opts: { json?: boolean },
): DoctorResult {
  const result: DoctorResult = {
    schemaVersion: 0,
    package: { path: packagePath, size },
    summary: {
      entries,
      ok: checks.filter(check => check.level === 'ok').length,
      warnings: checks.filter(check => check.level === 'warn').length,
      errors: checks.filter(check => check.level === 'error').length,
    },
    checks,
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    for (const check of checks) {
      const message = check.entry ? `${check.code}: [${check.entry}] ${check.message}` : `${check.code}: ${check.message}`;
      if (check.level === 'error') {
        error(message);
      } else if (check.level === 'warn') {
        warn(message);
      } else {
        info(message);
      }
    }
    info(`\nDoctor: ${result.summary.errors} error(s), ${result.summary.warnings} warning(s).`);
  }

  return result;
}
