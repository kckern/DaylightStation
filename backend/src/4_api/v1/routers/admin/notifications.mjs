import express from 'express';

/**
 * Admin sub-router for household notification governance. Forwards to injected
 * services only (this router never imports #apps).
 */
export function createAdminNotificationsRouter({ notificationConfigService, notificationLedgerStore, logger = console }) {
  const router = express.Router();

  router.get('/', (req, res, next) => {
    try { res.json(notificationConfigService.getConfig()); } catch (e) { next(e); }
  });

  router.put('/', (req, res, next) => {
    try {
      res.json(notificationConfigService.updateConfig(req.body || {}));
    } catch (e) {
      if (e.code === 'VALIDATION') return res.status(400).json({ error: e.message });
      next(e);
    }
  });

  router.get('/ledger', (req, res, next) => {
    try {
      const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
      res.json({ events: notificationLedgerStore.recentEvents(limit) });
    } catch (e) { next(e); }
  });

  return router;
}
