/**
 * Text rendering utilities for canvas-based output.
 * @module 1_rendering/lib/TextRenderer
 */

/**
 * Wrap text into lines that fit within maxWidth.
 *
 * @param {Object} ctx - Canvas 2D context (needs measureText)
 * @param {string|null} text - Text to wrap
 * @param {number} maxWidth - Maximum line width in pixels
 * @returns {string[]} Wrapped lines
 */
export function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}
