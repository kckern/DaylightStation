// backend/src/4_api/routers/admin/shims.mjs
import express from 'express';

/**
 * Create admin shims router for monitoring legacy shim usage
 *
 * Endpoints:
 * - GET /report - Returns shim usage report
 * - POST /reset - Resets shim metrics
 *
 * @param {Object} config
 * @param {Object} config.metrics - ShimMetrics instance with getReport() and reset() methods
 * @returns {express.Router}
 */
export function createShimsRouter(config) {
  const { metrics } = config;
  const router = express.Router();

  /**
   * GET /report
   * Returns current shim usage report
   */
  router.get('/report', (req, res) => {
    const report = metrics.getReport();
    res.json({ shims: report });
  });

  /**
   * POST /reset
   * Resets all shim metrics
   */
  router.post('/reset', (req, res) => {
    metrics.reset();
    res.json({
      status: 'reset',
      timestamp: new Date().toISOString()
    });
  });

  return router;
}
