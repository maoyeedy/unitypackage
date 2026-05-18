import React, { useState, useRef, useEffect } from 'react';

interface FileListItemProps {
  path: string;
  content?: Uint8Array;
  maintainStructure: boolean;
  enablePreview: boolean;
  showFileSize: boolean;
}

const formatFileSize = (bytes: number): string => {
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Byte';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)).toString(), 10);
  const size = Math.round(bytes / Math.pow(1024, i)).toString();
  return `${size} ${sizes[i]}`;
};

const isImageFile = (path: string): boolean => {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tga'].includes(extension);
};

const FileListItem: React.FC<FileListItemProps> = ({
  path,
  content,
  maintainStructure,
  enablePreview,
  showFileSize,
}) => {
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const urlRef = useRef<string | null>(null);
  const fileName = maintainStructure ? path : path.split('/').pop() ?? path;

  useEffect(() => {
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  if (!content) {
    console.warn(`Content is undefined for file: ${path}`);
    return <li className="file-list-item">Error loading: {fileName}</li>;
  }

  if (!urlRef.current) {
    const blob = new Blob([content as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
    urlRef.current = URL.createObjectURL(blob);
  }

  const handleMouseOver = () => {
    if (enablePreview && isImageFile(path)) {
      setIsPreviewVisible(true);
    }
  };

  const handleMouseOut = () => {
    if (enablePreview && isImageFile(path)) {
      setIsPreviewVisible(false);
    }
  };

  return (
    <li className="file-list-item">
      <a
        href={urlRef.current || '#'}
        download={fileName}
        onMouseOver={handleMouseOver}
        onMouseOut={handleMouseOut}
      >
        {fileName}
      </a>
      {showFileSize && (
        <span className="file-info">
          ({formatFileSize(content.byteLength)})
        </span>
      )}
      {enablePreview && isImageFile(path) && isPreviewVisible && (
        <img src={urlRef.current || ''} alt={`${fileName} preview`} className="preview" />
      )}
    </li>
  );
};

export default FileListItem;
