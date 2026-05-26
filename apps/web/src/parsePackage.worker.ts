/// <reference lib="webworker" />

import {
  analyzeUnityPackageEntries,
  parseUnityPackageEntries,
} from 'unitypackage-core';
import { entriesToRecords } from './packageModel';
import type { ParsePackageRequest, ParsePackageResponse } from './workerTypes';

self.onmessage = ({ data }: MessageEvent<ParsePackageRequest>) => {
  try {
    const bytes = new Uint8Array(data.buffer);
    const options = data.maxOutputBytes !== undefined ? { maxOutputBytes: data.maxOutputBytes } : undefined;

    const { entries, diagnostics } = parseUnityPackageEntries(bytes, options);

    const records = entriesToRecords(entries, diagnostics);
    const { findings: analysis } = analyzeUnityPackageEntries(entries, diagnostics);
    self.postMessage({ type: 'success', records, diagnostics, analysis } satisfies ParsePackageResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse package';
    self.postMessage({ type: 'error', message } satisfies ParsePackageResponse);
  }
};
