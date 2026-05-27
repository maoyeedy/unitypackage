import { Component, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Boxes, Download, ListTree, Search, Settings, X } from 'lucide-react';
import './App.css';
import { buildExtensionGroups, buildTreeRows, filterRecords, getExtensionFileRecordIds, getMetaSidecarForAsset, getTreeFileRecordIds, sortRecords, toSidecarSelectableRecords } from './packageModel';
import { DropZone } from './components/DropZone';
import { Stats } from './components/Stats';
import { Explorer } from './components/Explorer';
import { PreviewPanel } from './components/preview/PreviewPanel';
import { ContentContext } from './contexts/ContentContext';
import { usePackageLoader } from './hooks/usePackageLoader';
import { useExplorerSelection } from './hooks/useExplorerSelection';
import { useZipDownload, downloadBlob } from './hooks/useZipDownload';

interface AppErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };
  static getDerivedStateFromError(): AppErrorBoundaryState { return { hasError: true }; }
  componentDidCatch(error: unknown): void { console.error('Unhandled web error:', error); }
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
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const treeViewportRef = useRef<HTMLDivElement | null>(null);

  let clearSelection: () => void = () => { /* noop */ };
  let setActiveRecordId: React.Dispatch<React.SetStateAction<string | null>> = () => { /* noop */ };

  const {
    records,
    getContent,
    packageName,
    status: { currentOp, lastCompleted, error, isLoading },
    handlePackageFile,
    completeOp,
    setError,
    setCurrentOp,
  } = usePackageLoader({
    onReset: () => {
      clearSelection();
      setQuery('');
      setDebouncedQuery('');
    },
    onLoad: (newRecords) => {
      setActiveRecordId(newRecords.find(record => record.extension !== 'meta')?.id ?? null);
    },
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const visibleRecords = useMemo(() => {
    return sortRecords(filterRecords(records, { query: debouncedQuery }), 'name', 'asc');
  }, [records, debouncedQuery]);

  const selection = useExplorerSelection({ records, visibleRecords, treeViewportRef });

  clearSelection = selection.clearSelection;
  setActiveRecordId = selection.setActiveRecordId;

  const {
    selectedRecordIds,
    activeRecordId,
    collapsedFolders,
    focusedRowId,
    selectionAnchorId,
    keyboardRangeBaseIds,
    groupingMode,
    scrollToRow,
    setGroupingMode,
    setFocusedRowId,
    setSelectionAnchorId,
    setKeyboardRangeBaseIds,
    activateRecord,
    toggleFolder,
    expandAll,
    collapseAll,
    revealPathInTree,
    toggleRecordSelection,
    replaceRecordSelection,
    selectScope,
  } = selection;

  const sidecarSelectableRecords = useMemo(() => toSidecarSelectableRecords(records), [records]);

  const {
    maintainStructure,
    setMaintainStructure,
    includeMetaSidecarsInZip,
    setIncludeMetaSidecarsInZip,
    getSelectedZipIds,
    downloadZip,
  } = useZipDownload({
    records,
    sidecarSelectableRecords,
    selectedRecordIds,
    getContent,
    completeOp,
    setError,
    setCurrentOp,
  });

  const activeRecord = useMemo(() => {
    return records.find(r => r.id === activeRecordId) ?? visibleRecords[0] ?? null;
  }, [activeRecordId, visibleRecords, records]);

  const activeMetaSidecar = useMemo(() => {
    return activeRecord ? getMetaSidecarForAsset(records, activeRecord, sidecarSelectableRecords) : undefined;
  }, [activeRecord, records, sidecarSelectableRecords]);

  const selectedVisibleCount = useMemo(() => {
    return visibleRecords.filter(r => selectedRecordIds.has(r.id)).length;
  }, [selectedRecordIds, visibleRecords]);

  const totalBytes = useMemo(() => records.reduce((sum, r) => sum + r.byteLength, 0), [records]);
  const extensionGroups = useMemo(() => groupingMode === 'extension' ? buildExtensionGroups(visibleRecords) : [], [groupingMode, visibleRecords]);
  const treeRows = useMemo(() => groupingMode === 'tree' ? buildTreeRows(visibleRecords, collapsedFolders) : [], [groupingMode, visibleRecords, collapsedFolders]);
  const treeFileRecordIds = useMemo(() => groupingMode === 'tree' ? getTreeFileRecordIds(treeRows) : [], [groupingMode, treeRows]);
  const extensionFileRecordIds = useMemo(() => groupingMode === 'extension' ? getExtensionFileRecordIds(extensionGroups) : [], [groupingMode, extensionGroups]);

  return (
    <main className="app-shell">
      <header className="app-bar" aria-label="Package toolbar">
        <div className="package-title">
          <h1>Unity Package Workspace</h1>
          <p>{packageName ?? 'Open a .unitypackage to view and extract files.'}</p>
        </div>
        <div className="app-bar-actions">
          <DropZone mode="compact" isLoading={isLoading} onPackageFile={(file) => void handlePackageFile(file)} />
          <div className="input input--search">
            <Search aria-hidden="true" size={14} />
            <input
              type="search"
              aria-label="Search package files"
              value={query}
              placeholder="Search files by name or path"
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>
      </header>

      <section className="workspace" aria-label="Unity package workspace">
        <section className="explorer-panel" aria-label="Package explorer">
          <div className="panel-toolbar">
            <div>
              <h2>Extract</h2>
              <p>{visibleRecords.length.toString()} visible files{selectedRecordIds.size > 0 ? `, ${selectedVisibleCount.toString()} selected` : ''}</p>
            </div>
            <div className="button-row">
              <div className="tabs" role="group" aria-label="Explorer grouping">
                <button type="button" className={groupingMode === 'tree' ? 'active' : ''} onClick={() => setGroupingMode('tree')}>
                  <ListTree aria-hidden="true" size={14} /><span>Tree</span>
                </button>
                <button type="button" className={groupingMode === 'extension' ? 'active' : ''} onClick={() => setGroupingMode('extension')}>
                  <Boxes aria-hidden="true" size={14} /><span>Extension</span>
                </button>
              </div>
              <button
                type="button"
                className="btn btn--icon"
                aria-label="Clear selection"
                title="Clear selection"
                disabled={selectedRecordIds.size === 0}
                onClick={clearSelection}
              >
                <X aria-hidden="true" size={14} />
              </button>
              <div className="zip-group" role="group" aria-label="Download ZIP">
                <details className="dropdown zip-options">
                  <summary className="btn btn--icon zip-options-trigger" aria-label="ZIP options" title="ZIP options">
                    <Settings aria-hidden="true" size={14} />
                  </summary>
                  <div className="dropdown-menu zip-options-menu">
                    <label className="toggle-row">
                      <input type="checkbox" checked={maintainStructure} onChange={e => setMaintainStructure(e.target.checked)} />
                      Preserve folders in ZIP downloads
                    </label>
                    <label className="toggle-row">
                      <input type="checkbox" checked={includeMetaSidecarsInZip} onChange={e => setIncludeMetaSidecarsInZip(e.target.checked)} />
                      Include .meta sidecars in ZIP
                    </label>
                  </div>
                </details>
                <button type="button" className="btn btn--primary" disabled={selectedRecordIds.size === 0} onClick={() => void downloadZip(getSelectedZipIds(), 'selected_files.zip')}>
                  <Download aria-hidden="true" size={14} /><span>Zip Selected</span>
                </button>
              </div>
            </div>
          </div>
          <Explorer groupingMode={groupingMode} records={visibleRecords} treeRows={treeRows} extensionGroups={extensionGroups} treeFileRecordIds={treeFileRecordIds} extensionFileRecordIds={extensionFileRecordIds} selectedIds={selectedRecordIds} activeId={activeRecord?.id ?? null} collapsedFolders={collapsedFolders} treeViewportRef={treeViewportRef} scrollToRow={scrollToRow} onToggleFolder={toggleFolder} onExpandAll={expandAll} onCollapseAll={collapseAll} onActivate={activateRecord} onToggleSelected={toggleRecordSelection} onScopeSelect={selectScope} onReplaceSelection={replaceRecordSelection} focusedRowId={focusedRowId} onFocusRow={setFocusedRowId} selectionAnchorId={selectionAnchorId} onSetAnchor={setSelectionAnchorId} keyboardRangeBaseIds={keyboardRangeBaseIds} onSetKeyboardRangeBase={setKeyboardRangeBaseIds} />
        </section>

        <aside className="inspector-panel" aria-label="Preview and metadata">
          <ContentContext.Provider value={getContent}>
            <PreviewPanel record={activeRecord} metaSidecar={activeMetaSidecar} selectableRecords={sidecarSelectableRecords} onDownload={r => { const bytes = getContent(r.id); if (bytes) downloadBlob(new Blob([bytes], { type: r.mimeType }), r.fileName); }} onRevealInTree={revealPathInTree} />
          </ContentContext.Provider>
        </aside>
      </section>

      <footer className="statusbar" aria-live="polite">
        <span className="statusbar-op">{currentOp ?? lastCompleted ?? null}</span>
        {records.length > 0 && (
          <Stats records={records} filteredCount={visibleRecords.length} totalBytes={totalBytes} />
        )}
        {error ? <span className="status-error"><AlertTriangle size={13} />{error}</span> : null}
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
