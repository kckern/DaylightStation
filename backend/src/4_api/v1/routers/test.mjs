// backend/src/4_api/v1/routers/test.mjs
/**
 * Test Infrastructure API
 *
 * Endpoints for controlling test infrastructure (shutoff valves, simulators, etc.)
 * Only available in development/test environments.
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create test infrastructure router
 * @param {Object} config
 * @param {Object} [config.plexShutoffControls] - Plex shutoff valve controls (injected)
 * @param {Function} [config.plexShutoffControls.enable] - Enable shutoff
 * @param {Function} [config.plexShutoffControls.disable] - Disable shutoff
 * @param {Function} [config.plexShutoffControls.getStatus] - Get shutoff status
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createTestRouter(config = {}) {
  const router = express.Router();
  const { plexShutoffControls, logger = console } = config;

  // Only enable in dev/test
  const isDev = process.env.NODE_ENV !== 'production';

  if (!isDev) {
    router.all('*', (req, res) => {
      res.status(403).json({ error: 'Test endpoints disabled in production' });
    });
    return router;
  }

  // Guard: If shutoff controls not provided, disable plex shutoff endpoints
  if (!plexShutoffControls) {
    router.all('/plex/shutoff/*', (req, res) => {
      res.status(503).json({ error: 'Plex shutoff controls not configured' });
    });
    return router;
  }

  const { enable, disable, getStatus } = plexShutoffControls;

  /**
   * POST /test/plex/shutoff/enable
   * Enable the Plex proxy shutoff valve (simulates network stall)
   * Body: { mode: 'block' | 'delay', delayMs?: number }
   */
  router.post('/plex/shutoff/enable', asyncHandler(async (req, res) => {
    const { mode = 'block', delayMs = 30000 } = req.body || {};
    enable({ mode, delayMs });
    logger.info?.('[test] Plex shutoff enabled', { mode, delayMs });
    res.json({
      success: true,
      status: getStatus()
    });
  }));

  /**
   * POST /test/plex/shutoff/disable
   * Disable the Plex proxy shutoff valve
   */
  router.post('/plex/shutoff/disable', asyncHandler(async (req, res) => {
    disable();
    logger.info?.('[test] Plex shutoff disabled');
    res.json({
      success: true,
      status: getStatus()
    });
  }));

  /**
   * GET /test/plex/shutoff/status
   * Get current shutoff valve status
   */
  router.get('/plex/shutoff/status', asyncHandler(async (req, res) => {
    res.json(getStatus());
  }));

  return router;
}

export default createTestRouter;
