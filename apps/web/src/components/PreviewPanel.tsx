import { useEffect, useMemo, useState } from 'react';
import { Download, FileArchive, Locate } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import csharp from 'highlight.js/lib/languages/csharp';
import yaml from 'highlight.js/lib/languages/yaml';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import glsl from 'highlight.js/lib/languages/glsl';
import type { SyntaxLanguage } from 'unitypackage-core';
import {
  formatBytes,
  getDeclaredMetaInfoForRecord,
  isUnityGeneratedExtension,
  type PackageFileRecord,
} from '../packageModel';

hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('glsl', glsl);
hljs.registerLanguage('hlsl', glsl);

const REGISTERED_LANGUAGES = new Set<SyntaxLanguage>([
  'csharp',
  'yaml',
  'json',
  'css',
  'hlsl',
  'glsl',
]);

const textDecoder = new TextDecoder('utf-8', { fatal: false });

export function PreviewPanel({
  record,
  metaSidecar,
  onDownload,
  onRevealInTree,
}: {
  record: PackageFileRecord | null;
  metaSidecar?: PackageFileRecord;
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
    <PreviewPanelContent
      key={record.id}
      record={record}
      metaSidecar={metaSidecar}
      onDownload={onDownload}
      onRevealInTree={onRevealInTree}
    />
  );
}

function PreviewPanelContent({
  record,
  metaSidecar,
  onDownload,
  onRevealInTree,
}: {
  record: PackageFileRecord;
  metaSidecar?: PackageFileRecord;
  onDownload: (record: PackageFileRecord) => void;
  onRevealInTree: (recordId: string) => void;
}) {
  const [previewMode, setPreviewMode] = useState<'asset' | 'meta'>('asset');
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
      <PreviewBody record={previewRecord} />
      {previewMode === 'asset' ? (
        <Metadata record={record} metaSidecar={metaSidecar} onRevealInTree={onRevealInTree} />
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

function PreviewBody({ record }: { record: PackageFileRecord }) {
  if (record.previewKind === 'image') return <ImagePreview key={record.id} record={record} />;
  if (record.previewKind === 'text') {
    if (isUnityGeneratedExtension(record.extension)) {
      return <DeferredTextPreview key={record.id} record={record} />;
    }
    return <TextPreview record={record} />;
  }
  return null;
}

function DeferredTextPreview({ record }: { record: PackageFileRecord }) {
  const [loaded, setLoaded] = useState(false);
  if (loaded) return <TextPreview record={record} />;
  return (
    <div className="preview-frame deferred-frame">
      <p>Unity-generated asset ({formatBytes(record.byteLength)})</p>
      <button type="button" onClick={() => setLoaded(true)}>Load preview</button>
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
  const preview = textDecoder.decode(record.content);

  const highlightedHtml = useMemo(() => {
    if (!REGISTERED_LANGUAGES.has(record.syntaxLanguage)) {
      return null;
    }
    return hljs.highlight(preview, { language: record.syntaxLanguage }).value;
  }, [preview, record.syntaxLanguage]);

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
}: {
  record: PackageFileRecord;
  metaSidecar?: PackageFileRecord;
  onRevealInTree: (recordId: string) => void;
}) {
  const declaredMetaInfo = useMemo(
    () => getDeclaredMetaInfoForRecord(metaSidecar ? [record, metaSidecar] : [record], record),
    [metaSidecar, record],
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
