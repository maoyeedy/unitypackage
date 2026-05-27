import { useCallback, useState } from 'react';
import type { PackageFileRecord, SidecarSelectableRecord } from '../packageModel';
import { resolveAllZipRecordIds, resolveSelectedZipRecordIds } from '../packageModel';
import type { DownloadZipRequest, DownloadZipResponse } from '../workerTypes';
import { buildZipPayload } from '../zipPath';

function createDownloadZipInWorker(
  records: PackageFileRecord[],
  maintainStructure: boolean,
  recordIds: string[],
  getContent: (id: string) => Uint8Array<ArrayBuffer> | undefined,
): Promise<Uint8Array | null> {
  const { files, transfer } = buildZipPayload({ records, recordIds, maintainStructure, getContent });
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../downloadZip.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<DownloadZipResponse>) => {
      worker.terminate();
      if (data.type === 'success') resolve(data.data);
      else if (data.type === 'empty') resolve(null);
      else reject(new Error(data.message));
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message)); };
    worker.onmessageerror = () => { worker.terminate(); reject(new Error('Failed to receive ZIP data')); };
    worker.postMessage({ files, maintainStructure } satisfies DownloadZipRequest, transfer);
  });
}


export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function useZipDownload(params: {
  records: PackageFileRecord[];
  sidecarSelectableRecords: SidecarSelectableRecord[];
  selectedRecordIds: Set<string>;
  getContent: (id: string) => Uint8Array<ArrayBuffer> | undefined;
  completeOp: (label: string) => void;
  setError: (message: string | null) => void;
  setCurrentOp: (op: string | null) => void;
}): {
  maintainStructure: boolean;
  setMaintainStructure: React.Dispatch<React.SetStateAction<boolean>>;
  includeMetaSidecarsInZip: boolean;
  setIncludeMetaSidecarsInZip: React.Dispatch<React.SetStateAction<boolean>>;
  getSelectedZipIds: () => string[];
  getAllZipIds: () => string[];
  downloadZip: (recordIds: string[], fileName: string) => Promise<void>;
} {
  const {
    records,
    sidecarSelectableRecords,
    selectedRecordIds,
    getContent,
    completeOp,
    setError,
    setCurrentOp,
  } = params;

  const [maintainStructure, setMaintainStructure] = useState(true);
  const [includeMetaSidecarsInZip, setIncludeMetaSidecarsInZip] = useState(true);

  const getSelectedZipIds = useCallback(() => {
    return resolveSelectedZipRecordIds(
      sidecarSelectableRecords,
      [...selectedRecordIds],
      includeMetaSidecarsInZip,
    );
  }, [includeMetaSidecarsInZip, selectedRecordIds, sidecarSelectableRecords]);

  const getAllZipIds = useCallback(() => {
    return resolveAllZipRecordIds(sidecarSelectableRecords, includeMetaSidecarsInZip);
  }, [includeMetaSidecarsInZip, sidecarSelectableRecords]);

  const downloadZip = useCallback(async (recordIds: string[], fileName: string) => {
    setError(null);
    setCurrentOp('Creating ZIP');
    try {
      const data = await createDownloadZipInWorker(records, maintainStructure, recordIds, getContent);
      if (!data) {
        setCurrentOp(null);
        setError('No files to download.');
        return;
      }

      downloadBlob(new Blob([new Uint8Array(data)], { type: 'application/zip' }), fileName);
      completeOp(`ZIP downloaded: ${fileName}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to create ZIP file';
      setError(message);
      setCurrentOp(null);
    }
  }, [records, maintainStructure, getContent, completeOp, setError, setCurrentOp]);

  return {
    maintainStructure,
    setMaintainStructure,
    includeMetaSidecarsInZip,
    setIncludeMetaSidecarsInZip,
    getSelectedZipIds,
    getAllZipIds,
    downloadZip,
  };
}
