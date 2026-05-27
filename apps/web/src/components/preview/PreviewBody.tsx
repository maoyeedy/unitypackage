import { useEffect, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';
import csharp from 'highlight.js/lib/languages/csharp';
import yaml from 'highlight.js/lib/languages/yaml';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import glsl from 'highlight.js/lib/languages/glsl';
import { FileQuestion } from 'lucide-react';
import type { SyntaxLanguage } from 'unitypackage-core';
import type { PackageFileRecord } from '../../packageModel';
import { useContent } from '../../contexts/ContentContext';

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

interface PreviewBodyProps {
  record: PackageFileRecord;
}

export function PreviewBody({ record }: PreviewBodyProps) {
  if (record.previewKind === 'image') return <ImagePreview key={record.id} record={record} />;
  if (record.previewKind === 'text') return <TextPreview record={record} />;
  return <NoPreview record={record} />;
}

function NoPreview({ record }: { record: PackageFileRecord }) {
  const extLabel = record.extension ? `.${record.extension}` : 'no extension';
  return (
    <div className="preview-frame no-preview-frame" role="status" aria-label="No preview available">
      <FileQuestion aria-hidden="true" size={28} />
      <p>No preview</p>
      <small>{extLabel}</small>
    </div>
  );
}

function ImagePreview({ record }: { record: PackageFileRecord }) {
  const getContent = useContent();
  const [blobUrl, setBlobUrl] = useState('');

  useEffect(() => {
    const bytes = getContent(record.id);
    if (!bytes || bytes.byteLength === 0) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: record.mimeType }));
    // Blob URL must be created post-commit (not during render) to
    // avoid stale URL issues with React Compiler auto-memoization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBlobUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [record.id, getContent, record.mimeType]);

  if (!blobUrl) return null;

  return (
    <div className="preview-frame image-frame">
      <img src={blobUrl} alt={record.fileName} />
    </div>
  );
}

function TextPreview({ record }: { record: PackageFileRecord }) {
  const getContent = useContent();
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
