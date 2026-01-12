/**
 * Health API Router
 *
 * Provides REST API for health metrics including weight, workouts,
 * nutrition, and aggregated daily health data.
 *
 * @module api/routers/health
 */

import express from 'express';

/**
 * Create Health API router
 *
 * @param {Object} config
 * @param {Object} config.healthService - HealthAggregationService instance
 * @param {Object} config.healthStore - YamlHealthStore instance
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHealthRouter(config) {
  const { healthService, healthStore, configService, logger = console } = config;
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
   * Get weight data
   */
  router.get('/weight', asyncHandler(async (req, res) => {
    const username = getDefaultUsername();
    const weightData = await healthStore.loadWeightData(username);

    res.json({
      message: 'Weight data retrieved successfully',
      data: weightData
    });
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
      timestamp: new Date().toISOString(),
      endpoints: [
        'GET /daily - Get comprehensive daily health data',
        'GET /date/:date - Get health data for specific date (YYYY-MM-DD)',
        'GET /range?start=&end= - Get health data for date range',
        'GET /weight - Get weight tracking data',
        'GET /workouts - Get Strava workout data',
        'GET /fitness - Get fitness tracking data',
        'GET /nutrition - Get nutrition data',
        'GET /coaching - Get health coaching messages',
        'GET /status - This endpoint'
      ]
    });
  }));

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
