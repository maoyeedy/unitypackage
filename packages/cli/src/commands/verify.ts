import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseUnityPackageEntries } from 'unitypackage-core';
import { sanitizeFsPath } from '../util/path.js';
import { info, warn, error } from '../util/logger.js';
import { EXIT, CliError } from '../util/exit.js';

export type FindingLevel = 'warn' | 'error';

export interface Finding {
  level: FindingLevel;
  code: string;
  message: string;
  entry?: string;
}

export interface VerifyResult {
  schemaVersion: 0;
  package: { path: string; size: number };
  ok: boolean;
  findings: Finding[];
}

export async function verify(packagePath: string, opts: { json?: boolean } = {}): Promise<VerifyResult> {
  const raw = await readFile(packagePath).catch(() => {
    throw new CliError(`Cannot read file: ${packagePath}`, EXIT.IO);
  });

  const findings: Finding[] = [];

  function finding(level: FindingLevel, code: string, message: string, entry?: string): void {
    findings.push({ level, code, message, ...(entry !== undefined && { entry }) });
  }

  let entries;
  try {
    entries = parseUnityPackageEntries(new Uint8Array(raw));
  } catch (err) {
    finding('error', 'PARSE_FAILED', `Failed to parse package: ${err instanceof Error ? err.message : String(err)}`);
    return output(packagePath, raw.length, findings, opts);
  }

  const seenGuids = new Set<string>();
  const seenPaths = new Set<string>();

  for (const entry of entries) {
    // Duplicate GUID
    if (seenGuids.has(entry.guid)) {
      finding('error', 'DUPLICATE_GUID', `Duplicate GUID: ${entry.guid}`, entry.pathname);
    } else {
      seenGuids.add(entry.guid);
    }

    // Missing meta
    if (!entry.meta) {
      finding('warn', 'MISSING_META', `Entry has no meta file`, entry.pathname);
    }

    // Path traversal: normalized pathname must not escape with '..' or start with '/'
    const normalized = path.normalize(entry.pathname);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      finding('error', 'PATH_TRAVERSAL', `Pathname escapes output directory: ${entry.pathname}`, entry.pathname);
    }

    // Duplicate sanitized paths
    const normalizedPath = sanitizeFsPath(entry.pathname).toLowerCase();
    if (seenPaths.has(normalizedPath)) {
      finding('warn', 'DUPLICATE_PATH', `Duplicate sanitized pathname: ${entry.pathname}`, entry.pathname);
    } else {
      seenPaths.add(normalizedPath);
    }

    // Long paths
    if (entry.pathname.length > 255) {
      finding('warn', 'LONG_PATH', `Pathname length ${entry.pathname.length} exceeds 255 chars`, entry.pathname);
    }
  }

  return output(packagePath, raw.length, findings, opts);
}

function output(packagePath: string, size: number, findings: Finding[], opts: { json?: boolean }): VerifyResult {
  const hasErrors = findings.some(f => f.level === 'error');
  const result: VerifyResult = {
    schemaVersion: 0,
    package: { path: packagePath, size },
    ok: !hasErrors,
    findings,
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    if (findings.length === 0) {
      info('Package OK — no issues found.');
    } else {
      for (const f of findings) {
        const msg = f.entry ? `[${f.entry}] ${f.message}` : f.message;
        if (f.level === 'error') {
          error(`${f.code}: ${msg}`);
        } else {
          warn(`${f.code}: ${msg}`);
        }
      }
      info(`\n${findings.filter(f => f.level === 'error').length} error(s), ${findings.filter(f => f.level === 'warn').length} warning(s).`);
    }
  }

  if (hasErrors) throw new CliError('Package has errors.', EXIT.ERROR);
  return result;
}
