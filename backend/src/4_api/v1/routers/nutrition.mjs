/**
 * Nutrition API Router
 *
 * REST API endpoints for nutrition/food logging operations.
 */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { nowDate } from '#system/utils/time.mjs';

/**
 * Create router with dependencies
 * @param {Object} deps
 * @param {Object} deps.foodLogService - Pre-built FoodLogService instance
 * @param {Object} deps.foodLogStore - Pre-built YamlFoodLogDatastore instance
 * @param {Object} [deps.logger] - Logger instance
 * @returns {express.Router}
 */
export function createNutritionRouter(deps) {
  const { foodLogService, foodLogStore, logger } = deps;
  const router = express.Router();

  /**
   * GET /api/nutrition
   * Get nutrition module overview
   */
  router.get('/', asyncHandler(async (req, res) => {
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
  }));

  /**
   * GET /api/nutrition/logs/dates
   * List all dates with food logs
   */
  router.get('/logs/dates', asyncHandler(async (req, res) => {
    const { hid } = req.query;
    if (!hid) {
      return res.status(400).json({ error: 'Missing household ID (hid)' });
    }

    const dates = await foodLogStore.listDates(hid);
    res.json({ dates });
  }));

  /**
   * GET /api/nutrition/logs/:date
   * Get food log for a specific date
   */
  router.get('/logs/:date', asyncHandler(async (req, res) => {
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
  }));

  /**
   * POST /api/nutrition/logs/:date
   * Create or update food log for a date
   */
  router.post('/logs/:date', asyncHandler(async (req, res) => {
    const { hid } = req.query;
    const { date } = req.params;
    const entry = req.body;

    if (!hid) {
      return res.status(400).json({ error: 'Missing household ID (hid)' });
    }

    const log = await foodLogService.logFood(hid, date, entry);
    res.json(log);
  }));

  /**
   * DELETE /api/nutrition/logs/:date/entries/:index
   * Remove an entry from a food log
   */
  router.delete('/logs/:date/entries/:index', asyncHandler(async (req, res) => {
    const { hid } = req.query;
    const { date, index } = req.params;

    if (!hid) {
      return res.status(400).json({ error: 'Missing household ID (hid)' });
    }

    const log = await foodLogService.removeEntry(hid, date, parseInt(index, 10));
    res.json(log);
  }));

  /**
   * GET /api/nutrition/summary/:date
   * Get daily nutrition summary
   */
  router.get('/summary/:date', asyncHandler(async (req, res) => {
    const { hid } = req.query;
    const { date } = req.params;

    if (!hid) {
      return res.status(400).json({ error: 'Missing household ID (hid)' });
    }

    const summary = await foodLogService.getDailySummary(hid, date);
    res.json(summary);
  }));

  /**
   * GET /api/nutrition/summary/weekly/:weekStart
   * Get weekly nutrition summary
   */
  router.get('/summary/weekly/:weekStart', asyncHandler(async (req, res) => {
    const { hid } = req.query;
    const { weekStart } = req.params;

    if (!hid) {
      return res.status(400).json({ error: 'Missing household ID (hid)' });
    }

    const summary = await foodLogService.getWeeklySummary(hid, weekStart);
    res.json(summary);
  }));

  /**
   * GET /api/nutrition/range
   * Get food logs for a date range
   */
  router.get('/range', asyncHandler(async (req, res) => {
    const { hid, startDate, endDate } = req.query;

    if (!hid) {
      return res.status(400).json({ error: 'Missing household ID (hid)' });
    }
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Missing startDate or endDate' });
    }

    const logs = await foodLogService.getLogsInRange(hid, startDate, endDate);
    res.json({ logs });
  }));

  return router;
}

export default createNutritionRouter;
