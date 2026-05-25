/// <reference lib="webworker" />

import { parseUnityPackageEntries } from 'unitypackage-core';
import { entriesToRecords } from './packageModel';
import type { ParsePackageResponse } from './workerTypes';

interface ParsePackageRequest {
  buffer: ArrayBuffer;
}

self.onmessage = ({ data }: MessageEvent<ParsePackageRequest>) => {
  try {
    const entries = parseUnityPackageEntries(new Uint8Array(data.buffer));
    const records = entriesToRecords(entries, entries.diagnostics);
    self.postMessage({ type: 'success', records, diagnostics: entries.diagnostics } satisfies ParsePackageResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse package';
    self.postMessage({ type: 'error', message } satisfies ParsePackageResponse);
  }
};
