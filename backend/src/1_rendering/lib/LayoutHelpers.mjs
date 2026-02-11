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
