import { readFile } from 'node:fs/promises';
import { CliError, EXIT } from './exit.js';

export async function readPackageBytes(packagePath: string): Promise<Uint8Array> {
  try {
    return await readFile(packagePath);
  } catch {
    throw new CliError(`Cannot read file: ${packagePath}`, EXIT.IO);
  }
}
