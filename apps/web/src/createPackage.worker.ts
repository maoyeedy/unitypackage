/// <reference lib="webworker" />

import { tryCreateUnityPackage, type CreateUnityPackageEntry, type CreateUnityPackageOptions } from 'unitypackage-core';
import type { CreatePackageRequest, CreatePackageResponse } from './workerTypes';

const postResponse = (response: CreatePackageResponse, transfer?: Transferable[]) => {
  self.postMessage(response, { transfer });
};

self.onmessage = ({ data }: MessageEvent<CreatePackageRequest>) => {
  try {
    const { stagedRecords, allRecords = [], gzipLevel = 6, filename = 'export.unitypackage' } = data;

    const stagedAssets = stagedRecords.filter(
      record => !record.isUnityPreview && record.extension !== 'meta'
    );

    const entries: CreateUnityPackageEntry[] = stagedAssets.map(assetRecord => {
      let metaBytes = assetRecord.meta;
      if (!metaBytes) {
        const metaRecord = stagedRecords.find(
          r => r.guid === assetRecord.guid && r.extension === 'meta'
        ) ?? allRecords.find(
          r => r.guid === assetRecord.guid && r.extension === 'meta'
        );
        if (metaRecord) {
          metaBytes = metaRecord.content;
        }
      }

      return {
        guid: assetRecord.guid,
        pathname: assetRecord.pathname,
        meta: metaBytes ?? new Uint8Array(),
        asset: assetRecord.hasAsset ? assetRecord.content : undefined,
      };
    });

    const result = tryCreateUnityPackage(entries, { gzipLevel: gzipLevel as CreateUnityPackageOptions['gzipLevel'] });
    if (result.bytes) {
      postResponse(
        {
          type: 'success',
          bytes: result.bytes,
          filename,
        },
        [result.bytes.buffer]
      );
    } else {
      postResponse({
        type: 'error',
        diagnostics: result.diagnostics,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      diagnostics: [
        {
          code: 'empty-entries',
          message: msg,
          severity: 'error',
        },
      ],
    });
  }
};
