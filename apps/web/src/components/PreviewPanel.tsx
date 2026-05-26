import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Archive,
  Check,
  Copy,
  Download,
  Info,
  Search,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  formatBytes,
  getDeclaredMetaInfoForRecord,
  getExpectedImporterTypeForRecord,
  getRecordCategory,
  getSiblings,
  readDeclaredMetaImporter,
  readMetaGuid,
  resolveMetaSidecarSelection,
  toSidecarSelectableRecords,
  type PackageFileRecord,
  type PreviewKind,
  type RecordCategory,
} from '../packageModel';
import { highlightCode, findQueryMatches, splitLineTokensForMatches, type HighlightedCode, type HighlightedToken } from '../syntaxHighlight';

const textDecoder = new TextDecoder('utf-8', { fatal: false });

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function PreviewPanel({
  record,
  records,
  includeMetaSidecars,
  onDownloadZip,
  onStatusWarning,
  onRevealInTree,
  onOpenSibling,
  onOpenSiblingInExplorer,
  showPreviews,
  onSetShowPreviews,
  includeMetaSidecarsForSibling,
  onSetIncludeMetaSidecars,
}: {
  record: PackageFileRecord | null;
  records: PackageFileRecord[];
  includeMetaSidecars: boolean;
  onDownloadZip: (records: PackageFileRecord[], fileName: string, recordIds: string[]) => void;
  onStatusWarning: (message: string) => void;
  onRevealInTree: (path: string) => void;
  onOpenSibling?: (siblingId: string) => void;
  onOpenSiblingInExplorer?: (siblingId: string) => void;
  showPreviews?: boolean;
  onSetShowPreviews?: (value: boolean) => void;
  includeMetaSidecarsForSibling?: boolean;
  onSetIncludeMetaSidecars?: (value: boolean) => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState(false);
  const [copiedBase64, setCopiedBase64] = useState(false);

  useEffect(() => {
    setCopiedText(false);
    setCopiedBase64(false);
    if (!record) {
      setBlobUrl(null);
      return undefined;
    }

    const blob = new Blob([record.content as Uint8Array<ArrayBuffer>], { type: record.mimeType });
    const nextUrl = URL.createObjectURL(blob);
    setBlobUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [record]);

  const handlePreviewDownload = useCallback(() => {
    if (!record) return;
    if (includeMetaSidecars && getRecordCategory(record) === 'asset') {
      const result = resolveMetaSidecarSelection(
        toSidecarSelectableRecords(records),
        [record.id],
      );
      if (result.missingMetaForAssetIds.length > 0) {
        downloadBlob(new Blob([record.content as Uint8Array<ArrayBuffer>], { type: record.mimeType }), record.fileName);
        onStatusWarning(`Downloaded ${record.fileName}. No .meta sidecar found in this package.`);
      } else {
        const zipFileName = `${record.fileName}.zip`;
        onDownloadZip(records, zipFileName, result.ids);
      }
      return;
    }
    downloadBlob(new Blob([record.content as Uint8Array<ArrayBuffer>], { type: record.mimeType }), record.fileName);
  }, [record, includeMetaSidecars, records, onStatusWarning, onDownloadZip]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handlePreviewDownload();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [handlePreviewDownload]);

  if (!record) {
    return (
      <div className="preview-empty">
        <Info aria-hidden="true" size={34} />
        <h2>No file selected</h2>
        <p>Select a file in the explorer to preview content and metadata.</p>
      </div>
    );
  }

  const isTextual = record.previewKind === 'text';
  const isSmallRecord = record.content.byteLength <= 65536;

  const handleCopyText = async () => {
    const text = textDecoder.decode(record.content);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(true);
      setTimeout(() => { setCopiedText(false); }, 2000);
    } catch (err) {
      console.error('Failed to copy text', err);
    }
  };

  const handleCopyBase64 = async () => {
    let binary = '';
    for (const byte of record.content) {
      binary += String.fromCharCode(byte);
    }
    const base64 = window.btoa(binary);
    try {
      await navigator.clipboard.writeText(base64);
      setCopiedBase64(true);
      setTimeout(() => { setCopiedBase64(false); }, 2000);
    } catch (err) {
      console.error('Failed to copy base64', err);
    }
  };

  return (
    <div className="preview-content">
      <header className="preview-header">
        <div>
          <h2>{record.fileName}</h2>
          <Breadcrumb virtualPath={record.virtualPath} onRevealInTree={onRevealInTree} />
        </div>
        <div className="preview-header-actions" style={{ display: 'flex', gap: '6px' }}>
          {isTextual && (
            <button
              type="button"
              className="icon-button"
              title={copiedText ? "Copied!" : "Copy text"}
              aria-label="Copy text"
              onClick={() => { void handleCopyText(); }}
            >
              {copiedText ? <Check aria-hidden="true" size={17} /> : <Copy aria-hidden="true" size={17} />}
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            disabled={!isSmallRecord}
            title={
              !isSmallRecord
                ? "Base64 copy only supported for files under 64 KB"
                : copiedBase64
                ? "Copied!"
                : "Copy as Base64"
            }
            aria-label="Copy as base64"
            onClick={() => { void handleCopyBase64(); }}
          >
            {copiedBase64 ? <Check aria-hidden="true" size={17} /> : <Archive aria-hidden="true" size={17} />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Download ${record.fileName}`}
            title="Download file (Alt+D)"
            onClick={handlePreviewDownload}
          >
            <Download aria-hidden="true" size={18} />
          </button>
        </div>
      </header>
      <PreviewBody record={record} blobUrl={blobUrl} />
      <Metadata record={record} records={records} />
      <RelatedRow
        record={record}
        records={records}
        onOpenSibling={onOpenSibling}
        onOpenSiblingInExplorer={onOpenSiblingInExplorer}
        showPreviews={showPreviews}
        onSetShowPreviews={onSetShowPreviews}
        includeMetaSidecarsForSibling={includeMetaSidecarsForSibling}
        onSetIncludeMetaSidecars={onSetIncludeMetaSidecars}
      />
    </div>
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
    <p className="preview-breadcrumb" aria-label="File path breadcrumb">
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1;
        const segmentPath = parts.slice(0, index + 1).join('/');
        return (
          <span key={segmentPath} className="breadcrumb-segment">
            {index > 0 && <span className="breadcrumb-sep" aria-hidden="true">/</span>}
            <button
              type="button"
              className={isLast ? "breadcrumb-btn breadcrumb-leaf" : "breadcrumb-btn"}
              title={`Reveal ${segmentPath} in tree`}
              onClick={() => { onRevealInTree(segmentPath); }}
            >
              {part}
            </button>
          </span>
        );
      })}
    </p>
  );
}

function ImagePreview({ record, blobUrl }: { record: PackageFileRecord; blobUrl: string }) {
  const [naturalDims, setNaturalDims] = useState<{ width: number; height: number } | null>(null);
  const [isFit, setIsFit] = useState(true);

  useEffect(() => {
    setNaturalDims(null);
    setIsFit(true);
  }, [record.id]);

  return (
    <div className="preview-frame media-frame image-preview-container" style={{ position: 'relative', overflow: isFit ? 'hidden' : 'auto' }}>
      <img
        src={blobUrl}
        alt={`${record.fileName} preview`}
        onLoad={(e) => {
          const img = e.currentTarget;
          setNaturalDims({ width: img.naturalWidth, height: img.naturalHeight });
        }}
        style={isFit ? {
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
        } : {
          maxWidth: 'none',
          maxHeight: 'none',
        }}
      />
      <div className="media-controls-overlay" style={{
        position: 'absolute',
        bottom: '8px',
        right: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        color: '#fff',
        padding: '4px 8px',
        borderRadius: '6px',
        fontSize: '0.78rem',
        backdropFilter: 'blur(4px)',
        zIndex: 10,
      }}>
        {naturalDims && (
          <span style={{ color: '#ffffff' }}>{naturalDims.width} x {naturalDims.height}</span>
        )}
        <button
          type="button"
          onClick={() => { setIsFit(f => !f); }}
          style={{
            background: 'rgba(255, 255, 255, 0.2)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            color: '#fff',
            cursor: 'pointer',
            padding: '2px 8px',
            fontSize: '0.75rem',
            borderRadius: '4px',
            minHeight: '22px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isFit ? '1:1' : 'Fit'}
        </button>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function AudioPreview({ record, blobUrl }: { record: PackageFileRecord; blobUrl: string }) {
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    setDuration(null);
  }, [record.id]);

  return (
    <div className="preview-frame audio-preview-container" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '12px',
      padding: '24px',
    }}>
      <audio
        controls
        src={blobUrl}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
        }}
      >
        <a href={blobUrl} download={record.fileName}>Download audio</a>
      </audio>
      {duration !== null && (
        <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
          Duration: {formatDuration(duration)}
        </span>
      )}
    </div>
  );
}

function HexPreview({ record }: { record: PackageFileRecord }) {
  const bytes = record.content;
  const rowCount = Math.ceil(bytes.length / 16);
  const parentRef = useRef<HTMLDivElement | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 20,
  });

  return (
    <div ref={parentRef} className="preview-frame hex-frame" style={{ overflow: 'auto' }}>
      <div className="virtual-spacer" style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map(virtualRow => {
          const rowIndex = virtualRow.index;
          const start = rowIndex * 16;
          const end = Math.min(start + 16, bytes.length);
          const rowBytes = bytes.slice(start, end);

          const offsetStr = start.toString(16).padStart(8, '0').toUpperCase();

          const hexParts: string[] = [];
          for (let j = 0; j < 16; j++) {
            if (j < rowBytes.length) {
              hexParts.push(rowBytes[j].toString(16).padStart(2, '0').toUpperCase());
            } else {
              hexParts.push('  ');
            }
          }
          const hexStrLeft = hexParts.slice(0, 8).join(' ');
          const hexStrRight = hexParts.slice(8, 16).join(' ');
          const hexStr = `${hexStrLeft}  ${hexStrRight}`;

          let asciiStr = '';
          for (const b of rowBytes) {
            asciiStr += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
          }

          return (
            <div
              key={rowIndex}
              className="hex-row"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                display: 'flex',
                fontFamily: 'monospace',
                whiteSpace: 'pre',
                fontSize: '0.82rem',
                lineHeight: `${virtualRow.size}px`,
              }}
            >
              <span className="hex-offset" style={{ opacity: 0.5, marginRight: '16px' }}>{offsetStr}</span>
              <span className="hex-bytes" style={{ marginRight: '24px' }}>{hexStr}</span>
              <span className="hex-ascii">{asciiStr}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PreviewBody({ record, blobUrl }: { record: PackageFileRecord; blobUrl: string | null }) {
  if (!blobUrl) {
    return <div className="preview-frame">Preparing preview</div>;
  }

  if (record.previewKind === 'image') {
    return <ImagePreview record={record} blobUrl={blobUrl} />;
  }

  if (record.previewKind === 'pdf') {
    return (
      <div className="preview-frame pdf-frame">
        <object data={blobUrl} type="application/pdf" aria-label={`${record.fileName} preview`}>
          <a href={blobUrl} download={record.fileName}>Download PDF</a>
        </object>
      </div>
    );
  }

  if (record.previewKind === 'audio') {
    return <AudioPreview record={record} blobUrl={blobUrl} />;
  }

  if (record.previewKind === 'video') {
    return (
      <div className="preview-frame media-frame">
        <video controls src={blobUrl}>
          <a href={blobUrl} download={record.fileName}>Download video</a>
        </video>
      </div>
    );
  }

  if (record.previewKind === 'text') {
    return <TextPreview record={record} />;
  }

  return <HexPreview record={record} />;
}

function tokenStyle(token: HighlightedToken): CSSProperties {
  const style: CSSProperties = {
    color: token.color,
    backgroundColor: token.backgroundColor,
  };

  if (token.fontStyle !== undefined) {
    if ((token.fontStyle & 1) !== 0) style.fontStyle = 'italic';
    if ((token.fontStyle & 2) !== 0) style.fontWeight = 700;
    if ((token.fontStyle & 4) !== 0) style.textDecoration = 'underline';
  }

  return {
    ...style,
    ...token.htmlStyle,
  };
}

function TextPreview({ record }: { record: PackageFileRecord }) {
  const [loadedLimit, setLoadedLimit] = useState(20000);

  useEffect(() => {
    setLoadedLimit(20000);
  }, [record.id]);

  const preview = useMemo(() => {
    return textDecoder.decode(record.content.slice(0, loadedLimit));
  }, [record.content, loadedLimit]);

  const hasMoreToLoad = record.content.byteLength > loadedLimit && loadedLimit < 262144;
  const isHardCeiling = record.content.byteLength > 262144 && loadedLimit >= 262144;

  const [highlightedCode, setHighlightedCode] = useState<HighlightedCode | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHighlightedCode(null);

    void highlightCode(preview, record.syntaxLanguage)
      .then(result => {
        if (!cancelled) setHighlightedCode(result);
      })
      .catch(() => {
        if (!cancelled) setHighlightedCode(null);
      });

    return () => {
      cancelled = true;
    };
  }, [preview, record.syntaxLanguage]);

  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);

  const linesCount = highlightedCode ? highlightedCode.lines.length : 0;

  const rowVirtualizer = useVirtualizer({
    count: linesCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 10,
  });

  const linesText = useMemo(() => {
    if (!highlightedCode) return [];
    return highlightedCode.lines.map(line => line.map(t => t.content).join(''));
  }, [highlightedCode]);

  const matches = useMemo(() => {
    return findQueryMatches(linesText, findQuery);
  }, [linesText, findQuery]);

  useEffect(() => {
    setActiveMatchIdx(0);
    if (matches.length > 0) {
      rowVirtualizer.scrollToIndex(matches[0].lineIndex, { align: 'center' });
    }
  }, [matches, rowVirtualizer]);

  const handleNextMatch = () => {
    if (matches.length === 0) return;
    const nextIdx = (activeMatchIdx + 1) % matches.length;
    setActiveMatchIdx(nextIdx);
    rowVirtualizer.scrollToIndex(matches[nextIdx].lineIndex, { align: 'center' });
  };

  const handlePrevMatch = () => {
    if (matches.length === 0) return;
    const prevIdx = (activeMatchIdx - 1 + matches.length) % matches.length;
    setActiveMatchIdx(prevIdx);
    rowVirtualizer.scrollToIndex(matches[prevIdx].lineIndex, { align: 'center' });
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFindOpen) {
        setIsFindOpen(false);
        parentRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isFindOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      setIsFindOpen(true);
      setTimeout(() => {
        findInputRef.current?.focus();
        findInputRef.current?.select();
      }, 0);
    } else if (e.key === 'Escape' && isFindOpen) {
      e.preventDefault();
      setIsFindOpen(false);
      parentRef.current?.focus();
    }
  };

  const handleLoadMore = () => {
    setLoadedLimit(Math.min(262144, record.content.byteLength));
  };

  if (!highlightedCode) {
    return (
      <div className="preview-frame text-frame" style={{ padding: '12px' }}>
        Loading preview...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }} onKeyDown={handleKeyDown}>
      {isFindOpen && (
        <div className="preview-find-bar" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          backgroundColor: 'var(--panel-2)',
        }}>
          <Search size={16} className="text-muted" />
          <input
            ref={findInputRef}
            type="text"
            placeholder="Find..."
            aria-label="Find in preview"
            value={findQuery}
            onChange={(e) => {
              setFindQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                  handlePrevMatch();
                } else {
                  handleNextMatch();
                }
              }
            }}
            style={{
              flex: 1,
              border: '1px solid var(--border)',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '0.85rem',
              background: 'var(--panel)',
              color: 'var(--text)',
            }}
          />
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)', minWidth: '55px', textAlign: 'center' }}>
            {matches.length > 0 ? `${activeMatchIdx + 1} of ${matches.length}` : '0 of 0'}
          </span>
          <button
            type="button"
            onClick={handlePrevMatch}
            disabled={matches.length === 0}
            style={{ minHeight: '26px', padding: '0 6px', fontSize: '0.8rem' }}
          >
            Prev
          </button>
          <button
            type="button"
            onClick={handleNextMatch}
            disabled={matches.length === 0}
            style={{ minHeight: '26px', padding: '0 6px', fontSize: '0.8rem' }}
          >
            Next
          </button>
          <button
            type="button"
            onClick={() => {
              setIsFindOpen(false);
              parentRef.current?.focus();
            }}
            style={{ minHeight: '26px', padding: '0 6px', fontSize: '0.8rem' }}
          >
            Close
          </button>
        </div>
      )}
      <div
        ref={parentRef}
        className="preview-frame text-frame highlighted-text-frame"
        tabIndex={0}
        style={{
          backgroundColor: highlightedCode.background,
          color: highlightedCode.foreground,
          overflow: 'auto',
          margin: '12px',
          outline: 'none',
          position: 'relative',
        }}
      >
        <div className="virtual-spacer" style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map(virtualRow => {
            const rowIndex = virtualRow.index;
            const originalLine = highlightedCode.lines[rowIndex];
            if (!originalLine) return null;

            const lineMatches = matches.filter(m => m.lineIndex === rowIndex);
            const displayTokens = splitLineTokensForMatches(
              originalLine,
              lineMatches,
              matches[activeMatchIdx] ? matches[activeMatchIdx].globalIndex : null
            );

            return (
              <div
                key={rowIndex}
                className="code-line"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  whiteSpace: 'pre',
                  lineHeight: `${virtualRow.size}px`,
                }}
              >
                {displayTokens.map((token, tokenIndex) => (
                  <span
                    className={
                      token.isMatch
                        ? token.isActiveMatch
                          ? 'syntax-token preview-match active-match'
                          : 'syntax-token preview-match'
                        : 'syntax-token'
                    }
                    key={tokenIndex}
                    style={{
                      ...tokenStyle(token),
                      ...(token.isMatch ? {
                        backgroundColor: token.isActiveMatch ? 'var(--warning)' : 'rgba(253, 224, 71, 0.4)',
                        color: '#000',
                      } : {}),
                    }}
                  >
                    {token.content}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      {hasMoreToLoad && (
        <div className="load-more-banner" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          margin: '0 12px 12px 12px',
          border: '1px dashed var(--accent)',
          borderRadius: '6px',
          backgroundColor: 'color-mix(in srgb, var(--accent) 5%, transparent)',
        }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
            Large file truncated at {formatBytes(loadedLimit)} (total size: {formatBytes(record.content.byteLength)}).
          </span>
          <button
            type="button"
            onClick={handleLoadMore}
            style={{
              minHeight: '26px',
              padding: '0 10px',
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
              fontSize: '0.82rem',
            }}
          >
            Load up to 256 KB
          </button>
        </div>
      )}
      {isHardCeiling && (
        <div className="load-more-banner" style={{
          padding: '8px 12px',
          margin: '0 12px 12px 12px',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          backgroundColor: 'var(--panel-2)',
          fontSize: '0.82rem',
          color: 'var(--muted)',
        }}>
          This file exceeds the 256 KB preview limit. Truncated to preserve browser memory.
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <button
      type="button"
      className="copy-btn"
      onClick={() => { void handleCopy(); }}
      title="Copy to clipboard"
      aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
      style={{
        background: 'transparent',
        border: 'none',
        padding: '2px',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: '6px',
        color: copied ? 'var(--success, #22c55e)' : 'var(--muted, #888)',
        verticalAlign: 'middle',
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function MetaSidecarView({ siblingRecord }: { siblingRecord: PackageFileRecord }) {
  const [highlightedCode, setHighlightedCode] = useState<HighlightedCode | null>(null);

  const metaText = useMemo(() => {
    return textDecoder.decode(siblingRecord.content);
  }, [siblingRecord.content]);

  const metaGuid = useMemo(() => readMetaGuid(siblingRecord.content), [siblingRecord.content]);
  const metaImporter = useMemo(() => readDeclaredMetaImporter(siblingRecord.content), [siblingRecord.content]);

  useEffect(() => {
    let cancelled = false;
    setHighlightedCode(null);

    void highlightCode(metaText, 'yaml')
      .then(result => {
        if (!cancelled) setHighlightedCode(result);
      })
      .catch(() => {
        if (!cancelled) setHighlightedCode(null);
      });

    return () => {
      cancelled = true;
    };
  }, [metaText]);

  const importerString = metaImporter
    ? metaImporter.kind === 'known'
      ? metaImporter.type
      : `Unknown (${metaImporter.name})`
    : 'None';

  return (
    <div className="meta-sidecar-view" style={{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
      <h4 style={{ margin: '0 0 8px 0', fontSize: '0.85rem', fontWeight: 600 }}>Meta Sidecar Quick View</h4>
      <div className="meta-sidecar-facts" style={{ fontSize: '0.78rem', marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div>
          <span style={{ color: 'var(--muted)' }}>Declared GUID: </span>
          <code>{metaGuid ?? 'None'}</code>
        </div>
        <div>
          <span style={{ color: 'var(--muted)' }}>Declared Importer: </span>
          <code>{importerString}</code>
        </div>
      </div>
      <div
        className="preview-frame text-frame highlighted-text-frame"
        style={{
          backgroundColor: highlightedCode?.background ?? 'var(--panel-2)',
          color: highlightedCode?.foreground ?? 'var(--text)',
          overflow: 'auto',
          maxHeight: '300px',
          padding: '8px',
          borderRadius: '4px',
          fontSize: '0.78rem',
          fontFamily: 'monospace',
          border: '1px solid var(--border)',
          whiteSpace: 'pre',
          margin: 0,
        }}
      >
        {highlightedCode ? (
          highlightedCode.lines.map((line, lineIdx) => (
            <div key={lineIdx} className="code-line" style={{ minHeight: '1.2em', whiteSpace: 'pre' }}>
              {line.map((token, tokenIdx) => (
                <span
                  key={tokenIdx}
                  className="syntax-token"
                  style={tokenStyle(token)}
                >
                  {token.content}
                </span>
              ))}
            </div>
          ))
        ) : (
          <div>Loading meta sidecar...</div>
        )}
      </div>
    </div>
  );
}

function previewLabel(kind: PreviewKind): string {
  switch (kind) {
    case 'audio':
      return 'Native audio';
    case 'image':
      return 'Native image';
    case 'pdf':
      return 'Native PDF';
    case 'text':
      return 'Highlighted text';
    case 'video':
      return 'Native video';
    case 'unsupported':
      return 'Unsupported';
  }
}

function diagSeveritySummary(
  diagnostics: { severity: string }[],
  findings: { severity: string }[],
): string {
  const all = [...diagnostics, ...findings];
  const errors = all.filter(d => d.severity === 'error').length;
  const warnings = all.filter(d => d.severity === 'warning').length;
  const infos = all.filter(d => d.severity === 'info').length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors.toString()} error${errors !== 1 ? 's' : ''}`);
  if (warnings > 0) parts.push(`${warnings.toString()} warning${warnings !== 1 ? 's' : ''}`);
  if (infos > 0) parts.push(`${infos.toString()} info`);
  return parts.join(', ');
}

function DiagnosticsDisclosure({
  diagnostics,
  findings,
}: {
  diagnostics: { severity: string; code: string; message: string }[];
  findings: { severity: string; code: string; message: string }[];
}) {
  const total = diagnostics.length + findings.length;
  if (total === 0) return null;

  const summary = diagSeveritySummary(diagnostics, findings);
  const hasError = [...diagnostics, ...findings].some(d => d.severity === 'error');
  const hasWarning = [...diagnostics, ...findings].some(d => d.severity === 'warning');
  const severityClass = hasError
    ? 'diag-badge diag-badge-error'
    : hasWarning
    ? 'diag-badge diag-badge-warning'
    : 'diag-badge diag-badge-info';

  return (
    <details className="details-disclosure">
      <summary className="details-disclosure-summary">
        <span>Diagnostics</span>
        <span className={severityClass}>{summary}</span>
      </summary>
      <div className="record-diagnostics record-diagnostics-disclosure">
        <ul>
          {diagnostics.map((diagnostic, index) => (
            <li key={`parser-${diagnostic.code}-${index.toString()}`}>
              <strong>[{diagnostic.severity.toUpperCase()}] {diagnostic.code}</strong>
              <span>{diagnostic.message}</span>
            </li>
          ))}
          {findings.map((finding, index) => (
            <li key={`analysis-${finding.code}-${index.toString()}`}>
              <strong>[{finding.severity.toUpperCase()}] {finding.code}</strong>
              <span>{finding.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function MetaSidecarDisclosure({ siblingRecord }: { siblingRecord: PackageFileRecord }) {
  const metaText = useMemo(() => textDecoder.decode(siblingRecord.content), [siblingRecord.content]);
  const lineCount = metaText.split('\n').length;
  const isLong = lineCount > 20;

  if (!isLong) {
    return <MetaSidecarView siblingRecord={siblingRecord} />;
  }

  return (
    <details className="details-disclosure">
      <summary className="details-disclosure-summary">
        <span>Meta sidecar</span>
        <span className="diag-badge">{lineCount.toString()} lines</span>
      </summary>
      <MetaSidecarView siblingRecord={siblingRecord} />
    </details>
  );
}

const CATEGORY_LABEL: Record<RecordCategory, string> = {
  asset: 'Asset',
  meta: '.meta',
  preview: 'Preview',
};

function RelatedRow({
  record,
  records,
  onOpenSibling,
  onOpenSiblingInExplorer,
  showPreviews,
  onSetShowPreviews,
  includeMetaSidecarsForSibling,
  onSetIncludeMetaSidecars,
}: {
  record: PackageFileRecord;
  records: PackageFileRecord[];
  onOpenSibling?: (siblingId: string) => void;
  onOpenSiblingInExplorer?: (siblingId: string) => void;
  showPreviews?: boolean;
  onSetShowPreviews?: (value: boolean) => void;
  includeMetaSidecarsForSibling?: boolean;
  onSetIncludeMetaSidecars?: (value: boolean) => void;
}) {
  const siblings = useMemo(() => getSiblings(record, records), [record, records]);
  const hasSiblings = siblings.asset !== undefined || siblings.meta !== undefined || siblings.preview !== undefined;
  if (!hasSiblings) return null;

  const siblingEntries: { category: RecordCategory; sibling: PackageFileRecord }[] = [];
  if (siblings.asset !== undefined) siblingEntries.push({ category: 'asset', sibling: siblings.asset });
  if (siblings.meta !== undefined) siblingEntries.push({ category: 'meta', sibling: siblings.meta });
  if (siblings.preview !== undefined) siblingEntries.push({ category: 'preview', sibling: siblings.preview });

  return (
    <section className="related-row" aria-label="Related records">
      <h4 className="related-row-label">Related</h4>
      <ul className="related-row-list">
        {siblingEntries.map(({ category, sibling }) => {
          // Determine whether this sibling is currently hidden by explorer filters
          const isPreviewHidden = category === 'preview' && !showPreviews;
          const isMetaHidden = category === 'meta' && !includeMetaSidecarsForSibling;
          const isHiddenInExplorer = isPreviewHidden || isMetaHidden;

          return (
            <li key={sibling.id} className="related-row-item">
              <button
                type="button"
                className="related-sibling-btn"
                title={`View ${sibling.virtualPath} in details pane`}
                onClick={() => { onOpenSibling?.(sibling.id); }}
              >
                <span className="related-badge">{CATEGORY_LABEL[category]}</span>
                <span className="related-filename">{sibling.fileName}</span>
              </button>
              <button
                type="button"
                className="related-reveal-btn"
                title={
                  isHiddenInExplorer
                    ? `Enable ${category === 'preview' ? 'preview records' : '.meta sidecars'} and reveal in list`
                    : `Open ${sibling.virtualPath} in explorer`
                }
                onClick={() => {
                  // Enable the appropriate filter if needed so the record is visible
                  if (isPreviewHidden) {
                    onSetShowPreviews?.(true);
                  }
                  if (isMetaHidden) {
                    onSetIncludeMetaSidecars?.(true);
                  }
                  onOpenSiblingInExplorer?.(sibling.id);
                }}
              >
                Open in list
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Metadata({ record, records }: { record: PackageFileRecord; records: PackageFileRecord[] }) {
  const expectedImporter = getExpectedImporterTypeForRecord(record);
  const declaredMetaInfo = getDeclaredMetaInfoForRecord(records, record);

  const siblingMetaRecord = record.extension !== 'meta' && !record.isUnityPreview
    ? records.find(r => r.guid === record.guid && r.extension === 'meta')
    : undefined;

  const importerDisplay = declaredMetaInfo.importer ?? expectedImporter;
  const diagTotal = record.diagnostics.length + record.findings.length;

  const technicalRows: [string, string][] = [
    ['Extension', record.extension || 'None'],
    ['MIME', record.mimeType],
    ['Asset bytes', record.assetSize === undefined ? 'None' : formatBytes(record.assetSize)],
    ['Meta bytes', record.metaSize === undefined ? 'None' : formatBytes(record.metaSize)],
    ['Preview bytes', record.previewSize === undefined ? 'None' : formatBytes(record.previewSize)],
    ['Duplicate paths', record.duplicatePathCount.toString()],
    ['Preview support', previewLabel(record.previewKind)],
    ['Syntax language', record.previewKind === 'text' ? record.syntaxLanguage : 'None'],
    ['Expected importer', expectedImporter],
  ];

  return (
    <section className="metadata">
      <h3>Details</h3>
      <dl className="metadata-summary">
        <div>
          <dt>Path</dt>
          <dd style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
            <span style={{ overflowWrap: 'anywhere' }}>{record.virtualPath}</span>
            <CopyButton text={record.virtualPath} />
          </dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(record.byteLength)}</dd>
        </div>
        <div>
          <dt>GUID</dt>
          <dd style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
            <span style={{ overflowWrap: 'anywhere' }}>{record.guid}</span>
            <CopyButton text={record.guid} />
          </dd>
        </div>
        <div>
          <dt>Importer</dt>
          <dd style={{ overflowWrap: 'anywhere' }}>{importerDisplay}</dd>
        </div>
        {diagTotal > 0 && (
          <div>
            <dt>Diagnostics</dt>
            <dd>
              <span className={
                [...record.diagnostics, ...record.findings].some(d => d.severity === 'error')
                  ? 'diag-badge diag-badge-error'
                  : [...record.diagnostics, ...record.findings].some(d => d.severity === 'warning')
                  ? 'diag-badge diag-badge-warning'
                  : 'diag-badge diag-badge-info'
              }>
                {diagSeveritySummary(record.diagnostics, record.findings)}
              </span>
            </dd>
          </div>
        )}
      </dl>

      <details className="details-disclosure">
        <summary className="details-disclosure-summary">
          <span>Technical details</span>
        </summary>
        <dl>
          {technicalRows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd style={{ overflowWrap: 'anywhere' }}>{value}</dd>
            </div>
          ))}
          {declaredMetaInfo.guid !== undefined && declaredMetaInfo.guid !== record.guid ? (
            <div key="Declared meta GUID">
              <dt>Declared meta GUID</dt>
              <dd style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                <span style={{ overflowWrap: 'anywhere' }}>{declaredMetaInfo.guid}</span>
                <CopyButton text={declaredMetaInfo.guid} />
              </dd>
            </div>
          ) : null}
        </dl>
      </details>

      <DiagnosticsDisclosure diagnostics={record.diagnostics} findings={record.findings} />

      {siblingMetaRecord && <MetaSidecarDisclosure siblingRecord={siblingMetaRecord} />}
    </section>
  );
}
