import {
  analyzeUnityPackageEntries,
  parseUnityPackageEntries,
  type ParseUnityPackageOptions,
  type UnityPackageAnalysisFinding,
  type UnityPackageParseDiagnostic,
  type UnityPackageEntry,
} from 'unitypackage-core';
import { info, warn, error } from '../util/logger.js';
import { EXIT, CliError } from '../util/exit.js';
import { readPackageBytes } from '../util/package.js';
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


export async function verify(packagePath: string, opts: VerifyOptions = {}): Promise<VerifyResult> {
  const raw = await readPackageBytes(packagePath);

  const findings: Finding[] = [];

  function finding(level: FindingLevel, code: string, message: string, entry?: string): void {
    findings.push({ level, code, message, ...(entry !== undefined && { entry }) });
  }

  let entries: UnityPackageEntry[];
  let parseDiagnostics: UnityPackageParseDiagnostic[];
  try {
    const parsed = parseUnityPackageEntries(raw, opts.parseOptions);
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
    const isUnexpectedFile =
      diagnostic.code === 'unexpected-guid-directory-file' ||
      diagnostic.code === 'entries-outside-guid-directory';
    finding(
      level,
      isUnexpectedFile ? 'UNEXPECTED_FILE' : `PARSER_${diagnostic.code.toUpperCase().replaceAll('-', '_')}`,
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
