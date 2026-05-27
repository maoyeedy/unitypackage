import { useEffect, useMemo, useState } from 'react';
import { Download, FileArchive, Locate } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';
import csharp from 'highlight.js/lib/languages/csharp';
import yaml from 'highlight.js/lib/languages/yaml';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import glsl from 'highlight.js/lib/languages/glsl';
import type { SyntaxLanguage } from 'unitypackage-core';
import {
  formatBytes,
  getDeclaredMetaInfoForRecord,
  type PackageFileRecord,
  type SidecarSelectableRecord,
} from '../packageModel';

const LANGUAGES: [SyntaxLanguage, LanguageFn][] = [
  ['csharp', csharp],
  ['yaml', yaml],
  ['json', json],
  ['css', css],
  ['glsl', glsl],
  ['hlsl', glsl],
];
for (const [name, fn] of LANGUAGES) {
  hljs.registerLanguage(name, fn);
}
const REGISTERED_LANGUAGES = new Set<SyntaxLanguage>(LANGUAGES.map(([name]) => name));

const textDecoder = new TextDecoder('utf-8', { fatal: false });

export function PreviewPanel({
  record,
  metaSidecar,
  onDownload,
  onRevealInTree,
  selectableRecords,
  getContent,
}: {
  record: PackageFileRecord | null;
  metaSidecar?: PackageFileRecord;
  onDownload: (record: PackageFileRecord) => void;
  onRevealInTree: (recordId: string) => void;
  selectableRecords?: readonly SidecarSelectableRecord[];
  getContent: (id: string) => Uint8Array<ArrayBuffer> | undefined;
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
    <PreviewPanelContent
      record={record}
      metaSidecar={metaSidecar}
      onDownload={onDownload}
      onRevealInTree={onRevealInTree}
      selectableRecords={selectableRecords}
      getContent={getContent}
    />
  );
}

function PreviewPanelContent({
  record,
  metaSidecar,
  onDownload,
  onRevealInTree,
  selectableRecords,
  getContent,
}: {
  record: PackageFileRecord;
  metaSidecar?: PackageFileRecord;
  onDownload: (record: PackageFileRecord) => void;
  onRevealInTree: (recordId: string) => void;
  selectableRecords?: readonly SidecarSelectableRecord[];
  getContent: (id: string) => Uint8Array<ArrayBuffer> | undefined;
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
      <header className="preview-header">
        <div>
          <Breadcrumb virtualPath={previewRecord.virtualPath} onRevealInTree={onRevealInTree} />
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
      <PreviewBody record={previewRecord} getContent={getContent} />
      {previewMode === 'asset' ? (
        <Metadata
          record={record}
          metaSidecar={metaSidecar}
          onRevealInTree={onRevealInTree}
          selectableRecords={selectableRecords}
          getContent={getContent}
        />
      ) : null}
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

function PreviewBody({
  record,
  getContent,
}: {
  record: PackageFileRecord;
  getContent: (id: string) => Uint8Array<ArrayBuffer> | undefined;
}) {
  if (record.previewKind === 'image') return <ImagePreview key={record.id} record={record} getContent={getContent} />;
  if (record.previewKind === 'text') return <TextPreview record={record} getContent={getContent} />;
  return null;
}

function ImagePreview({
  record,
  getContent,
}: {
  record: PackageFileRecord;
  getContent: (id: string) => Uint8Array<ArrayBuffer> | undefined;
}) {
  const [blobUrl] = useState(() => {
    const bytes = getContent(record.id);
    if (!bytes) return '';
    return URL.createObjectURL(new Blob([bytes], { type: record.mimeType }));
  });

  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  if (!blobUrl) return null;

  return (
    <div className="preview-frame image-frame">
      <img src={blobUrl} alt={record.fileName} />
    </div>
  );
}

function TextPreview({
  record,
  getContent,
}: {
  record: PackageFileRecord;
  getContent: (id: string) => Uint8Array<ArrayBuffer> | undefined;
}) {
  // Relying on the React Compiler to optimize and memoize computations automatically.
  const bytes = getContent(record.id);
  if (!bytes) return null;
  const preview = textDecoder.decode(bytes);

  let highlightedHtml: string | null = null;
  if (REGISTERED_LANGUAGES.has(record.syntaxLanguage)) {
    try {
      highlightedHtml = hljs.highlight(preview, { language: record.syntaxLanguage }).value;
    } catch (err) {
      console.error('Failed to highlight preview:', err);
    }
  }

  return (
    <div className="preview-frame text-frame">
      {highlightedHtml ? (
        <pre><code dangerouslySetInnerHTML={{ __html: highlightedHtml }} /></pre>
      ) : (
        <pre><code>{preview}</code></pre>
      )}
    </div>
  );
}

function Metadata({
  record,
  metaSidecar,
  onRevealInTree,
  selectableRecords,
  getContent,
}: {
  record: PackageFileRecord;
  metaSidecar?: PackageFileRecord;
  onRevealInTree: (recordId: string) => void;
  selectableRecords?: readonly SidecarSelectableRecord[];
  getContent: (id: string) => Uint8Array<ArrayBuffer> | undefined;
}) {
  const declaredMetaInfo = useMemo(
    () => getDeclaredMetaInfoForRecord(metaSidecar ? [record, metaSidecar] : [record], record, getContent, selectableRecords),
    [metaSidecar, record, getContent, selectableRecords],
  );
  const rows: [string, string][] = [
    ['Path', record.virtualPath],
    ['GUID', record.guid],
    ['Size', formatBytes(record.byteLength)],
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
