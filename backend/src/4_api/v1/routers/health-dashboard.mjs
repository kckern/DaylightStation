/**
 * Health Dashboard API Router
 *
 * Serves agent-generated dashboard data for the fitness frontend.
 *
 * @module api/v1/routers/health-dashboard
 */

import express from 'express';

const Outcome = Object.freeze({
  INVALID_DATE: 'invalid-date',
  NOT_FOUND: 'not-found',
  NOT_FOUND_TODAY: 'not-found-today',
  DELETE_NOT_FOUND: 'delete-not-found',
  DELETE_FAILED: 'delete-failed',
});
const INTERNAL_ERROR_STATUS = 500;

/**
 * Create Health Dashboard API router.
 *
 * @param {Object} config
 * @param {import('#apps/health/AgentHealthDashboardService.mjs').AgentHealthDashboardService} config.dashboardService
 * @returns {express.Router}
 */
export function createHealthDashboardRouter(config = {}) {
  const router = express.Router();
  const { dashboardService } = config;

  if (!dashboardService
    || typeof dashboardService.getForDate !== 'function'
    || typeof dashboardService.getToday !== 'function'
    || typeof dashboardService.deleteForDate !== 'function') {
    throw new Error('dashboardService is required');
  }

  router.get('/:userId/:date', (req, res) => {
    const result = dashboardService.getForDate(req.params);
    sendReadResult(res, result);
  });

  router.get('/:userId', (req, res) => {
    const result = dashboardService.getToday({ userId: req.params.userId });
    sendReadResult(res, result);
  });

  router.delete('/:userId/:date', (req, res) => {
    const result = dashboardService.deleteForDate(req.params);
    switch (result.outcome) {
      case Outcome.INVALID_DATE:
        res.status(400).json({ error: 'Date must be YYYY-MM-DD format' });
        break;
      case Outcome.DELETE_NOT_FOUND:
        res.status(404).json({
          error: 'No dashboard file for this date',
          userId: result.userId,
          date: result.date,
        });
        break;
      case Outcome.DELETE_FAILED:
        // This legacy endpoint's public contract predates the shared error
        // envelope, so retain its exact one-field response during extraction.
        res.status(INTERNAL_ERROR_STATUS).json({ error: 'Failed to delete dashboard file' });
        break;
      default:
        res.json({ userId: result.userId, date: result.date, deleted: true });
    }
  });

  return router;
}

function sendReadResult(res, result) {
  switch (result.outcome) {
    case Outcome.INVALID_DATE:
      res.status(400).json({ error: 'Date must be YYYY-MM-DD format' });
      break;
    case Outcome.NOT_FOUND:
      res.status(404).json({
        error: 'No dashboard available',
        userId: result.userId,
        date: result.date,
        hint: 'The agent may not have run yet for this date',
      });
      break;
    case Outcome.NOT_FOUND_TODAY:
      res.status(404).json({
        error: 'No dashboard available for today',
        userId: result.userId,
        date: result.date,
      });
      break;
    default:
      res.json({
        userId: result.userId,
        date: result.date,
        dashboard: result.dashboard,
      });
  }
}

export default createHealthDashboardRouter;
