import { sendInternalError } from '#api/utils/internalError.mjs';
/**
 * Screens API Router
 * Serves screen configurations from YAML files
 *
 * @module api/v1/routers/screens
 */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create Screens API router
 *
 * @param {Object} config
 * @param {Object} config.screensQueryService - Injected application query service
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createScreensRouter(config = {}) {
  const {
    screensQueryService,
    logger = console,
  } = config;
  if (!screensQueryService) {
    throw new Error('createScreensRouter requires screensQueryService');
  }
  const router = express.Router();

  /**
   * GET /screens
   * List available screens
   */
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await screensQueryService.listScreens());
    })
  );

  /**
   * GET /screens/:screenId
   * Get screen configuration by ID
   */
  router.get(
    '/:screenId',
    asyncHandler(async (req, res) => {
      const { screenId } = req.params;

      // Validate screenId contains only safe characters (prevent path traversal)
      if (!/^[a-zA-Z0-9_-]+$/.test(screenId)) {
        logger.warn?.('screens.get.invalid_id', { screenId });
        return res.status(400).json({
          error: 'Invalid screen ID',
          message: 'Screen ID must contain only letters, numbers, hyphens, and underscores'
        });
      }

      const result = await screensQueryService.getScreen(screenId);
      if (result.outcome === 'not-found') {
        return res.status(404).json({ error: 'Screen not found', screenId });
      }
      if (result.outcome === 'invalid-config') {
        return res.status(400).json({
          error: 'Invalid screen config',
          message: 'Missing required "screen" field'
        });
      }
      res.json(result.screen);
    })
  );

  // ==========================================================================
  // Error Handler Middleware
  // ==========================================================================

  router.use((err, req, res, next) => {
    logger.error?.('screens.router.error', {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
    });
    sendInternalError(res, { error: err.message });
  });

  return router;
}

export default createScreensRouter;
