/**
 * Eink Router — serves rendered panels to hardware e-paper displays.
 * @module api/v1/routers/eink
 *
 * Consumed by Seeed reTerminal panels (firmware in _extensions/eink-panel).
 * Panel id is a PATH segment (matches the rest of the v1 API — /sessions/:id,
 * /budgets/:id, /info/plex/:id; query strings are reserved for filters/options):
 *   GET /api/v1/eink/:id/config         -> text/plain key=value snapshot
 *   GET /api/v1/eink/:id/panel          -> image/png (current view)
 *   GET /api/v1/eink/:id/action/:action -> { ok, view, index }
 *   GET /api/v1/eink/:id/status         -> JSON last-reported device telemetry
 *
 * The panel piggybacks its telemetry (battery/signal/wake/memory) as query params
 * on the /config wake poll; /status surfaces the latest reading for the server.
 *
 * Change detection lives on /config, not /panel. /config is the CHEAP render of
 * the SSOT blueprint's now-state: it resolves the current view's data and returns
 * an `image_hash` fingerprint of every pixel-affecting input WITHOUT drawing the
 * PNG, plus `next_wake` (sleep cadence) and the runtime config (rotation, button→
 * action map). The battery panel polls /config on every wake and pulls the
 * expensive /panel PNG only when image_hash differs from the one it cached. So
 * /panel is a pure on-demand render — no ETag/304 dance.
 *
 * Server-driven: only Wi-Fi + host/port + panel id are burned into the panel's
 * config.h; rotation, button map, cadence/schedule all come from /config — so an
 * edit is a SSOT change + redeploy, never a reflash.
 *
 * The device is on the LAN (networkTrustResolver grants it sysadmin), so no
 * token is required.
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * @param {Object} config
 * @param {import('#apps/eink/EinkPanelService.mjs').EinkPanelService} config.einkPanelService
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createEinkRouter({ einkPanelService, logger = console }) {
  const router = express.Router();

  // Pure on-demand render of a panel's current view. The panel only reaches here
  // after /config told it the image_hash changed, so there is no conditional-GET
  // dance — just render and ship the PNG.
  router.get('/:id/panel', asyncHandler(async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      const { png } = await einkPanelService.renderResult(id);
      res.set('Cache-Control', 'no-cache');
      res.set('Content-Type', 'image/png');
      // res.end (not res.send): /panel is an unconditional render, so bypass
      // Express's automatic If-None-Match/304 freshness check entirely.
      return res.end(png);
    } catch (err) {
      if (err?.status === 404) return res.status(404).json({ error: err.message });
      throw err;
    }
  }));

  // The wake-time snapshot the panel polls every cycle. Resolves the SSOT
  // blueprint's now-state into a cheap fingerprint (no PNG render): runtime config
  // (rotation, button→action map), `next_wake` cadence, the `image` URL, and the
  // `image_hash` the panel diffs against its cache to decide whether to pull the
  // PNG. Served as lib-free `key=value` lines (text/plain) so the panel parses it
  // without a JSON library.
  router.get('/:id/config', asyncHandler(async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    // The battery panel piggybacks its status (bat/rssi/wake/up/heap/psram/rst) on
    // this wake poll — zero extra cost, since a deep-sleep device can't host its own
    // server. Capture it before rendering the snapshot; it must never break /config,
    // so guard it (recordTelemetry is also internally non-throwing).
    try { einkPanelService.recordTelemetry(id, req.query); } catch (e) {
      logger.warn?.('eink.telemetry.record_failed', { id, error: e?.message });
    }
    try {
      const snap = await einkPanelService.stateSnapshot(id);
      const body = [
        `id=${snap.id}`,
        `rotation=${snap.rotation}`,
        `btn_green=${snap.buttons.green}`,
        `btn_right=${snap.buttons.right}`,
        `btn_left=${snap.buttons.left}`,
        `next_wake=${snap.nextWakeSec}`,
        `image=${snap.image}`,
        `image_hash=${snap.imageHash}`,
        '',
      ].join('\n');
      res.set('Cache-Control', 'no-cache');
      res.type('text/plain');
      return res.send(body);
    } catch (err) {
      if (err?.status === 404) return res.status(404).json({ error: err.message });
      throw err;
    }
  }));

  // Last-reported device telemetry (battery, signal, wake cause, memory, reset
  // reason), captured from the panel's /config wake polls. JSON for the always-on
  // server / a dashboard — the panel itself is asleep and never reads this. Returns
  // { reported: false } until the panel has woken at least once since the file existed.
  router.get('/:id/status', asyncHandler(async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    const telemetry = einkPanelService.getTelemetry(id);
    if (!telemetry) return res.json({ id, reported: false });
    return res.json({ id, reported: true, ...telemetry });
  }));

  // Button action: advance per-panel view state. The panel re-snapshots /config
  // after, picking up the new view's image_hash.
  router.get('/:id/action/:action', asyncHandler(async (req, res) => {
    const id = String(req.params.id || '').trim();
    const action = String(req.params.action || '').trim();
    if (!id || !action) return res.status(400).json({ error: 'id and action required' });
    try {
      const result = await einkPanelService.advance(id, action);
      return res.json({ ok: true, ...result });
    } catch (err) {
      if (err?.status === 404) return res.status(404).json({ error: err.message });
      throw err;
    }
  }));

  return router;
}

export default createEinkRouter;
