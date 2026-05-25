import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  AlertTriangle,
  Archive,
  Boxes,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Download,
  File,
  FileArchive,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Info,
  ListTree,
  PackagePlus,
  RefreshCw,
  Search,
  Square,
  UploadCloud,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { UnityPackageParseDiagnostic } from 'unitypackage-core';

import './App.css';
import type { DownloadZipResponse, ParsePackageResponse } from './workerTypes';
import {
  buildExtensionGroups,
  buildTreeRows,
  formatBytes,
  validatePackDraft,
  type ExtensionGroup,
  type GroupingMode,
  type PackageFileRecord,
  type PreviewKind,
  type TreeRow,
  type WorkspaceMode,
} from './packageModel';

interface ParseResult {
  records: PackageFileRecord[];
  diagnostics: UnityPackageParseDiagnostic[];
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

const textDecoder = new TextDecoder('utf-8', { fatal: false });

function parsePackageInWorker(buffer: ArrayBuffer): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parsePackage.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = ({ data }: MessageEvent<ParsePackageResponse>) => {
      worker.terminate();
      if (data.type === 'success') {
        resolve({ records: data.records, diagnostics: data.diagnostics });
        return;
      }

      reject(new Error(data.message));
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };

    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error('Failed to receive parsed package data'));
    };

    worker.postMessage({ buffer }, [buffer]);
  });
}

function createDownloadZipInWorker(
  records: PackageFileRecord[],
  maintainStructure: boolean,
  recordIds?: string[],
): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./downloadZip.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = ({ data }: MessageEvent<DownloadZipResponse>) => {
      worker.terminate();
      if (data.type === 'success') {
        resolve(data.data);
        return;
      }

      if (data.type === 'empty') {
        resolve(null);
        return;
      }

      reject(new Error(data.message));
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };

    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error('Failed to receive ZIP data'));
    };

    worker.postMessage({ records, maintainStructure, recordIds });
  });
}

class ErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error('Unhandled web error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-shell app-error" role="alert">
          <h1>Unity Package Workspace</h1>
          <p>Reload the page and open the package again.</p>
        </main>
      );
    }

    return this.props.children;
  }
}

function AppContent() {
  const [mode, setMode] = useState<WorkspaceMode>('extract');
  const [groupingMode, setGroupingMode] = useState<GroupingMode>('tree');
  const [records, setRecords] = useState<PackageFileRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<UnityPackageParseDiagnostic[]>([]);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [stagedRecordIds, setStagedRecordIds] = useState<Set<string>>(new Set());
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [maintainStructure, setMaintainStructure] = useState(true);
  const [query, setQuery] = useState('');
  const [packageName, setPackageName] = useState<string | null>(null);
  const [status, setStatus] = useState('Open a .unitypackage to inspect its contents.');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return records;
    return records.filter(record => {
      return (
        record.virtualPath.toLowerCase().includes(normalizedQuery) ||
        record.guid.toLowerCase().includes(normalizedQuery) ||
        record.kind.includes(normalizedQuery)
      );
    });
  }, [query, records]);

  const activeRecord = useMemo(() => {
    return records.find(record => record.id === activeRecordId) ?? filteredRecords[0] ?? null;
  }, [activeRecordId, filteredRecords, records]);

  const stagedRecords = useMemo(() => {
    return records.filter(record => stagedRecordIds.has(record.id));
  }, [records, stagedRecordIds]);

  const totalBytes = useMemo(() => records.reduce((sum, record) => sum + record.byteLength, 0), [records]);
  const extensionGroups = useMemo(() => buildExtensionGroups(filteredRecords), [filteredRecords]);
  const treeRows = useMemo(() => buildTreeRows(filteredRecords, collapsedFolders), [filteredRecords, collapsedFolders]);
  const packValidation = useMemo(() => validatePackDraft(stagedRecords), [stagedRecords]);

  const handlePackageFile = async (file: File) => {
    setIsLoading(true);
    setError(null);
    setPackageName(file.name);
    setStatus(`Parsing ${file.name}`);
    setRecords([]);
    setDiagnostics([]);
    setSelectedRecordIds(new Set());
    setStagedRecordIds(new Set());
    setActiveRecordId(null);
    setCollapsedFolders(new Set());

    try {
      const startedAt = performance.now();
      const result = await parsePackageInWorker(await file.arrayBuffer());
      const elapsed = Math.round(performance.now() - startedAt);
      setRecords(result.records);
      setDiagnostics(result.diagnostics);
      setActiveRecordId(result.records[0]?.id ?? null);
      setStatus(`Parsed ${result.records.length.toString()} records from ${file.name} in ${elapsed.toString()} ms.`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to parse package';
      setError(message);
      setStatus('Package parsing failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async (targetRecords: PackageFileRecord[], fileName: string, recordIds?: string[]) => {
    setError(null);
    try {
      const data = await createDownloadZipInWorker(targetRecords, maintainStructure, recordIds);
      if (!data) {
        setError('There are no files to download.');
        return;
      }

      downloadBlob(new Blob([new Uint8Array(data)], { type: 'application/zip' }), fileName);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to create ZIP file';
      setError(message);
    }
  };

  const toggleSelected = useCallback((recordId: string) => {
    setSelectedRecordIds(previous => {
      const next = new Set(previous);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }, []);

  const toggleFolder = useCallback((path: string) => {
    setCollapsedFolders(previous => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const stageSelection = () => {
    setStagedRecordIds(previous => {
      const next = new Set(previous);
      for (const id of selectedRecordIds) next.add(id);
      return next;
    });
    setMode('pack');
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Archive aria-hidden="true" size={26} />
          <div>
            <h1>Unity Package Workspace</h1>
            <p>{packageName ?? 'Inspect and prepare Unity package files locally in your browser.'}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ModeTabs mode={mode} onModeChange={setMode} />
          <label className="file-open-button">
            <UploadCloud aria-hidden="true" size={18} />
            <span>Open package</span>
            <input
              type="file"
              accept=".unitypackage"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handlePackageFile(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>
      </header>

      <section className="workspace" aria-label="Unity package workspace">
        <aside className="sidebar" aria-label="Package controls">
          <DropZone isLoading={isLoading} onPackageFile={(file) => void handlePackageFile(file)} />
          <div className="search-box">
            <Search aria-hidden="true" size={17} />
            <input
              type="search"
              value={query}
              placeholder="Filter path, GUID, or kind"
              onChange={event => {
                setQuery(event.target.value);
              }}
            />
          </div>
          <div className="segmented-control" aria-label="Explorer grouping">
            <button type="button" className={groupingMode === 'tree' ? 'active' : ''} onClick={() => { setGroupingMode('tree'); }}>
              <ListTree aria-hidden="true" size={16} />
              <span>Tree</span>
            </button>
            <button type="button" className={groupingMode === 'extension' ? 'active' : ''} onClick={() => { setGroupingMode('extension'); }}>
              <Boxes aria-hidden="true" size={16} />
              <span>Extension</span>
            </button>
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={maintainStructure}
              onChange={event => {
                setMaintainStructure(event.target.checked);
              }}
            />
            Preserve folders in ZIP downloads
          </label>
          <Stats records={records} filteredCount={filteredRecords.length} totalBytes={totalBytes} diagnostics={diagnostics} />
        </aside>

        <section className="main-panel" aria-label="Package explorer">
          {mode === 'extract' ? (
            <>
              <div className="panel-toolbar">
                <div>
                  <h2>Extract</h2>
                  <p>{filteredRecords.length.toString()} visible records</p>
                </div>
                <div className="button-row">
                  <button type="button" disabled={selectedRecordIds.size === 0} onClick={stageSelection}>
                    <PackagePlus aria-hidden="true" size={16} />
                    <span>Stage for pack</span>
                  </button>
                  <button
                    type="button"
                    disabled={selectedRecordIds.size === 0}
                    onClick={() => void handleDownload(records, 'selected_files.zip', [...selectedRecordIds])}
                  >
                    <Download aria-hidden="true" size={16} />
                    <span>Selected ZIP</span>
                  </button>
                  <button type="button" disabled={records.length === 0} onClick={() => void handleDownload(records, 'all_files.zip')}>
                    <FileArchive aria-hidden="true" size={16} />
                    <span>All ZIP</span>
                  </button>
                </div>
              </div>
              <Explorer
                groupingMode={groupingMode}
                records={filteredRecords}
                treeRows={treeRows}
                extensionGroups={extensionGroups}
                selectedIds={selectedRecordIds}
                activeId={activeRecord?.id ?? null}
                collapsedFolders={collapsedFolders}
                onToggleFolder={toggleFolder}
                onActivate={setActiveRecordId}
                onToggleSelected={toggleSelected}
              />
            </>
          ) : (
            <PackPanel
              stagedRecords={stagedRecords}
              validation={packValidation}
              onRemove={(id) => {
                setStagedRecordIds(previous => {
                  const next = new Set(previous);
                  next.delete(id);
                  return next;
                });
              }}
              onClear={() => {
                setStagedRecordIds(new Set());
              }}
            />
          )}
        </section>

        <aside className="preview-panel" aria-label="Preview and metadata">
          <PreviewPanel record={activeRecord} />
        </aside>
      </section>

      <footer className="statusbar" aria-live="polite">
        <span>{status}</span>
        {error ? (
          <span className="status-error">
            <AlertTriangle aria-hidden="true" size={15} />
            {error}
          </span>
        ) : null}
        {diagnostics.length > 0 ? (
          <span>
            <Info aria-hidden="true" size={15} />
            {diagnostics.length.toString()} diagnostics
          </span>
        ) : null}
      </footer>
    </main>
  );
}

function ModeTabs({ mode, onModeChange }: { mode: WorkspaceMode; onModeChange: (mode: WorkspaceMode) => void }) {
  return (
    <div className="mode-tabs" aria-label="Workspace mode">
      <button type="button" className={mode === 'extract' ? 'active' : ''} onClick={() => { onModeChange('extract'); }}>
        <Download aria-hidden="true" size={16} />
        <span>Extract</span>
      </button>
      <button type="button" className={mode === 'pack' ? 'active' : ''} onClick={() => { onModeChange('pack'); }}>
        <PackagePlus aria-hidden="true" size={16} />
        <span>Pack</span>
      </button>
    </div>
  );
}

function DropZone({ isLoading, onPackageFile }: { isLoading: boolean; onPackageFile: (file: File) => void }) {
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

function Stats({
  records,
  filteredCount,
  totalBytes,
  diagnostics,
}: {
  records: PackageFileRecord[];
  filteredCount: number;
  totalBytes: number;
  diagnostics: UnityPackageParseDiagnostic[];
}) {
  const assetCount = records.filter(record => record.kind === 'asset').length;
  const metaCount = records.filter(record => record.kind === 'meta').length;
  const previewCount = records.filter(record => record.kind === 'preview').length;

  return (
    <dl className="stats-grid">
      <div>
        <dt>Records</dt>
        <dd>{filteredCount.toString()} / {records.length.toString()}</dd>
      </div>
      <div>
        <dt>Assets</dt>
        <dd>{assetCount.toString()}</dd>
      </div>
      <div>
        <dt>Meta</dt>
        <dd>{metaCount.toString()}</dd>
      </div>
      <div>
        <dt>Previews</dt>
        <dd>{previewCount.toString()}</dd>
      </div>
      <div>
        <dt>Bytes</dt>
        <dd>{formatBytes(totalBytes)}</dd>
      </div>
      <div>
        <dt>Diagnostics</dt>
        <dd>{diagnostics.length.toString()}</dd>
      </div>
    </dl>
  );
}

function Explorer({
  groupingMode,
  records,
  treeRows,
  extensionGroups,
  selectedIds,
  activeId,
  collapsedFolders,
  onToggleFolder,
  onActivate,
  onToggleSelected,
}: {
  groupingMode: GroupingMode;
  records: PackageFileRecord[];
  treeRows: TreeRow[];
  extensionGroups: ExtensionGroup[];
  selectedIds: ReadonlySet<string>;
  activeId: string | null;
  collapsedFolders: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  onActivate: (recordId: string) => void;
  onToggleSelected: (recordId: string) => void;
}) {
  if (records.length === 0) {
    return (
      <div className="empty-state">
        <FileArchive aria-hidden="true" size={42} />
        <h2>No records loaded</h2>
        <p>Open a Unity package to inspect its tree, previews, metadata, diagnostics, and extractable files.</p>
      </div>
    );
  }

  return groupingMode === 'tree' ? (
    <VirtualTree
      rows={treeRows}
      selectedIds={selectedIds}
      activeId={activeId}
      collapsedFolders={collapsedFolders}
      onToggleFolder={onToggleFolder}
      onActivate={onActivate}
      onToggleSelected={onToggleSelected}
    />
  ) : (
    <ExtensionList
      groups={extensionGroups}
      selectedIds={selectedIds}
      activeId={activeId}
      onActivate={onActivate}
      onToggleSelected={onToggleSelected}
    />
  );
}

function VirtualTree({
  rows,
  selectedIds,
  activeId,
  collapsedFolders,
  onToggleFolder,
  onActivate,
  onToggleSelected,
}: {
  rows: TreeRow[];
  selectedIds: ReadonlySet<string>;
  activeId: string | null;
  collapsedFolders: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  onActivate: (recordId: string) => void;
  onToggleSelected: (recordId: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 38,
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="explorer-viewport" role="tree" aria-label="Package file tree">
      <div className="virtual-spacer" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map(virtualRow => {
          const row = rows[virtualRow.index];
          const style: CSSProperties = {
            height: `${virtualRow.size}px`,
            transform: `translateY(${virtualRow.start}px)`,
          };

          if (row.type === 'folder') {
            const collapsed = collapsedFolders.has(row.path);
            return (
              <button
                key={row.id}
                type="button"
                className="tree-row folder-row"
                style={{ ...style, paddingLeft: `${12 + row.depth * 18}px` }}
                onClick={() => { onToggleFolder(row.path); }}
                role="treeitem"
                aria-expanded={!collapsed}
              >
                {collapsed ? <ChevronRight aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}
                {collapsed ? <Folder aria-hidden="true" size={17} /> : <FolderOpen aria-hidden="true" size={17} />}
                <span>{row.name}</span>
                <small>{row.fileCount.toString()}</small>
              </button>
            );
          }

          return (
            <FileRow
              key={row.id}
              record={row.record}
              active={activeId === row.record.id}
              selected={selectedIds.has(row.record.id)}
              depth={row.depth}
              style={style}
              onActivate={onActivate}
              onToggleSelected={onToggleSelected}
            />
          );
        })}
      </div>
    </div>
  );
}

function ExtensionList({
  groups,
  selectedIds,
  activeId,
  onActivate,
  onToggleSelected,
}: {
  groups: ExtensionGroup[];
  selectedIds: ReadonlySet<string>;
  activeId: string | null;
  onActivate: (recordId: string) => void;
  onToggleSelected: (recordId: string) => void;
}) {
  return (
    <div className="extension-list">
      {groups.map(group => (
        <section className="extension-group" key={group.extension}>
          <header>
            <h3>{group.extension}</h3>
            <span>{group.records.length.toString()} files, {formatBytes(group.totalBytes)}</span>
          </header>
          {group.records.map(record => (
            <FileRow
              key={record.id}
              record={record}
              active={activeId === record.id}
              selected={selectedIds.has(record.id)}
              depth={0}
              onActivate={onActivate}
              onToggleSelected={onToggleSelected}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function FileRow({
  record,
  active,
  selected,
  depth,
  style,
  onActivate,
  onToggleSelected,
}: {
  record: PackageFileRecord;
  active: boolean;
  selected: boolean;
  depth: number;
  style?: CSSProperties;
  onActivate: (recordId: string) => void;
  onToggleSelected: (recordId: string) => void;
}) {
  const Icon = record.previewKind === 'image' ? FileImage : record.previewKind === 'text' ? FileText : File;

  return (
    <div
      className={`tree-row file-row${active ? ' active' : ''}`}
      style={{ ...style, paddingLeft: `${12 + depth * 18}px` }}
      role="treeitem"
      tabIndex={0}
      onClick={() => { onActivate(record.id); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate(record.id);
        }
      }}
    >
      <button
        type="button"
        className="icon-button"
        aria-label={selected ? `Deselect ${record.fileName}` : `Select ${record.fileName}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggleSelected(record.id);
        }}
      >
        {selected ? <CheckSquare aria-hidden="true" size={16} /> : <Square aria-hidden="true" size={16} />}
      </button>
      <Icon aria-hidden="true" size={17} />
      <span className="file-name">{record.fileName}</span>
      <small>{record.kind}</small>
      <small>{formatBytes(record.byteLength)}</small>
    </div>
  );
}

function PreviewPanel({ record }: { record: PackageFileRecord | null }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
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

  if (!record) {
    return (
      <div className="preview-empty">
        <Info aria-hidden="true" size={34} />
        <h2>No file selected</h2>
        <p>Select a file in the explorer to preview content and metadata.</p>
      </div>
    );
  }

  return (
    <div className="preview-content">
      <header className="preview-header">
        <div>
          <h2>{record.fileName}</h2>
          <p>{record.virtualPath}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={`Download ${record.fileName}`}
          onClick={() => {
            downloadBlob(new Blob([record.content as Uint8Array<ArrayBuffer>], { type: record.mimeType }), record.fileName);
          }}
        >
          <Download aria-hidden="true" size={18} />
        </button>
      </header>
      <PreviewBody record={record} blobUrl={blobUrl} />
      <Metadata record={record} />
    </div>
  );
}

function PreviewBody({ record, blobUrl }: { record: PackageFileRecord; blobUrl: string | null }) {
  if (!blobUrl) {
    return <div className="preview-frame">Preparing preview</div>;
  }

  if (record.previewKind === 'image') {
    return (
      <div className="preview-frame media-frame">
        <img src={blobUrl} alt={`${record.fileName} preview`} />
      </div>
    );
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
    return (
      <div className="preview-frame">
        <audio controls src={blobUrl}>
          <a href={blobUrl} download={record.fileName}>Download audio</a>
        </audio>
      </div>
    );
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
    const preview = textDecoder.decode(record.content.slice(0, 20000));
    return (
      <pre className="preview-frame text-frame">
        {record.content.byteLength > 20000 ? `${preview}\n\n[Preview truncated at 20 KB]` : preview}
      </pre>
    );
  }

  return (
    <div className="preview-frame unsupported-frame">
      <FileArchive aria-hidden="true" size={34} />
      <h3>No native preview</h3>
      <p>This file type can still be downloaded and staged for pack workflows.</p>
    </div>
  );
}

function Metadata({ record }: { record: PackageFileRecord }) {
  const rows = [
    ['Kind', record.kind],
    ['Path', record.virtualPath],
    ['GUID', record.guid],
    ['Extension', record.extension || 'None'],
    ['MIME', record.mimeType],
    ['Size', formatBytes(record.byteLength)],
    ['Asset bytes', record.assetSize === undefined ? 'None' : formatBytes(record.assetSize)],
    ['Meta bytes', record.metaSize === undefined ? 'None' : formatBytes(record.metaSize)],
    ['Preview bytes', record.previewSize === undefined ? 'None' : formatBytes(record.previewSize)],
    ['Duplicate paths', record.duplicatePathCount.toString()],
    ['Preview support', previewLabel(record.previewKind)],
  ];

  return (
    <section className="metadata">
      <h3>Metadata</h3>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {record.diagnostics.length > 0 ? (
        <div className="record-diagnostics">
          <h3>Related diagnostics</h3>
          <ul>
            {record.diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${index.toString()}`}>
                <strong>{diagnostic.code}</strong>
                <span>{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function PackPanel({
  stagedRecords,
  validation,
  onRemove,
  onClear,
}: {
  stagedRecords: PackageFileRecord[];
  validation: ReturnType<typeof validatePackDraft>;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <section className="pack-panel">
      <div className="panel-toolbar">
        <div>
          <h2>Pack</h2>
          <p>{validation.createEntryCount.toString()} future package entries staged</p>
        </div>
        <div className="button-row">
          <button type="button" disabled={stagedRecords.length === 0} onClick={onClear}>
            <RefreshCw aria-hidden="true" size={16} />
            <span>Clear</span>
          </button>
          <button type="button" disabled>
            <PackagePlus aria-hidden="true" size={16} />
            <span>Export .unitypackage</span>
          </button>
        </div>
      </div>
      <div className="pack-status" role="status">
        <AlertTriangle aria-hidden="true" size={18} />
        <div>
          <strong>Export is prepared but blocked</strong>
          <p>The creation worker will be connected after `docs/plans/web/new-api.md` adds the browser package creation API.</p>
        </div>
      </div>
      <ul className="validation-list">
        {validation.messages.map(message => (
          <li key={message}>{message}</li>
        ))}
      </ul>
      <div className="staged-list">
        {stagedRecords.map(record => (
          <div key={record.id} className="staged-row">
            <File aria-hidden="true" size={16} />
            <span>{record.virtualPath}</span>
            <small>{record.kind}</small>
            <button type="button" className="icon-button" aria-label={`Remove ${record.fileName}`} onClick={() => { onRemove(record.id); }}>
              <RefreshCw aria-hidden="true" size={15} />
            </button>
          </div>
        ))}
      </div>
    </section>
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
      return 'Text';
    case 'video':
      return 'Native video';
    case 'unsupported':
      return 'Unsupported';
  }
}

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

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
