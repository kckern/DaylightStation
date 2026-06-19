/**
 * Greyscale conversion for the 16-tone e-ink panel
 * @module 1_rendering/eink/widgets/lib/greyscale
 *
 * The Seeed E1003 is a MONOCHROME, 16-level grayscale panel (IT8951 Gray16). Its
 * firmware Floyd-Steinberg-dithers whatever image it receives down to those tones.
 *
 * We deliberately do NOT dither server-side. Dithering injects high-frequency
 * noise that PNG/deflate cannot compress, which BLOATS the download (a dithered
 * photo is several times larger than the smooth original) and would only pay off
 * if the firmware were reflashed to skip its own dither. Measured: shipping the
 * SMOOTH luma image as an 8-bit grayscale PNG is ~3x smaller than the RGBA PNG and
 * needs no reflash — the device keeps doing the dither it already does well. (For
 * a colour-type-0 PNG, pngle hands the firmware R=G=B, so its luma-reduce is an
 * exact pass-through.) So this module only does the colour→luma reduction; the
 * panel owns the dither.
 */

/**
 * Reduce the whole canvas to one 8-bit luma byte per pixel (Rec. 601), row-major.
 * No dithering — a smooth grayscale the panel firmware then dithers itself. Pairs
 * with grayscalePng.encodeGray8Png to emit a compact colour-type-0 PNG.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array} length width*height, each 0..255
 */
export function canvasToGray8(ctx, width, height) {
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
    // Rec. 601 luma; round so a mid grey lands on a hardware tone cleanly.
    gray[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return gray;
}
