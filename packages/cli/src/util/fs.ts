import { mkdir, readFile, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function safeGetStats(filePath: string): Promise<Stats | null> {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}
