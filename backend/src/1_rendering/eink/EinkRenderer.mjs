/**
 * Eink Renderer — config + data → PNG buffer
 * @module 1_rendering/eink/EinkRenderer
 *
 * Server-side equivalent of ScreenRenderer.jsx.
 * Takes a screen config (layout tree + data sources + theme), resolves data,
 * computes layout, and draws widgets onto a canvas.
 */

import { CanvasRenderer } from '#system/canvas/index.mjs';
import { resolveLayout } from './PanelRenderer.mjs';
import { resolveData } from './providers/DataResolver.mjs';
import * as registry from './widgets/registry.mjs';
import { registerBuiltins } from './widgets/builtins.mjs';
import { FONT_FACES } from './widgets/lib/fonts.mjs';
import { draw as drawPlaceholder } from './widgets/PlaceholderWidget.mjs';

// The target (Seeed reTerminal E1003) is a MONOCHROME, 16-level grayscale panel —
// there is no color. The palette is therefore a grayscale ramp whose values snap
// near the 16 hardware levels (0x00..0xFF in ~0x11 steps) so each fill renders as
// a clean tone, never a dithered color stipple. The color-named keys
// (red/blue/green/yellow) are kept as TONAL ALIASES — dark-to-light grays — so the
// widgets that reference them need no rewrite. Rendering note: IT8951 fast/partial
// (A2) refresh is effectively 1-bit, so keep grays in STATIC chrome; any gray in a
// frequently-changing region forces a full (flashing) refresh.
const DEFAULT_THEME = {
  bg: '#FFFFFF',          // white — e-ink reads crispest at the tonal extremes
  fg: '#000000',          // black
  muted: '#777777',       // mid gray — secondary text
  headerBg: '#000000',
  headerFg: '#FFFFFF',
  // grayscale ramp (dark -> light) for tonal hierarchy
  ink: '#000000',
  g1: '#333333',
  g2: '#555555',
  g3: '#888888',
  g4: '#BBBBBB',
  g5: '#DDDDDD',
  // tonal aliases — this mono panel has no color; severe/important -> darker tones
  red: '#222222',
  blue: '#444444',
  green: '#666666',
  yellow: '#999999',
};

/**
 * @param {Object} screenConfig - { layout, data, theme, width, height }
 * @param {Object} [options]
 * @param {string} [options.baseUrl] - Backend base URL for data fetching
 * @param {string} [options.fontDir] - Font directory path
 * @param {Object} [options.dataOverride] - Skip fetching, use this data directly
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function render(screenConfig, options = {}) {
  const {
    baseUrl,          // injected from household config by the caller; no host literal here
    fontDir = '/usr/share/fonts',
    dataOverride,
  } = options;

  const width = screenConfig.width || 1600;
  const height = screenConfig.height || 1200;
  const theme = { ...DEFAULT_THEME, ...screenConfig.theme };

  // Ensure built-in widgets are registered
  registerBuiltins();

  // Resolve data
  const data = dataOverride || await resolveData(screenConfig.data, baseUrl);

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

  return canvas.toBuffer('image/png');
}
