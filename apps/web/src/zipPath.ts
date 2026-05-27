import type { PackageFileRecord } from './packageModel';
import type { DownloadZipFileInput } from './workerTypes';

function uniqueZipPath(path: string, usedNames: Map<string, number>): string {
  const safePath = path.replace(/^\/+/, '') || 'file';
  const seen = usedNames.get(safePath) ?? 0;
  usedNames.set(safePath, seen + 1);
  if (seen === 0) return safePath;

  const slashIndex = safePath.lastIndexOf('/');
  const directory = slashIndex === -1 ? '' : safePath.slice(0, slashIndex + 1);
  const name = slashIndex === -1 ? safePath : safePath.slice(slashIndex + 1);
  const dotIndex = name.lastIndexOf('.');
  const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const ext = dotIndex > 0 ? name.slice(dotIndex) : '';
  return `${directory}${stem} (${seen + 1})${ext}`;
}

export interface BuildZipPayloadInput {
  records: readonly PackageFileRecord[];
  recordIds: readonly string[];
  maintainStructure: boolean;
  getContent: (id: string) => Uint8Array<ArrayBuffer> | undefined;
}

export interface BuildZipPayloadResult {
  files: DownloadZipFileInput[];
  transfer: ArrayBuffer[];
}

export function buildZipPayload({
  records,
  recordIds,
  maintainStructure,
  getContent,
}: BuildZipPayloadInput): BuildZipPayloadResult {
  const idSet = new Set(recordIds);
  const usedNames = new Map<string, number>();
  const files: DownloadZipFileInput[] = [];
  const transfer: ArrayBuffer[] = [];
  for (const record of records) {
    if (!idSet.has(record.id)) continue;
    const bytes = getContent(record.id);
    if (!bytes) continue;
    const path = uniqueZipPath(
      maintainStructure ? record.virtualPath : record.fileName,
      usedNames,
    );
    const copy = new Uint8Array(bytes);
    files.push({ path, content: copy });
    transfer.push(copy.buffer);
  }
  return { files, transfer };
}

