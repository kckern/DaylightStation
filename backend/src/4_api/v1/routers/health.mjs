/**
 * Health API Router
 *
 * Provides REST API for health metrics including weight, workouts,
 * nutrition, and aggregated daily health data.
 *
 * @module api/routers/health
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { nowDate } from '#system/utils/time.mjs';

/**
 * Create Health API router
 *
 * @param {Object} config
 * @param {Object} config.healthService - AggregateHealthUseCase instance
 * @param {Object} config.healthStore - YamlHealthStore instance
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.nutriListStore] - YamlNutriListStore for nutrilist operations
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHealthRouter(config) {
  const { healthService, healthStore, configService, nutriListStore, dashboardService, catalogService, webNutribotAdapter, longitudinalService, setDailyCoachingUseCase, logger = console } = config;
  const router = express.Router();

  // JSON parsing middleware
  router.use(express.json({ strict: false }));

  /**
   * Get default username for requests
   */
  const getDefaultUsername = () => {
    return configService?.getHeadOfHousehold?.() ||
           configService?.getDefaultUsername?.() ||
           'default';
  };

  /**
   * Get default household ID for nutrilist operations
   */
  const getDefaultHouseholdId = () => {
    return configService?.getDefaultHouseholdId?.() ||
           process.env.household_id ||
           'default';
  };

  /**
   * Get today's date in YYYY-MM-DD format
   */
  const getToday = () => {
    return nowDate();
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
      data: healthData
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
      data: metric.toJSON()
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
      data: metrics,
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
    const weightData = await healthStore.loadWeightData(username);

    // Return data directly to match legacy /data/lifelog/weight response
    res.json(weightData || {});
  }));

  /**
   * GET /health/workouts
   * Get workout/activity data
   */
  router.get('/workouts', asyncHandler(async (req, res) => {
    const username = getDefaultUsername();
    const activityData = await healthStore.loadActivityData(username);

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
    const fitnessData = await healthStore.loadFitnessData(username);

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
    const nutritionData = await healthStore.loadNutritionData(username);

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
    const coachingData = await healthStore.loadCoachingData(username);

    res.json({
      message: 'Health coaching data retrieved successfully',
      data: coachingData
    });
  }));

  /**
   * POST /health/coaching/:date
   * Set the daily coaching compliance entry for a date (PRD F-001).
   * Body shape matches DailyCoachingEntry — passed straight through to the
   * SetDailyCoachingUseCase, which handles validation.
   */
  router.post('/coaching/:date', asyncHandler(async (req, res) => {
    const username = req.query.username || configService?.getHeadOfHousehold?.();
    if (!username) {
      return res.status(400).json({ error: 'username required' });
    }
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: `invalid date: ${date}` });
    }
    if (!setDailyCoachingUseCase) {
      return res.status(503).json({ error: 'set-daily-coaching not wired' });
    }
    try {
      await setDailyCoachingUseCase.execute({
        userId: username,
        date,
        coaching: req.body,
      });
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

  if (nutriListStore) {
    /**
     * GET /health/nutrilist
     * Get today's nutrilist items
     */
    router.get('/nutrilist', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const today = getToday();

      logger.debug?.('health.nutrilist.today', { userId, date: today });

      const items = await nutriListStore.findByDate(userId, today);

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

      const item = await nutriListStore.findByUuid(userId, uuid);

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

      const items = await nutriListStore.findByDate(userId, date);

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

      const newItem = {
        uuid: uuidv4(),
        userId,
        item: itemData.item || itemData.name,
        name: itemData.name || itemData.item,
        unit: itemData.unit || 'g',
        amount: itemData.amount || itemData.grams || 0,
        grams: itemData.grams || itemData.amount || 0,
        noom_color: itemData.noom_color || itemData.color || 'yellow',
        color: itemData.color || itemData.noom_color || 'yellow',
        calories: itemData.calories || 0,
        fat: itemData.fat || 0,
        carbs: itemData.carbs || 0,
        protein: itemData.protein || 0,
        fiber: itemData.fiber || 0,
        sugar: itemData.sugar || 0,
        sodium: itemData.sodium || 0,
        cholesterol: itemData.cholesterol || 0,
        date: itemData.date || getToday(),
        log_uuid: itemData.log_uuid || 'MANUAL'
      };

      logger.debug?.('health.nutrilist.create', { userId, item: newItem.item });

      await nutriListStore.saveMany([newItem]);

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
      const existingItem = await nutriListStore.findByUuid(userId, uuid);
      if (!existingItem) {
        return res.status(404).json({ error: 'Nutrilist item not found' });
      }

      // Filter allowed fields
      const allowedFields = [
        'item', 'name', 'unit', 'amount', 'grams', 'noom_color', 'color',
        'calories', 'fat', 'carbs', 'protein', 'fiber', 'sugar', 'sodium', 'cholesterol', 'date'
      ];
      const filteredUpdate = {};
      Object.keys(updateData).forEach(key => {
        if (allowedFields.includes(key)) {
          filteredUpdate[key] = updateData[key];
        }
      });

      logger.debug?.('health.nutrilist.update', { userId, uuid, fields: Object.keys(filteredUpdate) });

      const updatedItem = await nutriListStore.update(userId, uuid, filteredUpdate);

      res.json({
        message: 'Nutrilist item updated successfully',
        data: updatedItem
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
      const existingItem = await nutriListStore.findByUuid(userId, uuid);
      if (!existingItem) {
        return res.status(404).json({ error: 'Nutrilist item not found' });
      }

      logger.debug?.('health.nutrilist.delete', { userId, uuid });

      const result = await nutriListStore.deleteById(userId, uuid);

      if (result) {
        res.json({
          message: 'Nutrilist item deleted successfully',
          uuid
        });
      } else {
        res.status(500).json({ error: 'Failed to delete nutrilist item' });
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
      return res.json({ items: results.map(e => e.toJSON()), count: results.length });
    }));

    /**
     * GET /api/v1/health/nutrition/catalog/recent - Recent catalog entries
     * Query: limit (default 10)
     */
    router.get('/nutrition/catalog/recent', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const limit = parseInt(req.query.limit) || 10;
      const results = await catalogService.getRecent(userId, limit);
      return res.json({ items: results.map(e => e.toJSON()), count: results.length });
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

  }

  // ==========================================================================
  // Nutrition Input Endpoint (Web → Nutribot Pipeline)
  // ==========================================================================

  if (webNutribotAdapter) {
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
        const result = await webNutribotAdapter.process({ type, content, userId });
        return res.json(result);
      } catch (err) {
        logger.error?.('health.nutrition.input.error', { type, error: err.message });
        return res.status(500).json({ error: err.message });
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
        const result = await webNutribotAdapter.processCallback({ callbackData, userId, messageId });
        return res.json(result);
      } catch (err) {
        logger.error?.('health.nutrition.callback.error', { error: err.message });
        return res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  });

  return router;
}

export default createHealthRouter;
