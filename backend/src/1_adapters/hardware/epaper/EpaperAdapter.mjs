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

import { render as einkRender } from '#rendering/eink/index.mjs';

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
 * @property {string} [baseUrl] - Backend base URL for data fetching
 * @property {Object} [screenConfig] - Eink screen layout/data/theme config
 * @property {Function} [dataProvider] - Async function returning dashboard data
 */

export class EpaperAdapter {
  #fontDir;
  #baseUrl;
  #screenConfig;
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
    this.#fontDir = config.fontDir;
    this.#baseUrl = config.baseUrl || 'http://localhost:3112';
    this.#screenConfig = config.screenConfig || null;
    this.#dataProvider = config.dataProvider || null;
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
   * @param {Object} [data] - Dashboard data (overrides data fetching)
   * @returns {Promise<Buffer>} PNG image buffer
   */
  async render(data) {
    const startTime = Date.now();

    // Build screen config, using provided data or fetching via DataResolver
    const screenConfig = this.#screenConfig || EpaperAdapter.defaultScreenConfig();
    const options = {
      baseUrl: this.#baseUrl,
      fontDir: this.#fontDir,
    };

    if (data) {
      options.dataOverride = data;
    } else if (this.#dataProvider) {
      options.dataOverride = await this.#dataProvider();
    }

    const buffer = await einkRender(screenConfig, options);
    this.#lastRender = buffer;
    this.#lastRenderTime = Date.now();

    this.#logger.info?.('epaper.rendered', {
      durationMs: Date.now() - startTime,
      sizeBytes: buffer.length,
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
   * Set or replace the screen config.
   * @param {Object} config - Eink screen layout/data/theme config
   */
  setScreenConfig(config) {
    this.#screenConfig = config;
  }

  /**
   * Set or replace the data provider function.
   * @param {Function} provider - Async function returning dashboard data
   */
  setDataProvider(provider) {
    this.#dataProvider = provider;
  }

  /**
   * Default screen config: header + weather panel.
   */
  static defaultScreenConfig() {
    return {
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT,
      layout: {
        direction: 'column',
        children: [
          { widget: 'header', basis: 100 },
          { widget: 'weather', grow: 1 },
        ],
      },
      data: {
        weather: { source: '/api/v1/home/weather' },
      },
      theme: {
        bg: PALETTE.white,
        fg: PALETTE.black,
        headerBg: PALETTE.black,
        headerFg: PALETTE.white,
        red: PALETTE.red,
        yellow: PALETTE.yellow,
        blue: PALETTE.blue,
        green: PALETTE.green,
      },
    };
  }
}

export const EPAPER_PALETTE = PALETTE;
export const EPAPER_WIDTH = DISPLAY_WIDTH;
export const EPAPER_HEIGHT = DISPLAY_HEIGHT;

export default EpaperAdapter;
