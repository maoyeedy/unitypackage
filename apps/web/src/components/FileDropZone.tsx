import React from 'react';
import { useState } from 'react';

interface FileDropZoneProps {
  onFileDrop: (file: File) => void;
  label: string;
  invalidFileMessage: string;
}

const FileDropZone: React.FC<FileDropZoneProps> = ({ onFileDrop, label, invalidFileMessage }) => {
  const [isDragActive, setIsDragActive] = useState(false);

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.unitypackage')) {
        onFileDrop(file);
      } else {
        alert(invalidFileMessage);
      }
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.unitypackage')) {
        onFileDrop(file);
      } else {
        alert(invalidFileMessage);
      }
      e.target.value = '';
    }
  };

  return (
    <>
      <div
        id="dropZone"
        className={isDragActive ? 'drag-active' : undefined}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => document.getElementById('fileInput')?.click()}
      >
        {label}
      </div>
      <input
        type="file"
        id="fileInput"
        style={{ display: 'none' }}
        accept=".unitypackage"
        onChange={handleFileInputChange}
      />
    </>
  );
};

export default FileDropZone;
