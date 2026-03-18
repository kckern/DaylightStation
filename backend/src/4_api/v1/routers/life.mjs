import { Router } from 'express';
import { createLogger } from '#system/logging/logger.mjs';
import createPlanRouter from './life/plan.mjs';
import createNowRouter from './life/now.mjs';
import createLogRouter from './life/log.mjs';
import createScheduleRouter from './life/schedule.mjs';

export default function createLifeRouter(config) {
  const router = Router();
  const logger = createLogger({ source: 'backend', app: 'life' });

  // Request logging middleware for all life routes
  router.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info('life.api.request', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start,
        username: req.query.username || 'default',
      });
    });
    next();
  });

  router.use('/plan', createPlanRouter(config));
  router.use('/now', createNowRouter(config));
  router.use('/log', createLogRouter(config));
  router.use('/schedule', createScheduleRouter(config));

  // GET /health — system health for lifeplan domain
  router.get('/health', (req, res) => {
    const username = req.query.username || 'default';
    const checks = {};

    // Plan loaded
    try {
      const plan = config.lifePlanStore?.load?.(username);
      checks.plan = {
        loaded: !!plan,
        goalCount: plan?.goals?.length || 0,
        beliefCount: plan?.beliefs?.length || 0,
        valueCount: plan?.values?.length || 0,
      };
    } catch {
      checks.plan = { loaded: false, error: 'Failed to load plan' };
    }

    // Latest metrics snapshot
    try {
      const latest = config.driftService?.getLatestSnapshot?.(username);
      checks.metrics = {
        hasSnapshot: !!latest,
        lastTimestamp: latest?.timestamp || null,
        ageMs: latest?.timestamp
          ? Date.now() - new Date(latest.timestamp).getTime()
          : null,
      };
    } catch {
      checks.metrics = { hasSnapshot: false };
    }

    // Ceremony adherence
    try {
      const plan = config.lifePlanStore?.load?.(username);
      const ceremonies = plan?.ceremonies || {};
      const enabledTypes = Object.entries(ceremonies)
        .filter(([, c]) => c?.enabled)
        .map(([type]) => type);
      checks.ceremonies = {
        enabledCount: enabledTypes.length,
        types: enabledTypes,
      };
    } catch {
      checks.ceremonies = { enabledCount: 0 };
    }

    // Service availability
    checks.services = {
      alignmentService: !!config.alignmentService,
      driftService: !!config.driftService,
      ceremonyService: !!config.ceremonyService,
      feedbackService: !!config.feedbackService,
      retroService: !!config.retroService,
      aggregator: !!config.aggregator,
    };

    const allOk = checks.plan?.loaded !== false
      && Object.values(checks.services).every(Boolean);

    const status = allOk ? 'ok' : 'degraded';
    if (status === 'degraded') {
      logger.warn('life.health.degraded', { checks });
    }
    res.json({ status, checks });
  });

  return router;
}
