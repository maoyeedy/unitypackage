import { useEffect } from 'react';
import type { UnityPackageParseDiagnostic } from 'unitypackage-core';
import type { UnityPackageAnalysisFinding, PackageFileRecord } from '../packageModel';

function severityLabel(severity: UnityPackageAnalysisFinding['severity']): string {
  switch (severity) {
    case 'error': return 'ERR';
    case 'warning': return 'WRN';
    case 'info': return 'INF';
  }
}

function findBestMatchingRecord(
  records: PackageFileRecord[],
  finding: UnityPackageAnalysisFinding,
): PackageFileRecord | undefined {
  if (finding.guid !== undefined) {
    const guid = finding.guid;
    if (finding.path !== undefined) {
      const path = finding.path;
      const exact = records.find(r => r.guid === guid && (r.id.endsWith(`/${path}`) || r.id === path));
      if (exact) return exact;
    }
    return records.find(r => r.guid === guid && !r.isUnityPreview && r.extension !== 'meta')
      ?? records.find(r => r.guid === guid);
  }
  if (finding.pathname !== undefined) {
    const pathname = finding.pathname;
    return records.find(r => r.pathname === pathname);
  }
  return undefined;
}

export function DiagnosticsDrawer({
  diagnostics,
  analysis,
  records,
  diagCodes,
  diagCodeFilter,
  onDiagCodeFilterChange,
  onNavigate,
  onClose,
}: {
  diagnostics: UnityPackageParseDiagnostic[];
  analysis: UnityPackageAnalysisFinding[];
  records: PackageFileRecord[];
  diagCodes: string[];
  diagCodeFilter: Set<string>;
  onDiagCodeFilterChange: (code: string) => void;
  onNavigate: (recordId: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <aside className="diagnostics-drawer" aria-label="Diagnostics">
      <div className="diagnostics-drawer-header">
        <h2>Diagnostics &amp; Findings</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close diagnostics"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            color: 'var(--text)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem',
            lineHeight: 1,
          }}
        >
          &times;
        </button>
      </div>
      {diagCodes.length > 0 && (
        <div className="diag-code-filter">
          <p className="diag-code-filter-label">Filter by code</p>
          <div className="chip-group" aria-label="Diagnostic code filter">
            {diagCodes.map(code => (
              <button
                key={code}
                type="button"
                id={`diag-chip-${code}`}
                className={`chip chip-diag${diagCodeFilter.has(code) ? ' active' : ''}`}
                aria-pressed={diagCodeFilter.has(code)}
                onClick={() => { onDiagCodeFilterChange(code); }}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      )}
      <ul className="diagnostics-list">
        {diagnostics.map((diagnostic, index) => {
          const target = diagnostic.guid !== undefined
            ? (records.find(r => r.guid === diagnostic.guid && !r.isUnityPreview && r.extension !== 'meta')
               ?? records.find(r => r.guid === diagnostic.guid))
            : (diagnostic.path !== undefined
               ? records.find(r => r.id.endsWith(`/${diagnostic.path}`) || r.id === diagnostic.path)
               : undefined);
          const pathToShow = target?.virtualPath ?? diagnostic.path;

          return (
            <li
              key={`parser-${diagnostic.code}-${index.toString()}`}
              className={`diagnostic-row severity-${diagnostic.severity}`}
              style={{ cursor: target ? 'pointer' : 'default' }}
              onClick={() => { if (target) onNavigate(target.id); }}
            >
              <div className="diagnostic-row-meta">
                <span className="diagnostic-badge">{severityLabel(diagnostic.severity)}</span>
                <span className="diagnostic-code">{diagnostic.code}</span>
              </div>
              <span className="diagnostic-message">{diagnostic.message}</span>
              {pathToShow && (
                <span className="diagnostic-path">
                  <strong>Path:</strong> {pathToShow}
                </span>
              )}
              {target ? (
                <button
                  type="button"
                  className="diagnostic-navigate"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate(target.id);
                  }}
                >
                  Go
                </button>
              ) : null}
            </li>
          );
        })}
        {analysis.map((finding, index) => {
          const target = findBestMatchingRecord(records, finding);
          const pathToShow = target?.virtualPath ?? finding.pathname ?? finding.path;

          return (
            <li
              key={`analysis-${finding.code}-${index.toString()}`}
              className={`diagnostic-row severity-${finding.severity}`}
              style={{ cursor: target ? 'pointer' : 'default' }}
              onClick={() => { if (target) onNavigate(target.id); }}
            >
              <div className="diagnostic-row-meta">
                <span className="diagnostic-badge">{severityLabel(finding.severity)}</span>
                <span className="diagnostic-code">{finding.code}</span>
              </div>
              <span className="diagnostic-message">{finding.message}</span>
              {pathToShow && (
                <span className="diagnostic-path">
                  <strong>Path:</strong> {pathToShow}
                </span>
              )}
              {target ? (
                <button
                  type="button"
                  className="diagnostic-navigate"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate(target.id);
                  }}
                >
                  Go
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
