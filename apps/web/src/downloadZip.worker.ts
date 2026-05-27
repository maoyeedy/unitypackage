/// <reference lib="webworker" />

import type { DownloadZipRequest, DownloadZipResponse } from './workerTypes';

const encoder = new TextEncoder();

const crcTable = new Uint32Array(256);
for (let i = 0; i < crcTable.length; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c >>> 0;
}

const postResponse = (response: DownloadZipResponse, transfer?: Transferable[]) => {
  self.postMessage(response, { transfer });
};

self.onmessage = ({ data }: MessageEvent<DownloadZipRequest>) => {
  try {
    const ids = new Set(data.recordIds);
    const usedNames = new Map<string, number>();
    const files = data.records
      .filter(record => ids.has(record.id))
      .map(record => ({
        path: uniqueZipPath(data.maintainStructure ? record.virtualPath : record.fileName, usedNames),
        bytes: record.content,
      }));

    if (files.length === 0) {
      postResponse({ type: 'empty' });
      return;
    }

    const zippedData = createStoredZip(files);
    postResponse({ type: 'success', data: zippedData }, [zippedData.buffer]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create ZIP';
    postResponse({ type: 'error', message });
  }
};

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

function createStoredZip(files: { path: string; bytes: Uint8Array }[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.path);
    const crc = crc32(file.bytes);
    const localHeader = createLocalHeader(nameBytes, file.bytes.byteLength, crc);
    localParts.push(localHeader, file.bytes);

    centralParts.push(createCentralHeader(nameBytes, file.bytes.byteLength, crc, offset));
    offset += localHeader.byteLength + file.bytes.byteLength;
  }

  const centralDirectory = concat(centralParts);
  const end = createEndRecord(files.length, centralDirectory.byteLength, offset);
  return concat([...localParts, centralDirectory, end]);
}

function createLocalHeader(nameBytes: Uint8Array, size: number, crc: number): Uint8Array {
  const header = new Uint8Array(30 + nameBytes.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.byteLength, true);
  view.setUint16(28, 0, true);
  header.set(nameBytes, 30);
  return header;
}

function createCentralHeader(nameBytes: Uint8Array, size: number, crc: number, offset: number): Uint8Array {
  const header = new Uint8Array(46 + nameBytes.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nameBytes.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  header.set(nameBytes, 46);
  return header;
}

function createEndRecord(fileCount: number, centralSize: number, centralOffset: number): Uint8Array {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return header;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
