import { readFile } from 'node:fs/promises';
import {
  parseUnityPackageEntries,
  type ParseUnityPackageOptions,
} from 'unitypackage-core';
import { CliError, EXIT } from './exit.js';

export async function readPackageBytes(packagePath: string): Promise<Uint8Array> {
  try {
    return await readFile(packagePath);
  } catch {
    throw new CliError(`Cannot read file: ${packagePath}`, EXIT.IO);
  }
}

export function parsePackageBytes(
  bytes: Uint8Array,
  options?: ParseUnityPackageOptions,
): ReturnType<typeof parseUnityPackageEntries> {
  return parseUnityPackageEntries(bytes, options);
}
