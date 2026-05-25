/// <reference lib="webworker" />

import { analyzeUnityPackageEntries, parseUnityPackageEntries } from 'unitypackage-core';
import { entriesToRecords } from './packageModel';
import type { ParsePackageResponse } from './workerTypes';

interface ParsePackageRequest {
  buffer: ArrayBuffer;
}

self.onmessage = ({ data }: MessageEvent<ParsePackageRequest>) => {
  try {
    const { entries, diagnostics } = parseUnityPackageEntries(new Uint8Array(data.buffer));
    const records = entriesToRecords(entries, diagnostics);
    const { findings: analysis } = analyzeUnityPackageEntries(entries, diagnostics);
    self.postMessage({ type: 'success', records, diagnostics, analysis } satisfies ParsePackageResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse package';
    self.postMessage({ type: 'error', message } satisfies ParsePackageResponse);
  }
};
