// backend/src/4_api/v1/routers/test.mjs
/**
 * Test Infrastructure API
 *
 * Endpoints for controlling test infrastructure (shutoff valves, simulators, etc.)
 * Only available in development/test environments.
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import {
  enablePlexShutoff,
  disablePlexShutoff,
  getPlexShutoffStatus
} from '#adapters/proxy/PlexProxyAdapter.mjs';

/**
 * Create test infrastructure router
 * @param {Object} config
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createTestRouter(config = {}) {
  const router = express.Router();
  const { logger = console } = config;

  // Only enable in dev/test
  const isDev = process.env.NODE_ENV !== 'production';

  if (!isDev) {
    router.all('*', (req, res) => {
      res.status(403).json({ error: 'Test endpoints disabled in production' });
    });
    return router;
  }

  /**
   * POST /test/plex/shutoff/enable
   * Enable the Plex proxy shutoff valve (simulates network stall)
   * Body: { mode: 'block' | 'delay', delayMs?: number }
   */
  router.post('/plex/shutoff/enable', asyncHandler(async (req, res) => {
    const { mode = 'block', delayMs = 30000 } = req.body || {};
    enablePlexShutoff({ mode, delayMs });
    logger.info?.('[test] Plex shutoff enabled', { mode, delayMs });
    res.json({
      success: true,
      status: getPlexShutoffStatus()
    });
  }));

  /**
   * POST /test/plex/shutoff/disable
   * Disable the Plex proxy shutoff valve
   */
  router.post('/plex/shutoff/disable', asyncHandler(async (req, res) => {
    disablePlexShutoff();
    logger.info?.('[test] Plex shutoff disabled');
    res.json({
      success: true,
      status: getPlexShutoffStatus()
    });
  }));

  /**
   * GET /test/plex/shutoff/status
   * Get current shutoff valve status
   */
  router.get('/plex/shutoff/status', asyncHandler(async (req, res) => {
    res.json(getPlexShutoffStatus());
  }));

  return router;
}

export default createTestRouter;
