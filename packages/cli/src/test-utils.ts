import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach } from 'vitest';
import { createUnityPackage } from 'unitypackage-core';

export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

const tempDirs: string[] = [];

export async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'unitypackage-tools-test-'));
  tempDirs.push(dir);
  return dir;
}

export function buildSingleScriptPackage(): Uint8Array {
  return createUnityPackage([
    {
      guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pathname: 'Assets/Scripts/MyScript.cs',
      asset: encoder.encode('public class MyScript {}'),
      meta: encoder.encode('fileFormatVersion: 2\nguid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'),
    },
  ]);
}

export function buildRawTarPackage(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries = Object.entries(files).map(([name, content]) =>
    createTarEntry(name, typeof content === 'string' ? encoder.encode(content) : content),
  );
  const tar = new Uint8Array(entries.reduce((sum, entry) => sum + entry.length, 0) + 1024);
  let offset = 0;
  for (const entry of entries) {
    tar.set(entry, offset);
    offset += entry.length;
  }
  return gzipSync(tar);
}

export function buildMalformedTarPackage(): Uint8Array {
  const header = new Uint8Array(1536);
  header.set(encoder.encode('bad/pathname'), 0);
  header.set(encoder.encode('invalid'), 124);
  return gzipSync(header);
}

export function createTarEntry(name: string, content: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  header.set(encoder.encode(name), 0);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, content.length);
  writeOctal(header, 136, 12, 0);
  for (let i = 148; i < 156; i += 1) header[i] = 0x20;
  header[156] = 0x30;
  header.set(encoder.encode('ustar\0'), 257);
  header.set(encoder.encode('00'), 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.set(encoder.encode(checksum.toString(8).padStart(6, '0') + '\0 '), 148);

  const entry = new Uint8Array(512 + Math.ceil(content.length / 512) * 512);
  entry.set(header, 0);
  entry.set(content, 512);
  return entry;
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  target.set(encoder.encode(value.toString(8).padStart(length - 1, '0') + '\0'), offset);
}

export function buildScriptAndTexturePackage(): Uint8Array {
  return createUnityPackage([
    {
      guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pathname: 'Assets/Scripts/MyScript.cs',
      asset: encoder.encode('public class MyScript {}'),
      meta: encoder.encode('fileFormatVersion: 2\nguid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'),
    },
    {
      guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      pathname: 'Assets/Textures/Icon.png',
      asset: encoder.encode('png'),
      meta: encoder.encode('fileFormatVersion: 2\nguid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'),
    },
  ]);
}

export function buildManyTextAssetsPackage(entryCount: number): Uint8Array {
  return createUnityPackage(
    Array.from({ length: entryCount }, (_, index) => {
      const guid = index.toString(16).padStart(32, '0');
      return {
        guid,
        pathname: `Assets/Large/File${index}.txt`,
        asset: encoder.encode(`file ${index}`),
        meta: encoder.encode(`fileFormatVersion: 2\nguid: ${guid}\n`),
      };
    }),
  );
}

afterEach(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});
