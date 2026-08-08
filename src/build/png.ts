// A minimal, dependency-free PNG encoder (Task 5.1, TECH_SPEC.md §7: "No image files —
// app icons... generated at build time"). `canvas`/node-canvas isn't in TECH_SPEC.md §2's
// devDependency list ("dependencies must be empty. Everything at runtime is first-party
// code... Write what you need") — this is exactly that: raw RGBA pixels in, PNG bytes out,
// using only `node:zlib` (Node's own standard library, not a package) for the DEFLATE
// compression the PNG format itself requires.

import { deflateSync } from 'node:zlib';

/** Standard PNG CRC-32, per the PNG spec (ISO/IEC 15948) Annex D — the same polynomial
 *  every PNG chunk's trailing checksum uses. Computed once at module load. */
const CRC_TABLE: readonly number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const lengthBytes = Buffer.alloc(4);
  lengthBytes.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBytes = Buffer.alloc(4);
  crcBytes.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lengthBytes, typeBytes, data, crcBytes]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Encodes a flat RGBA pixel buffer (`width * height * 4` bytes, row-major, no padding) as
 * a PNG file's bytes — 8-bit depth, colour type 6 (truecolour with alpha), filter type 0
 * (`None`) on every scanline, compressed with zlib's default settings. Simple, not
 * space-optimal (a real encoder would try per-line filter heuristics) — irrelevant here:
 * these are small, flat-colour icon images generated once at build time, not shipped as
 * runtime assets.
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePng: expected ${width * height * 4} bytes, got ${rgba.length}`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // colour type: truecolour + alpha
  ihdr.writeUInt8(0, 10); // compression method
  ihdr.writeUInt8(0, 11); // filter method
  ihdr.writeUInt8(0, 12); // interlace method

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const srcStart = y * stride;
    const dstStart = y * (stride + 1);
    raw[dstStart] = 0; // filter type None for every scanline
    Buffer.from(rgba.buffer, rgba.byteOffset + srcStart, stride).copy(raw, dstStart + 1);
  }
  const idatData = deflateSync(raw);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
