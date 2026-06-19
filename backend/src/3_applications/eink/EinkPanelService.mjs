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

import crypto from 'node:crypto';
import { render as einkRender, resolveData, RENDERER_VERSION } from '#rendering/eink/index.mjs';
import { computeNextWakeSeconds } from './wakeSchedule.mjs';
import { dataService as defaultDataService } from '#system/config/index.mjs';

const DEFAULT_WIDTH = 1872;   // E1003 native landscape
const DEFAULT_HEIGHT = 1404;

/**
 * Deterministic JSON: serialize with object keys sorted at every depth so the
 * same logical value always yields the same string (and thus the same hash),
 * regardless of property insertion order from a data feed.
 */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** Local calendar date (YYYY-MM-DD) — the only clock the clock-less panel shows. */
function localYMD(now) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export class EinkPanelService {
  #baseUrl;
  #fontDir;
  #dataService;
  #logger;
  #viewIndex = new Map();   // panelId -> current view index
  // panelId -> monotonic counter bumped by the 'refresh' button action. Folded
  // into the /config fingerprint so a press changes image_hash WITHOUT changing
  // the view — that is what lets the green button force a full e-ink redraw of the
  // CURRENT content on demand, instead of waiting for the next timer wake. Ephemeral
  // (in-memory) like #viewIndex: a panel reboot just resets to 0, harmless.
  #refreshNonce = new Map();

  constructor({ baseUrl, fontDir, dataService, logger } = {}) {
    // Host/port are injected by the composition root from household config
    // (devices.yml daylightHostInternal) — never hardcoded here.
    this.#baseUrl = baseUrl;
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
   * Scope a view's data-source URLs to one panel so server-side HOLDS (e.g. the
   * held favorite photo, /home/photo) are per-device, not global. Appends
   * `hold_key=<panelId>` to each source; feeds that don't hold (calendar/todos/
   * weather) simply ignore the param. Without this every panel shares the one
   * global pick — kitchen and upstairs would always show the same photo.
   */
  #scopeData(data, panelId) {
    const out = {};
    for (const [key, cfg] of Object.entries(data || {})) {
      if (cfg && typeof cfg === 'object' && typeof cfg.source === 'string') {
        const sep = cfg.source.includes('?') ? '&' : '?';
        out[key] = { ...cfg, source: `${cfg.source}${sep}hold_key=${encodeURIComponent(panelId)}` };
      } else {
        out[key] = cfg;
      }
    }
    return out;
  }

  /**
   * Resolve the panel's CURRENT view into the inputs a render consumes — the
   * view index/id, the renderer `screenConfig` (width/height/theme/layout/data
   * sources), and whether the panel is mono (grayscale output) or full colour.
   * Shared by renderResult (which renders it) and stateSnapshot (which
   * fingerprints it without rendering).
   */
  #currentView(screen, panelId) {
    const content = screen.content || {};
    const display = screen.hardware?.display || {};
    const views = this.#views(screen);
    const index = this.#wrap(this.#viewIndex.get(panelId) ?? 0, views.length);
    const view = views[index];
    // Mono vs colour is a fixed hardware fact (SSOT hardware.display.color). Mono
    // is the default: unset, or any 'gray'/'grey'/'mono' value (E1003 Gray16) →
    // compact grayscale PNG. A declared colour mode (E1004 'spectra-6') → full RGB.
    const colorMode = String(display.color || '').toLowerCase();
    const grayscale = !colorMode || /gray|grey|mono/.test(colorMode);
    const screenConfig = {
      width: content.width || display.width || DEFAULT_WIDTH,
      height: content.height || display.height || DEFAULT_HEIGHT,
      theme: { ...(content.theme || {}), ...(view.theme || {}) },
      layout: view.layout,
      data: this.#scopeData(view.data || content.data || {}, panelId),
    };
    return { index, view, screenConfig, grayscale };
  }

  /**
   * Render the panel's current view to a PNG buffer. This is the expensive path
   * (canvas draw) the panel only reaches when /config's image_hash told it the
   * content changed — so there is no conditional-GET / ETag dance here anymore;
   * change detection lives entirely in stateSnapshot.
   *
   * @param {string} panelId
   * @returns {Promise<{ png: Buffer, view: string }>}
   */
  async renderResult(panelId) {
    const screen = this.#loadScreen(panelId);
    const { index, view, screenConfig, grayscale } = this.#currentView(screen, panelId);

    const png = await einkRender(screenConfig, { baseUrl: this.#baseUrl, fontDir: this.#fontDir, grayscale });
    this.#logger.info?.('eink.panel.rendered', {
      panelId, view: view.id, index, bytes: png.length, grayscale,
      size: `${screenConfig.width}x${screenConfig.height}`,
    });
    return { png, view: view.id };
  }

  /**
   * Render the panel's current view to a PNG buffer.
   * @param {string} panelId
   * @returns {Promise<Buffer>}
   */
  async render(panelId) {
    const { png } = await this.renderResult(panelId);
    return png;
  }

  /**
   * The cheap "what should I show, and has it changed?" snapshot the firmware
   * polls on every wake. It is a *render of the now-state of the SSOT blueprint*
   * WITHOUT drawing any pixels: it resolves the current view's data feeds and
   * fingerprints every input that affects the image — date, view, resolved data,
   * layout, theme, and the renderer version — into `imageHash`. The panel pulls
   * the expensive /panel PNG only when that hash differs from the one it cached.
   *
   * Also carries the device's runtime config (rotation, button→action map) and
   * `nextWakeSec` (server-driven cadence). Only Wi-Fi + host/port + id are burned
   * into config.h; everything here is a SSOT edit + redeploy, never a reflash.
   *
   * @param {string} panelId
   * @returns {Promise<{ id: string, rotation: number,
   *   buttons: { green: string, right: string, left: string },
   *   nextWakeSec: number, image: string, imageHash: string, view: string }>}
   */
  async stateSnapshot(panelId) {
    const screen = this.#loadScreen(panelId);
    const buttons = screen.buttons || {};
    const { index, view, screenConfig, grayscale } = this.#currentView(screen, panelId);

    // Resolve the same data the renderer would — but stop there (no canvas).
    const data = await resolveData(screenConfig.data, this.#baseUrl);

    // Fingerprint of every pixel-affecting input. Stable key ordering so a feed
    // reordering its JSON keys does not spuriously bust the hash. RENDERER_VERSION
    // folds in code changes so a renderer/widget edit forces a refresh too. The
    // per-panel refreshNonce folds in the manual 'refresh' button: bumping it
    // changes the hash (so the panel redraws) without altering the content.
    const now = new Date();
    const fingerprint = stableStringify({
      date: localYMD(now),
      view: view.id,
      index,
      width: screenConfig.width,
      height: screenConfig.height,
      theme: screenConfig.theme,
      layout: screenConfig.layout,
      data,
      grayscale,
      refresh: this.#refreshNonce.get(panelId) ?? 0,
      renderer: RENDERER_VERSION,
    });
    const imageHash = crypto.createHash('sha1').update(fingerprint).digest('hex');
    const nextWakeSec = computeNextWakeSeconds(screen.refresh, now);

    const snapshot = {
      id: panelId,
      rotation: parseInt(screen.hardware?.display?.rotation ?? 0, 10) || 0,
      buttons: {
        green: String(buttons.green || 'select'),
        right: String(buttons.right || 'next'),
        left: String(buttons.left || 'prev'),
      },
      nextWakeSec,
      image: `/api/v1/eink/${encodeURIComponent(panelId)}/panel`,
      imageHash,
      view: view.id,
    };
    this.#logger.info?.('eink.panel.snapshot', {
      panelId, view: view.id, index, imageHash, nextWakeSec,
    });
    return snapshot;
  }

  /**
   * Apply a button action and return the resulting view state.
   * next/prev page through views; refresh forces a redraw of the current view;
   * select is reserved for per-view behavior.
   * @param {string} panelId
   * @param {'next'|'prev'|'refresh'|'select'} action
   */
  async advance(panelId, action) {
    const screen = this.#loadScreen(panelId);
    const views = this.#views(screen);
    const from = this.#wrap(this.#viewIndex.get(panelId) ?? 0, views.length);
    let to = from;
    if (action === 'next') to = this.#wrap(from + 1, views.length);
    else if (action === 'prev') to = this.#wrap(from - 1, views.length);
    else if (action === 'refresh') {
      // Manual "redraw now": keep the view, bump the per-panel nonce so the next
      // /config snapshot reports a new image_hash. The panel (which re-polls
      // /config right after this action) then sees the change and pulls a fresh
      // /panel — a full e-ink refresh of the SAME content, on demand, instead of
      // waiting for the timer wake. No reflash: the panel already redraws on any
      // hash change; we just give it one.
      this.#refreshNonce.set(panelId, (this.#refreshNonce.get(panelId) ?? 0) + 1);
    }
    // 'select' (and unknown actions): keep current view, no nonce bump (true
    // no-op); the re-fetched /panel reflects any per-view select handling once
    // widgets implement it.
    this.#viewIndex.set(panelId, to);
    const refreshNonce = this.#refreshNonce.get(panelId) ?? 0;
    this.#logger.info?.('eink.panel.action', { panelId, action, from, to, view: views[to]?.id, refreshNonce });
    return { action, index: to, view: views[to]?.id, viewCount: views.length, refreshNonce };
  }
}

export default EinkPanelService;
