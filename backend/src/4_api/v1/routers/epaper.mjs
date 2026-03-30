/**
 * ePaper Display Router
 *
 * Serves rendered PNG images for the reTerminal E1004 ePaper display.
 * The ESPHome device fetches GET /epaper/image.png on an interval.
 *
 * @module api/v1/routers/epaper
 */

import express from 'express';

/**
 * @param {Object} config
 * @param {import('#adapters/hardware/epaper/EpaperAdapter.mjs').EpaperAdapter} config.epaperAdapter
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createEpaperRouter(config) {
  const router = express.Router();
  const { epaperAdapter, logger = console } = config;

  /**
   * GET /epaper/image.png
   * Returns the current dashboard as a PNG image.
   * ESPHome's online_image component fetches this URL.
   */
  router.get('/image.png', async (req, res) => {
    if (!epaperAdapter) {
      return res.status(503).json({ error: 'ePaper adapter not configured' });
    }

    try {
      const forceRender = req.query.fresh === '1';
      let buffer;

      if (!forceRender) {
        buffer = epaperAdapter.getCached();
      }

      if (!buffer) {
        buffer = await epaperAdapter.render();
      }

      res.set({
        'Content-Type': 'image/png',
        'Content-Length': buffer.length,
        'Cache-Control': 'no-cache'
      });
      res.send(buffer);
    } catch (err) {
      logger.error?.('epaper.route.renderFailed', { error: err.message });
      res.status(500).json({ error: 'Render failed' });
    }
  });

  /**
   * POST /epaper/render
   * Force a fresh render and return status (not the image).
   */
  router.post('/render', async (req, res) => {
    if (!epaperAdapter) {
      return res.status(503).json({ error: 'ePaper adapter not configured' });
    }

    try {
      const buffer = await epaperAdapter.render(req.body || undefined);
      res.json({
        ok: true,
        sizeBytes: buffer.length,
        renderedAt: new Date().toISOString()
      });
    } catch (err) {
      logger.error?.('epaper.route.renderFailed', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /**
   * GET /epaper/status
   */
  router.get('/status', (req, res) => {
    if (!epaperAdapter) {
      return res.status(503).json({ error: 'ePaper adapter not configured' });
    }
    res.json(epaperAdapter.getStatus());
  });

  return router;
}
