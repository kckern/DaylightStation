import { Router } from 'express';
import { createLogger } from '../../../0_system/logging/logger.mjs';

export default function createNowRouter(config) {
  const { alignmentService, driftService } = config;
  const router = Router();
  const logger = createLogger({ source: 'backend', app: 'life', context: { router: 'now' } });

  const getUsername = (req) => req.query.username || 'default';

  // GET / — alignment data (mode: priorities|dashboard|briefing)
  router.get('/', async (req, res, next) => {
    try {
      const username = getUsername(req);
      const mode = req.query.mode || 'priorities';
      const start = Date.now();
      const result = alignmentService.computeAlignment(username);

      if (!result) return res.json({});

      logger.debug('life.alignment.computed', { username, mode, durationMs: Date.now() - start });

      switch (mode) {
        case 'priorities':
          return res.json({ priorities: result.priorities });
        case 'dashboard':
          return res.json({ dashboard: result.dashboard });
        case 'briefing':
          return res.json({ briefingContext: result.briefingContext });
        default:
          return res.json(result);
      }
    } catch (error) { next(error); }
  });

  // GET /drift — latest drift snapshot
  router.get('/drift', async (req, res, next) => {
    try {
      const snapshot = driftService.getLatestSnapshot(getUsername(req));
      res.json(snapshot || {});
    } catch (error) { next(error); }
  });

  // GET /drift/history — cycle-over-cycle drift history
  router.get('/drift/history', async (req, res, next) => {
    try {
      const history = driftService.getHistory(getUsername(req));
      res.json({ history });
    } catch (error) { next(error); }
  });

  // POST /drift/refresh — recompute drift snapshot
  router.post('/drift/refresh', async (req, res, next) => {
    try {
      const start = Date.now();
      const username = getUsername(req);
      const snapshot = await driftService.computeAndSave(username);
      logger.info('life.drift.refreshed', { username, durationMs: Date.now() - start, correlation: snapshot?.correlation });
      res.json(snapshot || {});
    } catch (error) { next(error); }
  });

  return router;
}
