/// <reference lib="webworker" />

import { parseUnityPackageEntries } from 'unitypackage-core';
import { entriesToRecords } from './packageModel';
import type { ParsePackageRequest, ParsePackageResponse } from './workerTypes';

self.onmessage = ({ data }: MessageEvent<ParsePackageRequest>) => {
  try {
    const bytes = new Uint8Array(data.buffer);
    const options = data.maxOutputBytes !== undefined ? { maxOutputBytes: data.maxOutputBytes } : undefined;

    const { entries } = parseUnityPackageEntries(bytes, options);

    const records = entriesToRecords(entries);
    const transfer: ArrayBuffer[] = [];
    for (const record of records) {
      const buffer = record.content.buffer;
      if (buffer instanceof ArrayBuffer && !transfer.includes(buffer)) {
        transfer.push(buffer);
      }
    }
    self.postMessage(
      { type: 'success', records } satisfies ParsePackageResponse,
      transfer,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse package';
    self.postMessage({ type: 'error', message } satisfies ParsePackageResponse);
  }
};
