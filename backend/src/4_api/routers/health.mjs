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

/**
 * Create Health API router
 *
 * @param {Object} config
 * @param {Object} config.healthService - HealthAggregationService instance
 * @param {Object} config.healthStore - YamlHealthStore instance
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.nutriListStore] - YamlNutriListStore for nutrilist operations
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHealthRouter(config) {
  const { healthService, healthStore, configService, nutriListStore, logger = console } = config;
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
  // Error Handler
  // ==========================================================================

  const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
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

    const healthData = await healthService.aggregateDailyHealth(username, days);

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
   * Get Strava workout data
   */
  router.get('/workouts', asyncHandler(async (req, res) => {
    const username = getDefaultUsername();
    const stravaData = await healthStore.loadStravaData(username);

    res.json({
      message: 'Workout data retrieved successfully',
      data: stravaData
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
        'GET /workouts - Get Strava workout data',
        'GET /fitness - Get fitness tracking data',
        'GET /nutrition - Get nutrition data',
        'GET /coaching - Get health coaching messages',
        'GET /nutrilist - Get today\'s nutrilist items',
        'GET /nutrilist/:date - Get nutrilist items for date',
        'GET /nutrilist/item/:uuid - Get single nutrilist item',
        'POST /nutrilist - Create nutrilist item',
        'PUT /nutrilist/:uuid - Update nutrilist item',
        'DELETE /nutrilist/:uuid - Delete nutrilist item',
        'GET /status - This endpoint'
      ]
    });
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
      const hid = getDefaultHouseholdId();
      const today = getToday();

      logger.debug?.('health.nutrilist.today', { hid, date: today });

      const items = await nutriListStore.findByDate(hid, today);

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
      const hid = getDefaultHouseholdId();

      logger.debug?.('health.nutrilist.item', { hid, uuid });

      const item = await nutriListStore.findByUuid(hid, uuid);

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
      const hid = getDefaultHouseholdId();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }

      logger.debug?.('health.nutrilist.byDate', { hid, date });

      const items = await nutriListStore.findByDate(hid, date);

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
      const hid = getDefaultHouseholdId();
      const itemData = req.body;

      if (!itemData.item && !itemData.name) {
        return res.status(400).json({ error: 'Item name is required' });
      }

      const newItem = {
        uuid: uuidv4(),
        userId: hid,
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

      logger.debug?.('health.nutrilist.create', { hid, item: newItem.item });

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
      const hid = getDefaultHouseholdId();
      const updateData = req.body;

      // Check if item exists
      const existingItem = await nutriListStore.findByUuid(hid, uuid);
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

      logger.debug?.('health.nutrilist.update', { hid, uuid, fields: Object.keys(filteredUpdate) });

      const updatedItem = await nutriListStore.update(hid, uuid, filteredUpdate);

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
      const hid = getDefaultHouseholdId();

      // Check if item exists
      const existingItem = await nutriListStore.findByUuid(hid, uuid);
      if (!existingItem) {
        return res.status(404).json({ error: 'Nutrilist item not found' });
      }

      logger.debug?.('health.nutrilist.delete', { hid, uuid });

      const result = await nutriListStore.deleteById(hid, uuid);

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
