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
import { draw as drawPlaceholder } from './widgets/PlaceholderWidget.mjs';

const DEFAULT_THEME = {
  bg: '#E8E8E8',
  fg: '#191E21',
  muted: '#888',
  headerBg: '#191E21',
  headerFg: '#E8E8E8',
  red: '#B21318',
  yellow: '#EFDE44',
  blue: '#2157BA',
  green: '#125F20',
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
    baseUrl = 'http://localhost:3112',
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

  // Create canvas
  const renderer = new CanvasRenderer({ fontDir });
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
