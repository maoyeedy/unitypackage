import type { UnityPackageAnalysisFinding, UnityPackageParseDiagnostic } from 'unitypackage-core';
import type { PackageFileRecord } from './packageModel';

export type { UnityPackageAnalysisFinding };

export interface ParsePackageRequest {
  buffer: ArrayBuffer;
  maxOutputBytes?: number;
}

export type ParsePackageResponse =
  | { type: 'success'; records: PackageFileRecord[]; diagnostics: UnityPackageParseDiagnostic[]; analysis: UnityPackageAnalysisFinding[] }
  | { type: 'error'; message: string };

export interface DownloadZipRequest {
  records: PackageFileRecord[];
  recordIds?: string[];
  maintainStructure: boolean;
}

export type DownloadZipResponse =
  | { type: 'success'; data: Uint8Array }
  | { type: 'empty' }
  | { type: 'error'; message: string };

