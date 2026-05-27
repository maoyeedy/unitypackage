import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowUpDown,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Download,
  FileArchive,
  Filter,
  Info,
  ListTree,
  RefreshCw,
  Search,
  Settings,
} from 'lucide-react';

import './App.css';
import type { DownloadZipFileInput, DownloadZipRequest, DownloadZipResponse, ParsePackageResponse } from './workerTypes';
import { uniqueZipPath } from './zipPath';
import {
  buildExtensionGroups,
  buildTreeRows,
  expandAncestors,
  filterRecords,
  getAllFolderPaths,
  getExtensionFileRecordIds,
  getMetaSidecarForAsset,
  getTreeFileRecordIds,
  resolveAllZipRecordIds,
  resolveSelectedZipRecordIds,
  sortRecords,
  toSidecarSelectableRecords,
  type GroupingMode,
  type PackageFileRecord,
  type SelectionState,
  type SortDirection,
  type SortKey,
} from './packageModel';

import { DropZone } from './components/DropZone';
import { Stats } from './components/Stats';
import { Explorer } from './components/Explorer';
import { PreviewPanel } from './components/PreviewPanel';

interface ParseResult {
  records: PackageFileRecord[];
  contents: Record<string, Uint8Array<ArrayBuffer>>;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

function parsePackageInWorker(buffer: ArrayBuffer): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parsePackage.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = ({ data }: MessageEvent<ParsePackageResponse>) => {
      worker.terminate();
      if (data.type === 'success') {
        resolve({ records: data.records, contents: data.contents });
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
  recordIds: string[],
  getContent: (id: string) => Uint8Array<ArrayBuffer> | undefined,
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

    const idSet = new Set(recordIds);
    const usedNames = new Map<string, number>();
    const files: DownloadZipFileInput[] = [];
    const transfer: ArrayBuffer[] = [];
    for (const record of records) {
      if (!idSet.has(record.id)) continue;
      const path = uniqueZipPath(
        maintainStructure ? record.virtualPath : record.fileName,
        usedNames,
      );
      const bytes = getContent(record.id);
      if (!bytes) continue;
      const copy = new Uint8Array(bytes);
      files.push({ path, content: copy });
      transfer.push(copy.buffer);
    }

    worker.postMessage({ files, maintainStructure } satisfies DownloadZipRequest, transfer);
  });
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
  const [groupingMode, setGroupingMode] = useState<GroupingMode>('tree');
  const [records, setRecords] = useState<PackageFileRecord[]>([]);
  const contentStoreRef = useRef<Map<string, Uint8Array<ArrayBuffer>>>(new Map());
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [keyboardRangeBaseIds, setKeyboardRangeBaseIds] = useState<Set<string> | null>(null);
  const [isExtPickerOpen, setIsExtPickerOpen] = useState(false);
  const [maintainStructure, setMaintainStructure] = useState(true);
  const [includeMetaSidecarsInZip, setIncludeMetaSidecarsInZip] = useState(true);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [leftPaneCollapsed, setLeftPaneCollapsed] = useState(false);
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState(false);
  const [packageName, setPackageName] = useState<string | null>(null);
  const [currentOp, setCurrentOp] = useState<string | null>(null);
  const [lastCompleted, setLastCompleted] = useState<string | null>(null);
  const lastCompletedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [scrollToRow, setScrollToRow] = useState<{ id: string; key: number } | null>(null);
  const treeViewportRef = useRef<HTMLDivElement | null>(null);

  const getContent = useCallback((recordId: string): Uint8Array<ArrayBuffer> | undefined => {
    return contentStoreRef.current.get(recordId);
  }, []);

  const completeOp = useCallback((label: string) => {
    setCurrentOp(null);
    setLastCompleted(label);
    if (lastCompletedTimerRef.current !== null) {
      clearTimeout(lastCompletedTimerRef.current);
    }
    lastCompletedTimerRef.current = setTimeout(() => {
      setLastCompleted(null);
    }, 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (lastCompletedTimerRef.current !== null) {
        clearTimeout(lastCompletedTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const visibleRecords = useMemo(() => {
    const filtered = filterRecords(records, {
      query: debouncedQuery,
    });
    return sortRecords(filtered, sortKey, sortDirection);
  }, [records, debouncedQuery, sortKey, sortDirection]);

  const visibleExtensions = useMemo(() => {
    const exts = new Set<string>();
    for (const record of visibleRecords) {
      exts.add(record.extension || 'no extension');
    }
    return [...exts].sort();
  }, [visibleRecords]);

  const activeRecord = useMemo(() => {
    return records.find(record => record.id === activeRecordId) ?? visibleRecords[0] ?? null;
  }, [activeRecordId, visibleRecords, records]);

  const sidecarSelectableRecords = useMemo(() => toSidecarSelectableRecords(records), [records]);

  const activeMetaSidecar = useMemo(() => {
    if (!activeRecord) return undefined;
    return getMetaSidecarForAsset(records, activeRecord, sidecarSelectableRecords);
  }, [activeRecord, records, sidecarSelectableRecords]);

  const selectedVisibleCount = useMemo(() => {
    let count = 0;
    for (const record of visibleRecords) {
      if (selectedRecordIds.has(record.id)) count += 1;
    }
    return count;
  }, [selectedRecordIds, visibleRecords]);

  const totalBytes = useMemo(() => records.reduce((sum, record) => sum + record.byteLength, 0), [records]);
  const extensionGroups = useMemo(
    () => groupingMode === 'extension' ? buildExtensionGroups(visibleRecords) : [],
    [groupingMode, visibleRecords],
  );
  const treeRows = useMemo(
    () => groupingMode === 'tree' ? buildTreeRows(visibleRecords, collapsedFolders) : [],
    [groupingMode, visibleRecords, collapsedFolders],
  );
  const treeFileRecordIds = useMemo(
    () => groupingMode === 'tree' ? getTreeFileRecordIds(treeRows) : [],
    [groupingMode, treeRows],
  );
  const extensionFileRecordIds = useMemo(
    () => groupingMode === 'extension' ? getExtensionFileRecordIds(extensionGroups) : [],
    [groupingMode, extensionGroups],
  );

  const handlePackageFile = async (file: File) => {
    setIsLoading(true);
    setError(null);
    setPackageName(file.name);
    setCurrentOp(`Parsing ${file.name}`);
    setRecords([]);
    setSelectedRecordIds(new Set());
    setActiveRecordId(null);
    setCollapsedFolders(new Set());
    setQuery('');
    setDebouncedQuery('');

    try {
      const result = await parsePackageInWorker(await file.arrayBuffer());
      contentStoreRef.current = new Map(Object.entries(result.contents));
      setRecords(result.records);
      setActiveRecordId(result.records.find(record => record.extension !== 'meta')?.id ?? null);
      completeOp(`Parsed ${result.records.length.toString()} files from ${file.name}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to parse package';
      setError(message);
      setCurrentOp(null);
    } finally {
      setIsLoading(false);
    }
  };

  const downloadZip = async (recordIds: string[], fileName: string) => {
    setError(null);
    setCurrentOp('Creating ZIP');
    try {
      const data = await createDownloadZipInWorker(records, maintainStructure, recordIds, getContent);
      if (!data) {
        setCurrentOp(null);
        setError('No files to download.');
        return;
      }

      downloadBlob(new Blob([new Uint8Array(data)], { type: 'application/zip' }), fileName);
      completeOp(`ZIP downloaded: ${fileName}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to create ZIP file';
      setError(message);
      setCurrentOp(null);
    }
  };

  const getSelectedZipIds = useCallback(() => {
    return resolveSelectedZipRecordIds(
      sidecarSelectableRecords,
      [...selectedRecordIds],
      includeMetaSidecarsInZip,
    );
  }, [includeMetaSidecarsInZip, selectedRecordIds, sidecarSelectableRecords]);

  const getAllZipIds = useCallback(() => {
    return resolveAllZipRecordIds(sidecarSelectableRecords, includeMetaSidecarsInZip);
  }, [includeMetaSidecarsInZip, sidecarSelectableRecords]);

  const toggleRecordSelection = useCallback((recordId: string) => {
    setSelectionAnchorId(recordId);
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

  const invertSelection = useCallback(() => {
    setSelectedRecordIds(previous => {
      const next = new Set(previous);
      for (const record of visibleRecords) {
        if (next.has(record.id)) {
          next.delete(record.id);
        } else {
          next.add(record.id);
        }
      }
      return next;
    });
  }, [visibleRecords]);

  const selectByExtension = useCallback((ext: string) => {
    setSelectedRecordIds(previous => {
      const next = new Set(previous);
      for (const record of visibleRecords) {
        const recordExt = record.extension || 'no extension';
        if (recordExt === ext) {
          next.add(record.id);
        }
      }
      return next;
    });
  }, [visibleRecords]);

  const activateRecord = useCallback((id: string) => {
    setActiveRecordId(id);
    setFocusedRowId(id);
    setSelectionAnchorId(id);
  }, []);

  const toggleFolder = useCallback((path: string) => {
    const rowId = `folder:${path}`;
    setFocusedRowId(rowId);
    setSelectionAnchorId(rowId);
    setCollapsedFolders(previous => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setCollapsedFolders(previous => {
      const next = new Set(previous);
      for (const folder of getAllFolderPaths(visibleRecords)) {
        next.delete(folder);
      }
      return next;
    });
  }, [visibleRecords]);

  const collapseAll = useCallback(() => {
    setCollapsedFolders(previous => {
      const next = new Set(previous);
      for (const folder of getAllFolderPaths(visibleRecords)) {
        next.add(folder);
      }
      return next;
    });
  }, [visibleRecords]);

  const revealPathInTree = useCallback((pathOrId: string) => {
    const record = records.find(r => r.id === pathOrId || r.virtualPath === pathOrId);
    const path = record ? record.virtualPath : pathOrId;
    const rowId = record ? record.id : `folder:${pathOrId}`;

    setGroupingMode('tree');
    setCollapsedFolders(prev => expandAncestors(path, prev));
    if (record) {
      setActiveRecordId(record.id);
    }
    setFocusedRowId(rowId);
    setSelectionAnchorId(rowId);
    setScrollToRow({ id: rowId, key: Date.now() });

    setTimeout(() => {
      treeViewportRef.current?.focus();
    }, 50);
  }, [records]);

  return (
    <main className="app-shell">
      <section
        className={[
          'workspace',
          leftPaneCollapsed ? 'workspace--left-collapsed' : '',
          rightPaneCollapsed ? 'workspace--right-collapsed' : '',
        ].filter(Boolean).join(' ')}
        aria-label="Unity package workspace"
      >
        <aside className={`sidebar${leftPaneCollapsed ? ' pane-collapsed' : ''}`} aria-label="Package controls">
          <button
            type="button"
            className="pane-collapse-toggle pane-collapse-toggle--left"
            aria-label={leftPaneCollapsed ? 'Expand controls pane' : 'Collapse controls pane'}
            title={leftPaneCollapsed ? 'Expand controls pane' : 'Collapse controls pane'}
            onClick={() => { setLeftPaneCollapsed(prev => !prev); }}
          >
            {leftPaneCollapsed
              ? <ChevronRight aria-hidden="true" size={15} />
              : <ChevronLeft aria-hidden="true" size={15} />}
          </button>
          <DropZone isLoading={isLoading} onPackageFile={(file) => void handlePackageFile(file)} />
          <div className="package-title">
            <h1>Unity Package Workspace</h1>
            <p>{packageName ?? 'Open a .unitypackage to view and extract files.'}</p>
          </div>
          <div className="search-box">
            <Search aria-hidden="true" size={17} />
            <input
              type="search"
              aria-label="Search package files"
              value={query}
              placeholder="Search files by name or path"
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
          <details className="sidebar-disclosure">
            <summary className="sidebar-disclosure-summary">
              <Settings aria-hidden="true" size={13} />
              <span>ZIP options</span>
            </summary>
            <div className="sidebar-disclosure-body">
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
                  checked={includeMetaSidecarsInZip}
                  onChange={event => {
                    setIncludeMetaSidecarsInZip(event.target.checked);
                  }}
                />
                Include .meta sidecars in ZIP
              </label>
            </div>
          </details>
          {records.length > 0 && (
            <details className="sidebar-disclosure">
              <summary className="sidebar-disclosure-summary">
                <Info aria-hidden="true" size={13} />
                <span>Package summary</span>
              </summary>
              <div className="sidebar-disclosure-body">
                 <Stats records={records} filteredCount={visibleRecords.length} totalBytes={totalBytes} />
              </div>
            </details>
          )}
        </aside>

        <section className="main-panel" aria-label="Package explorer">
          <div className="panel-toolbar">
            <div>
              <h2>Extract</h2>
              <p>
                {visibleRecords.length.toString()} visible files
                {selectedRecordIds.size > 0 ? `, ${selectedVisibleCount.toString()} selected` : ''}
              </p>
            </div>
            <div className="button-row">
              <div className="sort-control">
                <label htmlFor="sort-key" className="sort-label">Sort</label>
                <select
                  id="sort-key"
                  className="sort-select"
                  value={sortKey}
                  onChange={event => { setSortKey(event.target.value as SortKey); }}
                >
                  <option value="name">Name</option>
                  <option value="size">Size</option>
                  <option value="extension">Extension</option>
                  <option value="guid">GUID</option>
                </select>
                <button
                  type="button"
                  id="sort-direction-toggle"
                  className="icon-button"
                  aria-label={sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
                  title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
                  onClick={() => { setSortDirection(d => d === 'asc' ? 'desc' : 'asc'); }}
                >
                  {sortDirection === 'asc'
                    ? <ArrowUpDown aria-hidden="true" size={15} />
                    : <ArrowDownUp aria-hidden="true" size={15} />}
                </button>
              </div>
              <button type="button" disabled={selectedRecordIds.size === 0} onClick={clearSelection}>
                <RefreshCw aria-hidden="true" size={16} />
                <span>Clear selection</span>
              </button>
              <button
                type="button"
                disabled={visibleRecords.length === 0}
                onClick={invertSelection}
              >
                <RefreshCw aria-hidden="true" size={16} />
                <span>Invert selection</span>
              </button>
              <div className="select-by-ext-container">
                <button
                  type="button"
                  disabled={visibleRecords.length === 0}
                  onClick={() => { setIsExtPickerOpen(prev => !prev); }}
                  aria-label="Select by extension"
                  aria-expanded={isExtPickerOpen}
                  aria-haspopup="listbox"
                >
                  <Filter aria-hidden="true" size={16} />
                  <span>Select by extension</span>
                </button>
                {isExtPickerOpen && (
                  <div className="ext-picker-dropdown" role="listbox" aria-label="Available extensions">
                    {visibleExtensions.length === 0 ? (
                      <div className="ext-picker-item empty">No extensions</div>
                    ) : (
                      visibleExtensions.map(ext => (
                        <button
                          key={ext}
                          type="button"
                          className="ext-picker-item"
                          role="option"
                          onClick={() => {
                            selectByExtension(ext);
                            setIsExtPickerOpen(false);
                          }}
                        >
                          {ext === 'no extension' ? ext : `.${ext}`}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                disabled={selectedRecordIds.size === 0}
                onClick={() => void downloadZip(getSelectedZipIds(), 'selected_files.zip')}
              >
                <Download aria-hidden="true" size={16} />
                <span>Selected ZIP</span>
              </button>
              <button type="button" disabled={records.length === 0} onClick={() => void downloadZip(getAllZipIds(), 'all_files.zip')}>
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
            treeViewportRef={treeViewportRef}
            scrollToRow={scrollToRow}
            onToggleFolder={toggleFolder}
            onExpandAll={expandAll}
            onCollapseAll={collapseAll}
            onActivate={activateRecord}
            onToggleSelected={toggleRecordSelection}
            onScopeSelect={selectScope}
            onReplaceSelection={replaceRecordSelection}
            onRevealInTree={revealPathInTree}
            focusedRowId={focusedRowId}
            onFocusRow={setFocusedRowId}
            selectionAnchorId={selectionAnchorId}
            onSetAnchor={setSelectionAnchorId}
            keyboardRangeBaseIds={keyboardRangeBaseIds}
            onSetKeyboardRangeBase={setKeyboardRangeBaseIds}
          />
        </section>

        <aside className={`preview-panel${rightPaneCollapsed ? ' pane-collapsed' : ''}`} aria-label="Preview and metadata">
          <button
            type="button"
            className="pane-collapse-toggle pane-collapse-toggle--right"
            aria-label={rightPaneCollapsed ? 'Expand preview pane' : 'Collapse preview pane'}
            title={rightPaneCollapsed ? 'Expand preview pane' : 'Collapse preview pane'}
            onClick={() => { setRightPaneCollapsed(prev => !prev); }}
          >
            {rightPaneCollapsed
              ? <ChevronLeft aria-hidden="true" size={15} />
              : <ChevronRight aria-hidden="true" size={15} />}
          </button>
          <PreviewPanel
            record={activeRecord}
            metaSidecar={activeMetaSidecar}
            selectableRecords={sidecarSelectableRecords}
            onDownload={(record) => {
              const bytes = getContent(record.id);
              if (bytes) {
                downloadBlob(new Blob([bytes], { type: record.mimeType }), record.fileName);
              }
            }}
            onRevealInTree={revealPathInTree}
            getContent={getContent}
          />
        </aside>
      </section>

      <footer className="statusbar" aria-live="polite">
        <span className="statusbar-op">
          {currentOp ?? lastCompleted ?? null}
        </span>
        {error ? (
          <span className="status-error">
            <AlertTriangle aria-hidden="true" size={15} />
            {error}
          </span>
        ) : null}
      </footer>
    </main>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
