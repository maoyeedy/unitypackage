import { Component, useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowDownUp,
  ArrowUpDown,
  Boxes,
  CaseSensitive,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Download,
  File,
  FileArchive,
  Filter,
  Folder,
  FolderOpen,
  Info,
  ListTree,
  Locate,
  PackagePlus,
  RefreshCw,
  Search,
  Square,
  UploadCloud,
  CheckCircle,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { estimateUnityPackageSize } from 'unitypackage-core';
import type { UnityPackageParseDiagnostic, CreateUnityPackageDiagnostic } from 'unitypackage-core';

import './App.css';
import { getFileIconDescriptor } from './fileIcons';
import type { DownloadZipResponse, ParsePackageResponse, CreatePackageResponse } from './workerTypes';
import {
  buildExtensionGroups,
  buildTreeRows,
  canStageRecordForPack,
  collectDiagCodes,
  expandAncestors,
  filterRecords,
  formatBytes,
  getAllFolderPaths,
  getDeclaredMetaInfoForRecord,
  getExpectedImporterTypeForRecord,
  getExtensionFileRecordIds,
  getFolderRecordIds,
  getRecordCategory,
  getRangeRecordIds,
  getKeyboardRangeSelection,
  getSelectionState,
  getTreeFileRecordIds,
  resolveMetaSidecarSelection,
  routeAnalysisFindings,
  sortRecords,
  toSidecarSelectableRecords,
  validatePackDraft,
  readMetaGuid,
  readDeclaredMetaImporter,
  computeHeadHash,
  getRecentPackages,
  addRecentPackage,
  removeRecentPackage,
  pairDroppedItems,
  getMimeType,
  getPreviewKind,
  getSyntaxLanguage,
  type RawDroppedFile,
  type ExtensionGroup,
  type FilterMatchMode,
  type GroupingMode,
  type PackageFileRecord,
  type PreviewKind,
  type RecordCategory,
  type SelectionState,
  type SyntaxLanguage,
  type SortDirection,
  type SortKey,
  type TreeRow,
  type UnityPackageAnalysisFinding,
  type WorkspaceMode,
  type RecentPackage,
  type FileSystemFileHandle,
  type PackValidation,
  type PackDraftDiagnostic,
} from './packageModel';
import { highlightCode, findQueryMatches, splitLineTokensForMatches, type HighlightedCode, type HighlightedToken, type SyntaxThemeMode } from './syntaxHighlight';

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

const textDecoder = new TextDecoder('utf-8', { fatal: false });
const dragSelectionThresholdPx = 4;
const dragAutoScrollEdgePx = 32;
const dragAutoScrollStepPx = 18;
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
  const [stagedRecordIds, setStagedRecordIds] = useState<Set<string>>(() => {
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
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [keyboardRangeBaseIds, setKeyboardRangeBaseIds] = useState<Set<string> | null>(null);
  const [isExtPickerOpen, setIsExtPickerOpen] = useState(false);
  const [maintainStructure, setMaintainStructure] = useState<boolean>(() => {
    const stored = localStorage.getItem('unitypackage-maintainStructure');
    return stored === null ? true : stored === 'true';
  });
  const [includeMetaSidecars, setIncludeMetaSidecars] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [matchMode, setMatchMode] = useState<FilterMatchMode>('filename');
  const [caseSensitive, setCaseSensitive] = useState<boolean>(() => {
    return localStorage.getItem('unitypackage-caseSensitive') === 'true';
  });
  const [globMode, setGlobMode] = useState<boolean>(() => {
    return localStorage.getItem('unitypackage-globMode') === 'true';
  });
  const [categoryFilter, setCategoryFilter] = useState<Set<RecordCategory>>(() => {
    const val = localStorage.getItem('unitypackage-categoryFilter');
    if (!val) return new Set();
    try {
      const arr = JSON.parse(val) as unknown;
      if (Array.isArray(arr)) {
        return new Set(arr.filter((c): c is RecordCategory => c === 'asset' || c === 'meta' || c === 'preview'));
      }
    } catch {
      // Ignore
    }
    return new Set();
  });
  const [sizeMin, setSizeMin] = useState('');
  const [sizeMax, setSizeMax] = useState('');
  const [diagCodeFilter, setDiagCodeFilter] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const val = localStorage.getItem('unitypackage-sortKey');
    return (val === 'name' || val === 'size' || val === 'extension' || val === 'guid') ? val : 'name';
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    const val = localStorage.getItem('unitypackage-sortDirection');
    return (val === 'asc' || val === 'desc') ? val : 'asc';
  });
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>(() => {
    const val = localStorage.getItem('unitypackage-theme');
    return (val === 'auto' || val === 'light' || val === 'dark') ? val : 'auto';
  });
  const [recents, setRecents] = useState<RecentPackage[]>([]);
  const [recentToPrompt, setRecentToPrompt] = useState<RecentPackage | null>(null);
  const [packageName, setPackageName] = useState<string | null>(null);
  const [status, setStatus] = useState('Open a .unitypackage to inspect its contents.');
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
  const [successExport, setSuccessExport] = useState<{ bytes: Uint8Array; filename: string } | null>(null);
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
    if (records.length > 0) {
      setStagedRecordIds(prev => {
        const next = new Set<string>();
        let changed = false;
        for (const id of prev) {
          if (records.some(r => r.id === id)) {
            next.add(id);
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [records]);

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
    localStorage.setItem('unitypackage-categoryFilter', JSON.stringify([...categoryFilter]));
  }, [categoryFilter]);

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
    localStorage.setItem('unitypackage-theme', theme);
    const root = document.documentElement;
    if (theme === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    void getRecentPackages().then(setRecents);
  }, []);

  const visibleRecords = useMemo(() => {
    const filtered = filterRecords(records, {
      query: debouncedQuery,
      matchMode,
      caseSensitive,
      globMode,
      categories: categoryFilter,
      sizeMin,
      sizeMax,
      diagCodes: diagCodeFilter,
      includeMetaSidecars,
    });
    return sortRecords(filtered, sortKey, sortDirection);
  }, [
    records, debouncedQuery, matchMode, caseSensitive, globMode,
    categoryFilter, sizeMin, sizeMax, diagCodeFilter, includeMetaSidecars,
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
    setFocusedRowId(id);
    setSelectionAnchorId(id);
  }, []);

  const activeRecord = useMemo(() => {
    return records.find(record => record.id === activeRecordId) ?? visibleRecords[0] ?? null;
  }, [activeRecordId, visibleRecords, records]);

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

  useEffect(() => {
    setSuccessExport(null);
  }, [stagedEntries, gzipLevel, exportFilename]);

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
    setStatus(`Parsing ${file.name}`);
    setRecords([]);
    setDiagnostics([]);
    setAnalysis([]);
    setIsDiagnosticsOpen(false);
    setSelectedRecordIds(new Set());
    setActiveRecordId(null);
    setCollapsedFolders(new Set());
    setQuery('');
    setDebouncedQuery('');
    setDiagCodeFilter(new Set());

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
      setStatus('Package parsing failed.');
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
    setStatus('Processing dropped files...');
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
      setStatus(`Imported ${newImportedRecords.length} entries.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to import files';
      setError(msg);
      setStatus('Import failed.');
    }
  }, [records, stagedRecordIds, importedRecords]);

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

  const handleExport = async () => {
    setIsPacking(true);
    setPackDiagnostics([]);
    setSuccessExport(null);
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
      });
      const blob = new Blob([result.bytes.buffer as BlobPart], { type: 'application/octet-stream' });
      downloadBlob(blob, result.filename);
    } catch (caught) {
      if (caught instanceof Error) {
        const err = caught as PackageCreationError;
        if (err.diagnostics) {
          setPackDiagnostics(err.diagnostics);
        } else {
          setError(err.message);
        }
      } else {
        setError('Failed to create package');
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

  const selectScope = useCallback((recordIds: readonly string[], state: SelectionState) => {
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

  // When meta sidecars are hidden (via includeMetaSidecars or category filter), remove
  // hidden meta IDs from selection and re-home the active record if it points at a
  // now-hidden meta row.
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
      setStatus('No packable assets selected.');
    } else if (skippedCount > 0) {
      setStatus(`Staged ${stageableIds.size.toString()} assets and skipped ${skippedCount.toString()} preview or meta records.`);
    } else {
      setStatus(`Staged ${stageableIds.size.toString()} assets for pack.`);
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
          <div className="segmented-control" aria-label="Match mode">
            <button type="button" id="match-mode-filename" className={matchMode === 'filename' ? 'active' : ''} onClick={() => { setMatchMode('filename'); }}>Name</button>
            <button type="button" id="match-mode-path" className={matchMode === 'path' ? 'active' : ''} onClick={() => { setMatchMode('path'); }}>Path</button>
            <button type="button" id="match-mode-guid" className={matchMode === 'guid' ? 'active' : ''} onClick={() => { setMatchMode('guid'); }}>GUID</button>
          </div>
          <div className="filter-toggles">
            <button
              type="button"
              id="toggle-case-sensitive"
              className={`icon-button filter-toggle-btn${caseSensitive ? ' active' : ''}`}
              aria-pressed={caseSensitive}
              title="Case sensitive"
              aria-label="Toggle case sensitivity"
              onClick={() => { setCaseSensitive(v => !v); }}
            >
              <CaseSensitive aria-hidden="true" size={16} />
            </button>
            <button
              type="button"
              id="toggle-glob-mode"
              className={`icon-button filter-toggle-btn${globMode ? ' active' : ''}`}
              aria-pressed={globMode}
              title="Glob mode (e.g. **/*.shader)"
              aria-label="Toggle glob mode"
              onClick={() => { setGlobMode(v => !v); }}
            >
              <Filter aria-hidden="true" size={16} />
            </button>
          </div>
          <div className="chip-group" aria-label="Category filter">
            {(['asset', 'meta', 'preview'] as RecordCategory[]).map(cat => (
              <button
                key={cat}
                type="button"
                id={`category-chip-${cat}`}
                className={`chip${categoryFilter.has(cat) ? ' active' : ''}`}
                aria-pressed={categoryFilter.has(cat)}
                onClick={() => {
                  setCategoryFilter(prev => {
                    const next = new Set(prev);
                    if (next.has(cat)) next.delete(cat);
                    else next.add(cat);
                    return next;
                  });
                }}
              >
                {cat.charAt(0).toUpperCase() + cat.slice(1)}s
              </button>
            ))}
          </div>
          <div className="size-range">
            <label htmlFor="size-min" className="size-range-label">Size</label>
            <input
              id="size-min"
              type="text"
              className="size-input"
              placeholder="min (e.g. 100k)"
              aria-label="Minimum size"
              value={sizeMin}
              onChange={event => { setSizeMin(event.target.value); }}
            />
            <span className="size-range-sep">&ndash;</span>
            <input
              id="size-max"
              type="text"
              className="size-input"
              placeholder="max (e.g. 2m)"
              aria-label="Maximum size"
              value={sizeMax}
              onChange={event => { setSizeMax(event.target.value); }}
            />
          </div>
          {collectDiagCodes(records).length > 0 ? (
            <div className="chip-group" aria-label="Diagnostic code filter">
              {collectDiagCodes(records).map(code => (
                <button
                  key={code}
                  type="button"
                  id={`diag-chip-${code}`}
                  className={`chip chip-diag${diagCodeFilter.has(code) ? ' active' : ''}`}
                  aria-pressed={diagCodeFilter.has(code)}
                  onClick={() => {
                    setDiagCodeFilter(prev => {
                      const next = new Set(prev);
                      if (next.has(code)) next.delete(code);
                      else next.add(code);
                      return next;
                    });
                  }}
                >
                  {code}
                </button>
              ))}
            </div>
          ) : null}
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
          {recents.length > 0 && (
            <div className="recents-container">
              <h4 className="recents-title">
                <FolderOpen aria-hidden="true" size={15} />
                <span>Recent packages</span>
              </h4>
              <ul className="recents-list">
                {recents.map(recent => (
                  <li
                    key={recent.key}
                    className="recent-item"
                    onClick={() => void handleRecentClick(recent)}
                    title={recent.name}
                  >
                    <div className="recent-item-info">
                      <span className="recent-name">{recent.name}</span>
                      <span className="recent-meta">{formatBytes(recent.size)}</span>
                    </div>
                    <button
                      type="button"
                      className="recent-remove-btn"
                      onClick={(e) => void handleRemoveRecent(recent.key, e)}
                      title="Remove from recents"
                      aria-label={`Remove ${recent.name} from recents`}
                    >
                      &times;
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="theme-toggle-container">
            <span className="theme-toggle-label">Theme</span>
            <div className="segmented-control" aria-label="Theme mode" style={{ margin: 0 }}>
              <button
                type="button"
                className={theme === 'auto' ? 'active' : ''}
                onClick={() => setTheme('auto')}
              >
                Auto
              </button>
              <button
                type="button"
                className={theme === 'light' ? 'active' : ''}
                onClick={() => setTheme('light')}
              >
                Light
              </button>
              <button
                type="button"
                className={theme === 'dark' ? 'active' : ''}
                onClick={() => setTheme('dark')}
              >
                Dark
              </button>
            </div>
          </div>
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
              }}
              gzipLevel={gzipLevel}
              setGzipLevel={setGzipLevel}
              exportFilename={exportFilename}
              setExportFilename={setExportFilename}
              estimatedSize={estimatedSize}
              successExport={successExport}
              onDownloadAgain={() => {
                if (successExport) {
                  const blob = new Blob([successExport.bytes.buffer as BlobPart], { type: 'application/octet-stream' });
                  downloadBlob(blob, successExport.filename);
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

        <aside className="preview-panel" aria-label="Preview and metadata">
          <PreviewPanel
            record={activeRecord}
            records={records}
            includeMetaSidecars={includeMetaSidecars}
            onDownloadZip={(zipRecords, fileName, recordIds) => void handleDownload(zipRecords, fileName, recordIds)}
            onStatusWarning={setStatus}
            onRevealInTree={revealPathInTree}
          />
        </aside>
      </section>

      {isDiagnosticsOpen && (diagnostics.length > 0 || analysis.length > 0) ? (
        <DiagnosticsDrawer
          diagnostics={diagnostics}
          analysis={analysis}
          records={records}
          onNavigate={(recordId) => {
            const targetRecord = records.find(r => r.id === recordId);
            if (targetRecord) {
              setQuery(targetRecord.virtualPath);
              setMatchMode('path');
              setGlobMode(false);
              setCategoryFilter(new Set());
              setDiagCodeFilter(new Set());
              setSizeMin('');
              setSizeMax('');
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

  const extStats = useMemo(() => {
    const counts: Record<string, number> = {};
    const sizes: Record<string, number> = {};
    for (const r of records) {
      const ext = r.extension ? `.${r.extension}` : '(none)';
      counts[ext] = (counts[ext] ?? 0) + 1;
      sizes[ext] = (sizes[ext] ?? 0) + r.byteLength;
    }
    const byCount = Object.entries(counts)
      .map(([ext, count]) => ({ ext, count }))
      .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext))
      .slice(0, 5);
    const bySize = Object.entries(sizes)
      .map(([ext, size]) => ({ ext, size }))
      .sort((a, b) => b.size - a.size || a.ext.localeCompare(b.ext))
      .slice(0, 5);
    return { byCount, bySize };
  }, [records]);

  return (
    <div className="stats-container" style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
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

      {records.length > 0 && (
        <div className="top-extensions-section" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 600 }}>Top Extensions</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <h5 style={{ margin: '0 0 6px 0', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)' }}>By Count</h5>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {extStats.byCount.map(({ ext, count }) => (
                  <li key={ext} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text)' }}>
                    <code style={{ fontSize: '0.72rem' }}>{ext}</code>
                    <span>{count.toString()}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h5 style={{ margin: '0 0 6px 0', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)' }}>By Size</h5>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {extStats.bySize.map(({ ext, size }) => (
                  <li key={ext} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text)' }}>
                    <code style={{ fontSize: '0.72rem' }}>{ext}</code>
                    <span className="text-muted" style={{ color: 'var(--muted)' }}>{formatBytes(size)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
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
  treeViewportRef,
  scrollToRow,
  onToggleFolder,
  onExpandAll,
  onCollapseAll,
  onActivate,
  onToggleSelected,
  onScopeSelect,
  onReplaceSelection,
  onRevealInTree,
  focusedRowId,
  onFocusRow,
  selectionAnchorId,
  onSetAnchor,
  keyboardRangeBaseIds,
  onSetKeyboardRangeBase,
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
  treeViewportRef: RefObject<HTMLDivElement | null>;
  scrollToRow: { id: string; key: number } | null;
  onToggleFolder: (path: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onActivate: (recordId: string) => void;
  onToggleSelected: (recordId: string) => void;
  onScopeSelect: (recordIds: readonly string[], state: SelectionState) => void;
  onReplaceSelection: (selectedIds: Set<string>) => void;
  onRevealInTree: (recordId: string) => void;
  focusedRowId: string | null;
  onFocusRow: (id: string | null) => void;
  selectionAnchorId: string | null;
  onSetAnchor: (id: string | null) => void;
  keyboardRangeBaseIds: Set<string> | null;
  onSetKeyboardRangeBase: (base: Set<string> | null) => void;
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
      viewportRef={treeViewportRef}
      scrollToRow={scrollToRow}
      onToggleFolder={onToggleFolder}
      onExpandAll={onExpandAll}
      onCollapseAll={onCollapseAll}
      onActivate={onActivate}
      onToggleSelected={onToggleSelected}
      onScopeSelect={onScopeSelect}
      onReplaceSelection={onReplaceSelection}
      focusedRowId={focusedRowId}
      onFocusRow={onFocusRow}
      selectionAnchorId={selectionAnchorId}
      onSetAnchor={onSetAnchor}
      keyboardRangeBaseIds={keyboardRangeBaseIds}
      onSetKeyboardRangeBase={onSetKeyboardRangeBase}
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
      onRevealInTree={onRevealInTree}
      focusedRowId={focusedRowId}
      onFocusRow={onFocusRow}
      selectionAnchorId={selectionAnchorId}
      onSetAnchor={onSetAnchor}
      keyboardRangeBaseIds={keyboardRangeBaseIds}
      onSetKeyboardRangeBase={onSetKeyboardRangeBase}
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
  viewportRef,
  scrollToRow,
  onToggleFolder,
  onExpandAll,
  onCollapseAll,
  onActivate,
  onToggleSelected,
  onScopeSelect,
  onReplaceSelection,
  focusedRowId,
  onFocusRow,
  selectionAnchorId,
  onSetAnchor,
  keyboardRangeBaseIds,
  onSetKeyboardRangeBase,
}: {
  rows: TreeRow[];
  records: PackageFileRecord[];
  orderedRecordIds: string[];
  selectedIds: ReadonlySet<string>;
  activeId: string | null;
  collapsedFolders: ReadonlySet<string>;
  viewportRef: RefObject<HTMLDivElement | null>;
  scrollToRow: { id: string; key: number } | null;
  onToggleFolder: (path: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onActivate: (recordId: string) => void;
  onToggleSelected: (recordId: string) => void;
  onScopeSelect: (recordIds: readonly string[], state: SelectionState) => void;
  onReplaceSelection: (selectedIds: Set<string>) => void;
  focusedRowId: string | null;
  onFocusRow: (id: string | null) => void;
  selectionAnchorId: string | null;
  onSetAnchor: (id: string | null) => void;
  keyboardRangeBaseIds: Set<string> | null;
  onSetKeyboardRangeBase: (base: Set<string> | null) => void;
}) {
  const dragSelection = useRowSweepSelection({
    orderedRecordIds,
    selectedIds,
    scrollRef: viewportRef,
    onReplaceSelection,
  });
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 38,
    overscan: 10,
  });

  useEffect(() => {
    if (!scrollToRow) return;
    const index = rows.findIndex(row => row.id === scrollToRow.id);
    if (index === -1) return;

    virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [scrollToRow, rows, virtualizer]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const visibleRowIds = rows.map(r => r.id);
    if (visibleRowIds.length === 0) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      const allFileIds = rows.flatMap(row => row.type === 'file' ? [row.record.id] : []);
      onReplaceSelection(new Set(allFileIds));
      return;
    }

    const key = event.key;
    let nextFocusedId: string | null = null;
    let nextIndex = -1;

    const currentIndex = focusedRowId ? visibleRowIds.indexOf(focusedRowId) : -1;

    if (key === 'ArrowDown') {
      event.preventDefault();
      nextIndex = currentIndex === -1 ? 0 : Math.min(visibleRowIds.length - 1, currentIndex + 1);
      nextFocusedId = visibleRowIds[nextIndex] ?? null;
    } else if (key === 'ArrowUp') {
      event.preventDefault();
      nextIndex = currentIndex === -1 ? 0 : Math.max(0, currentIndex - 1);
      nextFocusedId = visibleRowIds[nextIndex] ?? null;
    } else if (key === 'Home') {
      event.preventDefault();
      nextIndex = 0;
      nextFocusedId = visibleRowIds[0] ?? null;
    } else if (key === 'End') {
      event.preventDefault();
      nextIndex = visibleRowIds.length - 1;
      nextFocusedId = visibleRowIds[nextIndex] ?? null;
    } else if (key === 'PageDown') {
      event.preventDefault();
      nextIndex = currentIndex === -1 ? 0 : Math.min(visibleRowIds.length - 1, currentIndex + 15);
      nextFocusedId = visibleRowIds[nextIndex] ?? null;
    } else if (key === 'PageUp') {
      event.preventDefault();
      nextIndex = currentIndex === -1 ? 0 : Math.max(0, currentIndex - 15);
      nextFocusedId = visibleRowIds[nextIndex] ?? null;
    } else if (key === 'ArrowLeft') {
      event.preventDefault();
      if (focusedRowId) {
        const currentRow = rows.find(r => r.id === focusedRowId);
        if (currentRow) {
          if (currentRow.type === 'folder' && !collapsedFolders.has(currentRow.path)) {
            onToggleFolder(currentRow.path);
          } else {
            const parts = (currentRow.type === 'folder' ? currentRow.path : currentRow.record.virtualPath).split('/').filter(Boolean);
            if (parts.length > 1) {
              const parentPath = parts.slice(0, -1).join('/');
              const parentId = `folder:${parentPath}`;
              if (visibleRowIds.includes(parentId)) {
                onFocusRow(parentId);
                onSetAnchor(parentId);
                onSetKeyboardRangeBase(null);
                const parentIdx = visibleRowIds.indexOf(parentId);
                if (parentIdx !== -1) {
                  virtualizer.scrollToIndex(parentIdx, { align: 'auto' });
                }
              }
            }
          }
        }
      }
      return;
    } else if (key === 'ArrowRight') {
      event.preventDefault();
      if (focusedRowId) {
        const currentRow = rows.find(r => r.id === focusedRowId);
        if (currentRow) {
          if (currentRow.type === 'folder') {
            if (collapsedFolders.has(currentRow.path)) {
              onToggleFolder(currentRow.path);
            } else {
              if (currentIndex !== -1 && currentIndex + 1 < visibleRowIds.length) {
                const nextRow = rows[currentIndex + 1];
                if (nextRow) {
                  onFocusRow(nextRow.id);
                  onSetAnchor(nextRow.id);
                  onSetKeyboardRangeBase(null);
                  virtualizer.scrollToIndex(currentIndex + 1, { align: 'auto' });
                }
              }
            }
          }
        }
      }
      return;
    } else if (key === ' ') {
      event.preventDefault();
      if (focusedRowId) {
        const currentRow = rows.find(r => r.id === focusedRowId);
        if (currentRow) {
          if (currentRow.type === 'file') {
            onToggleSelected(currentRow.record.id);
          } else {
            const folderRecordIds = getFolderRecordIds(records, currentRow.path);
            const selectionState = getSelectionState(folderRecordIds, selectedIds);
            onScopeSelect(folderRecordIds, selectionState);
          }
        }
      }
      return;
    } else if (key === 'Enter') {
      event.preventDefault();
      if (focusedRowId) {
        const currentRow = rows.find(r => r.id === focusedRowId);
        if (currentRow) {
          if (currentRow.type === 'file') {
            onActivate(currentRow.record.id);
          } else {
            onToggleFolder(currentRow.path);
          }
        }
      }
      return;
    }

    if (nextFocusedId && nextIndex !== -1) {
      onFocusRow(nextFocusedId);
      virtualizer.scrollToIndex(nextIndex, { align: 'auto' });

      if (event.shiftKey) {
        const validFileIdsSet = new Set(orderedRecordIds);
        let currentRangeBase = keyboardRangeBaseIds;
        if (!currentRangeBase) {
          currentRangeBase = new Set(selectedIds);
          onSetKeyboardRangeBase(currentRangeBase);
        }
        const anchor = selectionAnchorId ?? focusedRowId ?? visibleRowIds[0] ?? null;
        const mode = anchor && currentRangeBase.has(anchor) ? 'remove' : 'add';
        const nextSelection = getKeyboardRangeSelection(
          visibleRowIds,
          anchor,
          nextFocusedId,
          validFileIdsSet,
          currentRangeBase,
          mode
        );
        onReplaceSelection(nextSelection);
      } else {
        onSetKeyboardRangeBase(null);
        onSetAnchor(nextFocusedId);
      }
    }
  };

  const hasFolders = rows.some(r => r.type === 'folder');

  return (
    <>
      {hasFolders && (
        <div className="tree-toolbar">
          <button type="button" className="tree-toolbar-btn" onClick={onExpandAll} aria-label="Expand all folders">
            <ChevronsDown aria-hidden="true" size={15} />
            <span>Expand all</span>
          </button>
          <button type="button" className="tree-toolbar-btn" onClick={onCollapseAll} aria-label="Collapse all folders">
            <ChevronsUp aria-hidden="true" size={15} />
            <span>Collapse all</span>
          </button>
        </div>
      )}
      <div
        ref={viewportRef}
        className={`explorer-viewport${dragSelection.isDragging ? ' selecting-range' : ''}`}
        role="tree"
        aria-label="Package file tree"
        tabIndex={0}
        aria-activedescendant={focusedRowId ?? undefined}
        onKeyDown={handleKeyDown}
        style={{ outline: 'none' }}
      >
        <div className="virtual-spacer" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map(virtualRow => {
            const row = rows[virtualRow.index];
            const style: CSSProperties = {
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            };

            if (!row) return null;

            if (row.type === 'folder') {
              const collapsed = collapsedFolders.has(row.path);
              const folderRecordIds = getFolderRecordIds(records, row.path);
              const selectionState = getSelectionState(folderRecordIds, selectedIds);
              return (
                <FolderRow
                  key={row.id}
                  id={row.id}
                  name={row.name}
                  path={row.path}
                  depth={row.depth}
                  collapsed={collapsed}
                  fileCount={folderRecordIds.length}
                  selectionState={selectionState}
                  focused={focusedRowId === row.id}
                  style={style}
                  onClick={() => {
                    viewportRef.current?.focus();
                    onFocusRow(row.id);
                    onSetAnchor(row.id);
                    onSetKeyboardRangeBase(null);
                    onToggleFolder(row.path);
                  }}
                  onSelect={() => {
                    onScopeSelect(folderRecordIds, selectionState);
                  }}
                />
              );
            }

            return (
              <FileRow
                key={row.id}
                id={row.id}
                record={row.record}
                active={activeId === row.record.id}
                selected={selectedIds.has(row.record.id)}
                focused={focusedRowId === row.id}
                depth={row.depth}
                style={style}
                onActivate={onActivate}
                onToggleSelected={onToggleSelected}
                onPointerDown={(recordId, event) => {
                  viewportRef.current?.focus();
                  onFocusRow(row.id);
                  onSetAnchor(row.id);
                  onSetKeyboardRangeBase(null);
                  dragSelection.onPointerDown(recordId, event);
                }}
                shouldSuppressClick={dragSelection.shouldSuppressClick}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}

// Flat item list for the virtualized extension list.
// Each item is either a group header or a file row.
type ExtListItem =
  | { kind: 'header'; group: ExtensionGroup }
  | { kind: 'file'; record: PackageFileRecord; group: ExtensionGroup };

function ExtensionList({
  groups,
  orderedRecordIds,
  selectedIds,
  activeId,
  onActivate,
  onToggleSelected,
  onScopeSelect,
  onReplaceSelection,
  onRevealInTree,
  focusedRowId,
  onFocusRow,
  selectionAnchorId,
  onSetAnchor,
  keyboardRangeBaseIds,
  onSetKeyboardRangeBase,
}: {
  groups: ExtensionGroup[];
  orderedRecordIds: string[];
  selectedIds: ReadonlySet<string>;
  activeId: string | null;
  onActivate: (recordId: string) => void;
  onToggleSelected: (recordId: string) => void;
  onScopeSelect: (recordIds: readonly string[], state: SelectionState) => void;
  onReplaceSelection: (selectedIds: Set<string>) => void;
  onRevealInTree: (recordId: string) => void;
  focusedRowId: string | null;
  onFocusRow: (id: string | null) => void;
  selectionAnchorId: string | null;
  onSetAnchor: (id: string | null) => void;
  keyboardRangeBaseIds: Set<string> | null;
  onSetKeyboardRangeBase: (base: Set<string> | null) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const dragSelection = useRowSweepSelection({
    orderedRecordIds,
    selectedIds,
    scrollRef: parentRef,
    onReplaceSelection,
  });

  // Flatten groups into a single item list for virtualization.
  const items = useMemo<ExtListItem[]>(() => {
    const flat: ExtListItem[] = [];
    for (const group of groups) {
      flat.push({ kind: 'header', group });
      for (const record of group.records) {
        flat.push({ kind: 'file', record, group });
      }
    }
    return flat;
  }, [groups]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const item = items[index];
      return item?.kind === 'header' ? 44 : 38;
    },
    overscan: 10,
  });

  const visibleRowIds = useMemo(() => {
    return items.map(item => item.kind === 'header' ? `hdr-${item.group.extension}` : item.record.id);
  }, [items]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (visibleRowIds.length === 0) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      const allFileIds = items.flatMap(item => item.kind === 'file' ? [item.record.id] : []);
      onReplaceSelection(new Set(allFileIds));
      return;
    }

    const key = event.key;
    let nextFocusedId: string | null = null;
    let nextIndex = -1;

    const currentIndex = focusedRowId ? visibleRowIds.indexOf(focusedRowId) : -1;

    if (key === 'ArrowDown') {
      event.preventDefault();
      nextIndex = currentIndex === -1 ? 0 : Math.min(visibleRowIds.length - 1, currentIndex + 1);
      nextFocusedId = visibleRowIds[nextIndex] ?? null;
    } else if (key === 'ArrowUp') {
      event.preventDefault();
      nextIndex = currentIndex === -1 ? 0 : Math.max(0, currentIndex - 1);
      nextFocusedId = visibleRowIds[nextIndex] ?? null;
    } else if (key === 'Home') {
      event.preventDefault();
      nextIndex = 0;
      nextFocusedId = visibleRowIds[0] ?? null;
    } else if (key === 'End') {
      event.preventDefault();
      nextIndex = visibleRowIds.length - 1;
      nextFocusedId = visibleRowIds[nextIndex] ?? null;
    } else if (key === 'PageDown') {
      event.preventDefault();
      nextIndex = currentIndex === -1 ? 0 : Math.min(visibleRowIds.length - 1, currentIndex + 15);
      nextFocusedId = visibleRowIds[nextIndex] ?? null;
    } else if (key === 'PageUp') {
      event.preventDefault();
      nextIndex = currentIndex === -1 ? 0 : Math.max(0, currentIndex - 15);
      nextFocusedId = visibleRowIds[nextIndex] ?? null;
    } else if (key === ' ') {
      event.preventDefault();
      if (focusedRowId) {
        const item = items[currentIndex];
        if (item) {
          if (item.kind === 'file') {
            onToggleSelected(item.record.id);
          } else {
            const recordIds = item.group.records.map(r => r.id);
            const selectionState = getSelectionState(recordIds, selectedIds);
            onScopeSelect(recordIds, selectionState);
          }
        }
      }
      return;
    } else if (key === 'Enter') {
      event.preventDefault();
      if (focusedRowId) {
        const item = items[currentIndex];
        if (item?.kind === 'file') {
          onActivate(item.record.id);
        }
      }
      return;
    }

    if (nextFocusedId && nextIndex !== -1) {
      onFocusRow(nextFocusedId);
      virtualizer.scrollToIndex(nextIndex, { align: 'auto' });

      if (event.shiftKey) {
        const validFileIdsSet = new Set(orderedRecordIds);
        let currentRangeBase = keyboardRangeBaseIds;
        if (!currentRangeBase) {
          currentRangeBase = new Set(selectedIds);
          onSetKeyboardRangeBase(currentRangeBase);
        }
        const anchor = selectionAnchorId ?? focusedRowId ?? visibleRowIds[0] ?? null;
        const mode = anchor && currentRangeBase.has(anchor) ? 'remove' : 'add';
        const nextSelection = getKeyboardRangeSelection(
          visibleRowIds,
          anchor,
          nextFocusedId,
          validFileIdsSet,
          currentRangeBase,
          mode
        );
        onReplaceSelection(nextSelection);
      } else {
        onSetKeyboardRangeBase(null);
        onSetAnchor(nextFocusedId);
      }
    }
  };

  return (
    <div
      ref={parentRef}
      className={`explorer-viewport extension-list-viewport${dragSelection.isDragging ? ' selecting-range' : ''}`}
      role="tree"
      aria-label="Package file extensions"
      tabIndex={0}
      aria-activedescendant={focusedRowId ?? undefined}
      onKeyDown={handleKeyDown}
      style={{ outline: 'none' }}
    >
      <div className="virtual-spacer" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map(virtualRow => {
          const item = items[virtualRow.index];
          const style: CSSProperties = {
            height: `${virtualRow.size}px`,
            transform: `translateY(${virtualRow.start}px)`,
          };

          if (!item) return null;

          if (item.kind === 'header') {
            const { group } = item;
            const recordIds = group.records.map(r => r.id);
            const selState = getSelectionState(recordIds, selectedIds);
            const firstId = group.records[0]?.id;
            const hdrId = `hdr-${group.extension}`;
            return (
              <ExtensionHeaderRow
                key={hdrId}
                id={hdrId}
                extension={group.extension}
                selectionState={selState}
                fileCount={group.records.length}
                totalBytes={group.totalBytes}
                focused={focusedRowId === hdrId}
                style={style}
                onClick={() => {
                  parentRef.current?.focus();
                  onFocusRow(hdrId);
                  onSetAnchor(hdrId);
                  onSetKeyboardRangeBase(null);
                }}
                onSelect={() => {
                  onScopeSelect(recordIds, selState);
                }}
                onReveal={
                  firstId !== undefined
                    ? () => {
                        onRevealInTree(firstId);
                      }
                    : undefined
                }
              />
            );
          }

          return (
            <FileRow
              key={item.record.id}
              id={item.record.id}
              record={item.record}
              active={activeId === item.record.id}
              selected={selectedIds.has(item.record.id)}
              focused={focusedRowId === item.record.id}
              depth={0}
              style={style}
              onActivate={onActivate}
              onToggleSelected={onToggleSelected}
              onPointerDown={(recordId, event) => {
                parentRef.current?.focus();
                onFocusRow(recordId);
                onSetAnchor(recordId);
                onSetKeyboardRangeBase(null);
                dragSelection.onPointerDown(recordId, event);
              }}
              shouldSuppressClick={dragSelection.shouldSuppressClick}
            />
          );
        })}
      </div>
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

interface FolderRowProps {
  id: string;
  name: string;
  path: string;
  depth: number;
  collapsed: boolean;
  fileCount: number;
  selectionState: SelectionState;
  focused: boolean;
  style?: CSSProperties;
  onClick: () => void;
  onSelect: () => void;
}

const FolderRow = memo(({
  id,
  name,
  depth,
  collapsed,
  fileCount,
  selectionState,
  focused,
  style,
  onClick,
  onSelect,
}: FolderRowProps) => {
  return (
    <div
      id={id}
      data-row-id={id}
      className={`tree-row folder-row${focused ? ' focused' : ''}`}
      style={{ ...style, paddingLeft: `${12 + depth * 18}px` }}
      onClick={onClick}
      role="treeitem"
      tabIndex={-1}
      aria-expanded={!collapsed}
    >
      <SelectionToggle
        state={selectionState}
        disabled={fileCount === 0}
        label={`${selectionState === 'all' ? 'Deselect' : 'Select'} ${name}`}
        onSelect={onSelect}
      />
      {collapsed ? <ChevronRight aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}
      {collapsed ? <Folder aria-hidden="true" size={17} /> : <FolderOpen aria-hidden="true" size={17} />}
      <span>{name}</span>
      <small>{fileCount.toString()}</small>
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.id === nextProps.id &&
    prevProps.name === nextProps.name &&
    prevProps.path === nextProps.path &&
    prevProps.depth === nextProps.depth &&
    prevProps.collapsed === nextProps.collapsed &&
    prevProps.fileCount === nextProps.fileCount &&
    prevProps.selectionState === nextProps.selectionState &&
    prevProps.focused === nextProps.focused &&
    prevProps.style?.height === nextProps.style?.height &&
    prevProps.style?.transform === nextProps.style?.transform &&
    prevProps.onClick === nextProps.onClick &&
    prevProps.onSelect === nextProps.onSelect
  );
});

interface ExtensionHeaderRowProps {
  id: string;
  extension: string;
  selectionState: SelectionState;
  fileCount: number;
  totalBytes: number;
  focused: boolean;
  style?: CSSProperties;
  onClick: () => void;
  onSelect: () => void;
  onReveal: (() => void) | undefined;
}

const ExtensionHeaderRow = memo(({
  id,
  extension,
  selectionState,
  fileCount,
  totalBytes,
  focused,
  style,
  onClick,
  onSelect,
  onReveal,
}: ExtensionHeaderRowProps) => {
  return (
    <div
      id={id}
      className={`ext-group-header${focused ? ' focused' : ''}`}
      style={style}
      onClick={onClick}
      role="treeitem"
      tabIndex={-1}
    >
      <div className="extension-title">
        <SelectionToggle
          state={selectionState}
          disabled={fileCount === 0}
          label={`${selectionState === 'all' ? 'Deselect' : 'Select'} ${extension}`}
          onSelect={onSelect}
        />
        <h3>{extension}</h3>
      </div>
      <div className="ext-group-header-right">
        <span>{fileCount.toString()} files, {formatBytes(totalBytes)}</span>
        {onReveal !== undefined && (
          <button
            type="button"
            className="reveal-in-tree-btn"
            aria-label={`Reveal ${extension} in tree`}
            onClick={(event) => {
              event.stopPropagation();
              onReveal();
            }}
          >
            <Locate aria-hidden="true" size={14} />
            <span>Reveal</span>
          </button>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.id === nextProps.id &&
    prevProps.extension === nextProps.extension &&
    prevProps.selectionState === nextProps.selectionState &&
    prevProps.fileCount === nextProps.fileCount &&
    prevProps.totalBytes === nextProps.totalBytes &&
    prevProps.focused === nextProps.focused &&
    prevProps.style?.height === nextProps.style?.height &&
    prevProps.style?.transform === nextProps.style?.transform &&
    prevProps.onClick === nextProps.onClick &&
    prevProps.onSelect === nextProps.onSelect &&
    prevProps.onReveal === nextProps.onReveal &&
    (prevProps.onReveal === undefined) === (nextProps.onReveal === undefined)
  );
});

const FileRow = memo(({
  id,
  record,
  active,
  selected,
  focused,
  depth,
  style,
  onActivate,
  onToggleSelected,
  onPointerDown,
  shouldSuppressClick,
}: {
  id: string;
  record: PackageFileRecord;
  active: boolean;
  selected: boolean;
  focused: boolean;
  depth: number;
  style?: CSSProperties;
  onActivate: (recordId: string) => void;
  onToggleSelected: (recordId: string) => void;
  onPointerDown: (recordId: string, event: ReactPointerEvent<HTMLElement>) => void;
  shouldSuppressClick: () => boolean;
}) => {
  const { Icon, tone, label } = getFileIconDescriptor(record);

  return (
    <div
      id={id}
      className={`tree-row file-row${active ? ' active' : ''}${selected ? ' selected' : ''}${focused ? ' focused' : ''}`}
      style={{ ...style, paddingLeft: `${12 + depth * 18}px` }}
      role="treeitem"
      aria-selected={selected}
      tabIndex={-1}
      data-record-id={record.id}
      data-row-id={record.id}
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
}, (prevProps, nextProps) => {
  return (
    prevProps.id === nextProps.id &&
    prevProps.record === nextProps.record &&
    prevProps.active === nextProps.active &&
    prevProps.selected === nextProps.selected &&
    prevProps.focused === nextProps.focused &&
    prevProps.depth === nextProps.depth &&
    prevProps.style?.height === nextProps.style?.height &&
    prevProps.style?.transform === nextProps.style?.transform &&
    prevProps.onActivate === nextProps.onActivate &&
    prevProps.onToggleSelected === nextProps.onToggleSelected &&
    prevProps.onPointerDown === nextProps.onPointerDown &&
    prevProps.shouldSuppressClick === nextProps.shouldSuppressClick
  );
});


function PreviewPanel({
  record,
  records,
  includeMetaSidecars,
  onDownloadZip,
  onStatusWarning,
  onRevealInTree,
}: {
  record: PackageFileRecord | null;
  records: PackageFileRecord[];
  includeMetaSidecars: boolean;
  onDownloadZip: (records: PackageFileRecord[], fileName: string, recordIds: string[]) => void;
  onStatusWarning: (message: string) => void;
  onRevealInTree: (path: string) => void;
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
          <span style={{ color: '#ffffff' }}>{naturalDims.width} × {naturalDims.height}</span>
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

function TextPreview({ record }: { record: PackageFileRecord }) {
  const [loadedLimit, setLoadedLimit] = useState(20000);
  const themeMode = usePreferredSyntaxTheme();

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
  const themeMode = usePreferredSyntaxTheme();
  const [highlightedCode, setHighlightedCode] = useState<HighlightedCode | null>(null);

  const metaText = useMemo(() => {
    return textDecoder.decode(siblingRecord.content);
  }, [siblingRecord.content]);

  const metaGuid = useMemo(() => readMetaGuid(siblingRecord.content), [siblingRecord.content]);
  const metaImporter = useMemo(() => readDeclaredMetaImporter(siblingRecord.content), [siblingRecord.content]);

  useEffect(() => {
    let cancelled = false;
    setHighlightedCode(null);

    void highlightCode(metaText, 'yaml', themeMode)
      .then(result => {
        if (!cancelled) setHighlightedCode(result);
      })
      .catch(() => {
        if (!cancelled) setHighlightedCode(null);
      });

    return () => {
      cancelled = true;
    };
  }, [metaText, themeMode]);

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

  const siblingMetaRecord = record.extension !== 'meta' && !record.isUnityPreview
    ? records.find(r => r.guid === record.guid && r.extension === 'meta')
    : undefined;

  return (
    <section className="metadata">
      <h3>Metadata</h3>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
              <span style={{ overflowWrap: 'anywhere' }}>{value}</span>
              {(label === 'Path' || label === 'GUID') && <CopyButton text={value} />}
            </dd>
          </div>
        ))}
        {declaredMetaInfo.importer !== undefined ? (
          <div key="Declared importer">
            <dt>Declared importer</dt>
            <dd>{declaredMetaInfo.importer}</dd>
          </div>
        ) : null}
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
      {siblingMetaRecord && <MetaSidecarView siblingRecord={siblingMetaRecord} />}
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
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <aside className="diagnostics-drawer" aria-label="Diagnostics">
      <div className="diagnostics-drawer-header">
        <h2>Diagnostics & Findings</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close diagnostics"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            color: 'var(--text)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem',
            lineHeight: 1,
          }}
        >
          &times;
        </button>
      </div>
      <ul className="diagnostics-list">
        {diagnostics.map((diagnostic, index) => {
          const target = diagnostic.guid !== undefined
            ? (records.find(r => r.guid === diagnostic.guid && !r.isUnityPreview && r.extension !== 'meta')
               ?? records.find(r => r.guid === diagnostic.guid))
            : (diagnostic.path !== undefined
               ? records.find(r => r.id.endsWith(`/${diagnostic.path}`) || r.id === diagnostic.path)
               : undefined);
          const pathToShow = target?.virtualPath ?? diagnostic.path;

          return (
            <li
              key={`parser-${diagnostic.code}-${index.toString()}`}
              className={`diagnostic-row severity-${diagnostic.severity}`}
              style={{ cursor: target ? 'pointer' : 'default' }}
              onClick={() => { if (target) onNavigate(target.id); }}
            >
              <div className="diagnostic-row-meta">
                <span className="diagnostic-badge">{severityLabel(diagnostic.severity)}</span>
                <span className="diagnostic-code">{diagnostic.code}</span>
              </div>
              <span className="diagnostic-message">{diagnostic.message}</span>
              {pathToShow && (
                <span className="diagnostic-path">
                  <strong>Path:</strong> {pathToShow}
                </span>
              )}
              {target ? (
                <button
                  type="button"
                  className="diagnostic-navigate"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate(target.id);
                  }}
                >
                  Go
                </button>
              ) : null}
            </li>
          );
        })}
        {analysis.map((finding, index) => {
          const target = findBestMatchingRecord(records, finding);
          const pathToShow = target?.virtualPath ?? finding.pathname ?? finding.path;

          return (
            <li
              key={`analysis-${finding.code}-${index.toString()}`}
              className={`diagnostic-row severity-${finding.severity}`}
              style={{ cursor: target ? 'pointer' : 'default' }}
              onClick={() => { if (target) onNavigate(target.id); }}
            >
              <div className="diagnostic-row-meta">
                <span className="diagnostic-badge">{severityLabel(finding.severity)}</span>
                <span className="diagnostic-code">{finding.code}</span>
              </div>
              <span className="diagnostic-message">{finding.message}</span>
              {pathToShow && (
                <span className="diagnostic-path">
                  <strong>Path:</strong> {pathToShow}
                </span>
              )}
              {target ? (
                <button
                  type="button"
                  className="diagnostic-navigate"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate(target.id);
                  }}
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
  isPacking,
  packDiagnostics,
  onExport,
  onRemove,
  onClear,
  onClearDraft,
  gzipLevel,
  setGzipLevel,
  exportFilename,
  setExportFilename,
  estimatedSize,
  successExport,
  onDownloadAgain,
  onShowInList,
  highlightedRecordId,
  onPathnameChange,
  onImportFiles,
}: {
  stagedRecords: PackageFileRecord[];
  validation: PackValidation;
  isPacking: boolean;
  packDiagnostics: CreateUnityPackageDiagnostic[];
  onExport: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onClearDraft: () => void;
  gzipLevel: number;
  setGzipLevel: (level: number) => void;
  exportFilename: string;
  setExportFilename: (name: string) => void;
  estimatedSize: number;
  successExport: { bytes: Uint8Array; filename: string } | null;
  onDownloadAgain: () => void;
  onShowInList: (id: string) => void;
  highlightedRecordId: string | null;
  onPathnameChange: (id: string, newPathname: string) => void;
  onImportFiles: (dt: DataTransfer) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer) {
      onImportFiles(e.dataTransfer);
    }
  };
  const findStagedRecordForDiag = (diag: CreateUnityPackageDiagnostic) => {
    if (diag.guid) {
      const found = stagedRecords.find(r => r.guid === diag.guid);
      if (found) return found;
    }
    if (diag.path) {
      const pathnamePart = diag.path.includes('/') && diag.path.split('/')[0]?.length === 32
        ? diag.path.split('/').slice(1).join('/')
        : diag.path;
      const found = stagedRecords.find(r => r.pathname === pathnamePart || r.virtualPath === diag.path || r.id === diag.path);
      if (found) return found;
    }
    return null;
  };

  const globalValidationDiags = validation.diagnostics.filter((d: PackDraftDiagnostic) => !d.recordId);
  const isFilenameEmpty = !exportFilename.trim();
  const globalDiags = [...globalValidationDiags];
  if (isFilenameEmpty) {
    globalDiags.push({
      code: 'empty-entries',
      message: 'Output filename cannot be empty.',
    });
  }

  const isExportDisabled = validation.status !== 'ready' || isFilenameEmpty || isPacking;

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
          <button type="button" onClick={onClearDraft} id="clear-draft-btn">
            <RefreshCw aria-hidden="true" size={16} />
            <span>Clear draft</span>
          </button>
          <button
            type="button"
            disabled={isExportDisabled}
            onClick={onExport}
          >
            <PackagePlus aria-hidden="true" size={16} />
            <span>{isPacking ? 'Exporting...' : 'Export .unitypackage'}</span>
          </button>
        </div>
      </div>

      {successExport && (
        <div className="pack-status success" role="status">
          <CheckCircle aria-hidden="true" size={18} />
          <div>
            <strong>Package exported successfully!</strong>
            <div className="success-details">
              Filename: <code>{successExport.filename}</code>
              <br />
              Size: {formatBytes(successExport.bytes.length)}
            </div>
            <button
              type="button"
              className="text-button download-again-btn"
              onClick={onDownloadAgain}
            >
              Download again
            </button>
          </div>
        </div>
      )}

      {packDiagnostics.length > 0 && (
        <div className="pack-status error" role="status">
          <AlertTriangle aria-hidden="true" size={18} />
          <div>
            <strong>Package creation failed</strong>
            <ul className="pack-diagnostic-list" style={{ marginTop: '0.25rem', paddingLeft: '0', listStyle: 'none' }}>
              {packDiagnostics.map((diag, index) => {
                const target = findStagedRecordForDiag(diag);
                return (
                  <li key={index} className="creation-diagnostic-item" style={{ fontSize: '0.8125rem' }}>
                    <span>
                      [{diag.code}] {diag.message} {diag.path ? `(${diag.path})` : ''}
                    </span>
                    {target && (
                      <button
                        type="button"
                        className="text-button show-in-list-btn"
                        style={{ marginLeft: '8px', fontSize: '0.75rem' }}
                        onClick={() => onShowInList(target.id)}
                      >
                        Show in list
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      <div className="pack-controls">
        <div className="pack-control-group">
          <label htmlFor="export-filename">Output filename</label>
          <input
            id="export-filename"
            type="text"
            value={exportFilename}
            onChange={(e) => setExportFilename(e.target.value)}
            placeholder="unitypackage-name.unitypackage"
          />
        </div>

        <div className="pack-control-group">
          <label htmlFor="gzip-level">Compression level</label>
          <select
            id="gzip-level"
            value={gzipLevel}
            onChange={(e) => setGzipLevel(Number(e.target.value))}
          >
            <option value={0}>0 (Store - No compression)</option>
            <option value={1}>1 (Fastest)</option>
            <option value={3}>3 (Fast)</option>
            <option value={6}>6 (Balanced - Default)</option>
            <option value={9}>9 (Smallest)</option>
          </select>
        </div>

        <div className="pack-size-estimate">
          <div className="size-info">
            <span>Estimated uncompressed size:</span>
            <span className="size-value">{formatBytes(estimatedSize)}</span>
          </div>
          {estimatedSize > 1073741824 && (
            <div className="warning-banner">
              <AlertTriangle size={14} />
              <span>Warning: Estimated size exceeds 1 GiB. Large packages may cause slow exports.</span>
            </div>
          )}
        </div>
      </div>

      {globalDiags.length > 0 && (
        <div className="pack-status error" role="status" style={{ margin: '12px' }}>
          <AlertTriangle aria-hidden="true" size={18} />
          <ul style={{ paddingLeft: '1.25rem', margin: 0 }}>
            {globalDiags.map((d: PackDraftDiagnostic, i: number) => (
              <li key={i}>{d.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div
        className={`staged-list-container ${isDragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="staged-list-header">
          <h3>Staged Entries</h3>
          <span className="order-note">Entries are written in deterministic GUID order.</span>
        </div>
        {stagedRecords.length === 0 ? (
          <div className="drag-drop-placeholder">
            <UploadCloud size={32} />
            <p>Drag and drop local files/folders here to stage them</p>
            <small>Pairs of file + file.meta are matched; loose files auto-generate minimal metas.</small>
          </div>
        ) : (
          <div className="staged-list">
            {stagedRecords.map(record => {
              const recordDiags = validation.diagnostics.filter(d => d.recordId === record.id);
              const isHighlighted = record.id === highlightedRecordId;
              return (
                <div
                  key={record.id}
                  id={`staged-row-${record.id}`}
                  className={`staged-row-wrapper ${isHighlighted ? 'highlighted' : ''}`}
                >
                  <div className="staged-row" style={{ width: '100%' }}>
                    <File aria-hidden="true" size={16} style={{ flexShrink: 0 }} />
                    {record.isRawImported ? (
                      <input
                        type="text"
                        className="staged-pathname-input"
                        value={record.pathname}
                        onChange={(e) => onPathnameChange(record.id, e.target.value)}
                        style={{
                          flex: 1,
                          background: 'transparent',
                          border: '1px solid var(--border)',
                          borderRadius: '4px',
                          color: 'var(--text)',
                          padding: '2px 6px',
                          fontSize: '0.875rem',
                          minWidth: 0,
                        }}
                      />
                    ) : (
                      <span>{record.virtualPath}</span>
                    )}
                    <button
                      type="button"
                      className="icon-button"
                      style={{ flexShrink: 0 }}
                      aria-label={`Remove ${record.fileName}`}
                      onClick={() => { onRemove(record.id); }}
                    >
                      <RefreshCw aria-hidden="true" size={15} />
                    </button>
                  </div>
                  {recordDiags.length > 0 && (
                    <div className="record-diagnostics">
                      {recordDiags.map((d: PackDraftDiagnostic, i: number) => (
                        <div key={i} className={`record-diagnostic-item ${d.code}`}>
                          <AlertTriangle size={12} />
                          <span>[{d.code}] {d.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
