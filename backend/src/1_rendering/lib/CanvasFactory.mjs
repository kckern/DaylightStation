/**
 * Canvas creation and font registration.
 * @module 1_rendering/lib/CanvasFactory
 */

import { fileURLToPath } from 'node:url';

// Bundled font assets (backend/assets/fonts), resolved relative to this module —
// never the process cwd. Used when the caller doesn't supply a fontDir.
const DEFAULT_FONT_DIR = fileURLToPath(new URL('../../../assets/fonts', import.meta.url));

export async function initCanvas(config) {
  const { width, height, fontDir, fontFile, fontFamily } = config;
  const { createCanvas: createNodeCanvas, registerFont } = await import('canvas');

  if (fontFile && fontFamily) {
    const fontPath = `${fontDir || DEFAULT_FONT_DIR}/${fontFile}`;
    try {
      registerFont(fontPath, { family: fontFamily });
    } catch { /* fall back to system fonts */ }
  }

  const canvas = createNodeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';

  return { canvas, ctx, createNodeCanvas };
}
