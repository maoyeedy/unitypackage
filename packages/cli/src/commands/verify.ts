import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseUnityPackageEntries } from 'unitypackage-core';
import { parseMeta } from '../util/meta.js';
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

interface TarFile {
  path: string;
  content: Uint8Array;
}

export async function verify(packagePath: string, opts: { json?: boolean; strict?: boolean } = {}): Promise<VerifyResult> {
  const raw = await readFile(packagePath).catch(() => {
    throw new CliError(`Cannot read file: ${packagePath}`, EXIT.IO);
  });

  const findings: Finding[] = [];

  function finding(level: FindingLevel, code: string, message: string, entry?: string): void {
    findings.push({ level, code, message, ...(entry !== undefined && { entry }) });
  }

  let entries: ReturnType<typeof parseUnityPackageEntries>['entries'];
  let parseDiagnostics: ReturnType<typeof parseUnityPackageEntries>['diagnostics'];
  try {
    const parsed = parseUnityPackageEntries(new Uint8Array(raw));
    entries = parsed.entries;
    parseDiagnostics = parsed.diagnostics;
  } catch (err) {
    finding('error', 'PARSE_FAILED', `Failed to parse package: ${err instanceof Error ? err.message : String(err)}`);
    return output(packagePath, raw.length, findings, opts);
  }

  for (const diagnostic of parseDiagnostics) {
    if (diagnostic.code === 'ignored-preview') continue;
    const level: FindingLevel = diagnostic.severity === 'error' ? 'error' : 'warn';
    finding(
      level,
      `PARSER_${diagnostic.code.toUpperCase().replaceAll('-', '_')}`,
      diagnostic.message,
      diagnostic.path,
    );
  }

  for (const tarFile of listTarFiles(new Uint8Array(raw))) {
    const [guid, filename, ...rest] = tarFile.path.split('/');
    if (!filename || rest.length > 0) continue;
    if (!['pathname', 'asset', 'asset.meta', 'preview.png', 'metaData'].includes(filename)) {
      finding('warn', 'UNEXPECTED_FILE', `Unexpected file in GUID directory: ${filename}`, tarFile.path);
    }

    if (filename === 'asset.meta') {
      const meta = parseMeta(new TextDecoder().decode(tarFile.content));
      if (meta && meta.guid !== guid) {
        finding('error', 'GUID_MISMATCH', `asset.meta GUID ${meta.guid} does not match directory GUID ${guid}`, tarFile.path);
      }
    }
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

function output(packagePath: string, size: number, findings: Finding[], opts: { json?: boolean; strict?: boolean }): VerifyResult {
  const hasErrors = findings.some(f => f.level === 'error');
  const hasStrictWarnings = opts.strict === true && findings.some(f => f.level === 'warn');
  const result: VerifyResult = {
    schemaVersion: 0,
    package: { path: packagePath, size },
    ok: !hasErrors && !hasStrictWarnings,
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
  if (hasStrictWarnings) throw new CliError('Package has warnings.', EXIT.WARN);
  return result;
}

function listTarFiles(raw: Uint8Array): TarFile[] {
  const data = gunzipSync(raw);
  const files: TarFile[] = [];
  let offset = 0;

  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;

    const name = new TextDecoder().decode(header.subarray(0, 100)).replace(/\0/g, '').trim();
    const sizeStr = new TextDecoder().decode(header.subarray(124, 136)).replace(/\0/g, '').trim();
    const size = parseInt(sizeStr, 8);
    offset += 512;

    if (name && !Number.isNaN(size) && offset + size <= data.length && !name.endsWith('/')) {
      files.push({ path: name, content: data.subarray(offset, offset + size) });
    }

    offset += Number.isNaN(size) ? 0 : Math.ceil(size / 512) * 512;
  }

  return files;
}
