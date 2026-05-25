import type { UnityPackageDiagnosticSeverity, UnityPackageEntry } from './model';
import type { MetaImporterType } from './meta';
import { detectMetaImporterType, readDeclaredMetaImporter, readMetaGuid } from './meta';
import { detectPathnameCollisions, validatePathname } from './pathname';
import type { UnityPackageParseDiagnostic } from './parse';

export type UnityPackageAnalysisFindingCode =
  | 'parser-diagnostic'
  | 'unsafe-pathname'
  | 'duplicate-pathname'
  | 'case-colliding-pathname'
  | 'duplicate-guid'
  | 'meta-guid-mismatch'
  | 'meta-missing'
  | 'meta-importer-mismatch';

export interface UnityPackageAnalysisFinding {
  code: UnityPackageAnalysisFindingCode;
  severity: UnityPackageDiagnosticSeverity;
  message: string;
  guid?: string;
  pathname?: string;
  path?: string;
}

export interface UnityPackageAnalysisSummary {
  info: number;
  warning: number;
  error: number;
}

export interface UnityPackageAnalysisResult {
  findings: UnityPackageAnalysisFinding[];
  summary: UnityPackageAnalysisSummary;
}

export function analyzeUnityPackageEntries(
  entries: UnityPackageEntry[],
  parseDiagnostics: UnityPackageParseDiagnostic[] = [],
): UnityPackageAnalysisResult {
  const findings: UnityPackageAnalysisFinding[] = [];

  for (const diagnostic of parseDiagnostics) {
    findings.push({
      code: 'parser-diagnostic',
      severity: diagnostic.severity,
      message: diagnostic.message,
      guid: diagnostic.guid,
      path: diagnostic.path,
    });
  }

  const guidCounts = new Map<string, number>();
  for (const entry of entries) {
    guidCounts.set(entry.guid, (guidCounts.get(entry.guid) ?? 0) + 1);
  }

  for (const entry of entries) {
    const pathValidation = validatePathname(entry.pathname, { guid: entry.guid });
    if (!pathValidation.ok) {
      findings.push({
        code: 'unsafe-pathname',
        severity: 'error',
        message: pathValidation.detail
          ? `Pathname is unsafe (${pathValidation.reason}): ${pathValidation.detail}`
          : `Pathname is unsafe (${pathValidation.reason}).`,
        guid: entry.guid,
        pathname: entry.pathname,
        path: entry.pathname,
      });
    }

    if ((guidCounts.get(entry.guid) ?? 0) > 1) {
      findings.push({
        code: 'duplicate-guid',
        severity: 'error',
        message: 'GUID appears on more than one package entry.',
        guid: entry.guid,
        pathname: entry.pathname,
      });
    }

    if (entry.asset !== undefined && entry.meta === undefined) {
      findings.push({
        code: 'meta-missing',
        severity: 'warning',
        message: 'Entry has asset content but no meta content.',
        guid: entry.guid,
        pathname: entry.pathname,
        path: `${entry.guid}/asset.meta`,
      });
    }

    if (entry.meta !== undefined) {
      const declaredGuid = readMetaGuid(entry.meta);
      if (declaredGuid !== null && declaredGuid !== entry.guid.toLowerCase()) {
        findings.push({
          code: 'meta-guid-mismatch',
          severity: 'error',
          message: `Meta GUID ${declaredGuid} does not match archive GUID ${entry.guid}.`,
          guid: entry.guid,
          pathname: entry.pathname,
          path: `${entry.guid}/asset.meta`,
        });
      }

      const declaredImporter = readDeclaredMetaImporter(entry.meta);
      if (declaredImporter?.kind === 'known') {
        const expectedImporter = detectMetaImporterType(entry.pathname, entry.asset === undefined);
        if (!importersCompatible(declaredImporter.type, expectedImporter)) {
          findings.push({
            code: 'meta-importer-mismatch',
            severity: 'warning',
            message: `Meta importer ${declaredImporter.type} does not match expected ${expectedImporter}.`,
            guid: entry.guid,
            pathname: entry.pathname,
            path: `${entry.guid}/asset.meta`,
          });
        }
      }
    }
  }

  for (const collision of detectPathnameCollisions(entries)) {
    findings.push({
      code: collision.exactDuplicates ? 'duplicate-pathname' : 'case-colliding-pathname',
      severity: 'error',
      message: collision.exactDuplicates
        ? `Pathname appears more than once: ${collision.pathname}`
        : `Pathnames collide after case-folding: ${collision.caseFolded}`,
      pathname: collision.pathname,
      path: collision.pathname,
    });
  }

  return {
    findings,
    summary: summarizeFindings(findings),
  };
}

function importersCompatible(declared: MetaImporterType, expected: MetaImporterType): boolean {
  if (declared === expected) return true;
  if (declared === 'DefaultImporter' && expected === 'DefaultImporterFolder') return true;
  return false;
}

function summarizeFindings(findings: UnityPackageAnalysisFinding[]): UnityPackageAnalysisSummary {
  const summary: UnityPackageAnalysisSummary = { info: 0, warning: 0, error: 0 };
  for (const finding of findings) {
    summary[finding.severity] += 1;
  }
  return summary;
}
