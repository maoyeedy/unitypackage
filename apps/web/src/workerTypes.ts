import type { PackageFileRecord } from './packageModel';

export interface ParsePackageRequest {
  buffer: ArrayBuffer;
  maxOutputBytes?: number;
}

export type ParsePackageResponse =
  | { type: 'success'; records: PackageFileRecord[] }
  | { type: 'error'; message: string };

export interface DownloadZipFileInput {
  path: string;
  content: Uint8Array;
}

export interface DownloadZipRequest {
  files: DownloadZipFileInput[];
  maintainStructure: boolean;
}

export type DownloadZipResponse =
  | { type: 'success'; data: Uint8Array }
  | { type: 'empty' }
  | { type: 'error'; message: string };

