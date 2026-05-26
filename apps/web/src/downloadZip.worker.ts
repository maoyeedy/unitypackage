/// <reference lib="webworker" />

import { zip } from 'fflate';
import type { DownloadZipRequest, DownloadZipResponse } from './workerTypes';

const postResponse = (response: DownloadZipResponse, transfer?: Transferable[]) => {
  self.postMessage(response, { transfer });
};

self.onmessage = ({ data }: MessageEvent<DownloadZipRequest>) => {
  const filesToZip: Record<string, Uint8Array> = {};

  for (const [path, content] of Object.entries(data.files)) {
    if (data.excludeMeta && path.endsWith('.meta')) continue;
    const filePath = data.maintainStructure ? path : path.split('/').pop() ?? path;
    filesToZip[filePath] = content;
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
