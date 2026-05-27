import { useState } from 'react';
import { FileArchive } from 'lucide-react';
import type { PackageFileRecord, SidecarSelectableRecord } from '../../packageModel';
import { PreviewHeader } from './PreviewHeader';
import { PreviewBody } from './PreviewBody';
import { Metadata } from './Metadata';

interface PreviewPanelProps {
  record: PackageFileRecord | null;
  metaSidecar?: PackageFileRecord;
  onDownload: (record: PackageFileRecord) => void;
  onRevealInTree: (recordId: string) => void;
  selectableRecords?: readonly SidecarSelectableRecord[];
}

export function PreviewPanel({
  record,
  metaSidecar,
  onDownload,
  onRevealInTree,
  selectableRecords,
}: PreviewPanelProps) {
  if (!record) {
    return (
      <div className="preview-empty">
        <FileArchive aria-hidden="true" size={42} />
        <h2>No file selected</h2>
        <p>Select a package file to preview it or download it.</p>
      </div>
    );
  }

  return (
    <PreviewPanelContent
      record={record}
      metaSidecar={metaSidecar}
      onDownload={onDownload}
      onRevealInTree={onRevealInTree}
      selectableRecords={selectableRecords}
    />
  );
}

function PreviewPanelContent({
  record,
  metaSidecar,
  onDownload,
  onRevealInTree,
  selectableRecords,
}: {
  record: PackageFileRecord;
  metaSidecar?: PackageFileRecord;
  onDownload: (record: PackageFileRecord) => void;
  onRevealInTree: (recordId: string) => void;
  selectableRecords?: readonly SidecarSelectableRecord[];
}) {
  const [previewMode, setPreviewMode] = useState<'asset' | 'meta'>('asset');
  const [prevId, setPrevId] = useState(record.id);

  if (record.id !== prevId) {
    setPrevId(record.id);
    if (previewMode !== 'asset') {
      setPreviewMode('asset');
    }
  }

  const previewRecord = previewMode === 'meta' && metaSidecar ? metaSidecar : record;

  return (
    <>
      <PreviewHeader
        previewRecord={previewRecord}
        metaSidecar={metaSidecar}
        previewMode={previewMode}
        setPreviewMode={setPreviewMode}
        onDownload={onDownload}
        onRevealInTree={onRevealInTree}
      />
      <PreviewBody record={previewRecord} />
      {previewMode === 'asset' ? (
        <Metadata
          record={record}
          metaSidecar={metaSidecar}
          onRevealInTree={onRevealInTree}
          selectableRecords={selectableRecords}
        />
      ) : null}
    </>
  );
}
