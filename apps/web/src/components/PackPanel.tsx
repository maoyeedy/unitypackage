import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  File,
  Info,
  PackagePlus,
  RefreshCw,
  UploadCloud,
} from 'lucide-react';
import type { CreateUnityPackageDiagnostic } from 'unitypackage-core';
import {
  formatBytes,
  type PackageFileRecord,
  type PackValidation,
  type PackDraftDiagnostic,
} from '../packageModel';

export function PackPanel({
  stagedRecords,
  validation,
  isPacking,
  packDiagnostics,
  onExport,
  onRemove,
  onClear,
  onClearDraft,
  gzipLevel,
  setGzipLevel,
  exportFilename,
  setExportFilename,
  estimatedSize,
  successExport,
  onDownloadAgain,
  onShowInList,
  highlightedRecordId,
  onPathnameChange,
  onImportFiles,
}: {
  stagedRecords: PackageFileRecord[];
  validation: PackValidation;
  isPacking: boolean;
  packDiagnostics: CreateUnityPackageDiagnostic[];
  onExport: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onClearDraft: () => void;
  gzipLevel: number;
  setGzipLevel: (level: number) => void;
  exportFilename: string;
  setExportFilename: (name: string) => void;
  estimatedSize: number;
  successExport: { bytes: Uint8Array; filename: string } | null;
  onDownloadAgain: () => void;
  onShowInList: (id: string) => void;
  highlightedRecordId: string | null;
  onPathnameChange: (id: string, newPathname: string) => void;
  onImportFiles: (dt: DataTransfer) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer) {
      onImportFiles(e.dataTransfer);
    }
  };

  const findStagedRecordForDiag = (diag: CreateUnityPackageDiagnostic) => {
    if (diag.guid) {
      const found = stagedRecords.find(r => r.guid === diag.guid);
      if (found) return found;
    }
    if (diag.path) {
      const pathnamePart = diag.path.includes('/') && diag.path.split('/')[0]?.length === 32
        ? diag.path.split('/').slice(1).join('/')
        : diag.path;
      const found = stagedRecords.find(r => r.pathname === pathnamePart || r.virtualPath === diag.path || r.id === diag.path);
      if (found) return found;
    }
    return null;
  };

  const globalValidationDiags = validation.diagnostics.filter((d: PackDraftDiagnostic) => !d.recordId);
  const isFilenameEmpty = !exportFilename.trim();
  const globalDiags = [...globalValidationDiags];
  if (isFilenameEmpty) {
    globalDiags.push({
      code: 'empty-entries',
      message: 'Output filename cannot be empty.',
    });
  }

  const isExportDisabled = validation.status !== 'ready' || isFilenameEmpty || isPacking;

  return (
    <section className="pack-panel">
      <div className="panel-toolbar">
        <div>
          <h2>Pack</h2>
          <p>{validation.createEntryCount.toString()} future package entries staged</p>
        </div>
        <div className="button-row">
          <button type="button" disabled={stagedRecords.length === 0} onClick={onClear}>
            <RefreshCw aria-hidden="true" size={16} />
            <span>Clear</span>
          </button>
          <button type="button" onClick={onClearDraft} id="clear-draft-btn">
            <RefreshCw aria-hidden="true" size={16} />
            <span>Clear draft</span>
          </button>
          <button
            type="button"
            disabled={isExportDisabled}
            onClick={onExport}
          >
            <PackagePlus aria-hidden="true" size={16} />
            <span>{isPacking ? 'Exporting...' : 'Export .unitypackage'}</span>
          </button>
        </div>
      </div>

      {successExport && (
        <div className="pack-status success" role="status">
          <CheckCircle aria-hidden="true" size={18} />
          <div>
            <strong>Package exported successfully!</strong>
            <div className="success-details">
              Filename: <code>{successExport.filename}</code>
              <br />
              Size: {formatBytes(successExport.bytes.length)}
            </div>
            <button
              type="button"
              className="text-button download-again-btn"
              onClick={onDownloadAgain}
            >
              Download again
            </button>
          </div>
        </div>
      )}

      {packDiagnostics.length > 0 && (
        <div className="pack-status error" role="status">
          <AlertTriangle aria-hidden="true" size={18} />
          <div>
            <strong>Package creation failed</strong>
            <ul className="pack-diagnostic-list" style={{ marginTop: '0.25rem', paddingLeft: '0', listStyle: 'none' }}>
              {packDiagnostics.map((diag, index) => {
                const target = findStagedRecordForDiag(diag);
                return (
                  <li key={index} className="creation-diagnostic-item" style={{ fontSize: '0.8125rem' }}>
                    <span>
                      [{diag.code}] {diag.message} {diag.path ? `(${diag.path})` : ''}
                    </span>
                    {target && (
                      <button
                        type="button"
                        className="text-button show-in-list-btn"
                        style={{ marginLeft: '8px', fontSize: '0.75rem' }}
                        onClick={() => onShowInList(target.id)}
                      >
                        Show in list
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      <div className="pack-controls">
        <div className="pack-control-group">
          <label htmlFor="export-filename">Output filename</label>
          <input
            id="export-filename"
            type="text"
            value={exportFilename}
            onChange={(e) => setExportFilename(e.target.value)}
            placeholder="unitypackage-name.unitypackage"
          />
        </div>

        <div className="pack-control-group">
          <label htmlFor="gzip-level">Compression level</label>
          <select
            id="gzip-level"
            value={gzipLevel}
            onChange={(e) => setGzipLevel(Number(e.target.value))}
          >
            <option value={0}>0 (Store - No compression)</option>
            <option value={1}>1 (Fastest)</option>
            <option value={3}>3 (Fast)</option>
            <option value={6}>6 (Balanced - Default)</option>
            <option value={9}>9 (Smallest)</option>
          </select>
        </div>

        <div className="pack-size-estimate">
          <div className="size-info">
            <span>Estimated uncompressed size:</span>
            <span className="size-value">{formatBytes(estimatedSize)}</span>
          </div>
          {estimatedSize > 1073741824 && (
            <div className="warning-banner">
              <AlertTriangle size={14} />
              <span>Warning: Estimated size exceeds 1 GiB. Large packages may cause slow exports.</span>
            </div>
          )}
        </div>
      </div>

      {globalDiags.length > 0 && (
        <div className="pack-status error" role="status" style={{ margin: '12px' }}>
          <AlertTriangle aria-hidden="true" size={18} />
          <ul style={{ paddingLeft: '1.25rem', margin: 0 }}>
            {globalDiags.map((d: PackDraftDiagnostic, i: number) => (
              <li key={i}>{d.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div
        className={`staged-list-container ${isDragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="staged-list-header">
          <h3>Staged Entries</h3>
          <span
            className="order-note-icon"
            title="Entries are written in deterministic GUID order."
            aria-label="Entries are written in deterministic GUID order."
          >
            <Info aria-hidden="true" size={14} />
          </span>
        </div>
        {stagedRecords.length === 0 ? (
          <div className="drag-drop-placeholder">
            <UploadCloud size={32} />
            <p>Drop files or use Stage for Pack in the explorer.</p>
          </div>
        ) : (
          <div className="staged-list">
            {stagedRecords.map(record => {
              const recordDiags = validation.diagnostics.filter(d => d.recordId === record.id);
              const isHighlighted = record.id === highlightedRecordId;
              return (
                <div
                  key={record.id}
                  id={`staged-row-${record.id}`}
                  className={`staged-row-wrapper ${isHighlighted ? 'highlighted' : ''}`}
                >
                  <div className="staged-row" style={{ width: '100%' }}>
                    <File aria-hidden="true" size={16} style={{ flexShrink: 0 }} />
                    {record.isRawImported ? (
                      <input
                        type="text"
                        className="staged-pathname-input"
                        value={record.pathname}
                        onChange={(e) => onPathnameChange(record.id, e.target.value)}
                        style={{
                          flex: 1,
                          background: 'transparent',
                          border: '1px solid var(--border)',
                          borderRadius: '4px',
                          color: 'var(--text)',
                          padding: '2px 6px',
                          fontSize: '0.875rem',
                          minWidth: 0,
                        }}
                      />
                    ) : (
                      <span className="staged-row-path">{record.virtualPath}</span>
                    )}
                    <span className="staged-row-size">{formatBytes(record.byteLength)}</span>
                    <button
                      type="button"
                      className="icon-button"
                      style={{ flexShrink: 0 }}
                      aria-label={`Remove ${record.fileName}`}
                      onClick={() => { onRemove(record.id); }}
                    >
                      <RefreshCw aria-hidden="true" size={15} />
                    </button>
                  </div>
                  {recordDiags.length > 0 && (
                    <div className="record-diagnostics">
                      {recordDiags.map((d: PackDraftDiagnostic, i: number) => (
                        <div key={i} className={`record-diagnostic-item ${d.code}`}>
                          <AlertTriangle size={12} />
                          <span>[{d.code}] {d.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
