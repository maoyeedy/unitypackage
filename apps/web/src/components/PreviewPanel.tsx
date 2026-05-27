import { useEffect, useMemo, useState } from 'react';
import { Download, FileArchive, Locate } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import csharp from 'highlight.js/lib/languages/csharp';
import yaml from 'highlight.js/lib/languages/yaml';
import json from 'highlight.js/lib/languages/json';
import {
  formatBytes,
  getDeclaredMetaInfoForRecord,
  type PackageFileRecord,
} from '../packageModel';

hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('json', json);

const textDecoder = new TextDecoder('utf-8', { fatal: false });
const TEXT_PREVIEW_LIMIT = 200_000;

export function PreviewPanel({
  record,
  onDownload,
  onRevealInTree,
}: {
  record: PackageFileRecord | null;
  onDownload: (record: PackageFileRecord) => void;
  onRevealInTree: (recordId: string) => void;
}) {
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
    <>
      <header className="preview-header">
        <div>
          <Breadcrumb virtualPath={record.virtualPath} onRevealInTree={onRevealInTree} />
          <p>{formatBytes(record.byteLength)} · {record.mimeType}</p>
        </div>
        <button
          type="button"
          aria-label={`Download ${record.fileName}`}
          title="Download file"
          onClick={() => { onDownload(record); }}
        >
          <Download aria-hidden="true" size={18} />
          <span>Download</span>
        </button>
      </header>
      <PreviewBody record={record} />
      <Metadata record={record} onRevealInTree={onRevealInTree} />
    </>
  );
}

function Breadcrumb({
  virtualPath,
  onRevealInTree,
}: {
  virtualPath: string;
  onRevealInTree: (path: string) => void;
}) {
  const parts = virtualPath.split('/').filter(Boolean);
  return (
    <div className="breadcrumb" aria-label="File path">
      {parts.map((part, index) => {
        const path = parts.slice(0, index + 1).join('/');
        const isLast = index === parts.length - 1;
        return (
          <span key={path} className="breadcrumb-part">
            {index > 0 ? <span className="breadcrumb-separator">/</span> : null}
            {isLast ? (
              <span>{part}</span>
            ) : (
              <button type="button" onClick={() => { onRevealInTree(path); }}>
                {part}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

function PreviewBody({ record }: { record: PackageFileRecord }) {
  if (record.previewKind === 'image') {
    return <ImagePreview key={record.id} record={record} />;
  }

  if (record.previewKind === 'text') {
    return <TextPreview record={record} />;
  }

  return (
    <div className="preview-frame unsupported-frame">
      <FileArchive aria-hidden="true" size={34} />
      <h3>Preview unavailable</h3>
      <p>This file can still be downloaded or included in ZIP extraction.</p>
    </div>
  );
}

function ImagePreview({ record }: { record: PackageFileRecord }) {
  const [blobUrl] = useState(() => {
    return URL.createObjectURL(new Blob([record.content as Uint8Array<ArrayBuffer>], { type: record.mimeType }));
  });

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  return (
    <div className="preview-frame image-frame">
      <img src={blobUrl} alt={record.fileName} />
    </div>
  );
}

function TextPreview({ record }: { record: PackageFileRecord }) {
  const preview = useMemo(() => {
    const slice = record.content.slice(0, TEXT_PREVIEW_LIMIT);
    return textDecoder.decode(slice);
  }, [record.content]);

  const highlightedHtml = useMemo(() => {
    if (record.syntaxLanguage === 'text') return null;
    const hasLang = !!hljs.getLanguage(record.syntaxLanguage);
    if (!hasLang) return null;
    try {
      return hljs.highlight(preview, { language: record.syntaxLanguage }).value;
    } catch {
      return null;
    }
  }, [preview, record.syntaxLanguage]);

  const isTruncated = record.content.byteLength > TEXT_PREVIEW_LIMIT;

  return (
    <div className="preview-frame text-frame">
      {highlightedHtml ? (
        <pre><code dangerouslySetInnerHTML={{ __html: highlightedHtml }} /></pre>
      ) : (
        <pre><code>{preview}</code></pre>
      )}
      {isTruncated ? (
        <div className="preview-truncated">
          Showing first {formatBytes(TEXT_PREVIEW_LIMIT)} of {formatBytes(record.content.byteLength)}.
        </div>
      ) : null}
    </div>
  );
}

function Metadata({ record, onRevealInTree }: { record: PackageFileRecord; onRevealInTree: (recordId: string) => void }) {
  const declaredMetaInfo = useMemo(() => getDeclaredMetaInfoForRecord([record], record), [record]);
  const rows: [string, string][] = [
    ['Path', record.virtualPath],
    ['GUID', record.guid],
    ['Size', formatBytes(record.byteLength)],
    ['Type', record.extension ? `.${record.extension}` : 'No extension'],
    ['MIME', record.mimeType],
  ];

  if (declaredMetaInfo.guid) {
    rows.push(['Meta GUID', declaredMetaInfo.guid]);
  }
  if (declaredMetaInfo.importer) {
    rows.push(['Importer', declaredMetaInfo.importer]);
  }

  return (
    <section className="metadata" aria-label="File metadata">
      <div className="metadata-heading">
        <h3>Details</h3>
        <button type="button" className="icon-button" aria-label="Reveal in tree" title="Reveal in tree" onClick={() => { onRevealInTree(record.id); }}>
          <Locate aria-hidden="true" size={15} />
        </button>
      </div>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
