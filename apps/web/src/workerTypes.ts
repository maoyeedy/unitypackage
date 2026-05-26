import type { ExtractedFileContent, UnityPackageParseDiagnostic } from 'unitypackage-core';

export type ParsePackageResponse =
  | { type: 'success'; files: ExtractedFileContent; diagnostics: UnityPackageParseDiagnostic[] }
  | { type: 'error'; message: string };

export interface DownloadZipRequest {
  files: ExtractedFileContent;
  excludeMeta: boolean;
  maintainStructure: boolean;
}

export type DownloadZipResponse =
  | { type: 'success'; data: Uint8Array }
  | { type: 'empty' }
  | { type: 'error'; message: string };
