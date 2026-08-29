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
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create Config API router
 *
 * @param {Object} config
 * @param {Object} config.configQueryService - Semantic configuration query
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createConfigRouter(config) {
  const { configQueryService, logger = console } = config;
  const router = express.Router();

  // JSON parsing middleware
  router.use(express.json());

  /**
   * GET /api/v1/config/content-prefixes
   * Load legacy content prefix mapping from data/household/media/content-prefixes.yml
   * (colocated under media/ since task-13 — media owns content addressing;
   * previously data/household/config/content-prefixes.yml)
   * This is used by the frontend queryParamResolver to map legacy query params
  * to canonical singalong: and readalong: format.
   *
   * Response format:
   * {
   *   "legacy": {
  *     "hymn": "singalong:hymn",
  *     "primary": "singalong:primary",
  *     "scripture": "readalong:scripture",
  *     "talk": "readalong:talks",
  *     "poem": "readalong:poetry"
   *   }
   * }
   */
  router.get('/content-prefixes', asyncHandler(async (req, res) => {
    const result = configQueryService.getContentPrefixes();
    logger.info?.('config.content-prefixes.loaded', {
      hasLegacy: !!result?.legacy,
      legacyCount: Object.keys(result?.legacy || {}).length,
    });
    res.json(result);
  }));

  /**
   * GET /api/v1/config/player
   * Load player runtime config from data/household/player/config.yml
   * (colocated under player/ like the rest; previously
   * data/household/config/player.yml). Read directly rather than through the
   * household app union, so `player` is deliberately not in the config
   * registry. The file exists in no household today — absent at either path the
   * endpoint returns the same defaults — so this move is behaviour-neutral and
   * just keeps the reader off the config/ directory a later phase deletes.
   *
   * Response format:
   * {
   *   "on_deck": {
   *     "preempt_seconds": 15,
   *     "displace_to_queue": false
   *   }
   * }
   */
  router.get('/player', asyncHandler(async (req, res) => {
    const result = configQueryService.getPlayerConfig();
    logger.info?.('config.player.loaded', result.on_deck);
    res.json(result);
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
        'GET /player - Get player runtime config',
        'GET /status - This endpoint'
      ]
    });
  }));

  return router;
}

export default createConfigRouter;
