import { Download } from 'lucide-react';
import { formatBytes, type PackageFileRecord } from '../../packageModel';

interface PreviewHeaderProps {
  previewRecord: PackageFileRecord;
  metaSidecar?: PackageFileRecord;
  previewMode: 'asset' | 'meta';
  setPreviewMode: (mode: 'asset' | 'meta') => void;
  onDownload: (record: PackageFileRecord) => void;
}

export function PreviewHeader({
  previewRecord,
  metaSidecar,
  previewMode,
  setPreviewMode,
  onDownload,
}: PreviewHeaderProps) {
  return (
    <header className="preview-header">
      <div>
        <p>{formatBytes(previewRecord.byteLength)}</p>
      </div>
      {metaSidecar ? (
        <div className="preview-mode-switch" role="group" aria-label="Preview source">
          <button
            type="button"
            className={previewMode === 'asset' ? 'active' : ''}
            onClick={() => { setPreviewMode('asset'); }}
          >
            Asset
          </button>
          <button
            type="button"
            className={previewMode === 'meta' ? 'active' : ''}
            onClick={() => { setPreviewMode('meta'); }}
          >
            .meta
          </button>
        </div>
      ) : null}
      <button
        type="button"
        aria-label={`Download ${previewRecord.fileName}`}
        title="Download file"
        onClick={() => { onDownload(previewRecord); }}
      >
        <Download aria-hidden="true" size={18} />
        <span>Download</span>
      </button>
    </header>
  );
}
