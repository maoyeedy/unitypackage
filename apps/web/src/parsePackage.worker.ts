/// <reference lib="webworker" />

import { parseUnityPackageEntries } from 'unitypackage-core';
import type { ExtractedFileContent, UnityPackageEntry } from 'unitypackage-core';
import type { ParsePackageResponse } from './workerTypes';

interface ParsePackageRequest {
  buffer: ArrayBuffer;
}

const entriesToFiles = (entries: UnityPackageEntry[]): ExtractedFileContent => {
  const result: ExtractedFileContent = {};

  for (const entry of entries) {
    if (entry.asset) {
      result[entry.pathname] = entry.asset;
    }

    if (entry.meta) {
      result[`${entry.pathname}.meta`] = entry.meta;
    }
  }

  return result;
};

self.onmessage = ({ data }: MessageEvent<ParsePackageRequest>) => {
  try {
    const entries = parseUnityPackageEntries(new Uint8Array(data.buffer));
    const files = entriesToFiles(entries);
    self.postMessage({ type: 'success', files, diagnostics: entries.diagnostics } satisfies ParsePackageResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse package';
    self.postMessage({ type: 'error', message } satisfies ParsePackageResponse);
  }
};
