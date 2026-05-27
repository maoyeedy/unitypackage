import { useCallback, useState } from 'react';
import {
  expandAncestors,
  getAllFolderPaths,
  type GroupingMode,
  type PackageFileRecord,
  type SelectionState,
} from '../packageModel';

export function useExplorerSelection(params: {
  records: PackageFileRecord[];
  visibleRecords: PackageFileRecord[];
  treeViewportRef: React.RefObject<HTMLDivElement | null>;
}): {
  selectedRecordIds: Set<string>;
  setSelectedRecordIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  activeRecordId: string | null;
  setActiveRecordId: React.Dispatch<React.SetStateAction<string | null>>;
  collapsedFolders: Set<string>;
  setCollapsedFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  focusedRowId: string | null;
  setFocusedRowId: React.Dispatch<React.SetStateAction<string | null>>;
  selectionAnchorId: string | null;
  setSelectionAnchorId: React.Dispatch<React.SetStateAction<string | null>>;
  keyboardRangeBaseIds: Set<string> | null;
  setKeyboardRangeBaseIds: React.Dispatch<React.SetStateAction<Set<string> | null>>;
  groupingMode: GroupingMode;
  setGroupingMode: React.Dispatch<React.SetStateAction<GroupingMode>>;
  scrollToRow: { id: string; key: number } | null;
  setScrollToRow: React.Dispatch<React.SetStateAction<{ id: string; key: number } | null>>;
  toggleRecordSelection: (recordId: string) => void;
  applyRecordSelection: (recordIds: readonly string[], selected: boolean, baseSelectedIds?: ReadonlySet<string>) => void;
  replaceRecordSelection: (nextSelectedIds: Set<string>) => void;
  selectScope: (recordIds: readonly string[], state: SelectionState) => void;
  clearSelection: () => void;
  invertSelection: () => void;
  selectByExtension: (ext: string) => void;
  activateRecord: (id: string) => void;
  toggleFolder: (path: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  revealPathInTree: (pathOrId: string) => void;
} {
  const { records, visibleRecords, treeViewportRef } = params;

  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [keyboardRangeBaseIds, setKeyboardRangeBaseIds] = useState<Set<string> | null>(null);
  const [groupingMode, setGroupingMode] = useState<GroupingMode>('tree');
  const [scrollToRow, setScrollToRow] = useState<{ id: string; key: number } | null>(null);

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
  }, [records, treeViewportRef]);

  return {
    selectedRecordIds,
    setSelectedRecordIds,
    activeRecordId,
    setActiveRecordId,
    collapsedFolders,
    setCollapsedFolders,
    focusedRowId,
    setFocusedRowId,
    selectionAnchorId,
    setSelectionAnchorId,
    keyboardRangeBaseIds,
    setKeyboardRangeBaseIds,
    groupingMode,
    setGroupingMode,
    scrollToRow,
    setScrollToRow,
    toggleRecordSelection,
    applyRecordSelection,
    replaceRecordSelection,
    selectScope,
    clearSelection,
    invertSelection,
    selectByExtension,
    activateRecord,
    toggleFolder,
    expandAll,
    collapseAll,
    revealPathInTree,
  };
}
