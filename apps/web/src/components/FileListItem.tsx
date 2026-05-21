import React, { useState, useEffect } from 'react';

interface FileListItemProps {
  path: string;
  content?: Uint8Array;
  maintainStructure: boolean;
  enablePreview: boolean;
  showFileSize: boolean;
  style?: React.CSSProperties;
  'data-index'?: number;
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

const isTextPreviewFile = (path: string): boolean => {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return [
    'anim',
    'asmdef',
    'asmref',
    'asset',
    'cginc',
    'compute',
    'controller',
    'cs',
    'css',
    'glsl',
    'hlsl',
    'html',
    'js',
    'json',
    'jsx',
    'mat',
    'md',
    'meta',
    'prefab',
    'shader',
    'ts',
    'tsx',
    'txt',
    'unity',
    'uss',
    'uxml',
    'xml',
    'yaml',
    'yml',
  ].includes(extension);
};

const textDecoder = new TextDecoder('utf-8', { fatal: false });

const getTextPreview = (content: Uint8Array): string => {
  const decoded = textDecoder.decode(content.slice(0, 4096));
  return content.byteLength > 4096 ? `${decoded}\n...` : decoded;
};

const FileListItem = React.forwardRef<HTMLLIElement, FileListItemProps>(({
  path,
  content,
  maintainStructure,
  enablePreview,
  showFileSize,
  style,
  'data-index': dataIndex,
}, ref) => {
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const fileName = maintainStructure ? path : path.split('/').pop() ?? path;

  useEffect(() => {
    if (!content) {
      setBlobUrl(null);
      return undefined;
    }

    const blob = new Blob([content as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
    const nextUrl = URL.createObjectURL(blob);
    setBlobUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [content]);

  if (!content) {
    console.warn(`Content is undefined for file: ${path}`);
    return <li ref={ref} data-index={dataIndex} className="file-list-item virtual-row" style={style}>Error loading: {fileName}</li>;
  }

  const handleMouseOver = () => {
    if (enablePreview && (isImageFile(path) || isTextPreviewFile(path))) {
      setIsPreviewVisible(true);
    }
  };

  const handleMouseOut = () => {
    if (enablePreview && (isImageFile(path) || isTextPreviewFile(path))) {
      setIsPreviewVisible(false);
    }
  };

  return (
    <li ref={ref} data-index={dataIndex} className="file-list-item virtual-row" style={style}>
      <a
        href={blobUrl || '#'}
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
        <img src={blobUrl || ''} alt={`${fileName} preview`} className="preview" />
      )}
      {enablePreview && isTextPreviewFile(path) && isPreviewVisible && (
        <pre className="preview text-preview">{getTextPreview(content)}</pre>
      )}
    </li>
  );
});

export default FileListItem;
