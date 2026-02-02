/**
 * Config API Router
 *
 * Serves configuration data to the frontend (e.g., content-prefixes mapping).
 * This allows frontend to load configuration that drives behavior without
 * hardcoding values.
 *
 * @module api/routers/config
 */

import express from 'express';
import path from 'path';
import { loadYaml } from '#system/utils/FileIO.mjs';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create Config API router
 *
 * @param {Object} config
 * @param {string} config.dataPath - Base data directory path (e.g., /data or /path/to/data)
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createConfigRouter(config) {
  const { dataPath, logger = console } = config;
  const router = express.Router();

  // JSON parsing middleware
  router.use(express.json());

  /**
   * GET /api/v1/config/content-prefixes
   * Load legacy content prefix mapping from data/config/content-prefixes.yml
   * This is used by the frontend queryParamResolver to map legacy query params
   * to canonical singing: and narrated: format.
   *
   * Response format:
   * {
   *   "legacy": {
   *     "hymn": "singing:hymn",
   *     "primary": "singing:primary",
   *     "scripture": "narrated:scripture",
   *     "talk": "narrated:talks",
   *     "poem": "narrated:poetry"
   *   }
   * }
   */
  router.get('/content-prefixes', asyncHandler(async (req, res) => {
    const configPath = path.join(dataPath, 'config', 'content-prefixes');

    logger.debug?.('config.content-prefixes.request', { configPath });

    try {
      const config = loadYaml(configPath);

      logger.info?.('config.content-prefixes.loaded', {
        hasLegacy: !!config?.legacy,
        legacyCount: Object.keys(config?.legacy || {}).length
      });

      res.json(config || { legacy: {} });
    } catch (error) {
      logger.error?.('config.content-prefixes.error', {
        error: error.message,
        configPath
      });
      // Return empty structure instead of error for graceful degradation
      res.json({ legacy: {} });
    }
  }));

  /**
   * GET /api/v1/config/status
   * Config router status endpoint
   */
  router.get('/status', asyncHandler(async (req, res) => {
    res.json({
      message: 'Config router is operational',
      timestamp: Date.now(),
      endpoints: [
        'GET /content-prefixes - Get legacy content prefix mapping',
        'GET /status - This endpoint'
      ]
    });
  }));

  return router;
}

export default createConfigRouter;
