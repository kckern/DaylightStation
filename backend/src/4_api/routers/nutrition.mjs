/**
 * Nutrition API Router
 *
 * REST API endpoints for nutrition/food logging operations.
 */
import express from 'express';
import { FoodLogService } from '../../1_domains/nutrition/services/FoodLogService.mjs';
import { YamlFoodLogDatastore } from '../../2_adapters/persistence/yaml/YamlFoodLogDatastore.mjs';

const router = express.Router();

/**
 * Create router with dependencies
 * @param {Object} deps
 * @param {string} deps.dataRoot - Data root directory
 * @param {Object} [deps.logger] - Logger instance
 * @returns {express.Router}
 */
export function createNutritionRouter(deps) {
  const { dataRoot, logger } = deps;

  const foodLogStore = new YamlFoodLogDatastore({ dataRoot });
  const foodLogService = new FoodLogService({ foodLogStore });

  /**
   * GET /api/nutrition
   * Get nutrition module overview
   */
  router.get('/', async (req, res) => {
    try {
      const { hid } = req.query;
      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }

      const dates = await foodLogStore.listDates(hid);
      const today = nowDate();
      const todaySummary = await foodLogService.getDailySummary(hid, today);

      res.json({
        module: 'nutrition',
        householdId: hid,
        datesWithLogs: dates.length,
        mostRecentDate: dates[0] || null,
        today: todaySummary
      });
    } catch (error) {
      logger?.error?.('nutrition.overview.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/nutrition/logs/dates
   * List all dates with food logs
   */
  router.get('/logs/dates', async (req, res) => {
    try {
      const { hid } = req.query;
      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }

      const dates = await foodLogStore.listDates(hid);
      res.json({ dates });
    } catch (error) {
      logger?.error?.('nutrition.listDates.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/nutrition/logs/:date
   * Get food log for a specific date
   */
  router.get('/logs/:date', async (req, res) => {
    try {
      const { hid } = req.query;
      const { date } = req.params;

      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }

      const log = await foodLogService.getLog(hid, date);
      if (!log) {
        return res.status(404).json({ error: 'Food log not found' });
      }

      res.json(log);
    } catch (error) {
      logger?.error?.('nutrition.getLog.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/nutrition/logs/:date
   * Create or update food log for a date
   */
  router.post('/logs/:date', async (req, res) => {
    try {
      const { hid } = req.query;
      const { date } = req.params;
      const entry = req.body;

      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }

      const log = await foodLogService.logFood(hid, date, entry);
      res.json(log);
    } catch (error) {
      logger?.error?.('nutrition.logFood.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/nutrition/logs/:date/entries/:index
   * Remove an entry from a food log
   */
  router.delete('/logs/:date/entries/:index', async (req, res) => {
    try {
      const { hid } = req.query;
      const { date, index } = req.params;

      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }

      const log = await foodLogService.removeEntry(hid, date, parseInt(index, 10));
      res.json(log);
    } catch (error) {
      logger?.error?.('nutrition.removeEntry.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/nutrition/summary/:date
   * Get daily nutrition summary
   */
  router.get('/summary/:date', async (req, res) => {
    try {
      const { hid } = req.query;
      const { date } = req.params;

      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }

      const summary = await foodLogService.getDailySummary(hid, date);
      res.json(summary);
    } catch (error) {
      logger?.error?.('nutrition.dailySummary.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/nutrition/summary/weekly/:weekStart
   * Get weekly nutrition summary
   */
  router.get('/summary/weekly/:weekStart', async (req, res) => {
    try {
      const { hid } = req.query;
      const { weekStart } = req.params;

      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }

      const summary = await foodLogService.getWeeklySummary(hid, weekStart);
      res.json(summary);
    } catch (error) {
      logger?.error?.('nutrition.weeklySummary.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/nutrition/range
   * Get food logs for a date range
   */
  router.get('/range', async (req, res) => {
    try {
      const { hid, startDate, endDate } = req.query;

      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Missing startDate or endDate' });
      }

      const logs = await foodLogService.getLogsInRange(hid, startDate, endDate);
      res.json({ logs });
    } catch (error) {
      logger?.error?.('nutrition.range.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

export default router;
