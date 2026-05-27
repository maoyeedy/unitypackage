/// <reference lib="webworker" />

import { isUnityYamlBinary, parseUnityPackageEntries } from 'unitypackage-core';
import { entriesToRecords } from './packageModel';
import type { ParsePackageRequest, ParsePackageResponse } from './workerTypes';

self.onmessage = ({ data }: MessageEvent<ParsePackageRequest>) => {
  try {
    const bytes = new Uint8Array(data.buffer);
    const options = data.maxOutputBytes !== undefined ? { maxOutputBytes: data.maxOutputBytes } : undefined;

    const { entries } = parseUnityPackageEntries(bytes, options);

    const { records, contents } = entriesToRecords(entries);
    for (const record of records) {
      if (record.extension !== 'asset') continue;
      if (record.previewKind !== 'text') continue;

      const bytes = contents[record.id];
      if (bytes && isUnityYamlBinary(bytes)) {
        record.previewKind = 'unsupported';
      }
    }

    const transferSet = new Set<ArrayBuffer>();
    for (const bytes of Object.values(contents)) {
      if (bytes.buffer instanceof ArrayBuffer) {
        transferSet.add(bytes.buffer);
      }
    }
    self.postMessage(
      { type: 'success', records, contents } satisfies ParsePackageResponse,
      [...transferSet],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse package';
    self.postMessage({ type: 'error', message } satisfies ParsePackageResponse);
  }
};
