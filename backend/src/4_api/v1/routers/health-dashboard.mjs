/**
 * Health Dashboard API Router
 *
 * Serves agent-generated dashboard data for the fitness frontend.
 * Data is written by the health coach agent's DailyDashboard assignment
 * via the write_dashboard tool, persisted as YAML via dataService.
 *
 * @module api/v1/routers/health-dashboard
 */

import express from 'express';
import fs from 'node:fs';

/**
 * Create Health Dashboard API router
 *
 * @param {Object} config
 * @param {Object} config.dataService - DataService for YAML persistence
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHealthDashboardRouter(config) {
  const router = express.Router();
  const { dataService, logger = console } = config;

  if (!dataService) {
    throw new Error('dataService is required');
  }

  /**
   * GET /:userId/:date
   * Read the agent-generated dashboard for a specific user and date
   */
  router.get('/:userId/:date', (req, res) => {
    const { userId, date } = req.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Date must be YYYY-MM-DD format' });
    }

    const dashboard = dataService.user.read(`health-dashboard/${date}`, userId);

    if (!dashboard) {
      return res.status(404).json({
        error: 'No dashboard available',
        userId,
        date,
        hint: 'The agent may not have run yet for this date',
      });
    }

    res.json({ userId, date, dashboard });
  });

  /**
   * GET /:userId
   * Read today's dashboard (convenience endpoint)
   */
  router.get('/:userId', (req, res) => {
    const { userId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    const dashboard = dataService.user.read(`health-dashboard/${today}`, userId);

    if (!dashboard) {
      return res.status(404).json({
        error: 'No dashboard available for today',
        userId,
        date: today,
      });
    }

    res.json({ userId, date: today, dashboard });
  });

  /**
   * DELETE /:userId/:date
   * Remove the dashboard file for a specific user and date
   */
  router.delete('/:userId/:date', (req, res) => {
    const { userId, date } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Date must be YYYY-MM-DD format' });
    }

    const filePath = dataService.user.resolvePath(`health-dashboard/${date}`, userId);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info?.('health-dashboard.deleted', { userId, date, filePath });
        res.json({ userId, date, deleted: true });
      } else {
        res.status(404).json({ error: 'No dashboard file for this date', userId, date });
      }
    } catch (err) {
      logger.error?.('health-dashboard.delete.error', { userId, date, error: err.message });
      res.status(500).json({ error: 'Failed to delete dashboard file' });
    }
  });

  return router;
}

export default createHealthDashboardRouter;
