// ---------------------------------------------------------------------------
// GUID utilities
// ---------------------------------------------------------------------------

const VALID_GUID_LOWERCASE_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Returns true when value is exactly 32 lowercase hexadecimal characters.
 * Unity Editor exports use lowercase 32-hex GUIDs; the parser preserves
 * whatever prefix appears in the archive as `guid`.
 */
export function isValidGuid(value: string): boolean {
  return VALID_GUID_LOWERCASE_PATTERN.test(value);
}

/**
 * Generates a random 32-character lowercase hex GUID using
 * `globalThis.crypto.getRandomValues`. Browser-safe; no `node:crypto` import.
 */
export function generateGuid(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

// ---------------------------------------------------------------------------
// MD5 implementation (browser-safe, no external deps)
// Used by guidFromPath to match the CLI's createGuid algorithm.
// ---------------------------------------------------------------------------

function md5(data: Uint8Array): Uint8Array {
  // Pre-computed sine-derived constants (floor(abs(sin(i+1))) * 2^32)
  const T = new Uint32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ]);

  // Bit shift amounts per round
  const S = new Uint8Array([
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]);

  // Pad message: append 0x80, then zeros, then 64-bit little-endian bit length
  const bitLen = data.length * 8;
  const padLen = ((55 - data.length) % 64 + 64) % 64 + 1;
  const msg = new Uint8Array(data.length + padLen + 8);
  msg.set(data);
  msg[data.length] = 0x80;
  // Write bit length as 64-bit LE (we only support lengths < 2^32 bits)
  const view = new DataView(msg.buffer, msg.byteOffset);
  view.setUint32(data.length + padLen, bitLen >>> 0, true);
  view.setUint32(data.length + padLen + 4, Math.floor(bitLen / 0x100000000), true);

  // Initial hash state
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const msgView = new DataView(msg.buffer, msg.byteOffset);

  for (let i = 0; i < msg.length; i += 64) {
    // Load 16 little-endian uint32 words from this chunk
    const M: number[] = [];
    for (let j = 0; j < 16; j += 1) {
      M.push(msgView.getUint32(i + j * 4, true));
    }

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let step = 0; step < 64; step += 1) {
      let F: number;
      let g: number;

      if (step < 16) {
        F = (B & C) | (~B & D);
        g = step;
      } else if (step < 32) {
        F = (D & B) | (~D & C);
        g = (5 * step + 1) % 16;
      } else if (step < 48) {
        F = B ^ C ^ D;
        g = (3 * step + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * step) % 16;
      }

      // Use >>> 0 to keep values as unsigned 32-bit
      F = ((F + A + T[step] + M[g]) >>> 0);
      const rot = S[step];
      A = D;
      D = C;
      C = B;
      B = ((B + ((F << rot) | (F >>> (32 - rot)))) >>> 0);
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  // Write digest as little-endian bytes
  const digest = new Uint8Array(16);
  const digestView = new DataView(digest.buffer);
  digestView.setUint32(0, a0, true);
  digestView.setUint32(4, b0, true);
  digestView.setUint32(8, c0, true);
  digestView.setUint32(12, d0, true);
  return digest;
}

/**
 * Derives a deterministic 32-character lowercase hex GUID from a pathname
 * using the MD5-of-UTF-16LE algorithm that the CLI's `createGuid` helper uses.
 * Two calls with the same input always produce identical output.
 */
export function guidFromPath(pathname: string): string {
  // Encode as UTF-16LE (little-endian), matching Buffer.from(s, 'utf16le')
  const utf16 = new Uint8Array(pathname.length * 2);
  for (let i = 0; i < pathname.length; i += 1) {
    const code = pathname.charCodeAt(i);
    utf16[i * 2] = code & 0xff;
    utf16[i * 2 + 1] = (code >> 8) & 0xff;
  }
  const digest = md5(utf16);
  let hex = '';
  for (const byte of digest) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}
