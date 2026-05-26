import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Archive,
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
  PackagePlus,
  RefreshCw,
  Search,
  Settings,
  UploadCloud,
} from 'lucide-react';
import { estimateUnityPackageSize } from 'unitypackage-core';
import type { UnityPackageParseDiagnostic, CreateUnityPackageDiagnostic, UnityPackageEntryComponent } from 'unitypackage-core';

import './App.css';
import type { DownloadZipResponse, ParsePackageResponse, CreatePackageResponse } from './workerTypes';
import {
  buildExtensionGroups,
  buildTreeRows,
  canStageRecordForPack,
  collectDiagCodes,
  expandAncestors,
  filterRecords,
  getAllFolderPaths,
  getExtensionFileRecordIds,
  getTreeFileRecordIds,
  resolveMetaSidecarSelection,
  routeAnalysisFindings,
  sortRecords,
  toSidecarSelectableRecords,
  validatePackDraft,
  getMimeType,
  getPreviewKind,
  getRecordCategory,
  getSyntaxLanguage,
  computeHeadHash,
  getRecentPackages,
  addRecentPackage,
  removeRecentPackage,
  pairDroppedItems,
  type RawDroppedFile,
  type GroupingMode,
  type PackageFileRecord,
  type PreviewKind,
  type SortDirection,
  type SortKey,
  type SyntaxLanguage,
  type UnityPackageAnalysisFinding,
  type WorkspaceMode,
  type RecentPackage,
  type FileSystemFileHandle,
} from './packageModel';

import { ModeTabs } from './components/ModeTabs';
import { DropZone } from './components/DropZone';
import { Stats } from './components/Stats';
import { Explorer } from './components/Explorer';
import { PreviewPanel } from './components/PreviewPanel';
import { DiagnosticsDrawer } from './components/DiagnosticsDrawer';
import { PackPanel } from './components/PackPanel';
import { ToastStack } from './components/ToastStack';
import type { Toast } from './components/ToastStack';
import { RecentsMenu } from './components/RecentsMenu.js';
import { SettingsMenu } from './components/SettingsMenu.js';

interface ParseResult {
  records: PackageFileRecord[];
  diagnostics: UnityPackageParseDiagnostic[];
  analysis: UnityPackageAnalysisFinding[];
}

interface LaunchParams {
  readonly targetURL?: string;
  readonly files: readonly FileSystemFileHandle[];
}

interface LaunchQueue {
  setConsumer(consumer: (launchParams: LaunchParams) => void | Promise<void>): void;
}

declare global {
  interface Window {
    launchQueue?: LaunchQueue;
  }
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

const packDraftStorageKey = 'unitypackage:pack-draft:v1';
const maxPersistedImportedRecordBytes = 2 * 1024 * 1024;

function uint8ArrayToBase64(arr: Uint8Array): string {
  let binary = '';
  const len = arr.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return window.btoa(binary);
}

function base64ToUint8Array(str: string): Uint8Array {
  const binary = window.atob(str);
  const len = binary.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}

interface SerializedRawImportedRecord {
  id: string;
  guid: string;
  pathname: string;
  virtualPath: string;
  fileName: string;
  extension: string;
  mimeType: string;
  component: UnityPackageEntryComponent;
  isUnityPreview: boolean;
  content: string;
  byteLength: number;
  hasAsset: boolean;
  hasMeta: boolean;
  hasPreview: boolean;
  assetSize?: number;
  metaSize?: number;
  previewSize?: number;
  duplicatePathCount: number;
  previewKind: PreviewKind;
  syntaxLanguage: SyntaxLanguage;
  diagnostics: UnityPackageParseDiagnostic[];
  findings: UnityPackageAnalysisFinding[];
  meta?: string;
  isRawImported?: boolean;
  isDirectory?: boolean;
}

interface PackDraft {
  stagedRecordIds?: string[];
  importedRecords?: SerializedRawImportedRecord[];
  gzipLevel?: number;
  exportFilename?: string;
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

interface PackageCreationError extends Error {
  diagnostics?: CreateUnityPackageDiagnostic[];
}

function createPackageInWorker(
  stagedRecords: PackageFileRecord[],
  allRecords: PackageFileRecord[],
  gzipLevel?: number,
  filename?: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./createPackage.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = ({ data }: MessageEvent<CreatePackageResponse>) => {
      worker.terminate();
      if (data.type === 'success') {
        resolve({ bytes: data.bytes, filename: data.filename });
        return;
      }

      if (data.type === 'error') {
        const err: PackageCreationError = new Error('Failed to create package');
        err.diagnostics = data.diagnostics;
        reject(err);
        return;
      }
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };

    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error('Failed to receive package data'));
    };

    worker.postMessage({ stagedRecords, allRecords, gzipLevel, filename });
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

function getDefaultFilename(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `unitypackage-${yyyy}${mm}${dd}-${hh}${min}.unitypackage`;
}

function AppContent() {
  const [mode, setMode] = useState<WorkspaceMode>('extract');
  const [groupingMode, setGroupingMode] = useState<GroupingMode>(() => {
    const val = localStorage.getItem('unitypackage-groupingMode');
    return (val === 'tree' || val === 'extension') ? val : 'tree';
  });
  const [records, setRecords] = useState<PackageFileRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<UnityPackageParseDiagnostic[]>([]);
  const [analysis, setAnalysis] = useState<UnityPackageAnalysisFinding[]>([]);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [rawStagedRecordIds, setStagedRecordIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(packDraftStorageKey);
      if (saved) {
        const draft = JSON.parse(saved) as PackDraft;
        if (draft.stagedRecordIds && Array.isArray(draft.stagedRecordIds)) {
          return new Set(draft.stagedRecordIds);
        }
      }
    } catch (err) {
      console.error('Failed to load stagedRecordIds from draft:', err);
    }
    return new Set();
  });
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  // detailsRecordId: overrides which record is shown in the details/preview pane
  // without changing the explorer selection. Resets to null whenever activeRecordId
  // changes so the pane tracks the explorer by default.
  const [detailsRecordId, setDetailsRecordId] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [keyboardRangeBaseIds, setKeyboardRangeBaseIds] = useState<Set<string> | null>(null);
  const [isExtPickerOpen, setIsExtPickerOpen] = useState(false);
  const [isRecentsOpen, setIsRecentsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [maintainStructure, setMaintainStructure] = useState<boolean>(() => {
    const stored = localStorage.getItem('unitypackage-maintainStructure');
    return stored === null ? true : stored === 'true';
  });
  const [includeMetaSidecars, setIncludeMetaSidecars] = useState(false);
  const [showPreviews, setShowPreviews] = useState<boolean>(() => {
    return localStorage.getItem('unitypackage-showPreviews') === 'true';
  });
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [caseSensitive] = useState<boolean>(() => {
    return localStorage.getItem('unitypackage-caseSensitive') === 'true';
  });
  const [globMode] = useState<boolean>(() => {
    return localStorage.getItem('unitypackage-globMode') === 'true';
  });
  const [diagCodeFilter, setDiagCodeFilter] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const val = localStorage.getItem('unitypackage-sortKey');
    return (val === 'name' || val === 'size' || val === 'extension' || val === 'guid') ? val : 'name';
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    const val = localStorage.getItem('unitypackage-sortDirection');
    return (val === 'asc' || val === 'desc') ? val : 'asc';
  });
  const [leftPaneCollapsed, setLeftPaneCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('leftPaneCollapsed') === 'true';
  });
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('rightPaneCollapsed') === 'true';
  });

  const [recents, setRecents] = useState<RecentPackage[]>([]);
  const [recentToPrompt, setRecentToPrompt] = useState<RecentPackage | null>(null);
  const [packageName, setPackageName] = useState<string | null>(null);
  // currentOp: label shown while an async operation is in flight (cleared when done)
  const [currentOp, setCurrentOp] = useState<string | null>(null);
  // lastCompleted: fades out a few seconds after an op finishes
  const [lastCompleted, setLastCompleted] = useState<string | null>(null);
  const lastCompletedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastCounterRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPacking, setIsPacking] = useState(false);
  const [packDiagnostics, setPackDiagnostics] = useState<CreateUnityPackageDiagnostic[]>([]);
  const [gzipLevel, setGzipLevel] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(packDraftStorageKey);
      if (saved) {
        const draft = JSON.parse(saved) as PackDraft;
        if (typeof draft.gzipLevel === 'number') {
          return draft.gzipLevel;
        }
      }
    } catch (err) {
      console.error('Failed to load gzipLevel from draft:', err);
    }
    return 6;
  });
  const [exportFilename, setExportFilename] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(packDraftStorageKey);
      if (saved) {
        const draft = JSON.parse(saved) as PackDraft;
        if (typeof draft.exportFilename === 'string') {
          return draft.exportFilename;
        }
      }
    } catch (err) {
      console.error('Failed to load exportFilename from draft:', err);
    }
    return getDefaultFilename();
  });
  const [successExport, setSuccessExport] = useState<{ bytes: Uint8Array; filename: string; draftKey: string } | null>(null);
  const [highlightedRecordId, setHighlightedRecordId] = useState<string | null>(null);
  const [importedRecords, setImportedRecords] = useState<PackageFileRecord[]>(() => {
    try {
      const saved = localStorage.getItem(packDraftStorageKey);
      if (saved) {
        const draft = JSON.parse(saved) as PackDraft;
        if (draft.importedRecords && Array.isArray(draft.importedRecords)) {
          return draft.importedRecords.map((r: SerializedRawImportedRecord) => {
            const mapped: PackageFileRecord = {
              id: r.id,
              guid: r.guid,
              pathname: r.pathname,
              virtualPath: r.virtualPath,
              fileName: r.fileName,
              extension: r.extension,
              mimeType: r.mimeType,
              component: r.component ?? (r.isUnityPreview ? 'preview' : r.extension === 'meta' ? 'meta' : 'asset'),
              isUnityPreview: r.isUnityPreview,
              content: r.content ? base64ToUint8Array(r.content) : new Uint8Array(),
              byteLength: r.byteLength,
              hasAsset: r.hasAsset,
              hasMeta: r.hasMeta,
              hasPreview: r.hasPreview,
              assetSize: r.assetSize,
              metaSize: r.metaSize,
              previewSize: r.previewSize,
              duplicatePathCount: r.duplicatePathCount,
              previewKind: r.previewKind,
              syntaxLanguage: r.syntaxLanguage,
              diagnostics: r.diagnostics,
              findings: r.findings,
              meta: r.meta ? base64ToUint8Array(r.meta) : undefined,
              isRawImported: r.isRawImported,
              isDirectory: r.isDirectory,
            };
            return mapped;
          });
        }
      }
    } catch (err) {
      console.error('Failed to load importedRecords from draft:', err);
    }
    return [];
  });

  const stagedRecordIds = useMemo(() => {
    if (records.length === 0) return rawStagedRecordIds;

    const recordIds = new Set(records.map(record => record.id));
    const filteredIds = [...rawStagedRecordIds].filter(id => recordIds.has(id));
    if (filteredIds.length === rawStagedRecordIds.size) return rawStagedRecordIds;
    return new Set(filteredIds);
  }, [records, rawStagedRecordIds]);

  const addToast = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    toastCounterRef.current += 1;
    const id = toastCounterRef.current;
    setToasts(prev => [...prev, { id, message, kind }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
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

  useEffect(() => {
    try {
      if (stagedRecordIds.size === 0 && importedRecords.length === 0) {
        localStorage.removeItem(packDraftStorageKey);
      } else {
        const importedPayloadBytes = importedRecords.reduce(
          (sum, record) => sum + record.content.byteLength + (record.meta?.byteLength ?? 0),
          0
        );
        const shouldPersistImportedRecords = importedPayloadBytes <= maxPersistedImportedRecordBytes;
        const draft: PackDraft = {
          stagedRecordIds: Array.from(stagedRecordIds),
          gzipLevel,
          exportFilename,
        };

        if (shouldPersistImportedRecords) {
          draft.importedRecords = importedRecords.map(r => ({
            ...r,
            content: uint8ArrayToBase64(r.content),
            meta: r.meta ? uint8ArrayToBase64(r.meta) : undefined,
          }));
        }

        localStorage.setItem(packDraftStorageKey, JSON.stringify(draft));
      }
    } catch (err) {
      console.warn('Failed to persist pack draft:', err);
    }
  }, [stagedRecordIds, importedRecords, gzipLevel, exportFilename]);

  useEffect(() => {
    localStorage.setItem('unitypackage-groupingMode', groupingMode);
  }, [groupingMode]);

  useEffect(() => {
    localStorage.setItem('unitypackage-sortKey', sortKey);
  }, [sortKey]);

  useEffect(() => {
    localStorage.setItem('unitypackage-sortDirection', sortDirection);
  }, [sortDirection]);

  useEffect(() => {
    localStorage.setItem('unitypackage-globMode', String(globMode));
  }, [globMode]);

  useEffect(() => {
    localStorage.setItem('unitypackage-caseSensitive', String(caseSensitive));
  }, [caseSensitive]);

  useEffect(() => {
    localStorage.setItem('unitypackage-maintainStructure', String(maintainStructure));
  }, [maintainStructure]);

  useEffect(() => {
    localStorage.setItem('unitypackage-showPreviews', String(showPreviews));
  }, [showPreviews]);

  useEffect(() => {
    localStorage.setItem('leftPaneCollapsed', String(leftPaneCollapsed));
  }, [leftPaneCollapsed]);

  useEffect(() => {
    localStorage.setItem('rightPaneCollapsed', String(rightPaneCollapsed));
  }, [rightPaneCollapsed]);

  useEffect(() => {
    void getRecentPackages().then(setRecents);
  }, []);

  const visibleRecords = useMemo(() => {
    const filtered = filterRecords(records, {
      query: debouncedQuery,
      caseSensitive,
      globMode,
      diagCodes: diagCodeFilter,
      includeMetaSidecars,
      showPreviews,
    });
    return sortRecords(filtered, sortKey, sortDirection);
  }, [
    records, debouncedQuery, caseSensitive, globMode,
    diagCodeFilter, includeMetaSidecars, showPreviews,
    sortKey, sortDirection,
  ]);

  const visibleExtensions = useMemo(() => {
    const exts = new Set<string>();
    for (const record of visibleRecords) {
      exts.add(record.extension || 'no extension');
    }
    return [...exts].sort();
  }, [visibleRecords]);

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
    setDetailsRecordId(null);
    setFocusedRowId(id);
    setSelectionAnchorId(id);
  }, []);

  const activeRecord = useMemo(() => {
    return records.find(record => record.id === activeRecordId) ?? visibleRecords[0] ?? null;
  }, [activeRecordId, visibleRecords, records]);

  // The record shown in the details pane. Follows the explorer selection by default;
  // overridden when the user navigates to a sibling from the Related row.
  const detailsRecord = useMemo(() => {
    if (detailsRecordId !== null) {
      const found = records.find(r => r.id === detailsRecordId);
      if (found) return found;
    }
    return activeRecord;
  }, [detailsRecordId, records, activeRecord]);

  const stagedRecords = useMemo(() => {
    const parsedStaged = records.filter(record => stagedRecordIds.has(record.id));
    return [...parsedStaged, ...importedRecords];
  }, [records, stagedRecordIds, importedRecords]);

  const stagedEntries = useMemo(() => {
    const stagedAssets = stagedRecords.filter(
      record => !record.isUnityPreview && record.extension !== 'meta'
    );
    return stagedAssets.map(assetRecord => {
      let metaBytes = assetRecord.meta;
      if (!metaBytes) {
        const metaRecord = stagedRecords.find(
          r => r.guid === assetRecord.guid && r.extension === 'meta'
        ) ?? records.find(
          r => r.guid === assetRecord.guid && r.extension === 'meta'
        );
        if (metaRecord) {
          metaBytes = metaRecord.content;
        }
      }

      return {
        guid: assetRecord.guid,
        pathname: assetRecord.pathname,
        meta: metaBytes ?? new Uint8Array(),
        asset: assetRecord.hasAsset ? assetRecord.content : undefined,
      };
    });
  }, [stagedRecords, records]);

  const exportDraftKey = useMemo(() => {
    return JSON.stringify({
      filename: exportFilename,
      gzipLevel,
      entries: stagedEntries.map(entry => ({
        guid: entry.guid,
        pathname: entry.pathname,
        assetBytes: entry.asset?.byteLength ?? 0,
        metaBytes: entry.meta.byteLength,
      })),
    });
  }, [stagedEntries, gzipLevel, exportFilename]);

  const visibleSuccessExport = successExport?.draftKey === exportDraftKey ? successExport : null;

  const estimatedSize = useMemo(() => {
    if (stagedEntries.length === 0) return 0;
    return estimateUnityPackageSize(stagedEntries).tarBytes;
  }, [stagedEntries]);

  const totalBytes = useMemo(() => records.reduce((sum, record) => sum + record.byteLength, 0), [records]);
  const extensionGroups = useMemo(() => buildExtensionGroups(visibleRecords), [visibleRecords]);
  const treeRows = useMemo(() => buildTreeRows(visibleRecords, collapsedFolders), [visibleRecords, collapsedFolders]);
  const treeFileRecordIds = useMemo(() => getTreeFileRecordIds(treeRows), [treeRows]);
  const extensionFileRecordIds = useMemo(() => getExtensionFileRecordIds(extensionGroups), [extensionGroups]);
  const packValidation = useMemo(() => validatePackDraft(stagedRecords, records), [stagedRecords, records]);

  const handlePackageFileWithHandle = async (file: File, fileHandle: FileSystemFileHandle | null) => {
    setIsLoading(true);
    setError(null);
    setPackageName(file.name);
    setCurrentOp(`Parsing ${file.name}…`);
    setRecords([]);
    setDiagnostics([]);
    setAnalysis([]);
    setIsDiagnosticsOpen(false);
    setSelectedRecordIds(new Set());
    setActiveRecordId(null);
    setDetailsRecordId(null);
    setCollapsedFolders(new Set());
    setQuery('');
    setDebouncedQuery('');
    setDiagCodeFilter(new Set());

    try {
      const startedAt = performance.now();
      const result = await parsePackageInWorker(await file.arrayBuffer());
      const elapsed = Math.round(performance.now() - startedAt);
      routeAnalysisFindings(result.records, result.analysis);
      const resultRecordIds = new Set(result.records.map(record => record.id));
      setStagedRecordIds(previous => {
        const next = new Set([...previous].filter(id => resultRecordIds.has(id)));
        return next.size === previous.size ? previous : next;
      });
      setRecords(result.records);
      setDiagnostics(result.diagnostics);
      setAnalysis(result.analysis);
      setActiveRecordId(result.records[0]?.id ?? null);
      completeOp(`Parsed ${file.name}`);
      addToast(`Parsed ${result.records.length.toString()} records from ${file.name} in ${elapsed.toString()} ms`);

      const headHash = await computeHeadHash(file);
      const recentKey = `${file.name}|${file.size.toString()}|${headHash}`;
      await addRecentPackage({
        key: recentKey,
        name: file.name,
        size: file.size,
        headHash,
        fileHandle,
      });
      const updatedRecents = await getRecentPackages();
      setRecents(updatedRecents);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to parse package';
      setError(message);
      setCurrentOp(null);
      addToast(`Parse failed: ${message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePackageFile = (file: File) => {
    void handlePackageFileWithHandle(file, null);
  };

  useEffect(() => {
    if (typeof window !== 'undefined' && 'launchQueue' in window && window.launchQueue) {
      window.launchQueue.setConsumer(async (launchParams) => {
        if (launchParams.files && launchParams.files.length > 0) {
          const fileHandle = launchParams.files[0];
          if (fileHandle) {
            try {
              const file = await fileHandle.getFile();
              void handlePackageFileWithHandle(file, fileHandle);
            } catch (err) {
              console.error('Failed to open file from launchQueue:', err);
            }
          }
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRecentClick = async (recent: RecentPackage) => {
    if (recent.fileHandle) {
      try {
        const handle = recent.fileHandle;
        const options = { mode: 'read' as const };
        let permission = await handle.queryPermission(options);
        if (permission !== 'granted') {
          permission = await handle.requestPermission(options);
        }
        if (permission === 'granted') {
          const file = await handle.getFile();
          void handlePackageFileWithHandle(file, handle);
          return;
        }
      } catch (err) {
        console.error('Failed to access file handle:', err);
      }
    }
    setRecentToPrompt(recent);
  };

  const handleRemoveRecent = async (key: string, event: React.MouseEvent) => {
    event.stopPropagation();
    await removeRecentPackage(key);
    const updatedRecents = await getRecentPackages();
    setRecents(updatedRecents);
  };

  const handleClearAllRecents = async () => {
    for (const recent of recents) {
      await removeRecentPackage(recent.key);
    }
    setRecents([]);
  };

  const handleResetSettings = () => {
    const keysToRemove = [
      'unitypackage-groupingMode',
      'unitypackage-sortKey',
      'unitypackage-sortDirection',
      'unitypackage-maintainStructure',
      'unitypackage-showPreviews',
      'unitypackage-caseSensitive',
      'unitypackage-globMode',
    ];
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
    setGroupingMode('tree');
    setSortKey('name');
    setSortDirection('asc');
    setMaintainStructure(true);
    handleShowPreviewsChange(false);
  };

  const handlePathnameChange = useCallback((id: string, newPathname: string) => {
    setImportedRecords(prev =>
      prev.map(r => {
        if (r.id === id) {
          const parts = newPathname.split('/');
          const fileName = parts[parts.length - 1] ?? '';
          const extension = fileName.includes('.') ? fileName.split('.').pop() ?? '' : '';
          return {
            ...r,
            pathname: newPathname,
            virtualPath: newPathname,
            fileName,
            extension,
            mimeType: getMimeType(newPathname),
            syntaxLanguage: getSyntaxLanguage(newPathname),
            previewKind: r.isDirectory ? 'unsupported' : getPreviewKind(newPathname, r.content),
          };
        }
        return r;
      })
    );
  }, []);

  const handleImportFiles = useCallback(async (dataTransfer: DataTransfer) => {
    setCurrentOp('Importing files…');
    setError(null);

    interface DroppedItem {
      name: string;
      relativePath: string;
      isFile: boolean;
      isDirectory: boolean;
      file?: File;
    }

    try {
      const droppedItems: DroppedItem[] = [];
      const items = Array.from(dataTransfer.items || []);
      const entries: FileSystemEntry[] = [];
      const hasWebKitGetAsEntry = items.length > 0 && typeof items[0].webkitGetAsEntry === 'function';
      if (hasWebKitGetAsEntry) {
        for (const item of items) {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            entries.push(entry);
          }
        }
      }
      const fallbackFiles = Array.from(dataTransfer.files || []);

      const walkEntry = async (entry: FileSystemEntry, pathPrefix = ''): Promise<void> => {
        const relativePath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
        if (entry.isFile) {
          const file = await new Promise<File>((resolve, reject) => {
            (entry as FileSystemFileEntry).file(resolve, reject);
          });
          droppedItems.push({
            name: entry.name,
            relativePath,
            isFile: true,
            isDirectory: false,
            file,
          });
        } else if (entry.isDirectory) {
          droppedItems.push({
            name: entry.name,
            relativePath,
            isFile: false,
            isDirectory: true,
          });
          const dirReader = (entry as FileSystemDirectoryEntry).createReader();
          const readEntries = (): Promise<FileSystemEntry[]> => {
            return new Promise((resolve, reject) => {
              dirReader.readEntries(resolve, reject);
            });
          };

          const dirEntries: FileSystemEntry[] = [];
          try {
            let chunk = await readEntries();
            while (chunk.length > 0) {
              dirEntries.push(...chunk);
              chunk = await readEntries();
            }
          } catch (err) {
            console.error('Error reading directory entries:', err);
          }

          for (const child of dirEntries) {
            await walkEntry(child, relativePath);
          }
        }
      };

      if (hasWebKitGetAsEntry && entries.length > 0) {
        for (const entry of entries) {
          await walkEntry(entry);
        }
      } else {
        // Fallback to top-level files
        for (const file of fallbackFiles) {
          droppedItems.push({
            name: file.name,
            relativePath: file.name,
            isFile: true,
            isDirectory: false,
            file,
          });
        }
      }

      // Convert DroppedItem to RawDroppedFile (load content as Uint8Array)
      const rawFiles: RawDroppedFile[] = await Promise.all(
        droppedItems.map(async item => {
          let content = new Uint8Array();
          if (item.file) {
            const buf = await item.file.arrayBuffer();
            content = new Uint8Array(buf);
          }
          return {
            relativePath: item.relativePath,
            content,
            isDirectory: item.isDirectory,
          };
        })
      );

      // Collect existing GUIDs
      const existingGuids = new Set<string>();
      for (const record of records) {
        if (stagedRecordIds.has(record.id)) {
          existingGuids.add(record.guid);
        }
      }
      for (const r of importedRecords) {
        existingGuids.add(r.guid);
      }

      // Pair dropped items
      const paired = pairDroppedItems(rawFiles, existingGuids);

      // Map PairedDroppedItem to PackageFileRecord
      const newImportedRecords: PackageFileRecord[] = paired.map(item => {
        const parts = item.pathname.split('/');
        const fileName = parts[parts.length - 1] ?? '';
        const extension = fileName.includes('.') ? fileName.split('.').pop() ?? '' : '';

        return {
          id: `raw-${item.guid}`,
          guid: item.guid,
          pathname: item.pathname,
          virtualPath: item.pathname,
          fileName,
          extension,
          mimeType: getMimeType(item.pathname),
          component: 'asset',
          isUnityPreview: false,
          content: item.content,
          byteLength: item.content.byteLength,
          hasAsset: !item.isDirectory,
          hasMeta: true,
          hasPreview: false,
          assetSize: item.isDirectory ? undefined : item.content.byteLength,
          metaSize: item.meta.byteLength,
          duplicatePathCount: 0,
          previewKind: item.isDirectory ? 'unsupported' : getPreviewKind(item.pathname, item.content),
          syntaxLanguage: getSyntaxLanguage(item.pathname),
          diagnostics: [],
          findings: [],
          meta: item.meta,
          isRawImported: true,
          isDirectory: item.isDirectory,
        };
      });

      setImportedRecords(prev => [...prev, ...newImportedRecords]);
      setCurrentOp(null);
      addToast(`Imported ${newImportedRecords.length.toString()} entries`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to import files';
      setError(msg);
      setCurrentOp(null);
      addToast(`Import failed: ${msg}`, 'error');
    }
  }, [records, stagedRecordIds, importedRecords, addToast]);

  const handleDownload = async (targetRecords: PackageFileRecord[], fileName: string, recordIds?: string[]) => {
    setError(null);
    setCurrentOp('Creating ZIP…');
    try {
      const data = await createDownloadZipInWorker(targetRecords, maintainStructure, recordIds);
      if (!data) {
        setCurrentOp(null);
        addToast('No files to download.', 'error');
        return;
      }

      downloadBlob(new Blob([new Uint8Array(data)], { type: 'application/zip' }), fileName);
      setCurrentOp(null);
      addToast(`ZIP downloaded: ${fileName}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to create ZIP file';
      setError(message);
      setCurrentOp(null);
      addToast(`ZIP failed: ${message}`, 'error');
    }
  };

  const handleExport = async () => {
    setIsPacking(true);
    setPackDiagnostics([]);
    setSuccessExport(null);
    setCurrentOp('Exporting package…');
    try {
      let filename = exportFilename.trim();
      if (!filename) {
        filename = 'export.unitypackage';
      } else if (!filename.toLowerCase().endsWith('.unitypackage')) {
        filename += '.unitypackage';
      }

      const result = await createPackageInWorker(stagedRecords, records, gzipLevel, filename);
      setSuccessExport({
        bytes: result.bytes,
        filename: result.filename,
        draftKey: exportDraftKey,
      });
      const blob = new Blob([result.bytes.buffer as BlobPart], { type: 'application/octet-stream' });
      downloadBlob(blob, result.filename);
      setCurrentOp(null);
      addToast(`Exported ${result.filename}`);
    } catch (caught) {
      setCurrentOp(null);
      if (caught instanceof Error) {
        const err = caught as PackageCreationError;
        if (err.diagnostics) {
          setPackDiagnostics(err.diagnostics);
          addToast('Export failed: see diagnostics in the Pack panel.', 'error');
        } else {
          setError(err.message);
          addToast(`Export failed: ${err.message}`, 'error');
        }
      } else {
        setError('Failed to create package');
        addToast('Export failed.', 'error');
      }
    } finally {
      setIsPacking(false);
    }
  };

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

  const selectScope = useCallback((recordIds: readonly string[], state: import('./packageModel').SelectionState) => {
    applyRecordSelection(recordIds, state !== 'all');
  }, [applyRecordSelection]);

  const clearSelection = useCallback(() => {
    setSelectedRecordIds(new Set());
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

  const [scrollToRow, setScrollToRow] = useState<{ id: string; key: number } | null>(null);

  // Ref to the virtual-tree scroll container so we can scroll rows into view.
  const treeViewportRef = useRef<HTMLDivElement | null>(null);

  /**
   * Switches to tree mode, expands ancestors of the record or folder path,
   * and queues a scroll to the matching row after the next paint.
   */
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

  const removeHiddenRecordsFromSelection = useCallback((hiddenIds: ReadonlySet<string>) => {
    if (hiddenIds.size === 0) return;

    setSelectedRecordIds(previous => {
      if (![...previous].some(id => hiddenIds.has(id))) return previous;
      const next = new Set(previous);
      for (const id of hiddenIds) next.delete(id);
      return next;
    });
  }, []);

  const rehomeHiddenActiveRecord = useCallback((
    hiddenIds: ReadonlySet<string>,
    nextIncludeMetaSidecars: boolean,
    nextShowPreviews: boolean,
  ) => {
    if (hiddenIds.size === 0) return;

    const isVisibleWithSettings = (record: PackageFileRecord) => {
      if (!nextIncludeMetaSidecars && record.extension === 'meta') return false;
      if (!nextShowPreviews && record.isUnityPreview) return false;
      return true;
    };

    setActiveRecordId(previous => {
      if (previous === null || !hiddenIds.has(previous)) return previous;
      const hiddenRecord = records.find(record => record.id === previous);
      if (hiddenRecord) {
        const sameGuidAsset = records.find(
          record => record.guid === hiddenRecord.guid && getRecordCategory(record) === 'asset' && isVisibleWithSettings(record),
        );
        if (sameGuidAsset) return sameGuidAsset.id;
      }
      return records.find(isVisibleWithSettings)?.id ?? null;
    });
  }, [records]);

  const handleShowPreviewsChange = useCallback((nextShowPreviews: boolean) => {
    setShowPreviews(nextShowPreviews);
    if (nextShowPreviews) return;

    const hiddenIds = new Set(records.filter(record => record.isUnityPreview).map(record => record.id));
    removeHiddenRecordsFromSelection(hiddenIds);
    rehomeHiddenActiveRecord(hiddenIds, includeMetaSidecars, nextShowPreviews);
  }, [records, includeMetaSidecars, removeHiddenRecordsFromSelection, rehomeHiddenActiveRecord]);

  const handleIncludeMetaSidecarsChange = useCallback((nextIncludeMetaSidecars: boolean) => {
    setIncludeMetaSidecars(nextIncludeMetaSidecars);
    if (nextIncludeMetaSidecars) return;

    const hiddenIds = new Set(records.filter(record => record.extension === 'meta').map(record => record.id));
    removeHiddenRecordsFromSelection(hiddenIds);
    rehomeHiddenActiveRecord(hiddenIds, nextIncludeMetaSidecars, showPreviews);
  }, [records, showPreviews, removeHiddenRecordsFromSelection, rehomeHiddenActiveRecord]);

  const stageSelection = () => {
    const selectedRecords = records.filter(record => selectedRecordIds.has(record.id));
    const stageableIds = new Set(
      selectedRecords
        .filter(canStageRecordForPack)
        .map(record => record.id)
    );
    const skippedCount = selectedRecords.length - stageableIds.size;

    setStagedRecordIds(previous => {
      const next = new Set(previous);
      for (const id of stageableIds) next.add(id);
      return next;
    });
    if (stageableIds.size === 0) {
      addToast('No packable assets selected.', 'error');
    } else if (skippedCount > 0) {
      addToast(`Staged ${stageableIds.size.toString()} assets (skipped ${skippedCount.toString()} preview/meta records).`);
    } else {
      addToast(`Staged ${stageableIds.size.toString()} assets for pack.`);
    }
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
          <RecentsMenu
            recents={recents}
            isOpen={isRecentsOpen}
            onToggle={() => { setIsRecentsOpen(prev => !prev); setIsSettingsOpen(false); }}
            onOpen={(recent) => { void handleRecentClick(recent); }}
            onRemove={(key, e) => { void handleRemoveRecent(key, e); }}
            onClearAll={() => { void handleClearAllRecents(); }}
            onClose={() => { setIsRecentsOpen(false); }}
          />
          <SettingsMenu
            isOpen={isSettingsOpen}
            onToggle={() => { setIsSettingsOpen(prev => !prev); setIsRecentsOpen(false); }}
            onResetSettings={handleResetSettings}
            onClose={() => { setIsSettingsOpen(false); }}
          />
        </div>
      </header>

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
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={showPreviews}
              onChange={event => {
                handleShowPreviewsChange(event.target.checked);
              }}
            />
            Show preview records
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={includeMetaSidecars}
              onChange={event => {
                handleIncludeMetaSidecarsChange(event.target.checked);
              }}
            />
            Include .meta with assets
          </label>
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
            </div>
          </details>
          {records.length > 0 && (
            <details className="sidebar-disclosure">
              <summary className="sidebar-disclosure-summary">
                <Info aria-hidden="true" size={13} />
                <span>Package summary</span>
              </summary>
              <div className="sidebar-disclosure-body">
                <Stats records={records} filteredCount={visibleRecords.length} totalBytes={totalBytes} diagnostics={diagnostics} analysis={analysis} />
              </div>
            </details>
          )}
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
                              .{ext}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
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
                          addToast(
                            `${result.missingMetaForAssetIds.length.toString()} asset(s) have no .meta sidecar in this package.`,
                            'error',
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
            </>
          ) : (
            <PackPanel
              stagedRecords={stagedRecords}
              validation={packValidation}
              isPacking={isPacking}
              packDiagnostics={packDiagnostics}
              onExport={() => { void handleExport(); }}
              onRemove={(id) => {
                setStagedRecordIds(previous => {
                  const next = new Set(previous);
                  next.delete(id);
                  return next;
                });
                setImportedRecords(previous => previous.filter(r => r.id !== id));
              }}
              onClear={() => {
                setStagedRecordIds(new Set());
                setImportedRecords([]);
              }}
              onClearDraft={() => {
                localStorage.removeItem(packDraftStorageKey);
                setStagedRecordIds(new Set());
                setImportedRecords([]);
                setGzipLevel(6);
                setExportFilename(getDefaultFilename());
                addToast('Pack draft reset.');
              }}
              gzipLevel={gzipLevel}
              setGzipLevel={setGzipLevel}
              exportFilename={exportFilename}
              setExportFilename={setExportFilename}
              estimatedSize={estimatedSize}
              successExport={visibleSuccessExport}
              onDownloadAgain={() => {
                if (visibleSuccessExport) {
                  const blob = new Blob([visibleSuccessExport.bytes.buffer as BlobPart], { type: 'application/octet-stream' });
                  downloadBlob(blob, visibleSuccessExport.filename);
                }
              }}
              onShowInList={(recordId) => {
                setHighlightedRecordId(null);
                setTimeout(() => {
                  setHighlightedRecordId(recordId);
                  const element = document.getElementById(`staged-row-${recordId}`);
                  if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }, 10);
              }}
              highlightedRecordId={highlightedRecordId}
              onPathnameChange={handlePathnameChange}
              onImportFiles={(dt) => { void handleImportFiles(dt); }}
            />
          )}
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
            record={detailsRecord}
            records={records}
            includeMetaSidecars={includeMetaSidecars}
            onDownloadZip={(zipRecords, fileName, recordIds) => void handleDownload(zipRecords, fileName, recordIds)}
            onStatusWarning={(msg) => { addToast(msg, 'error'); }}
            onRevealInTree={revealPathInTree}
            onOpenSibling={(siblingId) => { setDetailsRecordId(siblingId); }}
            onOpenSiblingInExplorer={(siblingId) => {
              setDetailsRecordId(null);
              revealPathInTree(siblingId);
            }}
            showPreviews={showPreviews}
            onSetShowPreviews={handleShowPreviewsChange}
            includeMetaSidecarsForSibling={includeMetaSidecars}
            onSetIncludeMetaSidecars={handleIncludeMetaSidecarsChange}
          />
        </aside>
      </section>

      {isDiagnosticsOpen && (diagnostics.length > 0 || analysis.length > 0) ? (
        <DiagnosticsDrawer
          diagnostics={diagnostics}
          analysis={analysis}
          records={records}
          diagCodes={collectDiagCodes(records)}
          diagCodeFilter={diagCodeFilter}
          onDiagCodeFilterChange={(code) => {
            setDiagCodeFilter(prev => {
              const next = new Set(prev);
              if (next.has(code)) next.delete(code);
              else next.add(code);
              return next;
            });
          }}
          onNavigate={(recordId) => {
            const targetRecord = records.find(r => r.id === recordId);
            if (targetRecord) {
              setQuery('');
              setDebouncedQuery('');
              setDiagCodeFilter(new Set());
              setGroupingMode('tree');
              setCollapsedFolders(prev => expandAncestors(targetRecord.virtualPath, prev));
              setActiveRecordId(targetRecord.id);
              setFocusedRowId(targetRecord.id);
            }
            setIsDiagnosticsOpen(false);
          }}
          onClose={() => { setIsDiagnosticsOpen(false); }}
        />
      ) : null}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
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
        {(diagnostics.length > 0 || analysis.length > 0) ? (
          <button
            type="button"
            className="status-diagnostics-toggle"
            onClick={() => { setIsDiagnosticsOpen(open => !open); }}
            aria-expanded={isDiagnosticsOpen}
            aria-label="Toggle diagnostics drawer"
          >
            <Info aria-hidden="true" size={15} />
            {(diagnostics.length + analysis.length).toString()} findings
          </button>
        ) : null}
        {recentToPrompt && (
          <div className="modal-overlay" onClick={() => setRecentToPrompt(null)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Reopen Recent Package</h3>
                <button
                  type="button"
                  className="recent-remove-btn"
                  style={{ width: '24px', height: '24px', fontSize: '1.2rem', minHeight: '24px' }}
                  onClick={() => setRecentToPrompt(null)}
                  aria-label="Close dialog"
                >
                  &times;
                </button>
              </div>
              <div className="modal-body">
                <p>
                  Direct file access is not available for <strong>{recentToPrompt.name}</strong>.
                  Please select the file or drop it below to reopen.
                </p>
                <div
                  className="modal-dropzone"
                  onDragOver={(e) => {
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file?.name === recentToPrompt.name) {
                      void handlePackageFileWithHandle(file, null);
                      setRecentToPrompt(null);
                    } else if (file) {
                      setError(`Dropped file "${file.name}" does not match "${recentToPrompt.name}".`);
                    }
                  }}
                >
                  <span>Drop <strong>{recentToPrompt.name}</strong> here</span>
                  <label className="file-open-button" style={{ marginTop: '8px' }}>
                    <span>Choose File</span>
                    <input
                      type="file"
                      accept=".unitypackage"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file?.name === recentToPrompt.name) {
                          void handlePackageFileWithHandle(file, null);
                          setRecentToPrompt(null);
                        } else if (file) {
                          setError(`Selected file "${file.name}" does not match "${recentToPrompt.name}".`);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setRecentToPrompt(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
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
