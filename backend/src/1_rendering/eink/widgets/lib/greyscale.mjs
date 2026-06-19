/**
 * Greyscale conversion for the 16-tone e-ink panel
 * @module 1_rendering/eink/widgets/lib/greyscale
 *
 * The Seeed E1003 is a MONOCHROME, 16-level grayscale panel (IT8951 Gray16: the
 * hardware tones are 0x00, 0x11, 0x22 … 0xFF — 16 evenly-spaced levels). Its
 * firmware Floyd-Steinberg-dithers whatever PNG it receives down to those tones.
 * By dithering to EXACTLY those 16 levels here, server-side, the device's own
 * dither becomes a clean pass-through (the values already sit on its levels)
 * rather than a second, noisier re-dither — and a colour photo becomes a faithful
 * grayscale rendition that "uses all 16 tones".
 */

const LEVELS = 16;

/**
 * Floyd-Steinberg dither a rectangular region of the canvas to 16 grey levels,
 * in place. Operates on luma (Rec. 601) so a colour image is desaturated as it
 * is quantized.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x:number, y:number, w:number, h:number }} box
 */
export function ditherTo16Gray(ctx, box) {
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const w = Math.round(box.w);
  const h = Math.round(box.h);
  if (w <= 0 || h <= 0) return;

  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;

  // Pull luma into a float buffer so error diffusion has sub-byte headroom.
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    lum[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }

  const step = 255 / (LEVELS - 1); // 17 — distance between adjacent hardware tones
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const p = yy * w + xx;
      const old = lum[p];
      const q = Math.round(old / step) * step; // snap to nearest of the 16 levels
      const err = old - q;
      lum[p] = q;
      // Distribute the quantization error to not-yet-visited neighbours.
      if (xx + 1 < w) lum[p + 1] += (err * 7) / 16;
      if (yy + 1 < h) {
        if (xx > 0) lum[p + w - 1] += (err * 3) / 16;
        lum[p + w] += (err * 5) / 16;
        if (xx + 1 < w) lum[p + w + 1] += (err * 1) / 16;
      }
    }
  }

  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = Math.max(0, Math.min(255, Math.round(lum[p])));
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(img, x, y);
}
