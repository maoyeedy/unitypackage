import { memo, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileArchive,
  Folder,
  FolderOpen,
} from 'lucide-react';
import {
  formatBytes,
  getKeyboardRangeSelection,
  getSelectionState,
  type ExtensionGroup,
  type GroupingMode,
  type PackageFileRecord,
  type SelectionState,
  type TreeRow,
} from '../packageModel';
import { getFileIconDescriptor } from '../fileIcons';
import { useRowSweepSelection } from '../hooks/useRowSweepSelection';
import { useVirtualizerCompat } from '../hooks/useVirtualizerCompat';

interface ExplorerProps {
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
  focusedRowId: string | null;
  onFocusRow: (id: string | null) => void;
  selectionAnchorId: string | null;
  onSetAnchor: (id: string | null) => void;
  keyboardRangeBaseIds: Set<string> | null;
  onSetKeyboardRangeBase: (base: Set<string> | null) => void;
}

export function Explorer({
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
  focusedRowId,
  onFocusRow,
  selectionAnchorId,
  onSetAnchor,
  keyboardRangeBaseIds,
  onSetKeyboardRangeBase,
}: ExplorerProps) {
  if (records.length === 0) {
    return (
      <div className="empty-state">
        <FileArchive aria-hidden="true" size={42} />
        <h2>No records loaded</h2>
        <p>Open a Unity package to view and extract its files.</p>
      </div>
    );
  }

  return groupingMode === 'tree' ? (
    <VirtualTree
      rows={treeRows}
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
  'use no memo';
  const dragSelection = useRowSweepSelection({
    orderedRecordIds,
    selectedIds,
    scrollRef: viewportRef,
    onReplaceSelection,
  });
  const virtualizer = useVirtualizerCompat({
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
            const selectionState = getSelectionState(currentRow.recordIds, selectedIds);
            onScopeSelect(currentRow.recordIds, selectionState);
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <ChevronDown aria-hidden="true" size={15} />
              <span>Expand all</span>
            </span>
          </button>
          <button type="button" className="tree-toolbar-btn" onClick={onCollapseAll} aria-label="Collapse all folders">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <ChevronRight aria-hidden="true" size={15} />
              <span>Collapse all</span>
            </span>
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
              const selectionState = getSelectionState(row.recordIds, selectedIds);
              return (
                <FolderRow
                  key={row.id}
                  id={row.id}
                  name={row.name}
                  path={row.path}
                  depth={row.depth}
                  collapsed={collapsed}
                  fileCount={row.recordIds.length}
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
                    onScopeSelect(row.recordIds, selectionState);
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
  focusedRowId: string | null;
  onFocusRow: (id: string | null) => void;
  selectionAnchorId: string | null;
  onSetAnchor: (id: string | null) => void;
  keyboardRangeBaseIds: Set<string> | null;
  onSetKeyboardRangeBase: (base: Set<string> | null) => void;
}) {
  'use no memo';
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

  const virtualizer = useVirtualizerCompat({
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
      {state === 'all' ? (
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><polyline points="9 11 12 14 22 4"/>
        </svg>
      ) : (
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
        </svg>
      )}
    </button>
  );
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
    prevProps.onSelect === nextProps.onSelect
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
