/**
 * Legacy Usage Admin Router
 *
 * Exposes endpoints for monitoring legacy route usage.
 * Used to determine when it's safe to delete legacy code.
 *
 * Endpoints:
 *   GET /admin/legacy         - Get legacy route hit statistics
 *   POST /admin/legacy/reset  - Reset hit counters
 *
 * @module routers/admin/legacy
 */

import { Router } from 'express';
import { getLegacyTracker } from '../../middleware/legacyTracker.mjs';

/**
 * Create legacy admin router
 * @param {Object} [options]
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createLegacyAdminRouter(options = {}) {
  const { logger = console } = options;
  const router = Router();
  const tracker = getLegacyTracker({ logger });

  /**
   * GET /admin/legacy
   * Get legacy route hit statistics
   */
  router.get('/', (req, res) => {
    const hits = tracker.getHits();
    const totalHits = tracker.getTotalHits();

    res.json({
      status: totalHits === 0 ? 'clean' : 'active',
      message: totalHits === 0
        ? 'No legacy routes hit - safe to remove legacy code'
        : `${totalHits} legacy route hits detected`,
      totalHits,
      routes: hits,
      recommendation: totalHits === 0
        ? 'You can safely delete backend/_legacy/'
        : 'Wait until all routes show 0 hits before deleting legacy code'
    });
  });

  /**
   * POST /admin/legacy/reset
   * Reset hit counters (useful for starting fresh measurement period)
   */
  router.post('/reset', (req, res) => {
    tracker.reset();

    if (logger.info) {
      logger.info('legacy.tracker.reset', { by: req.ip });
    }

    res.json({
      status: 'ok',
      message: 'Legacy route hit counters have been reset'
    });
  });

  /**
   * GET /admin/legacy/summary
   * Get a quick summary suitable for dashboards
   */
  router.get('/summary', (req, res) => {
    const totalHits = tracker.getTotalHits();
    const hasHits = tracker.hasHits();

    res.json({
      legacyActive: hasHits,
      totalHits,
      safeToDelete: !hasHits
    });
  });

  return router;
}

export default createLegacyAdminRouter;
