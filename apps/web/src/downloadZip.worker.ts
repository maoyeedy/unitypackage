/// <reference lib="webworker" />

import { zip } from 'fflate';
import type { DownloadZipRequest, DownloadZipResponse } from './workerTypes';

const postResponse = (response: DownloadZipResponse, transfer?: Transferable[]) => {
  self.postMessage(response, { transfer });
};

self.onmessage = ({ data }: MessageEvent<DownloadZipRequest>) => {
  const filesToZip: Record<string, Uint8Array> = {};
  const ids = data.recordIds ? new Set(data.recordIds) : null;

  for (const record of data.records) {
    if (ids && !ids.has(record.id)) continue;
    const filePath = data.maintainStructure ? record.virtualPath : record.fileName;
    filesToZip[filePath] = record.content;
  }

  if (Object.keys(filesToZip).length === 0) {
    postResponse({ type: 'empty' });
    return;
  }

  zip(filesToZip, (err, zippedData) => {
    if (err) {
      postResponse({ type: 'error', message: err.message });
      return;
    }

    postResponse({ type: 'success', data: zippedData }, [zippedData.buffer]);
  });
};
