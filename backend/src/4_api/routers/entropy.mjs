/**
 * Entropy API Router
 *
 * Provides REST API for data freshness/staleness metrics.
 * High entropy = stale data, low entropy = fresh data.
 *
 * @module api/routers/entropy
 */

import express from 'express';

/**
 * Create Entropy API router
 *
 * @param {Object} config
 * @param {Object} config.entropyService - EntropyService instance
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createEntropyRouter(config) {
  const { entropyService, configService, logger = console } = config;
  const router = express.Router();

  /**
   * Get default username for requests
   */
  const getDefaultUsername = () => {
    return (
      configService?.getHeadOfHousehold?.() ||
      configService?.getDefaultUsername?.() ||
      'default'
    );
  };

  // ==========================================================================
  // Error Handler
  // ==========================================================================

  const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

  // ==========================================================================
  // Endpoints
  // ==========================================================================

  /**
   * GET /entropy
   * Get entropy report for all configured sources
   *
   * Response:
   * {
   *   items: EntropyItem[]
   * }
   */
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const username = getDefaultUsername();

      logger.debug?.('entropy.report.request', { username });

      const report = await entropyService.getReport(username);

      logger.info?.('entropy.report.success', {
        username,
        itemCount: report.items.length,
        summary: report.summary,
      });

      res.json(report);
    })
  );

  /**
   * GET /entropy/:source
   * Get entropy for a single source
   *
   * Response: EntropyItem or 404
   */
  router.get(
    '/:source',
    asyncHandler(async (req, res) => {
      const { source } = req.params;
      const username = getDefaultUsername();

      logger.debug?.('entropy.source.request', { username, source });

      const item = await entropyService.getSourceEntropy(username, source);

      if (!item) {
        return res.status(404).json({
          error: 'Source not found',
          source,
        });
      }

      logger.info?.('entropy.source.success', {
        username,
        source,
        status: item.status,
      });

      res.json(item);
    })
  );

  /**
   * GET /entropy/status
   * Entropy router status
   */
  router.get(
    '/status',
    asyncHandler(async (req, res) => {
      res.json({
        message: 'Entropy router is operational',
        timestamp: new Date().toISOString(),
        endpoints: [
          'GET / - Get entropy report for all sources',
          'GET /:source - Get entropy for specific source',
          'GET /status - This endpoint',
        ],
      });
    })
  );

  // ==========================================================================
  // Error Handler Middleware
  // ==========================================================================

  router.use((err, req, res, next) => {
    logger.error?.('entropy.router.error', {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
    });
    res.status(500).json({ error: err.message });
  });

  return router;
}

export default createEntropyRouter;
