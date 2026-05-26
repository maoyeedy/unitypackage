import { useMemo } from 'react';
import type { UnityPackageParseDiagnostic } from 'unitypackage-core';
import type { UnityPackageAnalysisFinding, PackageFileRecord } from '../packageModel';
import { formatBytes } from '../packageModel';

export function Stats({
  records,
  filteredCount,
  totalBytes,
  diagnostics,
  analysis,
}: {
  records: PackageFileRecord[];
  filteredCount: number;
  totalBytes: number;
  diagnostics: UnityPackageParseDiagnostic[];
  analysis: UnityPackageAnalysisFinding[];
}) {
  const assetCount = records.filter(record => !record.isUnityPreview && record.extension !== 'meta').length;
  const metaCount = records.filter(record => record.extension === 'meta').length;
  const previewCount = records.filter(record => record.isUnityPreview).length;

  const errorCount = (diagnostics.filter(d => d.severity === 'error').length + analysis.filter(f => f.severity === 'error').length);
  const warnCount = (diagnostics.filter(d => d.severity === 'warning').length + analysis.filter(f => f.severity === 'warning').length);
  const infoCount = (diagnostics.filter(d => d.severity === 'info').length + analysis.filter(f => f.severity === 'info').length);

  const extStats = useMemo(() => {
    const counts: Record<string, number> = {};
    const sizes: Record<string, number> = {};
    for (const r of records) {
      const ext = r.extension ? `.${r.extension}` : '(none)';
      counts[ext] = (counts[ext] ?? 0) + 1;
      sizes[ext] = (sizes[ext] ?? 0) + r.byteLength;
    }
    const byCount = Object.entries(counts)
      .map(([ext, count]) => ({ ext, count }))
      .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext))
      .slice(0, 5);
    const bySize = Object.entries(sizes)
      .map(([ext, size]) => ({ ext, size }))
      .sort((a, b) => b.size - a.size || a.ext.localeCompare(b.ext))
      .slice(0, 5);
    return { byCount, bySize };
  }, [records]);

  return (
    <div className="stats-container" style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
      <dl className="stats-grid">
        <div>
          <dt>Records</dt>
          <dd>{filteredCount.toString()} / {records.length.toString()}</dd>
        </div>
        <div>
          <dt>Assets</dt>
          <dd>{assetCount.toString()}</dd>
        </div>
        <div>
          <dt>Meta</dt>
          <dd>{metaCount.toString()}</dd>
        </div>
        <div>
          <dt>Previews</dt>
          <dd>{previewCount.toString()}</dd>
        </div>
        <div>
          <dt>Bytes</dt>
          <dd>{formatBytes(totalBytes)}</dd>
        </div>
        <div>
          <dt>Errors</dt>
          <dd>{errorCount.toString()}</dd>
        </div>
        <div>
          <dt>Warnings</dt>
          <dd>{warnCount.toString()}</dd>
        </div>
        <div>
          <dt>Info</dt>
          <dd>{infoCount.toString()}</dd>
        </div>
      </dl>

      {records.length > 0 && (
        <div className="top-extensions-section" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 600 }}>Top Extensions</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <h5 style={{ margin: '0 0 6px 0', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)' }}>By Count</h5>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {extStats.byCount.map(({ ext, count }) => (
                  <li key={ext} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text)' }}>
                    <code style={{ fontSize: '0.72rem' }}>{ext}</code>
                    <span>{count.toString()}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h5 style={{ margin: '0 0 6px 0', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)' }}>By Size</h5>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {extStats.bySize.map(({ ext, size }) => (
                  <li key={ext} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text)' }}>
                    <code style={{ fontSize: '0.72rem' }}>{ext}</code>
                    <span className="text-muted" style={{ color: 'var(--muted)' }}>{formatBytes(size)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
