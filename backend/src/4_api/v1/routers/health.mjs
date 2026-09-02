import { sendInternalError } from '#api/utils/internalError.mjs';
/**
 * Health API Router
 *
 * Provides REST API for health metrics including weight, workouts,
 * nutrition, and aggregated daily health data.
 *
 * @module api/routers/health
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { presentFoodCatalogEntry } from '../presenters/FoodCatalogPresenter.mjs';

function serializeWorkout(workout) {
  const record = {
    source: workout.source,
    title: workout.title,
    type: workout.type,
    duration: workout.duration,
    calories: workout.calories
  };

  if (workout.avgHr) record.avgHr = workout.avgHr;
  if (workout.maxHr) record.maxHr = workout.maxHr;
  if (workout.distance) record.distance = workout.distance;
  if (workout.startTime) record.startTime = workout.startTime;
  if (workout.endTime) record.endTime = workout.endTime;
  if (workout.strava) record.strava = workout.strava;
  if (workout.fitness) record.fitness = workout.fitness;
  return record;
}

function serializeHealthMetric(metric) {
  const summary = metric.getWorkoutSummary();
  return {
    date: metric.date,
    weight: metric.weight,
    nutrition: metric.nutrition,
    steps: metric.steps,
    workouts: metric.workouts.map(serializeWorkout),
    summary: {
      total_workout_calories: summary.totalCalories,
      total_workout_duration: summary.totalDuration,
    },
    coaching: metric.coaching,
  };
}

/**
 * Create Health API router
 *
 * @param {Object} config
 * @param {Object} config.healthService - AggregateHealthUseCase instance
 * @param {Object} config.healthOperations - Cohesive health data queries and commands
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHealthRouter(config) {
  const { healthService, healthOperations, dashboardService, catalogService, longitudinalService, budgetService, savedMealsService, medicalService, logger = console } = config;
  const router = express.Router();

  // JSON parsing middleware
  router.use(express.json({ strict: false }));

  /**
   * Get default username for requests
   */
  const getDefaultUsername = () => {
    return healthOperations.defaultUsername();
  };

  /**
   * Get today's date in YYYY-MM-DD format
   */
  const getToday = () => {
    return healthOperations.currentDate();
  };

  // ==========================================================================
  // Aggregate Health Endpoints
  // ==========================================================================

  /**
   * GET /health/daily
   * Get comprehensive daily health data (aggregated from all sources)
   */
  router.get('/daily', asyncHandler(async (req, res) => {
    const days = parseInt(req.query.days) || 15;
    const username = getDefaultUsername();

    logger.debug?.('health.daily.request', { username, days });

    const healthData = await healthService.execute(username, days, new Date());

    logger.info?.('health.daily.success', {
      username,
      days,
      recordCount: Object.keys(healthData).length
    });

    res.json({
      message: 'Daily health data retrieved successfully',
      data: Object.fromEntries(
        Object.entries(healthData).map(([date, metric]) => [date, serializeHealthMetric(metric)])
      )
    });
  }));

  /**
   * GET /health/longitudinal
   * Get longitudinal (30-day daily + 26-week weekly) aggregated health data
   */
  router.get('/longitudinal', asyncHandler(async (req, res) => {
    const username = req.query.userId || getDefaultUsername();
    const result = await longitudinalService.aggregate(username);
    res.json(result);
  }));

  /**
   * GET /health/date/:date
   * Get health metrics for a specific date
   */
  router.get('/date/:date', asyncHandler(async (req, res) => {
    const { date } = req.params;
    const username = getDefaultUsername();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const metric = await healthService.getHealthForDate(username, date);

    if (!metric) {
      return res.status(404).json({ error: 'No health data for this date', date });
    }

    res.json({
      message: 'Health data retrieved successfully',
      data: serializeHealthMetric(metric)
    });
  }));

  /**
   * GET /health/range
   * Get health metrics for a date range
   */
  router.get('/range', asyncHandler(async (req, res) => {
    const { start, end } = req.query;
    const username = getDefaultUsername();

    if (!start || !end) {
      return res.status(400).json({ error: 'start and end query parameters required' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const metrics = await healthService.getHealthForRange(username, start, end);

    res.json({
      message: 'Health data retrieved successfully',
      data: Object.fromEntries(
        Object.entries(metrics).map(([date, metric]) => [date, serializeHealthMetric(metric)])
      ),
      range: { start, end }
    });
  }));

  // ==========================================================================
  // Individual Data Source Endpoints
  // ==========================================================================

  /**
   * GET /health/weight
   * Get weight data (legacy parity: returns data directly, keyed by date)
   */
  router.get('/weight', asyncHandler(async (req, res) => {
    const username = getDefaultUsername();
    const weightData = await healthOperations.readWeight(username);

    // Return data directly to match legacy /data/lifelog/weight response
    res.json(weightData || {});
  }));

  /**
   * GET /health/workouts
   * Get workout/activity data
   */
  router.get('/workouts', asyncHandler(async (req, res) => {
    const username = getDefaultUsername();
    const activityData = await healthOperations.readActivity(username);

    res.json({
      message: 'Workout data retrieved successfully',
      data: activityData
    });
  }));

  /**
   * GET /health/fitness
   * Get fitness tracking data (FitnessSyncer)
   */
  router.get('/fitness', asyncHandler(async (req, res) => {
    const username = getDefaultUsername();
    const fitnessData = await healthOperations.readFitness(username);

    res.json({
      message: 'Fitness data retrieved successfully',
      data: fitnessData
    });
  }));

  /**
   * GET /health/nutrition
   * Get nutrition data
   */
  router.get('/nutrition', asyncHandler(async (req, res) => {
    const username = getDefaultUsername();
    const nutritionData = await healthOperations.readNutrition(username);

    res.json({
      message: 'Nutrition data retrieved successfully',
      data: nutritionData
    });
  }));

  /**
   * GET /health/coaching
   * Get health coaching data
   */
  router.get('/coaching', asyncHandler(async (req, res) => {
    const username = getDefaultUsername();
    const coachingData = await healthOperations.readCoaching(username);

    res.json({
      message: 'Health coaching data retrieved successfully',
      data: coachingData
    });
  }));

  /**
   * GET /health/coaching/schema
   * Return the user's coaching dimension schema (F2-D). The frontend's
   * CoachingComplianceCard fetches this on mount and renders one input row
   * per declared dimension. When the user has no playbook (or the playbook
   * lacks `coaching_dimensions`), returns `{ coaching_dimensions: [] }` and
   * the UI shows an empty-state message.
   */
  router.get('/coaching/schema', asyncHandler(async (req, res) => {
    const username = healthOperations.coachingUsername(req.query.username);
    if (!username) {
      return res.status(400).json({ error: 'username required' });
    }
    if (!healthOperations.coachingSchemaAvailable) {
      logger.warn?.('health.coaching.schema.loader_missing', { username });
      return res.json({ coaching_dimensions: [] });
    }
    try {
      const dims = await healthOperations.readCoachingDimensions(username);
      logger.info?.('health.coaching.schema.loaded', {
        username,
        dimensionCount: dims.length,
      });
      return res.json({ coaching_dimensions: dims });
    } catch (err) {
      logger.warn?.('health.coaching.schema.load_failed', {
        username,
        error: err.message,
      });
      return sendInternalError(res, { error: err.message });
    }
  }));

  /**
   * POST /health/coaching/:date
   * Set the daily coaching compliance entry for a date (PRD F-001).
   * Body shape matches DailyCoachingEntry — passed straight through to the
   * SetDailyCoachingUseCase, which handles validation.
   */
  router.post('/coaching/:date', asyncHandler(async (req, res) => {
    const username = healthOperations.coachingUsername(req.query.username);
    if (!username) {
      return res.status(400).json({ error: 'username required' });
    }
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: `invalid date: ${date}` });
    }
    if (!healthOperations.dailyCoachingAvailable) {
      return res.status(503).json({ error: 'set-daily-coaching not wired' });
    }
    try {
      await healthOperations.saveDailyCoaching(username, date, req.body);
      logger.info?.('health.coaching.saved', { username, date });
      return res.json({ message: 'coaching saved', date });
    } catch (err) {
      logger.warn?.('health.coaching.save_failed', { username, date, error: err.message });
      return res.status(422).json({ error: err.message });
    }
  }));

  // ==========================================================================
  // Status Endpoint
  // ==========================================================================

  /**
   * GET /health/status
   * Health router status
   */
  router.get('/status', asyncHandler(async (req, res) => {
    res.json({
      message: 'Health router is operational',
      timestamp: nowTs(),
      endpoints: [
        'GET /daily - Get comprehensive daily health data',
        'GET /date/:date - Get health data for specific date (YYYY-MM-DD)',
        'GET /range?start=&end= - Get health data for date range',
        'GET /weight - Get weight tracking data',
        'GET /workouts - Get workout/activity data',
        'GET /fitness - Get fitness tracking data',
        'GET /nutrition - Get nutrition data',
        'GET /coaching - Get health coaching messages',
        'GET /nutrilist - Get today\'s nutrilist items',
        'GET /nutrilist/:date - Get nutrilist items for date',
        'GET /nutrilist/item/:uuid - Get single nutrilist item',
        'POST /nutrilist - Create nutrilist item',
        'PUT /nutrilist/:uuid - Update nutrilist item',
        'DELETE /nutrilist/:uuid - Delete nutrilist item',
        'GET /status - This endpoint',
        'GET /dashboard - Unified health dashboard (today, history, goals, recency)'
      ]
    });
  }));

  /**
   * GET /health/dashboard - Unified health dashboard
   * Query params:
   *   - userId: username (optional, defaults to head of household)
   */
  router.get('/dashboard', asyncHandler(async (req, res) => {
    if (!dashboardService) {
      return res.status(501).json({ error: 'Dashboard service not configured' });
    }
    const userId = req.query.userId || getDefaultUsername();
    logger.debug?.('health.dashboard.request', { userId });

    const dashboard = await dashboardService.execute(userId);
    return res.json(dashboard);
  }));

  // ==========================================================================
  // NutriList Endpoints (Legacy Parity)
  // ==========================================================================

  if (healthOperations.nutritionItemsAvailable) {
    /**
     * GET /health/nutrilist
     * Get today's nutrilist items
     */
    router.get('/nutrilist', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const today = getToday();

      logger.debug?.('health.nutrilist.today', { userId, date: today });

      const items = await healthOperations.findNutritionItemsByDate(userId, today);

      res.json({
        message: "Today's nutrilist items retrieved successfully",
        data: items,
        date: today,
        count: items.length
      });
    }));

    /**
     * GET /health/nutrilist/item/:uuid
     * Get a single nutrilist item by UUID
     */
    router.get('/nutrilist/item/:uuid', asyncHandler(async (req, res) => {
      const { uuid } = req.params;
      const userId = getDefaultUsername();

      logger.debug?.('health.nutrilist.item', { userId, uuid });

      const item = await healthOperations.findNutritionItem(userId, uuid);

      if (!item) {
        return res.status(404).json({ error: 'Nutrilist item not found' });
      }

      res.json({
        message: 'Nutrilist item retrieved successfully',
        data: item
      });
    }));

    /**
     * GET /health/nutrilist/:date
     * Get nutrilist items for a specific date
     */
    router.get('/nutrilist/:date', asyncHandler(async (req, res) => {
      const { date } = req.params;
      const userId = getDefaultUsername();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }

      logger.debug?.('health.nutrilist.byDate', { userId, date });

      const items = await healthOperations.findNutritionItemsByDate(userId, date);

      res.json({
        message: 'Nutrilist items retrieved successfully',
        data: items,
        date,
        count: items.length
      });
    }));

    /**
     * POST /health/nutrilist
     * Create a new nutrilist item
     */
    router.post('/nutrilist', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const itemData = req.body;

      if (!itemData.item && !itemData.name) {
        return res.status(400).json({ error: 'Item name is required' });
      }

      const newItem = await healthOperations.createNutritionItem(userId, itemData);

      logger.debug?.('health.nutrilist.create', { userId, item: newItem.item });

      res.status(201).json({
        message: 'Nutrilist item created successfully',
        data: newItem
      });
    }));

    /**
     * PUT /health/nutrilist/:uuid
     * Update a nutrilist item
     */
    router.put('/nutrilist/:uuid', asyncHandler(async (req, res) => {
      const { uuid } = req.params;
      const userId = getDefaultUsername();
      const updateData = req.body;

      // Check if item exists
      const update = await healthOperations.updateNutritionItem(userId, uuid, updateData);
      if (!update) {
        return res.status(404).json({ error: 'Nutrilist item not found' });
      }

      logger.debug?.('health.nutrilist.update', { userId, uuid, fields: update.changedFields });

      res.json({
        message: 'Nutrilist item updated successfully',
        data: update.item
      });
    }));

    /**
     * DELETE /health/nutrilist/:uuid
     * Delete a nutrilist item
     */
    router.delete('/nutrilist/:uuid', asyncHandler(async (req, res) => {
      const { uuid } = req.params;
      const userId = getDefaultUsername();

      // Check if item exists
      const result = await healthOperations.deleteNutritionItem(userId, uuid);
      if (!result.found) {
        return res.status(404).json({ error: 'Nutrilist item not found' });
      }

      logger.debug?.('health.nutrilist.delete', { userId, uuid });

      if (result.deleted) {
        res.json({
          message: 'Nutrilist item deleted successfully',
          uuid
        });
      } else {
        sendInternalError(res, { error: 'Failed to delete nutrilist item' });
      }
    }));
  }

  // ==========================================================================
  // Food Catalog Endpoints
  // ==========================================================================

  if (catalogService) {

    /**
     * GET /api/v1/health/nutrition/catalog - Search food catalog
     * Query: q (search string), limit (default 10)
     */
    router.get('/nutrition/catalog', asyncHandler(async (req, res) => {
      const { q, limit } = req.query;
      const userId = getDefaultUsername();
      if (!q) {
        return res.status(400).json({ error: 'q query param required' });
      }
      const results = await catalogService.search(q, userId, parseInt(limit) || 10);
      return res.json({ items: results.map(presentFoodCatalogEntry), count: results.length });
    }));

    /**
     * GET /api/v1/health/nutrition/catalog/recent - Recent catalog entries
     * Query: limit (default 10)
     */
    router.get('/nutrition/catalog/recent', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const limit = parseInt(req.query.limit) || 10;
      const results = await catalogService.getRecent(userId, limit);
      return res.json({ items: results.map(presentFoodCatalogEntry), count: results.length });
    }));

    /**
     * POST /api/v1/health/nutrition/catalog/quickadd - Quick-add a catalog entry
     * Body: { catalogEntryId }
     */
    router.post('/nutrition/catalog/quickadd', asyncHandler(async (req, res) => {
      const { catalogEntryId } = req.body;
      if (!catalogEntryId) {
        return res.status(400).json({ error: 'catalogEntryId is required' });
      }
      const userId = getDefaultUsername();
      try {
        const item = await catalogService.quickAdd(catalogEntryId, userId);
        return res.json({ logged: true, item });
      } catch (err) {
        logger.error?.('health.catalog.quickadd.error', { catalogEntryId, error: err.message });
        return res.status(404).json({ error: err.message });
      }
    }));

    /**
     * POST /api/v1/health/nutrition/catalog/backfill - Seed catalog from existing data
     * Body: { daysBack } (default 90)
     */
    router.post('/nutrition/catalog/backfill', asyncHandler(async (req, res) => {
      const daysBack = parseInt(req.body.daysBack) || 90;
      const userId = getDefaultUsername();
      const result = await catalogService.backfill(userId, daysBack);
      return res.json(result);
    }));

    /**
     * GET /api/v1/health/nutrition/catalog/suggest - Ranked suggestions for add-combobox
     * Query: q (search string), limit (default 12)
     */
    router.get('/nutrition/catalog/suggest', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const { q = '', limit } = req.query;
      const items = await catalogService.suggest(q, userId, parseInt(limit) || 12);
      return res.json({ items });
    }));

    /**
     * PUT /api/v1/health/nutrition/catalog/favorite - Toggle favorite by id or name
     * Body: { id?, name?, favorite }
     */
    router.put('/nutrition/catalog/favorite', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const { id, name, favorite } = req.body;
      if (!id && !name) return res.status(400).json({ error: 'id or name is required' });
      try {
        const entry = id
          ? await catalogService.setFavorite(id, userId, favorite)
          : await catalogService.setFavoriteByName(name, userId, favorite);
        return res.json({ entry });
      } catch (err) {
        return res.status(404).json({ error: err.message });
      }
    }));

    /**
     * POST /api/v1/health/nutrition/catalog - Create a custom food, optionally mapped to a barcode
     * Body: { name, calories, protein, carbs, fat, barcodeUpc? }
     */
    router.post('/nutrition/catalog', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const { name, calories, protein, carbs, fat, barcodeUpc } = req.body;
      if (!name) return res.status(400).json({ error: 'name is required' });
      const entry = await catalogService.createCustom({ name, calories, protein, carbs, fat, barcodeUpc }, userId);
      return res.json({ entry });
    }));

  }

  // ==========================================================================
  // Budget & Goals (BudgetService)
  // ==========================================================================
  if (budgetService) {
    router.get('/budget', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      try {
        return res.json(await budgetService.getBudget(userId, date));
      } catch (err) {
        if (err.code === 'GOALS_NOT_CONFIGURED' || err.code === 'NO_WEIGHT_DATA') {
          return res.status(409).json({ error: err.message, code: err.code });
        }
        logger.error?.('health.budget.error', { date, error: err.message });
        return sendInternalError(res, { error: err.message });
      }
    }));

    router.get('/goals', asyncHandler(async (req, res) => {
      const goals = await budgetService.getGoals(getDefaultUsername());
      return res.json({ goals });
    }));

    router.put('/goals', asyncHandler(async (req, res) => {
      try {
        const goals = await budgetService.setGoals(getDefaultUsername(), req.body);
        return res.json({ goals });
      } catch (err) {
        if (err.code === 'GOALS_WRITE_FAILED') {
          logger.error?.('health.goals.put.write_failed', { error: err.message });
          return sendInternalError(res, { error: err.message, code: err.code });
        }
        logger.error?.('health.goals.put.error', { error: err.message });
        return sendInternalError(res, { error: err.message });
      }
    }));
  }

  // ==========================================================================
  // Saved Meals (SavedMealsService)
  // ==========================================================================
  if (savedMealsService) {
    router.get('/nutrition/meals', asyncHandler(async (req, res) =>
      res.json({ meals: await savedMealsService.list(getDefaultUsername()) })));

    router.post('/nutrition/meals', asyncHandler(async (req, res) => {
      const { name, items } = req.body;
      try {
        return res.json({ meal: await savedMealsService.create({ name, items }, getDefaultUsername()) });
      } catch (err) {
        if (err.code === 'MEALS_WRITE_FAILED') {
          logger.error?.('health.meals.create.write_failed', { error: err.message });
          return sendInternalError(res, { error: err.message, code: err.code });
        }
        return res.status(400).json({ error: err.message });
      }
    }));

    router.post('/nutrition/meals/:id/log', asyncHandler(async (req, res) => {
      const { date, mealTime } = req.body || {};
      try {
        return res.json(await savedMealsService.logToDate(req.params.id, getDefaultUsername(), { date, mealTime }));
      } catch (err) {
        if (err.code === 'MEALS_WRITE_FAILED') {
          logger.error?.('health.meals.log.write_failed', { error: err.message });
          return sendInternalError(res, { error: err.message, code: err.code });
        }
        return res.status(404).json({ error: err.message });
      }
    }));

    router.delete('/nutrition/meals/:id', asyncHandler(async (req, res) => {
      try {
        await savedMealsService.remove(req.params.id, getDefaultUsername());
        return res.json({ ok: true });
      } catch (err) {
        if (err.code === 'MEALS_WRITE_FAILED') {
          logger.error?.('health.meals.remove.write_failed', { error: err.message });
          return sendInternalError(res, { error: err.message, code: err.code });
        }
        throw err;
      }
    }));
  }

  // ==========================================================================
  // Medical Readings Endpoints
  // ==========================================================================

  if (medicalService) {
    router.get('/medical', asyncHandler(async (req, res) =>
      res.json(await medicalService.listGrouped(getDefaultUsername()))));

    router.post('/medical', asyncHandler(async (req, res) => {
      try {
        return res.json({ reading: await medicalService.add(req.body, getDefaultUsername()) });
      } catch (err) {
        if (err.code === 'INVALID_READING') return res.status(400).json({ error: err.message });
        if (err.code === 'MEDICAL_WRITE_FAILED') {
          logger.error?.('health.medical.add.write_failed', { error: err.message });
          return sendInternalError(res, { error: err.message, code: err.code });
        }
        throw err;
      }
    }));

    router.delete('/medical/:id', asyncHandler(async (req, res) => {
      try {
        await medicalService.remove(req.params.id, getDefaultUsername());
        return res.json({ ok: true });
      } catch (err) {
        if (err.code === 'MEDICAL_WRITE_FAILED') {
          logger.error?.('health.medical.remove.write_failed', { error: err.message });
          return sendInternalError(res, { error: err.message, code: err.code });
        }
        throw err;
      }
    }));
  }

  // ==========================================================================
  // Nutrition Input Endpoint (Web → Nutribot Pipeline)
  // ==========================================================================

  if (healthOperations.nutritionInputAvailable) {
    /**
     * POST /health/nutrition/input
     * Submit a nutrition input from the web UI directly into the nutribot pipeline.
     *
     * Body:
     *   - type: "text" | "voice" | "image" | "barcode" (required)
     *   - content: text string or barcode/UPC value (for text/barcode types)
     */
    router.post('/nutrition/input', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const { type, content } = req.body;
      if (!type) {
        return res.status(400).json({ error: 'type is required (text, voice, image, barcode)' });
      }
      try {
        const result = await healthOperations.processNutritionInput({ type, content, userId });
        return res.json(result);
      } catch (err) {
        logger.error?.('health.nutrition.input.error', { type, error: err.message });
        return sendInternalError(res, { error: err.message });
      }
    }));

    /**
     * POST /api/v1/health/nutrition/callback - Process Accept/Revise/Discard callback
     * Body: { callbackData: string, messageId?: string }
     */
    router.post('/nutrition/callback', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const { callbackData, messageId } = req.body;
      if (!callbackData) {
        return res.status(400).json({ error: 'callbackData is required' });
      }
      try {
        const result = await healthOperations.processNutritionCallback({ callbackData, userId, messageId });
        return res.json(result);
      } catch (err) {
        logger.error?.('health.nutrition.callback.error', { error: err.message });
        return sendInternalError(res, { error: err.message });
      }
    }));
  }

  // ==========================================================================
  // Error Handler Middleware
  // ==========================================================================

  router.use((err, req, res, next) => {
    logger.error?.('health.router.error', {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method
    });
    sendInternalError(res, { error: err.message });
  });

  return router;
}

export default createHealthRouter;
