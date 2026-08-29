import { Router } from 'express';
import { createLogger } from '#system/logging/logger.mjs';
import createPlanRouter from './life/plan.mjs';
import createNowRouter from './life/now.mjs';
import createLogRouter from './life/log.mjs';
import createScheduleRouter from './life/schedule.mjs';
import { createUsernameResolver } from './life/identity.mjs';

export default function createLifeRouter(config) {
  const router = Router();
  const logger = createLogger({ source: 'backend', app: 'life' });
  const users = createUsernameResolver({ lifeApi: config.lifeApi });

  // Resolve + validate the requesting user before anything else
  router.use(users.middleware);

  // Request logging middleware for all life routes
  router.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info('life.api.request', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start,
        username: req.lifeUsername,
      });
    });
    next();
  });

  // GET /user — resolved identity for the requesting client
  router.get('/user', (req, res) => {
    const username = req.lifeUsername;
    res.json(config.lifeApi.user(username));
  });

  // GET /users — household roster for the client-side user switcher.
  // No username param, so the identity middleware resolves the default user
  // (always valid) and lets this through.
  router.get('/users', (req, res) => {
    res.json({ users: config.lifeApi.roster() });
  });

  router.use('/plan', createPlanRouter(config));
  router.use('/now', createNowRouter(config));
  router.use('/log', createLogRouter({ lifeApi: config.lifeApi, usernameResolver: users }));
  router.use('/schedule', createScheduleRouter(config));

  // GET /health — system health for lifeplan domain
  router.get('/health', (req, res) => {
    const username = req.lifeUsername;
    const result = config.lifeApi.health(username);
    if (result.status === 'degraded') {
      logger.warn('life.health.degraded', { checks: result.checks });
    }
    res.json(result);
  });

  return router;
}
