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

const PLAYER_ON_DECK_DEFAULTS = Object.freeze({
  preempt_seconds: 15,
  displace_to_queue: false,
});

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
   * Load legacy content prefix mapping from data/household/config/content-prefixes.yml
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
    const configPath = path.join(dataPath, 'household', 'config', 'content-prefixes');

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
   * GET /api/v1/config/player
   * Load player runtime config from data/household/config/player.yml
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
    const configPath = path.join(dataPath, 'household', 'config', 'player');

    logger.debug?.('config.player.request', { configPath });

    let raw;
    try {
      raw = loadYaml(configPath);
    } catch (error) {
      logger.warn?.('config.player.load-failed', { error });
      return res.json({ on_deck: { ...PLAYER_ON_DECK_DEFAULTS } });
    }

    const rawOnDeck = raw?.on_deck ?? {};

    const preemptRaw = rawOnDeck.preempt_seconds;
    const preemptNum = Number(preemptRaw);
    const preempt_seconds = (preemptRaw !== undefined && Number.isFinite(preemptNum))
      ? Math.min(600, Math.max(0, preemptNum))
      : PLAYER_ON_DECK_DEFAULTS.preempt_seconds;

    const displaceRaw = rawOnDeck.displace_to_queue;
    const displace_to_queue = typeof displaceRaw === 'boolean'
      ? displaceRaw
      : PLAYER_ON_DECK_DEFAULTS.displace_to_queue;

    logger.info?.('config.player.loaded', { preempt_seconds, displace_to_queue });

    res.json({ on_deck: { preempt_seconds, displace_to_queue } });
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
