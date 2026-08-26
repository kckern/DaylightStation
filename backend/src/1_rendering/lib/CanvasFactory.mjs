/**
 * Canvas creation and font registration.
 * @module 1_rendering/lib/CanvasFactory
 */

import { fileURLToPath } from 'node:url';

// Bundled font assets (backend/assets/fonts), resolved relative to this module —
// never the process cwd. Used when the caller doesn't supply a fontDir.
const DEFAULT_FONT_DIR = fileURLToPath(new URL('../../../assets/fonts', import.meta.url));

/**
 * @param {object} config
 * @param {number} config.width
 * @param {number} config.height
 * @param {string} [config.fontDir] - overrides the bundled asset directory
 * @param {string} [config.fontFile] - the primary face, relative to `fontDir`
 * @param {string} [config.fontFamily] - the family name it registers under
 * @param {Array<{file: string, family: string}>} [config.extraFonts] - further
 *   faces to register alongside the primary one. A renderer that mixes a text
 *   face with, say, a numeric/machine face needs both registered before ANY
 *   measuring happens, and `registerFont` is process-global and must run before
 *   the canvas is created — so they are declared here rather than lazily at the
 *   first draw that wants one.
 */
export async function initCanvas(config) {
  const { width, height, fontDir, fontFile, fontFamily, extraFonts = [] } = config;
  const { createCanvas: createNodeCanvas, registerFont } = await import('canvas');

  const register = (file, family, weight) => {
    if (!file || !family) return;
    try {
      registerFont(`${fontDir || DEFAULT_FONT_DIR}/${file}`, {
        family, ...(weight ? { weight } : {}),
      });
    } catch { /* fall back to system fonts */ }
  };

  register(fontFile, fontFamily);
  // Each is independently best-effort: a missing decorative face degrades to a
  // system fallback, exactly as the primary one already did, and never fails a
  // print that is otherwise correct.
  for (const font of extraFonts) register(font?.file, font?.family, font?.weight);

  const canvas = createNodeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';

  return { canvas, ctx, createNodeCanvas };
}
