/**
 * ePaper Display Adapter
 *
 * Renders dashboard images for a Seeed reTerminal E1004 (13.3" Spectra 6 ePaper).
 * The device runs ESPHome firmware and fetches PNGs over HTTP from this adapter.
 *
 * Architecture:
 *   CanvasRenderer draws dashboard → PNG buffer → served via API route
 *   ESPHome `online_image` fetches PNG → device handles dithering to 6-color palette
 *
 * @module adapters/hardware/epaper
 */

import { CanvasRenderer, loadImage } from '#system/canvas/index.mjs';
import { drawRect, drawCenteredText, drawDashedLine } from '#system/canvas/drawingUtils.mjs';

const DISPLAY_WIDTH = 1600;
const DISPLAY_HEIGHT = 1200;

/**
 * Spectra 6 real-world color palette.
 * Design with these for crisp output; other colors will be dithered by ESPHome.
 */
const PALETTE = {
  black:  '#191E21',
  white:  '#E8E8E8',
  red:    '#B21318',
  yellow: '#EFDE44',
  blue:   '#2157BA',
  green:  '#125F20'
};

/**
 * @typedef {Object} EpaperConfig
 * @property {string} fontDir - Path to fonts directory
 * @property {Function} [dataProvider] - Async function returning dashboard data
 */

export class EpaperAdapter {
  #renderer;
  #dataProvider;
  #logger;
  #lastRender = null;
  #lastRenderTime = null;

  /**
   * @param {EpaperConfig} config
   * @param {Object} [deps]
   * @param {Object} [deps.logger]
   */
  constructor(config, deps = {}) {
    this.#logger = deps.logger || console;
    this.#dataProvider = config.dataProvider || null;
    this.#renderer = new CanvasRenderer({
      fontDir: config.fontDir,
      logger: this.#logger
    });
  }

  isConfigured() {
    return true;
  }

  getStatus() {
    return {
      configured: true,
      displaySize: `${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}`,
      lastRenderTime: this.#lastRenderTime,
      hasCache: this.#lastRender !== null
    };
  }

  /**
   * Render the dashboard and return a PNG buffer.
   * @param {Object} [data] - Dashboard data (overrides dataProvider)
   * @returns {Promise<Buffer>} PNG image buffer
   */
  async render(data) {
    const startTime = Date.now();

    if (!data && this.#dataProvider) {
      data = await this.#dataProvider();
    }

    const { canvas, ctx } = this.#renderer.createWithContext(DISPLAY_WIDTH, DISPLAY_HEIGHT);

    // -- Background --
    ctx.fillStyle = PALETTE.white;
    ctx.fillRect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);

    // -- Placeholder layout --
    // TODO: Replace with real dashboard sections once data sources are decided
    this.#drawPlaceholder(ctx, data || {});

    const buffer = canvas.toBuffer('image/png');
    this.#lastRender = buffer;
    this.#lastRenderTime = Date.now();

    this.#logger.info?.('epaper.rendered', {
      durationMs: Date.now() - startTime,
      sizeBytes: buffer.length
    });

    return buffer;
  }

  /**
   * Get the last rendered PNG buffer (cached).
   * @returns {Buffer|null}
   */
  getCached() {
    return this.#lastRender;
  }

  /**
   * Set or replace the data provider function.
   * @param {Function} provider - Async function returning dashboard data
   */
  setDataProvider(provider) {
    this.#dataProvider = provider;
  }

  // ============================================================================
  // Private - Dashboard Layout
  // ============================================================================

  #drawPlaceholder(ctx, data) {
    const margin = 40;
    const headerHeight = 120;

    // Header bar
    drawRect(ctx, {
      x: 0, y: 0,
      width: DISPLAY_WIDTH, height: headerHeight,
      fillColor: PALETTE.black
    });

    // Title
    ctx.font = 'bold 64px sans-serif';
    ctx.fillStyle = PALETTE.white;
    ctx.fillText('DaylightStation', margin, 80);

    // Date
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    });
    ctx.font = '40px sans-serif';
    const dateWidth = ctx.measureText(dateStr).width;
    ctx.fillText(dateStr, DISPLAY_WIDTH - dateWidth - margin, 80);

    // Divider
    drawDashedLine(ctx, {
      x1: margin, y: headerHeight + 20,
      x2: DISPLAY_WIDTH - margin,
      color: PALETTE.black,
      lineWidth: 2,
      dashPattern: [8, 8]
    });

    // Content placeholder
    const contentY = headerHeight + 60;
    ctx.fillStyle = PALETTE.black;
    ctx.font = '36px sans-serif';
    ctx.fillText('Dashboard content goes here', margin, contentY + 40);
    ctx.font = '28px sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText('Configure data sources to populate this display', margin, contentY + 90);

    // Color swatch preview (useful for calibrating the display)
    const swatchY = DISPLAY_HEIGHT - 200;
    const swatchSize = 100;
    const swatchGap = 30;
    const colors = Object.entries(PALETTE);
    const totalSwatchWidth = colors.length * swatchSize + (colors.length - 1) * swatchGap;
    let swatchX = (DISPLAY_WIDTH - totalSwatchWidth) / 2;

    for (const [name, color] of colors) {
      drawRect(ctx, {
        x: swatchX, y: swatchY,
        width: swatchSize, height: swatchSize,
        fillColor: color
      });
      drawCenteredText(ctx, {
        text: name,
        x: swatchX + swatchSize / 2,
        y: swatchY + swatchSize + 30,
        font: '22px sans-serif',
        color: PALETTE.black
      });
      swatchX += swatchSize + swatchGap;
    }
  }
}

export const EPAPER_PALETTE = PALETTE;
export const EPAPER_WIDTH = DISPLAY_WIDTH;
export const EPAPER_HEIGHT = DISPLAY_HEIGHT;

export default EpaperAdapter;
