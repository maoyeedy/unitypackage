import { createUnityPackage } from 'unitypackage-core';
import { gzipSync } from 'fflate';

const enc = new TextEncoder();

function metaBytes(guid: string): Uint8Array {
  return enc.encode(`fileFormatVersion: 2\nguid: ${guid}\n`);
}

export function buildMinimal(): Uint8Array {
  return createUnityPackage([
    {
      guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
      pathname: 'Assets/Minimal.cs',
      meta: metaBytes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'),
      asset: enc.encode('// minimal\n'),
    },
  ]);
}

export function buildNested(): Uint8Array {
  return createUnityPackage([
    {
      guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb01',
      pathname: 'Assets/Level1/Level2/Level3/Deep.cs',
      meta: metaBytes('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb01'),
      asset: enc.encode('// deep\n'),
    },
    {
      guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb02',
      pathname: 'Assets/Level1/Level2/Mid.txt',
      meta: metaBytes('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb02'),
      asset: enc.encode('mid\n'),
    },
    {
      guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb03',
      pathname: 'Assets/Level1/Top.prefab',
      meta: metaBytes('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb03'),
      asset: enc.encode('%YAML 1.1\n'),
    },
  ]);
}

export function buildBinary(): Uint8Array {
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return createUnityPackage([
    {
      guid: 'cccccccccccccccccccccccccccccc01',
      pathname: 'Assets/Textures/pixel.png',
      meta: metaBytes('cccccccccccccccccccccccccccccc01'),
      asset: pngBytes,
    },
  ]);
}

export function buildTraversal(): Uint8Array {
  return createUnityPackage([
    {
      guid: 'dddddddddddddddddddddddddddddd01',
      pathname: '../../etc/passwd',
      meta: metaBytes('dddddddddddddddddddddddddddddd01'),
      asset: enc.encode('root:x:0:0:\n'),
    },
  ]);
}

export function buildDuplicateGuid(): Uint8Array {
  const guid = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeee01';
  const tar = buildRawTar([
    { name: `${guid}/pathname`, content: enc.encode('Assets/FileA.cs') },
    { name: `${guid}/asset.meta`, content: metaBytes(guid) },
    { name: `${guid}/asset`, content: enc.encode('// A\n') },
    { name: `${guid}/pathname`, content: enc.encode('Assets/FileB.cs') },
    { name: `${guid}/asset.meta`, content: metaBytes(guid) },
    { name: `${guid}/asset`, content: enc.encode('// B\n') },
  ]);
  return gzipSync(tar);
}

export function buildLegacyMetaData(): Uint8Array {
  const guid = 'ffffffffffffffffffffffffffffff01';
  const tar = buildRawTar([
    { name: `${guid}/pathname`, content: enc.encode('Assets/Legacy.cs') },
    { name: `${guid}/metaData`, content: metaBytes(guid) },
    { name: `${guid}/asset`, content: enc.encode('// legacy\n') },
  ]);
  return gzipSync(tar);
}

export function buildTruncated(): Uint8Array {
  const full = buildMinimal();
  return full.slice(0, Math.floor(full.length * 0.8));
}

const BLOCK_SIZE = 512;

function buildRawTar(entries: Array<{ name: string; content: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const { name, content } of entries) {
    const header = new Uint8Array(BLOCK_SIZE);
    const nameBytes = enc.encode(name);
    header.set(nameBytes.slice(0, 100), 0);
    tarWriteOctal(header, 100, 8, 0o644);
    tarWriteOctal(header, 108, 8, 0);
    tarWriteOctal(header, 116, 8, 0);
    tarWriteOctal(header, 124, 12, content.length);
    tarWriteOctal(header, 136, 12, 0);
    for (let i = 148; i < 156; i++) header[i] = 0x20;
    header[156] = 0x30;
    header.set(enc.encode('ustar\0'), 257);
    header.set(enc.encode('00'), 263);
    const checksum = header.reduce((s, b) => s + b, 0);
    header.set(enc.encode(checksum.toString(8).padStart(6, '0') + '\0 '), 148);
    const padded = Math.ceil(content.length / BLOCK_SIZE) * BLOCK_SIZE;
    const entry = new Uint8Array(BLOCK_SIZE + padded);
    entry.set(header, 0);
    entry.set(content, BLOCK_SIZE);
    parts.push(entry);
  }
  parts.push(new Uint8Array(BLOCK_SIZE * 2));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { result.set(p, offset); offset += p.length; }
  return result;
}

function tarWriteOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  target.set(enc.encode(value.toString(8).padStart(length - 1, '0') + '\0'), offset);
}
