// backend/src/4_api/routers/admin/eventbus.mjs
import express from 'express';

/**
 * Create admin eventbus router for WebSocket server management
 *
 * Endpoints:
 * - POST /restart - Restart the WebSocket server
 * - GET /status - Get WebSocket server status and metrics
 *
 * @param {Object} config
 * @param {Object} config.eventBus - WebSocketEventBus instance
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createEventBusRouter(config) {
  const { eventBus, logger = console } = config;
  const router = express.Router();

  /**
   * POST /restart
   * Restart the WebSocket server
   */
  router.post('/restart', async (req, res) => {
    try {
      logger.info?.('admin.eventbus.restart.requested');

      if (!eventBus) {
        return res.status(503).json({
          error: 'EventBus not configured',
          timestamp: new Date().toISOString()
        });
      }

      await eventBus.restart();

      logger.info?.('admin.eventbus.restart.success');
      res.json({
        status: 'WebSocket server restarted successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error?.('admin.eventbus.restart.failed', { error: error.message });
      res.status(500).json({
        error: error.message || 'Failed to restart WebSocket server',
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * GET /status
   * Get WebSocket server status and metrics
   */
  router.get('/status', (req, res) => {
    if (!eventBus) {
      return res.status(503).json({
        error: 'EventBus not configured',
        timestamp: new Date().toISOString()
      });
    }

    const metrics = eventBus.getMetrics?.() || {};
    res.json({
      status: eventBus.isRunning?.() ? 'running' : 'stopped',
      metrics,
      timestamp: new Date().toISOString()
    });
  });

  return router;
}
