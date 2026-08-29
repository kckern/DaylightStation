/**
 * Eink Panel Service — application orchestration for hardware e-paper panels.
 * @module 3_applications/eink/EinkPanelService
 *
 * A hardware screen (physical e-ink, e.g. Seeed reTerminal E1003) is a dumb LAN
 * client of DaylightStation: it wakes, asks "what should I show?", and draws the
 * PNG we return. This service owns that interaction:
 *   - loads the panel's semantic screen configuration
 *   - tracks per-panel view state (which view is showing)
 *   - resolves the current view's layout/data/theme and renders a PNG via the
 *     1_rendering/eink framework
 *
 * View state is in-memory (ephemeral by design — a panel reboot just shows the
 * default view again).
 */

import { computeNextWakeSeconds } from './wakeSchedule.mjs';
import { isEinkPanelRenderer } from './ports/IEinkPanelRenderer.mjs';
import { isEinkPanelStore } from './ports/IEinkPanelStore.mjs';
import { isContentFingerprint } from './ports/IContentFingerprint.mjs';
import { isEinkDataSourceGateway } from './ports/IEinkDataSourceGateway.mjs';
import { MissingResourceError } from '#apps/common/errors/SemanticErrors.mjs';

const DEFAULT_WIDTH = 1872;   // E1003 native landscape
const DEFAULT_HEIGHT = 1404;

// Telemetry must survive a server redeploy: a deep-sleep battery panel only
// reports on its ~6h wake, so an in-memory-only store would show "unknown" for
// hours after every deploy.
// Single-cell LiPo voltage→charge envelope (raw, not a discharge curve): the panel
// reads battery millivolts off a GPIO divider. ~4.2V full, ~3.3V is the usable floor.
const BAT_FULL_MV = 4200;
const BAT_EMPTY_MV = 3300;
const BAT_LOW_PCT = 15;       // warn/flag at or below this charge

/** Battery millivolts → percent (0..100), or null when unavailable (bat=0/absent). */
function batteryPercent(mv) {
  if (!mv) return null;
  const pct = Math.round(((mv - BAT_EMPTY_MV) / (BAT_FULL_MV - BAT_EMPTY_MV)) * 100);
  return Math.max(0, Math.min(100, pct));
}

/**
 * Deterministic JSON: serialize with object keys sorted at every depth so the
 * same logical value always yields the same string (and thus the same hash),
 * regardless of property insertion order from a data feed.
 */
/** Local calendar date (YYYY-MM-DD) — the only clock the clock-less panel shows. */
function localYMD(now) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Decide which forecast window belongs in the panel model. This is an
 * application decision (what to show), not a drawing decision (how to show it).
 */
export function prepareEinkRenderData(data, referenceTime) {
  const weather = data?.weather;
  if (!weather || typeof weather !== 'object') return data;
  const hourly = Array.isArray(weather.hourly) ? weather.hourly : [];
  const referenceUnix = Math.floor(referenceTime.getTime() / 1000);
  const upcoming = hourly.filter((entry) => entry?.unix >= referenceUnix).slice(0, 12);
  return {
    ...data,
    weather: {
      ...weather,
      forecastHours: upcoming.length > 0 ? upcoming : hourly.slice(0, 12),
    },
  };
}

export class EinkPanelService {
  #panelStore;
  #logger;
  #dataSourceGateway;
  #panelRenderer;
  #fingerprint;
  #clock;
  #viewIndex = new Map();   // panelId -> current view index
  // panelId -> monotonic counter bumped by the 'refresh' button action. Folded
  // into the /config fingerprint so a press changes image_hash WITHOUT changing
  // the view — that is what lets the green button force a full e-ink redraw of the
  // CURRENT content on demand, instead of waiting for the next timer wake. Ephemeral
  // (in-memory) like #viewIndex: a panel reboot just resets to 0, harmless.
  #refreshNonce = new Map();
  // panelId -> latest telemetry record. Lazily hydrated from the persisted file on
  // first access (null until then) so the last-known reading survives a redeploy.
  #telemetry = null;

  constructor({ panelStore, dataSourceGateway, panelRenderer, fingerprint, clock = () => new Date(), logger } = {}) {
    if (!isEinkPanelStore(panelStore)) throw new Error('EinkPanelService requires panelStore');
    if (!isEinkDataSourceGateway(dataSourceGateway)) throw new Error('EinkPanelService requires dataSourceGateway');
    if (!isEinkPanelRenderer(panelRenderer)) {
      throw new TypeError('EinkPanelService requires panelRenderer');
    }
    if (!isContentFingerprint(fingerprint)) throw new TypeError('EinkPanelService requires fingerprint');
    this.#panelStore = panelStore;
    this.#logger = logger || console;
    this.#dataSourceGateway = dataSourceGateway;
    this.#panelRenderer = panelRenderer;
    this.#fingerprint = fingerprint;
    this.#clock = clock;
  }

  /** Load the screen config for a panel from household-tier data. */
  #loadScreen(panelId) {
    const screen = this.#panelStore.getPanel(panelId);
    if (!screen) {
      throw new MissingResourceError(`eink panel config not found: ${panelId}`, {
        code: 'EINK_PANEL_NOT_FOUND', context: { panelId },
      });
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
      data: view.data || content.data || {},
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

    // Resolve data FIRST (application concern), then hand the renderer its
    // inputs. The render path preloads images (loadImages) so widgets like
    // PhotoWidget have ready pixels; the /config snapshot deliberately does not.
    const resolvedData = await this.#dataSourceGateway.resolve(screenConfig.data, {
      loadImages: true,
      scopeKey: panelId,
      logger: this.#logger,
    });
    const renderReferenceTime = this.#clock();
    const data = prepareEinkRenderData(resolvedData, renderReferenceTime);
    const png = await this.#panelRenderer.render(screenConfig, {
      data,
      grayscale,
      renderReferenceTime,
    });
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
   *   nextWakeSec: number, imageHash: string, view: string }>}
   */
  async stateSnapshot(panelId) {
    const screen = this.#loadScreen(panelId);
    const buttons = screen.buttons || {};
    const { index, view, screenConfig, grayscale } = this.#currentView(screen, panelId);

    // Resolve the same data the render path would — but stop there (no canvas,
    // and no image preload: the battery-saving hash check never downloads a photo).
    const resolvedData = await this.#dataSourceGateway.resolve(screenConfig.data, {
      logger: this.#logger,
      scopeKey: panelId,
    });

    // Fingerprint of every pixel-affecting input. Stable key ordering so a feed
    // reordering its JSON keys does not spuriously bust the hash. RENDERER_VERSION
    // folds in code changes so a renderer/widget edit forces a refresh too. The
    // per-panel refreshNonce folds in the manual 'refresh' button: bumping it
    // changes the hash (so the panel redraws) without altering the content.
    const now = this.#clock();
    const data = prepareEinkRenderData(resolvedData, now);
    const imageHash = this.#fingerprint.hash({
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
      renderer: this.#panelRenderer.version,
    });
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

  /** Lazily hydrate the telemetry map from the persisted household file (once). */
  #loadTelemetry() {
    if (this.#telemetry) return this.#telemetry;
    const stored = this.#panelStore.getTelemetry();
    this.#telemetry = new Map(Object.entries(stored && typeof stored === 'object' ? stored : {}));
    return this.#telemetry;
  }

  /** Write the whole telemetry map back to disk. Never throws into the caller. */
  #persistTelemetry() {
    try {
      this.#panelStore.saveTelemetry(Object.fromEntries(this.#loadTelemetry()));
    } catch (e) {
      this.#logger.warn?.('eink.telemetry.persist_failed', { error: e?.message });
    }
  }

  /**
   * Record the device status the firmware piggybacks on its /config wake poll
   * (bat/rssi/wake/up/heap/psram/rst — see the eink-panel firmware). Keeps only the
   * LATEST reading per panel, persisted so it survives a redeploy. A poll carrying
   * NONE of these params (e.g. a manual /config curl, or pre-telemetry firmware) is
   * ignored so it cannot clobber the last real reading. Never throws — telemetry must
   * not break the panel's wake path.
   *
   * @param {string} panelId
   * @param {Object} telemetry - typed telemetry supplied by the HTTP boundary
   * @returns {Object|null} the stored record, or null if nothing to record
   */
  recordTelemetry(panelId, telemetry = {}) {
    const id = String(panelId || '').trim();
    if (!id) return null;
    const fields = {
      bat: telemetry.bat,
      rssi: telemetry.rssi,
      up: telemetry.up,
      heap: telemetry.heap,
      psram: telemetry.psram,
      rst: telemetry.rst,
      wake: telemetry.wake,
    };
    // A wake report must carry at least one known field; otherwise leave the last
    // reading untouched (a bare /config poll is not a telemetry update).
    if (Object.values(fields).every((v) => v === undefined)) return null;

    const record = { at: this.#clock().toISOString() };
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) record[k] = v;
    if (fields.bat !== undefined) {
      record.batteryPercent = batteryPercent(fields.bat);
      record.low = record.batteryPercent !== null && record.batteryPercent <= BAT_LOW_PCT;
    } else {
      record.low = false;
    }

    this.#loadTelemetry().set(id, record);
    this.#persistTelemetry();

    if (record.low) {
      this.#logger.warn?.('eink.telemetry.low_battery', {
        panelId: id, bat: record.bat, batteryPercent: record.batteryPercent,
      });
    }
    this.#logger.info?.('eink.telemetry.recorded', { panelId: id, ...record });
    return record;
  }

  /** Latest telemetry for a panel, or null if it has never reported. */
  getTelemetry(panelId) {
    const id = String(panelId || '').trim();
    if (!id) return null;
    return this.#loadTelemetry().get(id) || null;
  }
}

export default EinkPanelService;
