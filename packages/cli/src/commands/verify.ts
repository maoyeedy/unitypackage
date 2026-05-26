import { gunzipSync } from 'node:zlib';
import {
  analyzeUnityPackageEntries,
  type ParseUnityPackageOptions,
  type UnityPackageAnalysisFinding,
} from 'unitypackage-core';
import { info, warn, error } from '../util/logger.js';
import { EXIT, CliError } from '../util/exit.js';
import { parsePackageBytes, readPackageBytes } from '../util/package.js';
import { writeJsonResult } from '../util/output.js';

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

export interface VerifyOptions {
  json?: boolean;
  strict?: boolean;
  parseOptions?: ParseUnityPackageOptions;
}

interface TarFile {
  path: string;
  content: Uint8Array;
}

export async function verify(packagePath: string, opts: VerifyOptions = {}): Promise<VerifyResult> {
  const raw = await readPackageBytes(packagePath);

  const findings: Finding[] = [];

  function finding(level: FindingLevel, code: string, message: string, entry?: string): void {
    findings.push({ level, code, message, ...(entry !== undefined && { entry }) });
  }

  let entries: ReturnType<typeof parsePackageBytes>['entries'];
  let parseDiagnostics: ReturnType<typeof parsePackageBytes>['diagnostics'];
  try {
    const parsed = parsePackageBytes(raw, opts.parseOptions);
    entries = parsed.entries;
    parseDiagnostics = parsed.diagnostics;
  } catch (err) {
    if (err instanceof Error && err.name === 'DecompressionBombError') throw err;
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

  const analysis = analyzeUnityPackageEntries(entries, parseDiagnostics);
  for (const analysisFinding of analysis.findings) {
    if (analysisFinding.code === 'parser-diagnostic') continue;
    const mappedFinding = mapAnalysisFinding(analysisFinding);
    finding(mappedFinding.level, mappedFinding.code, mappedFinding.message, mappedFinding.entry);
  }

  for (const tarFile of listTarFiles(new Uint8Array(raw))) {
    const [, filename, ...rest] = tarFile.path.split('/');
    if (!filename || rest.length > 0) continue;
    if (!['pathname', 'asset', 'asset.meta', 'preview.png', 'metaData'].includes(filename)) {
      finding('warn', 'UNEXPECTED_FILE', `Unexpected file in GUID directory: ${filename}`, tarFile.path);
    }
  }

  if (entries.length === 0) {
    finding('warn', 'NO_ENTRIES', 'Package contains no asset records.');
  }

  for (const entry of entries) {
    if (!entry.pathname.startsWith('Assets/')) {
      finding('warn', 'PATH_OUTSIDE_ASSETS', `Pathname does not start with Assets/: ${entry.pathname}`, entry.pathname);
    }

    if (entry.pathname.includes('\\')) {
      finding('warn', 'BACKSLASH_PATH', `Pathname should use forward slashes: ${entry.pathname}`, entry.pathname);
    }

    if (entry.pathname.length > 255) {
      finding('warn', 'LONG_PATH', `Pathname length ${entry.pathname.length} exceeds 255 chars`, entry.pathname);
    }
  }

  return output(packagePath, raw.length, findings, opts);
}

function mapAnalysisFinding(analysisFinding: UnityPackageAnalysisFinding): Finding {
  const level: FindingLevel = analysisFinding.severity === 'error' ? 'error' : 'warn';
  const entry = analysisFinding.pathname ?? analysisFinding.path;

  switch (analysisFinding.code) {
    case 'unsafe-pathname':
      return {
        level,
        code: 'UNSAFE_PATHNAME',
        message: analysisFinding.message,
        ...(entry !== undefined && { entry }),
      };
    case 'duplicate-guid':
      return {
        level,
        code: 'DUPLICATE_GUID',
        message: analysisFinding.message,
        ...(entry !== undefined && { entry }),
      };
    case 'meta-guid-mismatch':
      return {
        level,
        code: 'GUID_MISMATCH',
        message: analysisFinding.message,
        ...(entry !== undefined && { entry }),
      };
    case 'meta-missing':
      return {
        level,
        code: 'MISSING_META',
        message: analysisFinding.message,
        ...(entry !== undefined && { entry }),
      };
    case 'duplicate-pathname':
    case 'case-colliding-pathname':
      return {
        level,
        code: 'DUPLICATE_PATH',
        message: analysisFinding.message,
        ...(entry !== undefined && { entry }),
      };
    case 'meta-importer-mismatch':
      return {
        level,
        code: 'IMPORTER_MISMATCH',
        message: analysisFinding.message,
        ...(entry !== undefined && { entry }),
      };
    case 'parser-diagnostic':
      return {
        level,
        code: 'PARSER_DIAGNOSTIC',
        message: analysisFinding.message,
        ...(entry !== undefined && { entry }),
      };
  }
}

function output(packagePath: string, size: number, findings: Finding[], opts: VerifyOptions): VerifyResult {
  const hasErrors = findings.some(f => f.level === 'error');
  const hasStrictWarnings = opts.strict === true && findings.some(f => f.level === 'warn');
  const result: VerifyResult = {
    schemaVersion: 0,
    package: { path: packagePath, size },
    ok: !hasErrors && !hasStrictWarnings,
    findings,
  };

  if (opts.json) {
    writeJsonResult(result);
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
