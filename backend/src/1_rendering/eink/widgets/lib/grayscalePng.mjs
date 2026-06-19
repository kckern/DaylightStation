/**
 * Minimal 8-bit grayscale PNG encoder (no dependencies)
 * @module 1_rendering/eink/widgets/lib/grayscalePng
 *
 * node-canvas only emits RGBA PNGs (its `palette`/indexed option is a no-op in the
 * build we ship — verified), and the e-ink panel is a 16-level MONOCHROME display —
 * shipping three colour channels is wasted bytes over the panel's Wi-Fi link (a
 * battery cost) and the device luma-reduces them anyway. This encoder writes a
 * PNG/colortype-0 (grayscale, 8 bit) image straight from one gray byte per pixel,
 * so /panel ships a ~3x smaller file already in the panel's own colour space.
 * Paired with greyscale.canvasToGray8 (a SMOOTH luma reduction — we do NOT dither
 * server-side, as that bloats the download), the panel firmware dithers the result
 * to its 16 tones exactly as before — no reflash.
 *
 * Uses only Node's built-in zlib (IDAT deflate); the PNG chunk framing comes from
 * the shared pngFraming helper — together that avoids pulling in a PNG library for
 * this narrow output path.
 */

import zlib from 'node:zlib';
import { chunk, PNG_SIGNATURE } from './pngFraming.mjs';

/**
 * Encode an 8-bit grayscale PNG from one gray byte per pixel (row-major).
 * @param {Uint8Array} gray - length width*height, each 0..255
 * @param {number} width
 * @param {number} height
 * @returns {Buffer} PNG bytes
 */
export function encodeGray8Png(gray, width, height) {
  if (!gray || gray.length !== width * height) {
    throw new Error(`encodeGray8Png: gray length ${gray?.length} != ${width}x${height}`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 0;    // colour type 0 = grayscale
  ihdr[10] = 0;   // compression: deflate
  ihdr[11] = 0;   // filter: adaptive (we use "none" per scanline)
  ihdr[12] = 0;   // interlace: none

  // Each scanline is prefixed with a filter-type byte (0 = none). One byte/pixel.
  const raw = Buffer.allocUnsafe((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (width + 1);
    raw[o] = 0;                                           // filter: none
    raw.set(gray.subarray(y * width, y * width + width), o + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export default encodeGray8Png;
