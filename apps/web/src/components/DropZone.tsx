import { useState } from 'react';
import { RefreshCw, UploadCloud } from 'lucide-react';

export function DropZone({ isLoading, onPackageFile }: { isLoading: boolean; onPackageFile: (file: File) => void }) {
  const [isDragActive, setIsDragActive] = useState(false);

  return (
    <label
      className={`drop-zone${isDragActive ? ' drag-active' : ''}`}
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
      {isLoading ? <RefreshCw aria-hidden="true" className="spin" size={24} /> : <UploadCloud aria-hidden="true" size={24} />}
      <span>{isLoading ? 'Parsing package' : 'Drop a .unitypackage'}</span>
      <small>or choose a file</small>
      <input
        type="file"
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
