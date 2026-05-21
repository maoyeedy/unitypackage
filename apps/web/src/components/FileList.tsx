import React, { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import FileListItem from './FileListItem';
import type { ExtractedFileContent } from 'unitypackage-core';
import { zip } from 'fflate';

interface FileToZip {
  path: string;
  content: Uint8Array;
}

interface FileListProps {
  files: ExtractedFileContent;
  excludeMeta: boolean;
  categorizeByExtension: boolean;
  maintainStructure: boolean;
  enablePreview: boolean;
  showFileSize: boolean;
  downloadCategoryLabel: (category: string) => string;
}

type CategorizedFiles = Record<string, FileToZip[]>;

type FileListRow =
  | { type: 'categoryHeader'; key: string; extension: string }
  | { type: 'file'; key: string; file: FileToZip }
  | { type: 'categoryAction'; key: string; extension: string; files: FileToZip[] };

const getFilteredAndCategorizedFiles = (
  files: ExtractedFileContent,
  excludeMeta: boolean,
  categorizeByExtension: boolean,
) => {
  const categorized: CategorizedFiles = {};
  const allFiles: FileToZip[] = [];

  for (const [path, content] of Object.entries(files)) {
    if (!(content instanceof Uint8Array)) {
      continue;
    }

    if (excludeMeta && path.endsWith('.meta')) {
      continue;
    }

    const fileEntry = { path, content };
    allFiles.push(fileEntry);

    if (categorizeByExtension) {
      const extension = path.split('.').pop()?.toLowerCase() ?? 'other';
      if (!(extension in categorized)) {
        categorized[extension] = [];
      }
      categorized[extension].push(fileEntry);
    }
  }

  allFiles.sort((a, b) => a.path.localeCompare(b.path));

  const categoryEntries = Object.entries(categorized)
    .sort(([extA], [extB]) => extA.localeCompare(extB))
    .map(([extension, categoryFiles]) => [
      extension,
      categoryFiles.sort((a, b) => a.path.localeCompare(b.path)),
    ] as const);

  return { categoryEntries, allFiles };
};

const FileList: React.FC<FileListProps> = ({
  files,
  excludeMeta,
  categorizeByExtension,
  maintainStructure,
  enablePreview,
  showFileSize,
  downloadCategoryLabel,
}) => {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const { categoryEntries, allFiles } = useMemo(
    () => getFilteredAndCategorizedFiles(files, excludeMeta, categorizeByExtension),
    [files, excludeMeta, categorizeByExtension],
  );

  const rows = useMemo<FileListRow[]>(() => {
    if (!categorizeByExtension) {
      return allFiles.map(file => ({ type: 'file', key: file.path, file }));
    }

    return categoryEntries.flatMap(([extension, categoryFiles]) => [
      { type: 'categoryHeader' as const, key: `category-${extension}`, extension },
      ...categoryFiles.map(file => ({ type: 'file' as const, key: `${extension}-${file.path}`, file })),
      ...(categoryFiles.length > 0
        ? [{ type: 'categoryAction' as const, key: `download-${extension}`, extension, files: categoryFiles }]
        : []),
    ]);
  }, [allFiles, categorizeByExtension, categoryEntries]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: index => {
      const row = rows[index];
      if (row?.type === 'categoryHeader') {
        return 52;
      }
      if (row?.type === 'categoryAction') {
        return 56;
      }
      return 34;
    },
    overscan: 12,
  });

  const downloadCategory = (extension: string, categoryFiles: FileToZip[]) => {
    const filesToZip: Record<string, Uint8Array> = {};
    categoryFiles.forEach(file => {
      const filePath = maintainStructure ? file.path : file.path.split('/').pop() ?? file.path;
      filesToZip[filePath] = file.content;
    });

    zip(filesToZip, (err, data) => {
      if (err) {
        console.error('Error zipping category:', err);
        alert('Error creating ZIP file for category.');
        return;
      }
      const blob = new Blob([data], { type: 'application/zip' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${extension}_files.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    });
  };

  return (
    <div id="fileListContainer">
      <div ref={scrollParentRef} className="file-list-viewport">
        <ul
          className="virtual-list"
          style={{
            height: `${virtualizer.getTotalSize()}px`,
          }}
        >
          {virtualizer.getVirtualItems().map(virtualRow => {
            const row = rows[virtualRow.index];
            const rowStyle = {
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            };

            if (row.type === 'categoryHeader') {
              return (
                <li
                  key={row.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="category virtual-row category-header"
                  style={rowStyle}
                >
                  <h3>{row.extension.toUpperCase()}</h3>
                </li>
              );
            }

            if (row.type === 'categoryAction') {
              return (
                <li
                  key={row.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="category-action virtual-row"
                  style={rowStyle}
                >
                  <button
                    type="button"
                    onClick={() => {
                      downloadCategory(row.extension, row.files);
                    }}
                  >
                    {downloadCategoryLabel(row.extension.toUpperCase())}
                  </button>
                </li>
              );
            }

            return (
              <FileListItem
                key={row.key}
                path={row.file.path}
                content={row.file.content}
                maintainStructure={maintainStructure}
                enablePreview={enablePreview}
                showFileSize={showFileSize}
                style={rowStyle}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
              />
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default FileList;
