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
 * @property {Object} [screenConfig] - Eink screen layout/data/theme config
 * @property {Function} [dataProvider] - Async function returning dashboard data.
 *   REQUIRED unless every render(data) call supplies data: the eink renderer no
 *   longer fetches (data resolution is an application-layer concern), so this
 *   adapter must be handed its data.
 */

export class EpaperAdapter {
  #fontDir;
  #screenConfig;
  #dataProvider;
  #renderFn;
  #logger;
  #lastRender = null;
  #lastRenderTime = null;

  /**
   * @param {EpaperConfig} config
   * @param {Object} deps
   * @param {Function} deps.renderFn - Eink render function
   *   `(screenConfig, { data, fontDir }) => Promise<Buffer>`. The composition
   *   root passes `render` from `#rendering/eink/index.mjs` — adapters must not
   *   import the rendering layer themselves. (This adapter is not yet wired in
   *   app.mjs/bootstrap; whoever wires it alongside createEpaperRouter supplies
   *   the function there.)
   * @param {Object} [deps.logger]
   */
  constructor(config, deps = {}) {
    if (typeof deps.renderFn !== 'function') {
      throw new TypeError('EpaperAdapter requires deps.renderFn (the eink render function) — inject it at the composition root');
    }
    this.#renderFn = deps.renderFn;
    this.#logger = deps.logger || console;
    this.#fontDir = config.fontDir;
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
   * @param {Object} [data] - Dashboard data; falls back to the configured
   *   dataProvider. One of the two MUST supply the data — the renderer draws
   *   what it receives and never fetches.
   * @returns {Promise<Buffer>} PNG image buffer
   */
  async render(data) {
    const startTime = Date.now();

    const screenConfig = this.#screenConfig || EpaperAdapter.defaultScreenConfig();
    const resolved = data || (this.#dataProvider ? await this.#dataProvider() : null);
    if (!resolved || typeof resolved !== 'object') {
      throw new TypeError('EpaperAdapter.render needs data (argument or configured dataProvider) — the eink renderer no longer fetches');
    }

    const buffer = await this.#renderFn(screenConfig, {
      data: resolved,
      fontDir: this.#fontDir,
    });
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
