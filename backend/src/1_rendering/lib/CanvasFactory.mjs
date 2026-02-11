/**
 * Canvas creation and font registration.
 * @module 1_rendering/lib/CanvasFactory
 */

export async function initCanvas(config) {
  const { width, height, fontDir, fontFile, fontFamily } = config;
  const { createCanvas: createNodeCanvas, registerFont } = await import('canvas');

  if (fontDir && fontFile && fontFamily) {
    const fontPath = `${fontDir}/${fontFile}`;
    try {
      registerFont(fontPath, { family: fontFamily });
    } catch { /* fall back to system fonts */ }
  }

  const canvas = createNodeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';

  return { canvas, ctx, createNodeCanvas };
}
