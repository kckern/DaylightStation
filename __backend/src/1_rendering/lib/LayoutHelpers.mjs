/**
 * Layout drawing utilities for canvas-based rendering.
 * @module 1_rendering/lib/LayoutHelpers
 */

/**
 * Draw a horizontal divider line.
 */
export function drawDivider(ctx, y, width, options = {}) {
  const { offset = 10, height = 2, color = '#000000' } = options;
  ctx.fillStyle = color;
  ctx.fillRect(offset, y, width - offset * 2, height);
}

/**
 * Draw a border rectangle.
 */
export function drawBorder(ctx, width, height, options = {}) {
  const { offset = 10, lineWidth = 3, color = '#000000' } = options;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(offset, offset, width - offset * 2, height - offset * 2);
}

/**
 * Trace a rounded-rectangle path (no fill/stroke — caller decides).
 */
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * Cover-fit an image into a destination rect: scale to fill, centre-crop the
 * overflow (CSS object-fit: cover). Does NOT clip — the destination rect is
 * covered exactly; clip first if the draw region must be bounded.
 */
export function drawCover(ctx, img, dx, dy, dw, dh) {
  const scale = Math.max(dw / img.width, dh / img.height);
  const sw = dw / scale, sh = dh / scale;
  const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

/**
 * Flip a canvas 180 degrees for upside-down mounted printers.
 */
export function flipCanvas(createNodeCanvas, canvas, width, height) {
  const flipped = createNodeCanvas(width, height);
  const fctx = flipped.getContext('2d');
  fctx.translate(width, height);
  fctx.scale(-1, -1);
  fctx.drawImage(canvas, 0, 0);
  return flipped;
}

/**
 * Format duration in seconds to human-readable string.
 */
export function formatDuration(seconds) {
  if (seconds == null) return '--';
  const s = Math.round(seconds);
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
}
