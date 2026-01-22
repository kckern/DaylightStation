// backend/src/4_api/routers/harvest.mjs
/**
 * Harvest Router - Data Collection Endpoints (DDD)
 *
 * Provides RESTful endpoints for triggering data harvesting from various services.
 * This is a DDD wrapper around the legacy harvest functionality.
 *
 * Endpoints:
 *   GET /harvest/watchlist - Sync watchlist from Infinity
 *   GET /harvest/budget - Trigger financial data refresh
 *   GET /harvest/payroll - Sync payroll data
 */
import express from 'express';
import crypto from 'crypto';

/**
 * Create harvest router for data collection endpoints
 * @param {Object} config
 * @param {Object} config.logger - Logger instance
 * @param {Function} config.refreshFinancialData - Budget refresh function
 * @param {Function} config.payrollSyncJob - Payroll sync function
 * @param {Object} config.Infinity - Infinity API client
 * @param {Function} config.configService - Config service for resolving users
 * @returns {express.Router}
 */
export function createHarvestRouter(config) {
  const router = express.Router();
  const {
    logger,
    refreshFinancialData,
    payrollSyncJob,
    Infinity,
    configService
  } = config;

  // Timeout configuration (ms)
  const HARVEST_TIMEOUT = 120000; // 2 minutes default
  const HARVEST_TIMEOUTS = {
    watchlist: 60000,   // 1 minute for watchlist
    budget: 240000,     // 4 minutes for budget
    payroll: 180000     // 3 minutes for payroll
  };

  /**
   * Resolve the target username from request query param or default to head of household
   */
  const resolveUsername = (req) => {
    if (req.query.user) {
      return req.query.user;
    }
    return configService?.getHeadOfHousehold?.() || 'default';
  };

  /**
   * Wrap a promise with a timeout
   */
  const withTimeout = (promise, timeoutMs, harvesterName) => {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout: ${harvesterName} exceeded ${timeoutMs}ms limit`)), timeoutMs)
      )
    ]);
  };

  /**
   * Sanitize error for API response
   */
  const sanitizeError = (error, harvesterName) => {
    let message = error.message || 'Unknown error';
    message = message
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
      .replace(/token[=:]\s*[^\s&]+/gi, 'token=[REDACTED]')
      .replace(/key[=:]\s*[^\s&]+/gi, 'key=[REDACTED]');

    return {
      harvester: harvesterName,
      message,
      type: error.name || 'Error',
      statusCode: error.response?.status
    };
  };

  /**
   * GET /harvest/watchlist
   * Sync watchlist data from Infinity
   */
  router.get('/watchlist', async (req, res) => {
    const guidId = crypto.randomUUID().split('-').pop();
    const username = resolveUsername(req);

    logger?.info?.('harvest.watchlist.started', { requestId: guidId, username });

    if (!Infinity) {
      return res.status(503).json({
        error: 'Infinity service not configured',
        harvester: 'watchlist'
      });
    }

    try {
      const timeoutMs = HARVEST_TIMEOUTS.watchlist;
      const result = await withTimeout(
        Infinity.loadData('watchlist', { targetUsername: username }),
        timeoutMs,
        'watchlist'
      );

      logger?.info?.('harvest.watchlist.completed', {
        requestId: guidId,
        resultType: typeof result,
        itemCount: Array.isArray(result) ? result.length : undefined
      });

      res.json({
        ok: true,
        harvester: 'watchlist',
        data: result,
        requestId: guidId
      });
    } catch (error) {
      logger?.error?.('harvest.watchlist.error', {
        requestId: guidId,
        error: error.message
      });

      const statusCode = error.message?.includes('Timeout') ? 504 : 500;
      res.status(statusCode).json(sanitizeError(error, 'watchlist'));
    }
  });

  /**
   * GET /harvest/budget
   * POST /harvest/budget
   * Trigger financial data refresh
   */
  const budgetHandler = async (req, res) => {
    const guidId = crypto.randomUUID().split('-').pop();
    const username = resolveUsername(req);

    logger?.info?.('harvest.budget.started', { requestId: guidId, username });

    if (!refreshFinancialData) {
      return res.status(503).json({
        error: 'Budget refresh service not configured',
        harvester: 'budget'
      });
    }

    try {
      const timeoutMs = HARVEST_TIMEOUTS.budget;
      const result = await withTimeout(
        refreshFinancialData(guidId, { targetUsername: username }),
        timeoutMs,
        'budget'
      );

      logger?.info?.('harvest.budget.completed', { requestId: guidId });

      res.json({
        ok: true,
        harvester: 'budget',
        data: result,
        requestId: guidId
      });
    } catch (error) {
      logger?.error?.('harvest.budget.error', {
        requestId: guidId,
        error: error.message
      });

      const statusCode = error.message?.includes('Timeout') ? 504 : 500;
      res.status(statusCode).json(sanitizeError(error, 'budget'));
    }
  };

  router.get('/budget', budgetHandler);
  router.post('/budget', budgetHandler);

  /**
   * GET /harvest/payroll
   * POST /harvest/payroll
   * Sync payroll data
   */
  const payrollHandler = async (req, res) => {
    const guidId = crypto.randomUUID().split('-').pop();
    const username = resolveUsername(req);
    const token = req.query.token;

    logger?.info?.('harvest.payroll.started', { requestId: guidId, username, hasToken: !!token });

    if (!payrollSyncJob) {
      return res.status(503).json({
        error: 'Payroll sync service not configured',
        harvester: 'payroll'
      });
    }

    try {
      const timeoutMs = HARVEST_TIMEOUTS.payroll;
      const result = await withTimeout(
        payrollSyncJob(logger, guidId, username, token),
        timeoutMs,
        'payroll'
      );

      logger?.info?.('harvest.payroll.completed', { requestId: guidId });

      res.json({
        ok: true,
        harvester: 'payroll',
        data: result,
        requestId: guidId
      });
    } catch (error) {
      logger?.error?.('harvest.payroll.error', {
        requestId: guidId,
        error: error.message
      });

      const statusCode = error.message?.includes('Timeout') ? 504 : 500;
      res.status(statusCode).json(sanitizeError(error, 'payroll'));
    }
  };

  router.get('/payroll', payrollHandler);
  router.post('/payroll', payrollHandler);

  /**
   * GET /harvest
   * List available harvesters
   */
  router.get('/', (req, res) => {
    res.json({
      ok: true,
      harvesters: ['watchlist', 'budget', 'payroll'],
      timeouts: HARVEST_TIMEOUTS
    });
  });

  return router;
}

export default createHarvestRouter;
