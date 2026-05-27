/// <reference lib="webworker" />

import { parseUnityPackageEntries } from 'unitypackage-core';
import { entriesToRecords, type PackageFileRecord } from './packageModel';
import type { ParsePackageRequest, ParsePackageResponse } from './workerTypes';

interface WorkerHeavyRecord extends PackageFileRecord {
  content: Uint8Array;
}

self.onmessage = ({ data }: MessageEvent<ParsePackageRequest>) => {
  try {
    const bytes = new Uint8Array(data.buffer);
    const options = data.maxOutputBytes !== undefined ? { maxOutputBytes: data.maxOutputBytes } : undefined;

    const { entries } = parseUnityPackageEntries(bytes, options);

    const records = entriesToRecords(entries) as unknown as WorkerHeavyRecord[];
    const lightRecords: PackageFileRecord[] = [];
    const contents: Record<string, Uint8Array> = {};
    const transfer: ArrayBuffer[] = [];
    for (const record of records) {
      const { content, ...rest } = record;
      lightRecords.push(rest);
      contents[record.id] = content;
      const buffer = content.buffer;
      if (buffer instanceof ArrayBuffer && !transfer.includes(buffer)) {
        transfer.push(buffer);
      }
    }
    self.postMessage(
      { type: 'success', records: lightRecords, contents } satisfies ParsePackageResponse,
      transfer,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse package';
    self.postMessage({ type: 'error', message } satisfies ParsePackageResponse);
  }
};
