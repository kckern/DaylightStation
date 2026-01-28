// backend/src/4_api/routers/harvest.mjs
/**
 * Harvest Router - Data Collection Endpoints (DDD)
 *
 * Provides RESTful endpoints for triggering data harvesting.
 * Delegates all harvest logic to HarvesterService.
 *
 * Endpoints:
 *   GET  /harvest              - List available harvesters with status
 *   GET  /harvest/:serviceId   - Trigger specific harvester
 *   POST /harvest/:serviceId   - Trigger specific harvester (with options)
 *   GET  /harvest/status/:serviceId - Get harvester status
 */
import express from 'express';
import crypto from 'crypto';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create harvest router
 * @param {Object} config
 * @param {Object} config.harvesterService - HarvesterService instance
 * @param {Object} config.configService - ConfigService for user resolution
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHarvestRouter(config) {
  const router = express.Router();
  const {
    harvesterService,
    configService,
    logger = console
  } = config;

  // Timeout configuration (ms)
  const DEFAULT_TIMEOUT = 120000; // 2 minutes
  const TIMEOUTS = {
    fitness: 180000,    // 3 minutes
    strava: 180000,
    health: 180000,
    budget: 240000,     // 4 minutes
    gmail: 180000,
    shopping: 300000,   // 5 minutes
  };

  /**
   * Resolve target username from request
   */
  const resolveUsername = (req) => {
    if (req.query.user) return req.query.user;
    if (req.body?.user) return req.body.user;
    return configService?.getHeadOfHousehold?.() || 'default';
  };

  /**
   * Wrap promise with timeout
   */
  const withTimeout = (promise, timeoutMs, serviceId) => {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout: ${serviceId} exceeded ${timeoutMs}ms limit`)),
          timeoutMs
        )
      )
    ]);
  };

  /**
   * Sanitize error for response
   */
  const sanitizeError = (error, serviceId) => {
    let message = error.message || 'Unknown error';
    message = message
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
      .replace(/token[=:]\s*[^\s&]+/gi, 'token=[REDACTED]')
      .replace(/key[=:]\s*[^\s&]+/gi, 'key=[REDACTED]');

    return {
      harvester: serviceId,
      message,
      type: error.name || 'Error'
    };
  };

  /**
   * GET /harvest
   * List all available harvesters with status
   */
  router.get('/', (req, res) => {
    const harvesters = harvesterService.listHarvesters();
    const allStatuses = harvesterService.getAllStatuses();

    // Convert statuses array to object keyed by serviceId for lookup
    const statusesByServiceId = {};
    for (const status of allStatuses) {
      statusesByServiceId[status.serviceId] = status;
    }

    res.json({
      ok: true,
      harvesters: harvesters.map(h => ({
        ...h,
        status: statusesByServiceId[h.serviceId]
      })),
      usage: 'GET /harvest/:serviceId or POST /harvest/:serviceId with options'
    });
  });

  /**
   * GET /harvest/status/:serviceId
   * Get status of a specific harvester
   */
  router.get('/status/:serviceId', (req, res) => {
    const { serviceId } = req.params;

    if (!harvesterService.has(serviceId)) {
      return res.status(404).json({
        ok: false,
        error: `Unknown harvester: ${serviceId}`,
        available: harvesterService.listHarvesters().map(h => h.serviceId)
      });
    }

    const status = harvesterService.getStatus(serviceId);
    res.json({ ok: true, ...status });
  });

  /**
   * GET/POST /harvest/:serviceId
   * Trigger a specific harvester
   */
  const harvestHandler = asyncHandler(async (req, res) => {
    const { serviceId } = req.params;
    const requestId = crypto.randomUUID().split('-').pop();
    const username = resolveUsername(req);
    const options = { ...req.query, ...req.body };
    delete options.user; // Don't pass user as option

    if (!harvesterService.has(serviceId)) {
      return res.status(404).json({
        ok: false,
        error: `Unknown harvester: ${serviceId}`,
        available: harvesterService.listHarvesters().map(h => h.serviceId),
        requestId
      });
    }

    logger?.info?.('harvest.request', {
      serviceId,
      username,
      requestId,
      method: req.method
    });

    try {
      const timeoutMs = TIMEOUTS[serviceId] || DEFAULT_TIMEOUT;
      const result = await withTimeout(
        harvesterService.harvest(serviceId, username, options),
        timeoutMs,
        serviceId
      );

      logger?.info?.('harvest.response', {
        serviceId,
        requestId,
        result
      });

      res.json({
        ok: true,
        harvester: serviceId,
        data: result,
        requestId
      });

    } catch (error) {
      logger?.error?.('harvest.error', {
        serviceId,
        requestId,
        error: error.message
      });

      const statusCode = error.message?.includes('Timeout') ? 504 :
                        error.message?.includes('cooldown') ? 503 :
                        error.response?.status === 429 ? 429 : 500;

      return res.status(statusCode).json({
        ok: false,
        ...sanitizeError(error, serviceId),
        requestId
      });
    }
  });

  router.get('/:serviceId', harvestHandler);
  router.post('/:serviceId', harvestHandler);

  return router;
}

export default createHarvestRouter;
