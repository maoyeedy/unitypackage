import { useState } from 'react';
import { RefreshCw, UploadCloud } from 'lucide-react';

type DropZoneMode = 'empty' | 'compact';

export function DropZone({ mode = 'empty', isLoading, onPackageFile }: { mode?: DropZoneMode; isLoading: boolean; onPackageFile: (file: File) => void }) {
  const [isDragActive, setIsDragActive] = useState(false);
  const isCompact = mode === 'compact';
  const iconSize = isCompact ? 14 : 24;

  return (
    <label
      className={`drop-zone drop-zone--${mode}${isDragActive ? ' drag-active' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragActive(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsDragActive(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragActive(false);
        const file = event.dataTransfer.files[0];
        if (file?.name.endsWith('.unitypackage')) {
          onPackageFile(file);
        }
      }}
    >
      {isLoading ? <RefreshCw aria-hidden="true" className="spin" size={iconSize} /> : <UploadCloud aria-hidden="true" size={iconSize} />}
      {isCompact ? (
        <span>{isLoading ? 'Parsing' : 'Open'}</span>
      ) : (
        <>
          <span>{isLoading ? 'Parsing package' : 'Drop a .unitypackage'}</span>
          <small>or click to choose a file</small>
        </>
      )}
      <input
        type="file"
        aria-label="Open Unity package"
        accept=".unitypackage"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPackageFile(file);
          event.currentTarget.value = '';
        }}
      />
    </label>
  );
}
