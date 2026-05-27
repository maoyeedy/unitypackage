import { useCallback, useEffect, useRef, useState } from 'react';
import type { PackageFileRecord } from '../packageModel';
import type { ParsePackageResponse } from '../workerTypes';

interface ParseResult {
  records: PackageFileRecord[];
  contents: Record<string, Uint8Array<ArrayBuffer>>;
}

function parsePackageInWorker(buffer: ArrayBuffer): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../parsePackage.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = ({ data }: MessageEvent<ParsePackageResponse>) => {
      worker.terminate();
      if (data.type === 'success') {
        resolve({ records: data.records, contents: data.contents });
        return;
      }

      reject(new Error(data.message));
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };

    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error('Failed to receive parsed package data'));
    };

    worker.postMessage({ buffer }, [buffer]);
  });
}

export function usePackageLoader(options?: {
  onReset?: () => void;
  onLoad?: (records: PackageFileRecord[]) => void;
}): {
  records: PackageFileRecord[];
  getContent: (id: string) => Uint8Array<ArrayBuffer> | undefined;
  packageName: string | null;
  status: { currentOp: string | null; lastCompleted: string | null; error: string | null; isLoading: boolean };
  handlePackageFile: (file: File) => Promise<void>;
  completeOp: (label: string) => void;
  setError: (message: string | null) => void;
  setCurrentOp: (op: string | null) => void;
} {
  const [records, setRecords] = useState<PackageFileRecord[]>([]);
  const contentStoreRef = useRef<Map<string, Uint8Array<ArrayBuffer>>>(new Map());
  const [packageName, setPackageName] = useState<string | null>(null);
  const [currentOp, setCurrentOp] = useState<string | null>(null);
  const [lastCompleted, setLastCompleted] = useState<string | null>(null);
  const lastCompletedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const getContent = useCallback((recordId: string): Uint8Array<ArrayBuffer> | undefined => {
    return contentStoreRef.current.get(recordId);
  }, []);

  const completeOp = useCallback((label: string) => {
    setCurrentOp(null);
    setLastCompleted(label);
    if (lastCompletedTimerRef.current !== null) {
      clearTimeout(lastCompletedTimerRef.current);
    }
    lastCompletedTimerRef.current = setTimeout(() => {
      setLastCompleted(null);
    }, 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (lastCompletedTimerRef.current !== null) {
        clearTimeout(lastCompletedTimerRef.current);
      }
    };
  }, []);

  const handlePackageFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    setPackageName(file.name);
    setCurrentOp(`Parsing ${file.name}`);
    setRecords([]);
    options?.onReset?.();

    try {
      const result = await parsePackageInWorker(await file.arrayBuffer());
      contentStoreRef.current = new Map(Object.entries(result.contents));
      setRecords(result.records);
      options?.onLoad?.(result.records);
      completeOp(`Parsed ${result.records.length.toString()} files from ${file.name}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to parse package';
      setError(message);
      setCurrentOp(null);
    } finally {
      setIsLoading(false);
    }
  }, [options, completeOp]);

  return {
    records,
    getContent,
    packageName,
    status: { currentOp, lastCompleted, error, isLoading },
    handlePackageFile,
    completeOp,
    setError,
    setCurrentOp,
  };
}
