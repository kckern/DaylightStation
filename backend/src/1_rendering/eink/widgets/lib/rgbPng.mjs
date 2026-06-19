/**
 * Minimal 24-bit RGB PNG encoder (colour-type 2, no dependencies)
 * @module 1_rendering/eink/widgets/lib/rgbPng
 *
 * For the colour e-ink panel (Seeed E1004, Spectra-6). node-canvas only emits RGBA
 * PNGs (colour-type 6), but the panel firmware's PNG decoder hands its draw callback
 * RGB and explicitly IGNORES the alpha byte (`d[0..2] = rgba[0..2]; // alpha ignored`),
 * then runs its own 6-colour Floyd-Steinberg dither on the RGB. So the alpha plane we
 * ship is pure waste over the panel's battery Wi-Fi link. This encoder drops it,
 * writing a colour-type-2 (8-bit RGB) PNG straight from the canvas pixels.
 *
 * Crucially we do NOT quantise to the 6 panel colours server-side — that is the colour
 * equivalent of dithering server-side (see greyscale.mjs): it would starve the
 * firmware's error-diffusion dither of real gradients and look worse. We ship the
 * SMOOTH RGB image and let the panel dither it, exactly as the firmware expects.
 *
 * Adaptive per-scanline filtering (the PNG None/Sub/Up/Average/Paeth predictors,
 * chosen per row by the standard minimum-sum-of-absolute-values heuristic) is what
 * makes this pay: on a continuous-tone photo it beats canvas's default RGBA output by
 * ~13% AND drops the alpha plane, while staying losslessly smooth. Measured at the
 * E1004's 1200x1600: ~1.44MB RGBA -> ~1.2MB. Encode cost (~1.6s) is irrelevant at the
 * panel's 6-hour refresh cadence.
 *
 * Uses only Node's built-in zlib (IDAT deflate); chunk framing from pngFraming.
 */

import zlib from 'node:zlib';
import { chunk, PNG_SIGNATURE } from './pngFraming.mjs';

/** Paeth predictor (PNG spec): pick a/b/c closest to the gradient p = a + b - c. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Encode an 8-bit RGB (colour-type 2) PNG from canvas RGBA pixels, dropping alpha.
 * @param {Uint8ClampedArray|Uint8Array} rgba - canvas getImageData bytes, length width*height*4
 * @param {number} width
 * @param {number} height
 * @returns {Buffer} PNG bytes
 */
export function encodeRgb8Png(rgba, width, height) {
  if (!rgba || rgba.length !== width * height * 4) {
    throw new Error(`encodeRgb8Png: rgba length ${rgba?.length} != ${width}x${height}x4`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // colour type 2 = truecolour RGB (no alpha)
  ihdr[10] = 0;   // compression: deflate
  ihdr[11] = 0;   // filter method 0 (the adaptive predictor set, selected per row)
  ihdr[12] = 0;   // interlace: none

  const bpp = 3;                 // bytes per pixel in the FILTERED stream (RGB)
  const stride = width * bpp;
  const cur = Buffer.allocUnsafe(stride);     // current scanline, raw RGB
  const prev = Buffer.alloc(stride);          // previous scanline, raw RGB (zeros for row 0)
  const out = Buffer.allocUnsafe((stride + 1) * height);
  // One reusable buffer per filter type (0..4) so we can score then keep the best.
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.allocUnsafe(stride));
  let op = 0;

  for (let y = 0; y < height; y++) {
    // Pack this row's RGB (drop the alpha byte) from the RGBA source.
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4; const d = x * 3;
      cur[d] = rgba[s]; cur[d + 1] = rgba[s + 1]; cur[d + 2] = rgba[s + 2];
    }
    // Build all five filtered candidates for the row.
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;          // left
      const b = prev[i];                              // up
      const c = i >= bpp ? prev[i - bpp] : 0;         // up-left
      const x = cur[i];
      cand[0][i] = x;                                 // None
      cand[1][i] = (x - a) & 0xff;                    // Sub
      cand[2][i] = (x - b) & 0xff;                    // Up
      cand[3][i] = (x - ((a + b) >> 1)) & 0xff;       // Average
      cand[4][i] = (x - paeth(a, b, c)) & 0xff;       // Paeth
    }
    // Pick the filter with the smallest sum of absolute (signed) residuals — the
    // standard heuristic for which row will deflate smallest.
    let best = 0; let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const cf = cand[f]; let sum = 0;
      for (let i = 0; i < stride; i++) { const v = cf[i]; sum += v < 128 ? v : 256 - v; }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    out[op++] = best;
    cand[best].copy(out, op); op += stride;
    // This row becomes the predictor base for the next.
    cur.copy(prev);
  }

  const idat = zlib.deflateSync(out.subarray(0, op), { level: 9 });
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export default encodeRgb8Png;
