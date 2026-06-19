/**
 * Eink Router — serves rendered panels to hardware e-paper displays.
 * @module api/v1/routers/eink
 *
 * Consumed by Seeed reTerminal panels (firmware in _extensions/eink-panel):
 *   GET /api/v1/eink/panel?id=<panelId>            -> image/png (current view)
 *   GET /api/v1/eink/action?id=<panelId>&action=.. -> { ok, view, index }
 *
 * The device is on the LAN (networkTrustResolver grants it sysadmin), so no
 * token is required.
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * @param {Object} config
 * @param {import('#applications/eink/EinkPanelService.mjs').EinkPanelService} config.einkPanelService
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createEinkRouter({ einkPanelService, logger = console }) {
  const router = express.Router();

  // Current rendered screen for a panel.
  router.get('/panel', asyncHandler(async (req, res) => {
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      const png = await einkPanelService.render(id);
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'no-store');   // panels poll on wake; never cache
      return res.send(png);
    } catch (err) {
      if (err?.status === 404) return res.status(404).json({ error: err.message });
      throw err;
    }
  }));

  // Button action: advance per-panel view state. Firmware re-fetches /panel after.
  router.get('/action', asyncHandler(async (req, res) => {
    const id = String(req.query.id || '').trim();
    const action = String(req.query.action || '').trim();
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
