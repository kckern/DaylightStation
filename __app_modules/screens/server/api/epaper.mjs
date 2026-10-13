import { sendInternalError } from '#api/utils/internalError.mjs';
/** ePaper display HTTP API. */
import express from 'express';

export function createEpaperRouter({ epaperService, logger = console }) {
  const router = express.Router();

  router.get('/image.png', async (req, res) => {
    if (!epaperService.configured) {
      return res.status(503).json({ error: 'ePaper adapter not configured' });
    }
    try {
      const buffer = await epaperService.image({ fresh: req.query.fresh === '1' });
      res.set({
        'Content-Type': 'image/png',
        'Content-Length': buffer.length,
        'Cache-Control': 'no-cache',
      });
      res.send(buffer);
    } catch (err) {
      logger.error?.('epaper.route.renderFailed', { error: err.message });
      sendInternalError(res, { error: 'Render failed' });
    }
  });

  router.post('/render', async (req, res) => {
    if (!epaperService.configured) {
      return res.status(503).json({ error: 'ePaper adapter not configured' });
    }
    try {
      res.json(await epaperService.render(req.body || undefined));
    } catch (err) {
      logger.error?.('epaper.route.renderFailed', { error: err.message });
      sendInternalError(res, { ok: false, error: err.message });
    }
  });

  router.get('/status', (req, res) => {
    if (!epaperService.configured) {
      return res.status(503).json({ error: 'ePaper adapter not configured' });
    }
    res.json(epaperService.status());
  });

  return router;
}
