/// <reference lib="webworker" />

import {
  analyzeUnityPackageEntries,
  parseUnityPackageEntries,
  parseUnityPackageStreamed,
  DecompressionBombError,
} from 'unitypackage-core';
import { entriesToRecords } from './packageModel';
import type { ParsePackageRequest, ParsePackageResponse } from './workerTypes';

self.onmessage = ({ data }: MessageEvent<ParsePackageRequest>) => {
  try {
    const bytes = new Uint8Array(data.buffer);
    const options = data.maxOutputBytes !== undefined ? { maxOutputBytes: data.maxOutputBytes } : undefined;

    let entries;
    let diagnostics;

    try {
      // Primary streaming path to enforce maxOutputBytes during decompression
      const result = parseUnityPackageStreamed(bytes, options);
      entries = result.entries;
      diagnostics = result.diagnostics;
    } catch (streamError) {
      // Fallback path to parseUnityPackageEntries if needed for compatibility during rollout.
      // If it's a DecompressionBombError, bubble it up directly.
      if (streamError instanceof DecompressionBombError || (streamError instanceof Error && streamError.name === 'DecompressionBombError')) {
        throw streamError;
      }
      const result = parseUnityPackageEntries(bytes, options);
      entries = result.entries;
      diagnostics = result.diagnostics;
    }

    const records = entriesToRecords(entries, diagnostics);
    const { findings: analysis } = analyzeUnityPackageEntries(entries, diagnostics);
    self.postMessage({ type: 'success', records, diagnostics, analysis } satisfies ParsePackageResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse package';
    self.postMessage({ type: 'error', message } satisfies ParsePackageResponse);
  }
};

