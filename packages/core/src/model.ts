export type ExtractedFileContent = Record<string, Uint8Array>;

export interface UnityPackageEntry {
  guid: string;
  pathname: string;
  asset?: Uint8Array;
  meta?: Uint8Array;
  preview?: Uint8Array;
}

export type UnityPackageDiagnosticSeverity = 'info' | 'warning' | 'error';
