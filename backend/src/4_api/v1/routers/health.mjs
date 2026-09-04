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
import { createLocalFileResource, sendLocalFileResource } from '#system/http/streamFile.mjs';
import { presentFoodCatalogEntry } from '../presenters/FoodCatalogPresenter.mjs';
import { isISODate } from '#shared/contracts/health/isoDate.mjs';
import { presentPendingNutritionLog } from '../presenters/PendingNutritionLogPresenter.mjs';

// Same allowlist PhotoStore enforces internally (1_adapters/persistence/PhotoStore.mjs).
// Duplicated here — not imported — because the API layer may not import
// adapters directly; this is the defense-in-depth check at the HTTP boundary,
// applied BEFORE the ref is handed to photoStore.resolvePath() at all.
const PHOTO_REF_PATTERN = /^ph_[A-Za-z0-9]+$/;

// Same four ids as MealTimes (2_domains/nutrition/entities/schemas.mjs) —
// duplicated here, not imported, for the same reason as PHOTO_REF_PATTERN
// above: the API layer may not import domains directly (api-no-domains).
const NUTRITION_MEAL_BUCKETS = ['morning', 'afternoon', 'evening', 'night'];
// Duplicated from VoiceMemoStore's AUDIO_REF_PATTERN for the same reason
// NUTRITION_MEAL_BUCKETS is duplicated from MealTimes: the API layer may not
// import an adapter (`api-no-adapters`). The store re-checks it against its own
// allowlist before the ref touches a path, so this is a shape gate, not the
// security boundary.
const AUDIO_REF_PATTERN = /^va_[A-Za-z0-9]+$/;

// Observation ids are exactly what `YamlObservationStore.append` mints (uuid v4), so
// the allowlist can be the UUID shape itself. Checked BEFORE the id reaches any store
// call, same defense-in-depth posture as PHOTO_REF_PATTERN above — a malformed id is a
// 400, never a lookup.
const OBSERVATION_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Food-log entry ids are not all uuids (short ids exist too), so this is a
// safe-characters allowlist rather than a shape: no slash, dot, whitespace or null byte
// can reach a datastore lookup. Existence is then checked by the lookup itself.
const ENTRY_UUID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Food-icon slugs are manifest KEYS, checked at the HTTP boundary before the
// value reaches the store at all. Same allowlist IconManifestStore enforces
// internally (1_adapters/persistence/IconManifestStore.mjs) — duplicated here,
// not imported, for the same reason as PHOTO_REF_PATTERN above: the API layer
// may not import adapters directly. The slug is never concatenated onto a path
// by anything: it can only select a manifest entry, whose own path the store
// validates independently.
const ICON_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

// The one date shape every health route accepts.
/**
 * The one shape check every date on this router uses.
 *
 * `isISODate` (not a bare regex): a regex passes "2026-02-31", which Date
 * silently normalizes to March 3, and "2026-08-32", whose later toISOString()
 * throws a RangeError and surfaces as a 500. Both are 400s.
 *
 * Returns null when the value is absent — ABSENT MEANS TODAY everywhere on
 * this router, which is why it is never coerced to null on the way through
 * (decision 2.6: a defaulted value would change what an absent one means).
 */
const validateOptionalDate = (value) => {
  if (value === undefined || value === null) return null;
  return isISODate(String(value))
    ? null
    : { error: 'Invalid date format. Use YYYY-MM-DD', code: 'DATE_INVALID' };
};

/**
 * Wire shape for one kitchen-scale observation. Explicit field list, never a spread of
 * the stored row: the day view reads these names, and a storage-side field added later
 * must not silently start crossing the HTTP boundary.
 */
function serializeObservation(o) {
  return {
    id: o.id,
    kind: o.kind,
    value: o.value,
    unit: o.unit ?? null,
    scaleId: o.scaleId,
    at: o.at,
    date: o.date,
    status: o.status,
    pairedEntryUuid: o.pairedEntryUuid ?? null,
  };
}

/** Local (not UTC) YYYY-MM-DD from a Date instance. */
function localDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
 * @param {Object} [config.observationPairing] - ObservationPairingService: read/re-pair/
 *   dismiss kitchen-scale observations. Absent = the three observation routes are not
 *   mounted at all (same gating style as catalogService/photoStore above).
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHealthRouter(config) {
  const { healthService, healthOperations, dashboardService, catalogService, longitudinalService, budgetService, savedMealsService, templateService = null, medicalService, photoStore = null, observationPairing = null, iconManifestStore = null, logger = console } = config;
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

  /**
   * Validate an `icon` a client wants written to a row or a catalog entry.
   *
   * Returns `{ ok: true, icon }` (icon normalized to null when cleared), or
   * `{ ok: false, error }`. Refusing an unknown slug HERE is what stops a
   * client pinning a food to a picture that will 404 forever afterwards while
   * the row silently shows its fallback glyph — the failure mode is invisible
   * once it is stored, so it has to be caught on the way in.
   *
   * With no manifest store configured the shape check still applies but
   * membership cannot be checked; the value is accepted and the row simply
   * falls back at render time. That is the same fail-soft posture the icon
   * route takes when no manifest is installed.
   */
  const validateIcon = (icon) => {
    if (icon === null || icon === undefined || icon === '') return { ok: true, icon: null };
    if (typeof icon !== 'string' || !ICON_SLUG_PATTERN.test(icon)) {
      return { ok: false, error: 'icon must be a manifest slug' };
    }
    if (iconManifestStore && !iconManifestStore.has(icon)) {
      return { ok: false, error: `Unknown icon: ${icon}` };
    }
    return { ok: true, icon };
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
   *
   * Single-user app: always resolves the head-of-household username.
   * Deliberately ignores any client-supplied userId (was a cross-user /
   * traversal vector into per-user datastore reads).
   */
  router.get('/longitudinal', asyncHandler(async (req, res) => {
    const username = getDefaultUsername();
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
   *
   * Single-user app: always resolves the head-of-household username.
   * Deliberately ignores any client-supplied userId (was a cross-user /
   * traversal vector into per-user datastore reads; see /longitudinal).
   */
  router.get('/dashboard', asyncHandler(async (req, res) => {
    if (!dashboardService) {
      return res.status(501).json({ error: 'Dashboard service not configured' });
    }
    const userId = getDefaultUsername();
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

      logger.info?.('health.nutrilist.create', { userId, uuid: newItem.uuid, name: newItem.name });

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

      // "Just this entry" (PRD F5.4) travels through this generic PUT, so the
      // icon is checked here rather than trusted from the client.
      if (updateData && Object.hasOwn(updateData, 'icon')) {
        const verdict = validateIcon(updateData.icon);
        if (!verdict.ok) return res.status(400).json({ error: verdict.error });
        updateData.icon = verdict.icon;
      }

      // Check if item exists
      const update = await healthOperations.updateNutritionItem(userId, uuid, updateData);
      if (!update) {
        return res.status(404).json({ error: 'Nutrilist item not found' });
      }

      logger.info?.('health.nutrilist.update', { userId, uuid, fields: update.changedFields });

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

      if (result.deleted) {
        logger.info?.('health.nutrilist.delete', { userId, uuid });
        res.json({
          message: 'Nutrilist item deleted successfully',
          uuid
        });
      } else {
        logger.error?.('health.nutrilist.delete.write_failed', { userId, uuid });
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
     * Body: { catalogEntryId, mealTime?, date? }
     *
     * `date` is the day the client is LOOKING AT. A row must land on the day
     * the person is looking at, not the day the server happens to be on — the
     * shipped bug was food added while viewing yesterday appearing on today.
     * ABSENT MEANS TODAY (decision 2.6), so it is never coerced to null.
     *
     * `mealTime` is the bucket the add row was launched from (Task 9.2). It is
     * applied by the quick-add itself, which is why the client no longer
     * follow-up-PUTs the row to move it: that PUT raced the day reload and left
     * the row in the clock's bucket whenever it failed.
     */
    router.post('/nutrition/catalog/quickadd', asyncHandler(async (req, res) => {
      const { catalogEntryId, mealTime, date } = req.body;
      if (!catalogEntryId) {
        return res.status(400).json({ error: 'catalogEntryId is required' });
      }
      const dateError = validateOptionalDate(date);
      if (dateError) return res.status(400).json(dateError);
      // A phantom bucket must be refused, not passed downstream — the same rule
      // /nutrition/input applies to its `bucket`.
      if (mealTime != null && !NUTRITION_MEAL_BUCKETS.includes(mealTime)) {
        return res.status(400).json({
          error: `Invalid mealTime: ${mealTime}. Must be one of: ${NUTRITION_MEAL_BUCKETS.join(', ')}`,
        });
      }
      const userId = getDefaultUsername();
      try {
        const item = await catalogService.quickAdd(catalogEntryId, userId, {
          mealTime: mealTime ?? undefined,
          date: date ?? undefined,
        });
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
     * Query: q (search string), limit (default 12), bucket (meal bucket, optional)
     *
     * `bucket` makes the ranking bucket-aware (PRD F8.1): the Breakfast row's
     * zero-keystroke list is that person's breakfast regulars. Omitted, the
     * ranking is the shipped bucket-blind one.
     */
    router.get('/nutrition/catalog/suggest', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const { q = '', limit, bucket } = req.query;
      if (bucket != null && !NUTRITION_MEAL_BUCKETS.includes(bucket)) {
        return res.status(400).json({
          error: `Invalid bucket: ${bucket}. Must be one of: ${NUTRITION_MEAL_BUCKETS.join(', ')}`,
        });
      }
      const max = parseInt(limit) || 12;
      const foods = await catalogService.suggest(q, userId, max, { bucket });
      // Templates slot in behind favourites (PRD F6.4). The ORDER is the
      // service's, not this route's: a ranking contract spelled out at an
      // endpoint is a ranking contract nothing can unit-test.
      const items = templateService
        ? await templateService.mergeIntoSuggestions(foods, { query: q, userId, limit: max })
        : foods;
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
        logger.warn?.('health.catalog.favorite.error', { id, name, error: err.message });
        return res.status(404).json({ error: err.message });
      }
    }));

    /**
     * PUT /api/v1/health/nutrition/catalog/icon - Pin a food's icon by id or name
     * Body: { id?, name?, icon }
     *
     * This is the "always for this food" half of the edit sheet's override
     * (PRD F5.4). Past rows follow on their next render, because a row's icon
     * is only a copy taken at log time — nothing rewrites history here.
     * `icon: null` clears back to the neutral fallback.
     */
    router.put('/nutrition/catalog/icon', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const { id, name, icon } = req.body || {};
      if (!id && !name) return res.status(400).json({ error: 'id or name is required' });
      const verdict = validateIcon(icon);
      if (!verdict.ok) return res.status(400).json({ error: verdict.error });
      try {
        const entry = id
          ? await catalogService.setIcon(id, userId, verdict.icon)
          : await catalogService.setIconByName(name, userId, verdict.icon);
        return res.json({ entry: presentFoodCatalogEntry(entry) });
      } catch (err) {
        logger.warn?.('health.catalog.icon.error', { id, name, error: err.message });
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

    /**
     * DELETE /api/v1/health/nutrition/catalog/:id - Permanently remove a catalog entry
     */
    router.delete('/nutrition/catalog/:id', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      try {
        await catalogService.remove(req.params.id, userId);
        return res.json({ ok: true });
      } catch (err) {
        if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
        if (err.code === 'CATALOG_WRITE_FAILED') {
          logger.error?.('health.catalog.remove.write_failed', { error: err.message });
          return sendInternalError(res, { error: err.message, code: err.code });
        }
        throw err;
      }
    }));

  }

  // ==========================================================================
  // Budget & Goals (BudgetService)
  // ==========================================================================
  if (budgetService) {
    router.get('/budget', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      // LOCAL date, not UTC — new Date().toISOString() reads as tomorrow
      // every evening in this household's timezone (UTC-7/8).
      const date = req.query.date || localDateISO(new Date());
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

    // The batched cousin of GET /budget: one request for a whole strip/block
    // instead of one per day (the 7-cell week strip and the 30-day sidebar
    // block each used to fan out into that many parallel /budget calls).
    //
    // A day the equation cannot be computed for comes back INSIDE the array as
    // `{ date, error: 'NO_WEIGHT_DATA' }`. It is a gap in a chart, not a failed
    // request — a 500 for the whole range because one day predates the scale
    // would make the strip unusable for anyone with a short weight history.
    router.get('/budget/range', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const { from, to } = req.query;
      try {
        return res.json({ days: await budgetService.getBudgetRange(userId, from, to) });
      } catch (err) {
        if (err.code === 'RANGE_INVALID') {
          return res.status(400).json({ error: err.message, code: err.code });
        }
        if (err.code === 'GOALS_NOT_CONFIGURED') {
          return res.status(409).json({ error: err.message, code: err.code });
        }
        logger.error?.('health.budget.range.error', { from, to, error: err.message });
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
        // A malformed macroGoals/watchMicros shape is the caller's fault, not
        // ours — 400, with the coded reason, so the goals form can say what is
        // wrong instead of reporting a server failure.
        if (err.code === 'GOALS_INVALID') {
          return res.status(400).json({ error: err.message, code: err.code });
        }
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
  // Meal Templates (TemplateService)
  //
  // Distinct from saved meals above, which stay as the copy-day-to-today
  // transport (PRD F6.3): a template carries core/variant roles and lands as a
  // dish GROUP, a saved meal is a flat snapshot list.
  // ==========================================================================
  if (templateService) {
    router.get('/nutrition/templates', asyncHandler(async (req, res) => {
      const includeProposed = req.query.includeProposed === '1' || req.query.includeProposed === 'true';
      return res.json({ templates: await templateService.list(getDefaultUsername(), { includeProposed }) });
    }));

    router.post('/nutrition/templates', asyncHandler(async (req, res) => {
      const { name, icon, components } = req.body || {};
      try {
        return res.json({ template: await templateService.create({ name, icon, components }, getDefaultUsername()) });
      } catch (err) {
        if (err.code === 'TEMPLATES_WRITE_FAILED') {
          logger.error?.('health.templates.create.write_failed', { error: err.message });
          return sendInternalError(res, { error: err.message, code: err.code });
        }
        return res.status(400).json({ error: err.message, code: err.code });
      }
    }));

    router.post('/nutrition/templates/:id/instantiate', asyncHandler(async (req, res) => {
      const { date, mealTime, variantNames } = req.body || {};
      const dateError = validateOptionalDate(date);
      if (dateError) return res.status(400).json(dateError);
      if (mealTime !== undefined && mealTime !== null && !NUTRITION_MEAL_BUCKETS.includes(mealTime)) {
        return res.status(400).json({ error: `Invalid bucket: ${mealTime}`, code: 'BUCKET_INVALID' });
      }
      if (variantNames !== undefined && !Array.isArray(variantNames)) {
        return res.status(400).json({ error: 'variantNames must be an array', code: 'VARIANTS_INVALID' });
      }
      try {
        return res.json(await templateService.instantiate(req.params.id, getDefaultUsername(), { date, mealTime, variantNames }));
      } catch (err) {
        if (err.code === 'TEMPLATE_NOT_FOUND') return res.status(404).json({ error: err.message, code: err.code });
        // A proposal is not a template yet. 409, not 400: the request is
        // well-formed and the id is real — the resource is in the wrong state.
        if (err.code === 'TEMPLATE_NOT_ACTIVE') return res.status(409).json({ error: err.message, code: err.code });
        // Nothing would be written. 400: the caller chose an empty set.
        if (err.code === 'TEMPLATE_NO_COMPONENTS') return res.status(400).json({ error: err.message, code: err.code });
        if (err.code === 'TEMPLATES_WRITE_FAILED') {
          logger.error?.('health.templates.instantiate.write_failed', { error: err.message });
          return sendInternalError(res, { error: err.message, code: err.code });
        }
        throw err;
      }
    }));

    // Approve / dismiss a mined proposal (PRD F6.2). Nothing is auto-created:
    // a proposal becomes a template only here, and a dismissal is permanent.
    router.post('/nutrition/templates/:id/approve', asyncHandler(async (req, res) => {
      const { name } = req.body || {};
      try {
        return res.json({ template: await templateService.approve(req.params.id, getDefaultUsername(), { name }) });
      } catch (err) {
        if (err.code === 'TEMPLATE_NOT_FOUND') return res.status(404).json({ error: err.message, code: err.code });
        if (err.code === 'TEMPLATES_WRITE_FAILED') {
          logger.error?.('health.templates.approve.write_failed', { error: err.message });
          return sendInternalError(res, { error: err.message, code: err.code });
        }
        throw err;
      }
    }));

    router.post('/nutrition/templates/:id/dismiss', asyncHandler(async (req, res) => {
      try {
        return res.json(await templateService.dismiss(req.params.id, getDefaultUsername()));
      } catch (err) {
        if (err.code === 'TEMPLATE_NOT_FOUND') return res.status(404).json({ error: err.message, code: err.code });
        if (err.code === 'TEMPLATES_WRITE_FAILED') {
          logger.error?.('health.templates.dismiss.write_failed', { error: err.message });
          return sendInternalError(res, { error: err.message, code: err.code });
        }
        throw err;
      }
    }));

    router.delete('/nutrition/templates/:id', asyncHandler(async (req, res) => {
      try {
        await templateService.remove(req.params.id, getDefaultUsername());
        return res.json({ ok: true });
      } catch (err) {
        if (err.code === 'TEMPLATES_WRITE_FAILED') {
          logger.error?.('health.templates.remove.write_failed', { error: err.message });
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
     *   - bucket: "morning" | "afternoon" | "evening" | "night" (optional) — the
     *     meal-time row the capture was launched from (Task 4.1). An explicit
     *     meal named in the utterance/caption still beats this; this beats the
     *     clock default. Omit entirely for existing behavior — Telegram, the
     *     coach, and the scale path never send it.
     *   - date: "YYYY-MM-DD" (optional) — the day the client is LOOKING AT. It
     *     becomes the parse's "today", so "this morning" resolves against the
     *     VIEWED day rather than the server's. A date the person names out loud
     *     still beats it, exactly as an explicitly named meal beats `bucket`.
     *     ABSENT MEANS TODAY; it is never coerced to null.
     *   - audioRef: `va_*` (optional, voice only) — retry a capture whose
     *     transcription failed, over the recording already in the user's store.
     *     Sent INSTEAD of `content`; nothing is re-recorded.
     */
    router.post('/nutrition/input', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const { type, content, bucket, date, audioRef } = req.body;
      if (!type) {
        return res.status(400).json({ error: 'type is required (text, voice, image, barcode)' });
      }
      // A bad bucket must be rejected here, never passed downstream — a phantom
      // meal id silently landing food in the wrong bucket is worse than a 400.
      // `bucket == null` (absent or explicit null) is treated as "not provided".
      if (bucket != null && !NUTRITION_MEAL_BUCKETS.includes(bucket)) {
        return res.status(400).json({
          error: `Invalid bucket: ${bucket}. Must be one of: ${NUTRITION_MEAL_BUCKETS.join(', ')}`,
        });
      }
      const dateError = validateOptionalDate(date);
      if (dateError) return res.status(400).json(dateError);
      if (audioRef != null && !AUDIO_REF_PATTERN.test(String(audioRef))) {
        return res.status(400).json({ error: 'Invalid audioRef', code: 'AUDIO_REF_INVALID' });
      }
      try {
        const result = await healthOperations.processNutritionInput({
          type, content, userId, bucket, date, audioRef: audioRef ?? undefined,
        });
        return res.json(result);
      } catch (err) {
        // A retry pointed at a memo that is not there is the caller's problem
        // and has an answer a person can act on. It is not a 500.
        if (err.code === 'AUDIO_NOT_FOUND') {
          logger.warn?.('health.nutrition.input.audio_missing', { audioRef });
          return res.status(404).json({
            error: "That recording is no longer available — please record it again.",
            code: 'AUDIO_NOT_FOUND',
          });
        }
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

    /**
     * GET /api/v1/health/nutrition/pending - Pending-review NutriLogs for a date
     *
     * Root-cause fix: a pending NutriLog (created via Telegram, the scale
     * bridge, or a failed AI call) never syncs into the nutrilist — it was
     * invisible in the web Today view until accepted/discarded from
     * Telegram. This surfaces it so the web UI can review it directly.
     *
     * Query: date (YYYY-MM-DD, default local today)
     */
    router.get('/nutrition/pending', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const { date: rawDate } = req.query;
      if (rawDate !== undefined && rawDate !== null && !isISODate(String(rawDate))) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }
      const date = rawDate || getToday();
      if (!healthOperations.pendingNutritionAvailable) {
        return res.json({ pending: [] });
      }
      try {
        const logs = await healthOperations.listPendingNutrition(userId, date);
        return res.json({ pending: logs.map(presentPendingNutritionLog) });
      } catch (err) {
        logger.error?.('health.nutrition.pending.error', { date, error: err.message });
        return sendInternalError(res, { error: err.message });
      }
    }));
  }

  // ==========================================================================
  // Kitchen-scale Observations (Task 5.4 — surfacing, re-pairing, dismissal)
  // ==========================================================================

  if (observationPairing) {
    /**
     * GET /api/v1/health/nutrition/observations?date=YYYY-MM-DD
     *
     * Every scale signal recorded on one calendar date — open (unmatched), consumed
     * (attached to a food-log entry) and dismissed alike. The day view splits them:
     * open rows render as unmatched rows with a Dismiss affordance, consumed rows
     * become the "scale-measured" badge on the entry they point at.
     *
     * `userId` is NEVER read from the request — same rule, same reason, as the photo
     * route below: this program is single-user (household head only), a client-supplied
     * user would read another household member's ledger, and nothing in the frontend
     * sends one. Always the household default.
     */
    router.get('/nutrition/observations', asyncHandler(async (req, res) => {
      const { date: rawDate } = req.query;
      if (rawDate !== undefined && !isISODate(String(rawDate))) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }
      const date = rawDate ? String(rawDate) : getToday();
      const userId = getDefaultUsername();
      try {
        const observations = observationPairing.listByDate(userId, date);
        return res.json({ observations: observations.map(serializeObservation), date, count: observations.length });
      } catch (err) {
        logger.error?.('health.nutrition.observations.error', { date, error: err.message, code: err.code ?? null });
        return sendInternalError(res, { error: err.message });
      }
    }));

    /**
     * POST /api/v1/health/nutrition/observations/:id/pair  { entryUuid }
     *
     * Attach (or re-attach) one observation to a food-log entry. The entry's grams —
     * and its calories, when a density observation is part of the evidence — are
     * recomputed from the measurement by the application service, which borrows the
     * scale path's own net-weight math rather than re-deriving it. Whatever the
     * observation pointed at before is released back to `open`.
     *
     * Both ids are checked against an allowlist BEFORE anything reaches a store call:
     * `:id` must be exactly the UUID shape `YamlObservationStore.append` mints, and
     * `entryUuid` must be plain id characters (no slash, dot, or null byte can reach a
     * lookup). Same posture as the photo route's `PHOTO_REF_PATTERN`.
     */
    router.post('/nutrition/observations/:id/pair', asyncHandler(async (req, res) => {
      const { id } = req.params;
      if (!OBSERVATION_ID_PATTERN.test(id || '')) {
        logger.debug?.('health.nutrition.observations.invalidId', { id });
        return res.status(400).json({ error: 'Invalid observation id' });
      }
      const entryUuid = req.body?.entryUuid;
      if (typeof entryUuid !== 'string' || !ENTRY_UUID_PATTERN.test(entryUuid)) {
        return res.status(400).json({ error: 'entryUuid is required' });
      }

      const userId = getDefaultUsername();
      try {
        const result = await observationPairing.pair(userId, id, entryUuid);
        logger.info?.('health.nutrition.observations.paired', {
          id, entryUuid, moved: result.moved.length,
        });
        return res.json({
          observation: serializeObservation(result.observation),
          moved: result.moved,
          recomputed: result.recomputed,
        });
      } catch (err) {
        if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'Observation not found' });
        if (err.code === 'ENTRY_NOT_FOUND') return res.status(404).json({ error: 'Food-log entry not found' });
        // The measurement still backs a living entry. Moving it would leave that entry
        // counting the same food a second time, and there is no measurement left to
        // recompute it from — so the collision is reported, with the entry named, rather
        // than resolved by guesswork. Nothing was written.
        // A group row holds no nutrition by design (its children do), so attaching a
        // measurement there would count the same food twice inside one dish.
        if (err.code === 'ENTRY_IS_GROUP') {
          return res.status(409).json({ error: err.message, code: 'ENTRY_IS_GROUP' });
        }
        if (err.code === 'PRIOR_ENTRY_EXISTS') {
          return res.status(409).json({ error: err.message, code: 'PRIOR_ENTRY_EXISTS' });
        }
        // The store writes one file atomically and has no rollback across two, so a
        // placement it cannot rewrite in a single write is refused rather than
        // half-applied. Nothing was written.
        if (err.code === 'CROSS_FILE_BATCH') {
          return res.status(409).json({
            error: 'One of these measurements has already been archived, and archived rows cannot be re-paired in the same step as current ones. Nothing was changed — dismiss or re-pair them one at a time.',
            code: 'CROSS_FILE_BATCH',
          });
        }
        logger.error?.('health.nutrition.observations.pair.error', { id, entryUuid, error: err.message, code: err.code ?? null });
        return sendInternalError(res, { error: err.message });
      }
    }));

    /**
     * POST /api/v1/health/nutrition/observations/:id/dismiss
     *
     * Mark one observation as "not food I am logging". This is the only thing in the
     * system that resolves a row which aged out of the composition window, and an
     * unresolved row is never archived — so this is also what keeps the hot file (on
     * the scale's own frame path) from growing without bound.
     */
    router.post('/nutrition/observations/:id/dismiss', asyncHandler(async (req, res) => {
      const { id } = req.params;
      if (!OBSERVATION_ID_PATTERN.test(id || '')) {
        logger.debug?.('health.nutrition.observations.invalidId', { id });
        return res.status(400).json({ error: 'Invalid observation id' });
      }
      const userId = getDefaultUsername();
      try {
        const result = observationPairing.dismiss(userId, id);
        logger.info?.('health.nutrition.observations.dismissed', { id });
        return res.json({ observation: serializeObservation(result.observation) });
      } catch (err) {
        if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'Observation not found' });
        logger.error?.('health.nutrition.observations.dismiss.error', { id, error: err.message, code: err.code ?? null });
        return sendInternalError(res, { error: err.message });
      }
    }));
  }

  // ==========================================================================
  // Photo Serving (Task 2.3 — capture photo persistence)
  // ==========================================================================

  /**
   * GET /api/v1/health/nutrition/photos/:photoRef - Serve a stored capture photo
   *
   * Security: `photoRef` is a URL path segment. It is checked against the
   * exact same allowlist PhotoStore enforces internally, BEFORE it is passed
   * anywhere near a path join (belt-and-braces — PhotoStore.resolvePath()
   * repeats the check and additionally verifies containment on the resolved
   * path). Any ref that fails — `..`, a slash, a null byte, an absolute
   * path, a percent-encoded traversal form, or simply the wrong shape — is
   * refused with 404 before touching the filesystem.
   *
   * `userId` is intentionally NOT read from the request. This program is
   * single-user (household head only); a client-supplied userId would (a)
   * defeat PhotoStore's containment check, because the check validates
   * against a base directory built from that same untrusted value, and
   * (b) have no legitimate caller — nothing in the frontend sends this
   * parameter. Always resolve to the household default.
   *
   * Content-Type is set explicitly from the fixed on-disk naming
   * PhotoStore always writes (`.jpg`/`.thumb.jpg`) — never taken from the
   * client, and never inferred by Express from the resolved file's
   * extension (see streamFile.mjs: sendFile derives type from the path,
   * which happens to agree here, but explicit is the actual guarantee).
   * `X-Content-Type-Options: nosniff` pins that against client sniffing.
   *
   * Query: size=thumb (optional) - serves the thumbnail variant, falling
   * back to the original photo if no thumbnail exists.
   */
  router.get('/nutrition/photos/:photoRef', asyncHandler(async (req, res) => {
    if (!photoStore) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    const { photoRef } = req.params;
    if (!PHOTO_REF_PATTERN.test(photoRef || '')) {
      logger.debug?.('health.nutrition.photos.invalidRef', { photoRef });
      return res.status(404).json({ error: 'Photo not found' });
    }

    // Never read userId from the request — see security note above.
    const userId = getDefaultUsername();
    const size = req.query.size === 'thumb' ? 'thumb' : undefined;
    const absolutePath = photoStore.resolvePath(userId, photoRef, { size });
    if (!absolutePath) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    res.set('Content-Type', 'image/jpeg');
    res.set('X-Content-Type-Options', 'nosniff');
    const resource = createLocalFileResource(absolutePath, { mimeType: 'image/jpeg' });
    return sendLocalFileResource(req, res, resource, (err) => {
      if (err && !res.headersSent) {
        logger.warn?.('health.nutrition.photos.sendFailed', { photoRef, error: err.message });
        res.status(404).json({ error: 'Photo not found' });
      }
    });
  }));

  // ==========================================================================
  // Food Icons (IconManifestStore)
  // ==========================================================================

  /**
   * GET /api/v1/health/nutrition/icons/:slug
   *
   * Streams one food icon from the media mount. `:slug` is user-controllable
   * and is being used to reach the filesystem, so it is gated exactly the way
   * the photo route above gates `photoRef`: allowlist FIRST, at this boundary,
   * before the value is handed to the store; the store then re-checks it,
   * refuses to build a path out of it (a slug only ever SELECTS a manifest
   * entry), validates the entry's own path, and containment-checks the result.
   * `..`, an encoded traversal and an absolute path are all simply not slugs.
   *
   * There is no user parameter, deliberately — see the photo route's note.
   * The manifest is household-wide, and a client-supplied identity would have
   * no legitimate caller here either.
   *
   * Content-Type comes from the store (derived from the manifest entry's
   * extension against a closed allowlist, or `image/png` for a rendered
   * derivative), never from the client and never from Express's inference;
   * `nosniff` pins it. The cache is long and immutable because a slug's bytes
   * never change — a corrected icon is a manifest edit pointing the slug at a
   * different file, and the store's own cache key changes with it.
   */
  /**
   * GET /api/v1/health/nutrition/icons - the offered icon vocabulary
   * Query: q (substring filter), limit (default 60)
   *
   * Feeds the edit sheet's picker. Returns slugs only — the picker builds each
   * URL from the slug through the route above, so filenames stay in the
   * manifest and never travel to the client.
   */
  router.get('/nutrition/icons', asyncHandler(async (req, res) => {
    if (!iconManifestStore) return res.json({ icons: [], count: 0 });
    const { q = '', limit } = req.query;
    const parsed = parseInt(limit, 10);
    const icons = iconManifestStore.search(String(q), Number.isFinite(parsed) ? parsed : 60);
    return res.json({ icons, count: icons.length });
  }));

  router.get('/nutrition/icons/:slug', asyncHandler(async (req, res) => {
    if (!iconManifestStore) {
      return res.status(404).json({ error: 'Icon not found' });
    }
    const { slug } = req.params;
    if (!ICON_SLUG_PATTERN.test(slug || '')) {
      logger.debug?.('health.nutrition.icons.invalidSlug', { slug });
      return res.status(404).json({ error: 'Icon not found' });
    }

    // The RENDERED derivative, not the source: the hi-res art averages ~3 MB a
    // file, and a day's log plus one open picker would otherwise cost hundreds
    // of megabytes. Falls back to the source on any rendering failure, so this
    // can degrade in size but never in availability.
    const hit = await iconManifestStore.resolveRendered(slug);
    if (!hit) {
      return res.status(404).json({ error: 'Icon not found' });
    }

    res.set('Content-Type', hit.contentType);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    const resource = createLocalFileResource(hit.absolutePath, { mimeType: hit.contentType });
    return sendLocalFileResource(req, res, resource, (err) => {
      if (err && !res.headersSent) {
        logger.warn?.('health.nutrition.icons.sendFailed', { slug, error: err.message });
        res.status(404).json({ error: 'Icon not found' });
      }
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
    sendInternalError(res, { error: err.message });
  });

  return router;
}

export default createHealthRouter;
