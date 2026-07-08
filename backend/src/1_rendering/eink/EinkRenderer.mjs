/**
 * Eink Renderer — config + data → PNG buffer
 * @module 1_rendering/eink/EinkRenderer
 *
 * Server-side equivalent of ScreenRenderer.jsx.
 * Takes a screen config (layout tree + theme) and ALREADY-RESOLVED data,
 * computes layout, and draws widgets onto a canvas. Data acquisition lives in
 * the application layer (3_applications/eink/DataResolver.mjs) — this module
 * never fetches.
 */

import { CanvasRenderer } from '../canvas/index.mjs';
import { resolveLayout } from './PanelRenderer.mjs';
import * as registry from './widgets/registry.mjs';
import { registerBuiltins } from './widgets/builtins.mjs';
import { FONT_FACES } from './widgets/lib/fonts.mjs';
import { draw as drawPlaceholder } from './widgets/PlaceholderWidget.mjs';
import { canvasToGray8 } from './widgets/lib/greyscale.mjs';
import { encodeGray8Png } from './widgets/lib/grayscalePng.mjs';
import { encodeRgb8Png } from './widgets/lib/rgbPng.mjs';
import { DEFAULT_THEME } from './einkTheme.mjs';

/**
 * @param {Object} screenConfig - { layout, theme, width, height }
 * @param {Object} options
 * @param {Object} options.data - REQUIRED. Already-resolved data keyed by source
 *   name (see 3_applications/eink/DataResolver.mjs). The renderer draws what it
 *   receives; it never fetches. Pass `{}` for data-free layouts.
 * @param {string} [options.fontDir] - Font directory path
 * @param {boolean} [options.grayscale=true] - emit a compact 8-bit grayscale PNG
 *   (mono panels, e.g. E1003 Gray16). Pass false for full-colour panels (e.g.
 *   E1004 Spectra-6) to emit an RGB PNG the panel firmware colour-dithers itself.
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function render(screenConfig, options = {}) {
  const {
    data,
    fontDir = '/usr/share/fonts',
    grayscale = true,
  } = options;

  if (!data || typeof data !== 'object') {
    const err = new TypeError(
      'EinkRenderer.render requires options.data (already-resolved data map) — '
      + 'resolve it in the application layer via 3_applications/eink/DataResolver.mjs'
    );
    err.code = 'EINK_RENDER_DATA_REQUIRED';
    throw err;
  }

  const width = screenConfig.width || 1600;
  const height = screenConfig.height || 1200;
  const theme = { ...DEFAULT_THEME, ...screenConfig.theme };

  // Ensure built-in widgets are registered
  registerBuiltins();

  // Create canvas and register the base font (Roboto Condensed) so widgets can
  // address it by name. Missing faces degrade gracefully (synthetic bold).
  const renderer = new CanvasRenderer({ fontDir });
  for (const face of FONT_FACES) {
    renderer.registerFont(face.path, face.family, { weight: face.weight });
  }
  const { canvas, ctx } = renderer.createWithContext(width, height);

  // Fill background
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);

  // Resolve layout tree into widget regions
  const rootBox = { x: 0, y: 0, w: width, h: height };
  const regions = resolveLayout(screenConfig.layout, rootBox);

  // Draw each widget
  for (const region of regions) {
    const drawFn = registry.get(region.widget);
    if (drawFn) {
      ctx.save();
      // Clip to widget region
      ctx.beginPath();
      ctx.rect(region.box.x, region.box.y, region.box.w, region.box.h);
      ctx.clip();
      drawFn(ctx, region.box, { ...data, ...region.props }, theme);
      ctx.restore();
    } else {
      ctx.save();
      drawPlaceholder(ctx, region.box, { _widgetName: region.widget }, theme);
      ctx.restore();
    }
  }

  // MONO panels (default): emit a compact 8-bit GRAYSCALE PNG, not canvas's 32-bit
  // RGBA. The panel is monochrome, so three colour channels are wasted bytes over
  // its Wi-Fi link (a battery cost) and the device luma-reduces them anyway.
  // Shipping one smooth grey byte/pixel is ~3x smaller and the panel firmware
  // dithers it unchanged (no reflash). We reduce the whole canvas at once here
  // rather than per-widget so every tone — chrome and photos alike — lands in the
  // panel's colour space.
  //
  // COLOUR panels (Spectra-6): emit a colour-type-2 RGB PNG, NOT canvas's RGBA. The
  // panel firmware ignores the alpha byte and runs its own 6-colour dither on the RGB,
  // so the alpha plane is wasted Wi-Fi bytes (a battery cost). We keep the image SMOOTH
  // (no server-side quantise to the 6 colours — that would starve the firmware's
  // error-diffusion dither of gradients); adaptive PNG filtering makes the RGB stream
  // ~13% smaller than the RGBA canvas default while staying lossless.
  if (grayscale) {
    const gray = canvasToGray8(ctx, width, height);
    return encodeGray8Png(gray, width, height);
  }
  const { data: rgba } = ctx.getImageData(0, 0, width, height);
  return encodeRgb8Png(rgba, width, height);
}
