/**
 * Launch API Router
 *
 * Endpoints:
 * - POST /api/v1/launch - Launch content on a target device
 *
 * @module api/v1/routers/launch
 */
import express from 'express';

/**
 * Create launch API router
 *
 * @param {Object} config
 * @param {Object} config.launchService - LaunchService for orchestrating content launches
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createLaunchRouter(config) {
  const { launchService, logger = console } = config;
  const router = express.Router();

  /**
   * POST / - Launch content on a target device
   *
   * Body:
   * - contentId: string - Compound content ID (e.g., 'retroarch:n64/mario-kart-64')
   * - targetDeviceId: string - Device to launch on (e.g., 'shield-tv')
   */
  router.post('/', async (req, res) => {
    const { contentId, targetDeviceId } = req.body;

    if (!contentId) {
      return res.status(400).json({
        error: 'Missing required field: contentId'
      });
    }

    try {
      const result = await launchService.launch({ contentId, targetDeviceId });
      res.json(result);
    } catch (error) {
      const status = error.name === 'ValidationError' ? 400
        : error.name === 'EntityNotFoundError' ? 404
        : 500;
      logger.error?.('launch.api.error', { contentId, targetDeviceId, error: error.message });
      res.status(status).json({
        error: error.message,
        ...(error.code && { code: error.code }),
        ...(error.details && { details: error.details })
      });
    }
  });

  return router;
}

export default createLaunchRouter;
