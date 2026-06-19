/**
 * Eink Panel Service — application orchestration for hardware e-paper panels.
 * @module 3_applications/eink/EinkPanelService
 *
 * A hardware screen (physical e-ink, e.g. Seeed reTerminal E1003) is a dumb LAN
 * client of DaylightStation: it wakes, asks "what should I show?", and draws the
 * PNG we return. This service owns that interaction:
 *   - loads the panel's screen config (data/household/screens/<id>.yml)
 *   - tracks per-panel view state (which view is showing)
 *   - resolves the current view's layout/data/theme and renders a PNG via the
 *     1_rendering/eink framework
 *
 * Layer: 3_applications. Imports 1_rendering (allowed) and 0_system config.
 * View state is in-memory (ephemeral by design — a panel reboot just shows the
 * default view again).
 */

import { render as einkRender } from '#rendering/eink/index.mjs';
import { dataService as defaultDataService } from '#system/config/index.mjs';

const DEFAULT_WIDTH = 1872;   // E1003 native landscape
const DEFAULT_HEIGHT = 1404;

export class EinkPanelService {
  #baseUrl;
  #fontDir;
  #dataService;
  #logger;
  #viewIndex = new Map();   // panelId -> current view index

  constructor({ baseUrl, fontDir, dataService, logger } = {}) {
    this.#baseUrl = baseUrl || 'http://localhost:3112';
    this.#fontDir = fontDir || '/usr/share/fonts';
    this.#dataService = dataService || defaultDataService;   // household-tier I/O
    this.#logger = logger || console;
  }

  /** Load the screen config for a panel from household-tier data. */
  #loadScreen(panelId) {
    let screen = null;
    try {
      screen = this.#dataService.household.read(`screens/${panelId}`);
    } catch (e) {
      // Missing file surfaces as ENOENT from the YAML reader — treat as not-found.
      if (e?.code !== 'ENOENT') throw e;
    }
    if (!screen) {
      const err = new Error(`eink panel config not found: screens/${panelId}.yml`);
      err.status = 404;
      throw err;
    }
    return screen;
  }

  /** Normalize the view list; always returns at least one view. */
  #views(screen) {
    const views = screen?.content?.views;
    if (Array.isArray(views) && views.length) return views;
    return [{ id: 'default', layout: { children: [{ widget: 'placeholder' }] } }];
  }

  #wrap(i, len) { return len ? (((i % len) + len) % len) : 0; }

  /**
   * Render the panel's current view to a PNG buffer.
   * @param {string} panelId
   * @returns {Promise<Buffer>}
   */
  async render(panelId) {
    const screen = this.#loadScreen(panelId);
    const content = screen.content || {};
    const display = screen.hardware?.display || {};
    const views = this.#views(screen);
    const index = this.#wrap(this.#viewIndex.get(panelId) ?? 0, views.length);
    const view = views[index];

    const screenConfig = {
      width: content.width || display.width || DEFAULT_WIDTH,
      height: content.height || display.height || DEFAULT_HEIGHT,
      theme: { ...(content.theme || {}), ...(view.theme || {}) },
      layout: view.layout,
      data: view.data || content.data || {},
    };

    const png = await einkRender(screenConfig, { baseUrl: this.#baseUrl, fontDir: this.#fontDir });
    this.#logger.info?.('eink.panel.rendered', {
      panelId, view: view.id, index, bytes: png.length,
      size: `${screenConfig.width}x${screenConfig.height}`,
    });
    return png;
  }

  /**
   * Apply a button action and return the resulting view state.
   * next/prev page through views; select is reserved for per-view behavior.
   * @param {string} panelId
   * @param {'next'|'prev'|'select'} action
   */
  async advance(panelId, action) {
    const screen = this.#loadScreen(panelId);
    const views = this.#views(screen);
    const from = this.#wrap(this.#viewIndex.get(panelId) ?? 0, views.length);
    let to = from;
    if (action === 'next') to = this.#wrap(from + 1, views.length);
    else if (action === 'prev') to = this.#wrap(from - 1, views.length);
    // 'select' (and unknown actions): keep current view; the re-fetched /panel
    // reflects any per-view select handling once widgets implement it.
    this.#viewIndex.set(panelId, to);
    this.#logger.info?.('eink.panel.action', { panelId, action, from, to, view: views[to]?.id });
    return { action, index: to, view: views[to]?.id, viewCount: views.length };
  }
}

export default EinkPanelService;
