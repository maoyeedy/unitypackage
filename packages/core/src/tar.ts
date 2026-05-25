export const BLOCK_SIZE = 512;
export const textDecoder = new TextDecoder();
export const textEncoder = new TextEncoder();

export function createTarEntry(name: string, content: Uint8Array): Uint8Array {
  const header = new Uint8Array(BLOCK_SIZE);
  const nameBytes = textEncoder.encode(name);

  if (nameBytes.length > 100) {
    throw new Error(`Tar entry name is too long: ${name}`);
  }

  header.set(nameBytes, 0);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, content.length);
  writeOctal(header, 136, 12, 0);

  for (let i = 148; i < 156; i += 1) {
    header[i] = 0x20;
  }

  header[156] = 0x30;
  header.set(textEncoder.encode('ustar\0'), 257);
  header.set(textEncoder.encode('00'), 263);

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumString = checksum.toString(8).padStart(6, '0') + '\0 ';
  header.set(textEncoder.encode(checksumString), 148);

  const paddedSize = Math.ceil(content.length / BLOCK_SIZE) * BLOCK_SIZE;
  const entry = new Uint8Array(BLOCK_SIZE + paddedSize);
  entry.set(header, 0);
  entry.set(content, BLOCK_SIZE);
  return entry;
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  const valueString = value.toString(8).padStart(length - 1, '0') + '\0';
  target.set(textEncoder.encode(valueString), offset);
}

export function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}
