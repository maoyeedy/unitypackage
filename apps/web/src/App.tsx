import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
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
import { getFileIconDescriptor } from './fileIcons';
import type { DownloadZipResponse, ParsePackageResponse } from './workerTypes';
import {
  buildExtensionGroups,
  buildTreeRows,
  formatBytes,
  getDeclaredMetaInfoForRecord,
  getExpectedImporterTypeForRecord,
  getExtensionFileRecordIds,
  getFolderRecordIds,
  getRecordCategory,
  getRangeRecordIds,
  getSelectionState,
  getTreeFileRecordIds,
  resolveMetaSidecarSelection,
  routeAnalysisFindings,
  toSidecarSelectableRecords,
  validatePackDraft,
  type ExtensionGroup,
  type GroupingMode,
  type PackageFileRecord,
  type PreviewKind,
  type SelectionState,
  type TreeRow,
  type UnityPackageAnalysisFinding,
  type WorkspaceMode,
} from './packageModel';
import { highlightCode, type HighlightedCode, type HighlightedToken, type SyntaxThemeMode } from './syntaxHighlight';

interface ParseResult {
  records: PackageFileRecord[];
  diagnostics: UnityPackageParseDiagnostic[];
  analysis: UnityPackageAnalysisFinding[];
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

const textDecoder = new TextDecoder('utf-8', { fatal: false });
const textPreviewByteLimit = 20000;
const dragSelectionThresholdPx = 4;
const dragAutoScrollEdgePx = 32;
const dragAutoScrollStepPx = 18;

type SelectionMode = 'add' | 'remove';

interface DragSelectionState {
  pointerId: number;
  startClientY: number;
  startRecordId: string;
  baseSelectedIds: Set<string>;
  mode: SelectionMode;
  active: boolean;
}

function parsePackageInWorker(buffer: ArrayBuffer): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parsePackage.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = ({ data }: MessageEvent<ParsePackageResponse>) => {
      worker.terminate();
      if (data.type === 'success') {
        resolve({ records: data.records, diagnostics: data.diagnostics, analysis: data.analysis });
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
  const [analysis, setAnalysis] = useState<UnityPackageAnalysisFinding[]>([]);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [stagedRecordIds, setStagedRecordIds] = useState<Set<string>>(new Set());
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [maintainStructure, setMaintainStructure] = useState(true);
  const [includeMetaSidecars, setIncludeMetaSidecars] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [packageName, setPackageName] = useState<string | null>(null);
  const [status, setStatus] = useState('Open a .unitypackage to inspect its contents.');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = debouncedQuery.trim().toLowerCase();
    if (!normalizedQuery || !/[a-z0-9]/i.test(normalizedQuery)) return records;
    return records.filter(record =>
      record.fileName.toLowerCase().includes(normalizedQuery) ||
      record.guid.toLowerCase().includes(normalizedQuery)
    );
  }, [debouncedQuery, records]);

  const visibleRecords = useMemo(() => {
    if (includeMetaSidecars) return filteredRecords;
    return filteredRecords.filter(record => record.extension !== 'meta');
  }, [filteredRecords, includeMetaSidecars]);

  const activeRecord = useMemo(() => {
    return records.find(record => record.id === activeRecordId) ?? filteredRecords[0] ?? null;
  }, [activeRecordId, filteredRecords, records]);

  const stagedRecords = useMemo(() => {
    return records.filter(record => stagedRecordIds.has(record.id));
  }, [records, stagedRecordIds]);

  const totalBytes = useMemo(() => records.reduce((sum, record) => sum + record.byteLength, 0), [records]);
  const extensionGroups = useMemo(() => buildExtensionGroups(visibleRecords), [visibleRecords]);
  const treeRows = useMemo(() => buildTreeRows(visibleRecords, collapsedFolders), [visibleRecords, collapsedFolders]);
  const treeFileRecordIds = useMemo(() => getTreeFileRecordIds(treeRows), [treeRows]);
  const extensionFileRecordIds = useMemo(() => getExtensionFileRecordIds(extensionGroups), [extensionGroups]);
  const packValidation = useMemo(() => validatePackDraft(stagedRecords), [stagedRecords]);

  const handlePackageFile = async (file: File) => {
    setIsLoading(true);
    setError(null);
    setPackageName(file.name);
    setStatus(`Parsing ${file.name}`);
    setRecords([]);
    setDiagnostics([]);
    setAnalysis([]);
    setIsDiagnosticsOpen(false);
    setSelectedRecordIds(new Set());
    setStagedRecordIds(new Set());
    setActiveRecordId(null);
    setCollapsedFolders(new Set());

    try {
      const startedAt = performance.now();
      const result = await parsePackageInWorker(await file.arrayBuffer());
      const elapsed = Math.round(performance.now() - startedAt);
      routeAnalysisFindings(result.records, result.analysis);
      setRecords(result.records);
      setDiagnostics(result.diagnostics);
      setAnalysis(result.analysis);
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

  const toggleRecordSelection = useCallback((recordId: string) => {
    setSelectedRecordIds(previous => {
      const next = new Set(previous);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }, []);

  const applyRecordSelection = useCallback((recordIds: readonly string[], selected: boolean, baseSelectedIds?: ReadonlySet<string>) => {
    setSelectedRecordIds(previous => {
      const next = new Set(baseSelectedIds ?? previous);
      for (const id of recordIds) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const replaceRecordSelection = useCallback((nextSelectedIds: Set<string>) => {
    setSelectedRecordIds(new Set(nextSelectedIds));
  }, []);

  const selectScope = useCallback((recordIds: readonly string[], state: SelectionState) => {
    applyRecordSelection(recordIds, state !== 'all');
  }, [applyRecordSelection]);

  const clearSelection = useCallback(() => {
    setSelectedRecordIds(new Set());
  }, []);

  const toggleFolder = useCallback((path: string) => {
    setCollapsedFolders(previous => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // When meta sidecars are hidden, remove hidden meta IDs from selection and
  // re-home the active record if it points at a now-hidden meta row.
  useEffect(() => {
    if (includeMetaSidecars) return;

    const hiddenMetaIds = new Set(
      records.filter(record => record.extension === 'meta').map(record => record.id),
    );
    if (hiddenMetaIds.size === 0) return;

    setSelectedRecordIds(previous => {
      const hasHidden = [...previous].some(id => hiddenMetaIds.has(id));
      if (!hasHidden) return previous;
      const next = new Set(previous);
      for (const id of hiddenMetaIds) next.delete(id);
      return next;
    });

    setActiveRecordId(previous => {
      if (previous === null || !hiddenMetaIds.has(previous)) return previous;
      // Try to find the same-GUID asset record
      const hiddenRecord = records.find(record => record.id === previous);
      if (hiddenRecord) {
        const sameGuidAsset = records.find(
          record => record.guid === hiddenRecord.guid && record.extension !== 'meta' && !record.isUnityPreview,
        );
        if (sameGuidAsset) return sameGuidAsset.id;
      }
      // Fall back to the first visible (non-meta) record
      const firstVisible = records.find(record => record.extension !== 'meta');
      return firstVisible?.id ?? null;
    });
  }, [includeMetaSidecars, records]);

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
              placeholder="Filter name or GUID"
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
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={includeMetaSidecars}
              onChange={event => {
                setIncludeMetaSidecars(event.target.checked);
              }}
            />
            Include .meta with assets
          </label>
          <Stats records={records} filteredCount={visibleRecords.length} totalBytes={totalBytes} diagnostics={diagnostics} analysis={analysis} />
        </aside>

        <section className="main-panel" aria-label="Package explorer">
          {mode === 'extract' ? (
            <>
              <div className="panel-toolbar">
                <div>
                  <h2>Extract</h2>
                  <p>
                    {visibleRecords.length.toString()} visible records
                    {selectedRecordIds.size > 0 ? `, ${[...selectedRecordIds].filter(id => visibleRecords.some(r => r.id === id)).length.toString()} selected` : ''}
                  </p>
                </div>
                <div className="button-row">
                  <button type="button" disabled={selectedRecordIds.size === 0} onClick={clearSelection}>
                    <RefreshCw aria-hidden="true" size={16} />
                    <span>Clear selection</span>
                  </button>
                  <button type="button" disabled={selectedRecordIds.size === 0} onClick={stageSelection}>
                    <PackagePlus aria-hidden="true" size={16} />
                    <span>Stage for pack</span>
                  </button>
                  <button
                    type="button"
                    disabled={selectedRecordIds.size === 0}
                    onClick={() => {
                      if (!includeMetaSidecars) {
                        void handleDownload(records, 'selected_files.zip', [...selectedRecordIds]);
                        return;
                      }
                      const result = resolveMetaSidecarSelection(
                        toSidecarSelectableRecords(records),
                        [...selectedRecordIds],
                      );
                      void handleDownload(records, 'selected_files.zip', result.ids).then(() => {
                        if (result.missingMetaForAssetIds.length > 0) {
                          setStatus(
                            `ZIP created. ${result.missingMetaForAssetIds.length.toString()} asset(s) have no .meta sidecar in this package.`,
                          );
                        }
                      });
                    }}
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
                records={visibleRecords}
                treeRows={treeRows}
                extensionGroups={extensionGroups}
                treeFileRecordIds={treeFileRecordIds}
                extensionFileRecordIds={extensionFileRecordIds}
                selectedIds={selectedRecordIds}
                activeId={activeRecord?.id ?? null}
                collapsedFolders={collapsedFolders}
                onToggleFolder={toggleFolder}
                onActivate={setActiveRecordId}
                onToggleSelected={toggleRecordSelection}
                onScopeSelect={selectScope}
                onReplaceSelection={replaceRecordSelection}
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
          <PreviewPanel
            record={activeRecord}
            records={records}
            includeMetaSidecars={includeMetaSidecars}
            onDownloadZip={(zipRecords, fileName, recordIds) => void handleDownload(zipRecords, fileName, recordIds)}
            onStatusWarning={setStatus}
          />
        </aside>
      </section>

      {isDiagnosticsOpen && (diagnostics.length > 0 || analysis.length > 0) ? (
        <DiagnosticsDrawer
          diagnostics={diagnostics}
          analysis={analysis}
          records={records}
          onNavigate={(recordId) => {
            setActiveRecordId(recordId);
            setIsDiagnosticsOpen(false);
          }}
          onClose={() => { setIsDiagnosticsOpen(false); }}
        />
      ) : null}
      <footer className="statusbar" aria-live="polite">
        <span>{status}</span>
        {error ? (
          <span className="status-error">
            <AlertTriangle aria-hidden="true" size={15} />
            {error}
          </span>
        ) : null}
        {(diagnostics.length > 0 || analysis.length > 0) ? (
          <button
            type="button"
            className="status-diagnostics-toggle"
            onClick={() => { setIsDiagnosticsOpen(open => !open); }}
          >
            <Info aria-hidden="true" size={15} />
            {(diagnostics.length + analysis.length).toString()} findings
          </button>
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
  analysis,
}: {
  records: PackageFileRecord[];
  filteredCount: number;
  totalBytes: number;
  diagnostics: UnityPackageParseDiagnostic[];
  analysis: UnityPackageAnalysisFinding[];
}) {
  const assetCount = records.filter(record => !record.isUnityPreview && record.extension !== 'meta').length;
  const metaCount = records.filter(record => record.extension === 'meta').length;
  const previewCount = records.filter(record => record.isUnityPreview).length;

  const errorCount = (diagnostics.filter(d => d.severity === 'error').length + analysis.filter(f => f.severity === 'error').length);
  const warnCount = (diagnostics.filter(d => d.severity === 'warning').length + analysis.filter(f => f.severity === 'warning').length);
  const infoCount = (diagnostics.filter(d => d.severity === 'info').length + analysis.filter(f => f.severity === 'info').length);

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
        <dt>Errors</dt>
        <dd>{errorCount.toString()}</dd>
      </div>
      <div>
        <dt>Warnings</dt>
        <dd>{warnCount.toString()}</dd>
      </div>
      <div>
        <dt>Info</dt>
        <dd>{infoCount.toString()}</dd>
      </div>
    </dl>
  );
}

function Explorer({
  groupingMode,
  records,
  treeRows,
  extensionGroups,
  treeFileRecordIds,
  extensionFileRecordIds,
  selectedIds,
  activeId,
  collapsedFolders,
  onToggleFolder,
  onActivate,
  onToggleSelected,
  onScopeSelect,
  onReplaceSelection,
}: {
  groupingMode: GroupingMode;
  records: PackageFileRecord[];
  treeRows: TreeRow[];
  extensionGroups: ExtensionGroup[];
  treeFileRecordIds: string[];
  extensionFileRecordIds: string[];
  selectedIds: ReadonlySet<string>;
  activeId: string | null;
  collapsedFolders: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  onActivate: (recordId: string) => void;
  onToggleSelected: (recordId: string) => void;
  onScopeSelect: (recordIds: readonly string[], state: SelectionState) => void;
  onReplaceSelection: (selectedIds: Set<string>) => void;
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
      records={records}
      orderedRecordIds={treeFileRecordIds}
      selectedIds={selectedIds}
      activeId={activeId}
      collapsedFolders={collapsedFolders}
      onToggleFolder={onToggleFolder}
      onActivate={onActivate}
      onToggleSelected={onToggleSelected}
      onScopeSelect={onScopeSelect}
      onReplaceSelection={onReplaceSelection}
    />
  ) : (
    <ExtensionList
      groups={extensionGroups}
      orderedRecordIds={extensionFileRecordIds}
      selectedIds={selectedIds}
      activeId={activeId}
      onActivate={onActivate}
      onToggleSelected={onToggleSelected}
      onScopeSelect={onScopeSelect}
      onReplaceSelection={onReplaceSelection}
    />
  );
}

function VirtualTree({
  rows,
  records,
  orderedRecordIds,
  selectedIds,
  activeId,
  collapsedFolders,
  onToggleFolder,
  onActivate,
  onToggleSelected,
  onScopeSelect,
  onReplaceSelection,
}: {
  rows: TreeRow[];
  records: PackageFileRecord[];
  orderedRecordIds: string[];
  selectedIds: ReadonlySet<string>;
  activeId: string | null;
  collapsedFolders: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  onActivate: (recordId: string) => void;
  onToggleSelected: (recordId: string) => void;
  onScopeSelect: (recordIds: readonly string[], state: SelectionState) => void;
  onReplaceSelection: (selectedIds: Set<string>) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const dragSelection = useRowSweepSelection({
    orderedRecordIds,
    selectedIds,
    scrollRef: parentRef,
    onReplaceSelection,
  });
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 38,
    overscan: 10,
  });

  return (
    <div
      ref={parentRef}
      className={`explorer-viewport${dragSelection.isDragging ? ' selecting-range' : ''}`}
      role="tree"
      aria-label="Package file tree"
    >
      <div className="virtual-spacer" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map(virtualRow => {
          const row = rows[virtualRow.index];
          const style: CSSProperties = {
            height: `${virtualRow.size}px`,
            transform: `translateY(${virtualRow.start}px)`,
          };

          if (row.type === 'folder') {
            const collapsed = collapsedFolders.has(row.path);
            const folderRecordIds = getFolderRecordIds(records, row.path);
            const selectionState = getSelectionState(folderRecordIds, selectedIds);
            return (
              <div
                key={row.id}
                className="tree-row folder-row"
                style={{ ...style, paddingLeft: `${12 + row.depth * 18}px` }}
                onClick={() => { onToggleFolder(row.path); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onToggleFolder(row.path);
                  }
                }}
                role="treeitem"
                tabIndex={0}
                aria-expanded={!collapsed}
              >
                <SelectionToggle
                  state={selectionState}
                  disabled={folderRecordIds.length === 0}
                  label={`${selectionState === 'all' ? 'Deselect' : 'Select'} ${row.name}`}
                  onSelect={() => { onScopeSelect(folderRecordIds, selectionState); }}
                />
                {collapsed ? <ChevronRight aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}
                {collapsed ? <Folder aria-hidden="true" size={17} /> : <FolderOpen aria-hidden="true" size={17} />}
                <span>{row.name}</span>
                <small>{row.fileCount.toString()}</small>
              </div>
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
              onPointerDown={dragSelection.onPointerDown}
              shouldSuppressClick={dragSelection.shouldSuppressClick}
            />
          );
        })}
      </div>
    </div>
  );
}

function ExtensionList({
  groups,
  orderedRecordIds,
  selectedIds,
  activeId,
  onActivate,
  onToggleSelected,
  onScopeSelect,
  onReplaceSelection,
}: {
  groups: ExtensionGroup[];
  orderedRecordIds: string[];
  selectedIds: ReadonlySet<string>;
  activeId: string | null;
  onActivate: (recordId: string) => void;
  onToggleSelected: (recordId: string) => void;
  onScopeSelect: (recordIds: readonly string[], state: SelectionState) => void;
  onReplaceSelection: (selectedIds: Set<string>) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const dragSelection = useRowSweepSelection({
    orderedRecordIds,
    selectedIds,
    scrollRef: parentRef,
    onReplaceSelection,
  });

  return (
    <div ref={parentRef} className={`extension-list${dragSelection.isDragging ? ' selecting-range' : ''}`}>
      {groups.map(group => (
        <section className="extension-group" key={group.extension}>
          <header>
            <div className="extension-title">
              <SelectionToggle
                state={getSelectionState(group.records.map(record => record.id), selectedIds)}
                disabled={group.records.length === 0}
                label={`${getSelectionState(group.records.map(record => record.id), selectedIds) === 'all' ? 'Deselect' : 'Select'} ${group.extension}`}
                onSelect={() => {
                  const recordIds = group.records.map(record => record.id);
                  onScopeSelect(recordIds, getSelectionState(recordIds, selectedIds));
                }}
              />
              <h3>{group.extension}</h3>
            </div>
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
              onPointerDown={dragSelection.onPointerDown}
              shouldSuppressClick={dragSelection.shouldSuppressClick}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function SelectionToggle({
  state,
  label,
  disabled = false,
  onSelect,
}: {
  state: SelectionState;
  label: string;
  disabled?: boolean;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const ariaChecked = state === 'partial' ? 'mixed' : state === 'all';

  return (
    <button
      type="button"
      className={`icon-button selection-toggle selection-${state}`}
      role="checkbox"
      aria-checked={ariaChecked}
      aria-label={label}
      disabled={disabled}
      onPointerDown={(event) => { event.stopPropagation(); }}
      onKeyDown={(event) => { event.stopPropagation(); }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(event);
      }}
    >
      {state === 'all' ? <CheckSquare aria-hidden="true" size={16} /> : <Square aria-hidden="true" size={16} />}
    </button>
  );
}

function useRowSweepSelection({
  orderedRecordIds,
  selectedIds,
  scrollRef,
  onReplaceSelection,
}: {
  orderedRecordIds: string[];
  selectedIds: ReadonlySet<string>;
  scrollRef: { current: HTMLElement | null };
  onReplaceSelection: (selectedIds: Set<string>) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const suppressClickRef = useRef(false);

  const shouldSuppressClick = useCallback(() => suppressClickRef.current, []);

  useEffect(() => {
    if (!isDragging) return undefined;

    document.body.classList.add('range-selecting');
    return () => {
      document.body.classList.remove('range-selecting');
    };
  }, [isDragging]);

  const onPointerDown = useCallback((recordId: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || orderedRecordIds.length === 0) return;
    event.preventDefault();
    event.currentTarget.focus();

    const drag: DragSelectionState = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startRecordId: recordId,
      baseSelectedIds: new Set(selectedIds),
      mode: selectedIds.has(recordId) ? 'remove' : 'add',
      active: false,
    };

    const applyRange = (targetRecordId: string) => {
      const rangeIds = getRangeRecordIds(orderedRecordIds, drag.startRecordId, targetRecordId);
      const next = new Set(drag.baseSelectedIds);
      for (const id of rangeIds) {
        if (drag.mode === 'add') next.add(id);
        else next.delete(id);
      }
      onReplaceSelection(next);
    };

    const scrollNearEdge = (clientY: number) => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) return;

      const bounds = scrollElement.getBoundingClientRect();
      if (clientY < bounds.top + dragAutoScrollEdgePx) {
        scrollElement.scrollTop -= dragAutoScrollStepPx;
      } else if (clientY > bounds.bottom - dragAutoScrollEdgePx) {
        scrollElement.scrollTop += dragAutoScrollStepPx;
      }
    };

    const getRecordIdAtPoint = (clientX: number, clientY: number) => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) return null;

      const bounds = scrollElement.getBoundingClientRect();
      if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) {
        return null;
      }

      const element = document.elementFromPoint(clientX, clientY);
      if (!(element instanceof HTMLElement)) return null;
      const row = element.closest<HTMLElement>('[data-record-id]');
      if (!row || !scrollElement.contains(row)) return null;
      return row.dataset.recordId ?? null;
    };

    const onPointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== drag.pointerId) return;

      const targetRecordId = getRecordIdAtPoint(pointerEvent.clientX, pointerEvent.clientY);
      if (!drag.active && Math.abs(pointerEvent.clientY - drag.startClientY) < dragSelectionThresholdPx) return;
      if (!targetRecordId) return;

      scrollNearEdge(pointerEvent.clientY);
      drag.active = true;
      setIsDragging(true);
      pointerEvent.preventDefault();
      window.getSelection()?.removeAllRanges();
      applyRange(targetRecordId);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };

    const onPointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== drag.pointerId) return;
      cleanup();
      if (drag.active) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      setIsDragging(false);
    };

    const onPointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== drag.pointerId) return;
      cleanup();
      setIsDragging(false);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }, [onReplaceSelection, orderedRecordIds, scrollRef, selectedIds]);

  return {
    isDragging,
    onPointerDown,
    shouldSuppressClick,
  };
}

function FileRow({
  record,
  active,
  selected,
  depth,
  style,
  onActivate,
  onToggleSelected,
  onPointerDown,
  shouldSuppressClick,
}: {
  record: PackageFileRecord;
  active: boolean;
  selected: boolean;
  depth: number;
  style?: CSSProperties;
  onActivate: (recordId: string) => void;
  onToggleSelected: (recordId: string) => void;
  onPointerDown: (recordId: string, event: ReactPointerEvent<HTMLElement>) => void;
  shouldSuppressClick: () => boolean;
}) {
  const { Icon, tone, label } = getFileIconDescriptor(record);

  return (
    <div
      className={`tree-row file-row${active ? ' active' : ''}${selected ? ' selected' : ''}`}
      style={{ ...style, paddingLeft: `${12 + depth * 18}px` }}
      role="treeitem"
      aria-selected={selected}
      tabIndex={0}
      data-record-id={record.id}
      onPointerDown={(event) => { onPointerDown(record.id, event); }}
      onClick={(event) => {
        if (shouldSuppressClick()) {
          event.preventDefault();
          return;
        }

        if (event.ctrlKey || event.metaKey) {
          onToggleSelected(record.id);
        }

        onActivate(record.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onActivate(record.id);
          return;
        }

        if (event.key === ' ') {
          event.preventDefault();
          onToggleSelected(record.id);
        }
      }}
    >
      <SelectionToggle
        state={selected ? 'all' : 'none'}
        label={selected ? `Deselect ${record.fileName}` : `Select ${record.fileName}`}
        onSelect={() => { onToggleSelected(record.id); }}
      />
      <span className={`file-kind-icon file-kind-${tone}`} title={label}>
        <Icon aria-hidden="true" size={17} strokeWidth={1.9} />
      </span>
      <span className="file-name">{record.fileName}</span>
      <small>{formatBytes(record.byteLength)}</small>
    </div>
  );
}

function PreviewPanel({
  record,
  records,
  includeMetaSidecars,
  onDownloadZip,
  onStatusWarning,
}: {
  record: PackageFileRecord | null;
  records: PackageFileRecord[];
  includeMetaSidecars: boolean;
  onDownloadZip: (records: PackageFileRecord[], fileName: string, recordIds: string[]) => void;
  onStatusWarning: (message: string) => void;
}) {
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

  const handlePreviewDownload = () => {
    if (includeMetaSidecars && getRecordCategory(record) === 'asset') {
      const result = resolveMetaSidecarSelection(
        toSidecarSelectableRecords(records),
        [record.id],
      );
      if (result.missingMetaForAssetIds.length > 0) {
        // No meta exists: download raw asset and warn
        downloadBlob(new Blob([record.content as Uint8Array<ArrayBuffer>], { type: record.mimeType }), record.fileName);
        onStatusWarning(`Downloaded ${record.fileName}. No .meta sidecar found in this package.`);
      } else {
        // Meta exists: create a ZIP named after the asset file
        const zipFileName = `${record.fileName}.zip`;
        onDownloadZip(records, zipFileName, result.ids);
      }
      return;
    }
    downloadBlob(new Blob([record.content as Uint8Array<ArrayBuffer>], { type: record.mimeType }), record.fileName);
  };

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
          onClick={handlePreviewDownload}
        >
          <Download aria-hidden="true" size={18} />
        </button>
      </header>
      <PreviewBody record={record} blobUrl={blobUrl} />
      <Metadata record={record} records={records} />
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
    return <TextPreview record={record} />;
  }

  return (
    <div className="preview-frame unsupported-frame">
      <FileArchive aria-hidden="true" size={34} />
      <h3>No native preview</h3>
      <p>This file type can still be downloaded and staged for pack workflows.</p>
    </div>
  );
}

function TextPreview({ record }: { record: PackageFileRecord }) {
  const themeMode = usePreferredSyntaxTheme();
  const preview = useMemo(() => textDecoder.decode(record.content.slice(0, textPreviewByteLimit)), [record.content]);
  const isTruncated = record.content.byteLength > textPreviewByteLimit;
  const [highlightedCode, setHighlightedCode] = useState<HighlightedCode | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHighlightedCode(null);

    void highlightCode(preview, record.syntaxLanguage, themeMode)
      .then(result => {
        if (!cancelled) setHighlightedCode(result);
      })
      .catch(() => {
        if (!cancelled) setHighlightedCode(null);
      });

    return () => {
      cancelled = true;
    };
  }, [preview, record.syntaxLanguage, themeMode]);

  if (!highlightedCode) {
    return (
      <pre className="preview-frame text-frame">
        {formatTextPreview(preview, isTruncated)}
      </pre>
    );
  }

  return (
    <pre
      className="preview-frame text-frame highlighted-text-frame"
      style={{
        backgroundColor: highlightedCode.background,
        color: highlightedCode.foreground,
      }}
    >
      <code>
        {highlightedCode.lines.map((line, lineIndex) => (
          <span className="code-line" key={lineIndex.toString()}>
            {line.map((token, tokenIndex) => (
              <span className="syntax-token" key={`${lineIndex.toString()}-${tokenIndex.toString()}`} style={tokenStyle(token)}>
                {token.content}
              </span>
            ))}
          </span>
        ))}
        {isTruncated ? <span className="preview-truncation">[Preview truncated at 20 KB]</span> : null}
      </code>
    </pre>
  );
}

function usePreferredSyntaxTheme(): SyntaxThemeMode {
  const [themeMode, setThemeMode] = useState<SyntaxThemeMode>(() => getPreferredSyntaxTheme());

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = () => {
      setThemeMode(mediaQuery.matches ? 'dark' : 'light');
    };
    mediaQuery.addEventListener('change', updateTheme);
    updateTheme();

    return () => {
      mediaQuery.removeEventListener('change', updateTheme);
    };
  }, []);

  return themeMode;
}

function getPreferredSyntaxTheme(): SyntaxThemeMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function formatTextPreview(preview: string, isTruncated: boolean): string {
  return isTruncated ? `${preview}\n\n[Preview truncated at 20 KB]` : preview;
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

function Metadata({ record, records }: { record: PackageFileRecord; records: PackageFileRecord[] }) {
  const expectedImporter = getExpectedImporterTypeForRecord(record);
  const declaredMetaInfo = getDeclaredMetaInfoForRecord(records, record);

  const rows: [string, string][] = [
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
    ['Syntax language', record.previewKind === 'text' ? record.syntaxLanguage : 'None'],
    ['Expected importer', expectedImporter],
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
        {declaredMetaInfo.importer !== undefined ? (
          <div key="Declared importer">
            <dt>Declared importer</dt>
            <dd>{declaredMetaInfo.importer}</dd>
          </div>
        ) : null}
        {declaredMetaInfo.guid !== undefined ? (
          <div key="Declared meta GUID">
            <dt>Declared meta GUID</dt>
            <dd>{declaredMetaInfo.guid}</dd>
          </div>
        ) : null}
      </dl>
      {(record.diagnostics.length > 0 || record.findings.length > 0) ? (
        <div className="record-diagnostics">
          <h3>Related diagnostics</h3>
          <ul>
            {record.diagnostics.map((diagnostic, index) => (
              <li key={`parser-${diagnostic.code}-${index.toString()}`}>
                <strong>[{diagnostic.severity.toUpperCase()}] {diagnostic.code}</strong>
                <span>{diagnostic.message}</span>
              </li>
            ))}
            {record.findings.map((finding, index) => (
              <li key={`analysis-${finding.code}-${index.toString()}`}>
                <strong>[{finding.severity.toUpperCase()}] {finding.code}</strong>
                <span>{finding.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function severityLabel(severity: UnityPackageAnalysisFinding['severity']): string {
  switch (severity) {
    case 'error': return 'ERR';
    case 'warning': return 'WRN';
    case 'info': return 'INF';
  }
}

function findBestMatchingRecord(
  records: PackageFileRecord[],
  finding: UnityPackageAnalysisFinding,
): PackageFileRecord | undefined {
  if (finding.guid !== undefined) {
    const guid = finding.guid;
    if (finding.path !== undefined) {
      const path = finding.path;
      const exact = records.find(r => r.guid === guid && (r.id.endsWith(`/${path}`) || r.id === path));
      if (exact) return exact;
    }
    return records.find(r => r.guid === guid && !r.isUnityPreview && r.extension !== 'meta')
      ?? records.find(r => r.guid === guid);
  }
  if (finding.pathname !== undefined) {
    const pathname = finding.pathname;
    return records.find(r => r.pathname === pathname);
  }
  return undefined;
}

function DiagnosticsDrawer({
  diagnostics,
  analysis,
  records,
  onNavigate,
  onClose,
}: {
  diagnostics: UnityPackageParseDiagnostic[];
  analysis: UnityPackageAnalysisFinding[];
  records: PackageFileRecord[];
  onNavigate: (recordId: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="diagnostics-drawer" aria-label="Diagnostics">
      <div className="diagnostics-drawer-header">
        <h2>Findings</h2>
        <button type="button" className="icon-button" aria-label="Close diagnostics" onClick={onClose}>
          <RefreshCw aria-hidden="true" size={16} />
        </button>
      </div>
      <ul className="diagnostics-list">
        {diagnostics.map((diagnostic, index) => (
          <li key={`parser-${diagnostic.code}-${index.toString()}`} className={`diagnostic-row severity-${diagnostic.severity}`}>
            <span className="diagnostic-badge">{severityLabel(diagnostic.severity)}</span>
            <span className="diagnostic-code">{diagnostic.code}</span>
            <span className="diagnostic-message">{diagnostic.message}</span>
            {diagnostic.guid !== undefined && records.some(r => r.guid === diagnostic.guid) ? (
              <button
                type="button"
                className="diagnostic-navigate"
                onClick={() => {
                  const record = records.find(r => r.guid === diagnostic.guid && !r.isUnityPreview && r.extension !== 'meta')
                    ?? records.find(r => r.guid === diagnostic.guid);
                  if (record) onNavigate(record.id);
                }}
              >
                Go
              </button>
            ) : null}
          </li>
        ))}
        {analysis.map((finding, index) => {
          const target = findBestMatchingRecord(records, finding);
          return (
            <li key={`analysis-${finding.code}-${index.toString()}`} className={`diagnostic-row severity-${finding.severity}`}>
              <span className="diagnostic-badge">{severityLabel(finding.severity)}</span>
              <span className="diagnostic-code">{finding.code}</span>
              <span className="diagnostic-message">{finding.message}</span>
              {target !== undefined ? (
                <button
                  type="button"
                  className="diagnostic-navigate"
                  onClick={() => { onNavigate(target.id); }}
                >
                  Go
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
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
      return 'Highlighted text';
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
