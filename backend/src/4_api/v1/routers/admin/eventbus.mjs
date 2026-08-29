import { sendInternalError } from '#api/utils/internalError.mjs';
// backend/src/4_api/routers/admin/eventbus.mjs
import express from 'express';
import { nowTs } from '#system/utils/index.mjs';

/**
 * Create admin eventbus router for WebSocket server management
 *
 * Endpoints:
 * - GET/POST /restart - Restart the WebSocket server
 * - GET/POST /broadcast - Broadcast message to all clients
 * - GET /status - Get WebSocket server status and metrics
 *
 * @param {Object} config
 * @param {Object} config.eventBusAdministration
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createEventBusRouter(config) {
  const { eventBusAdministration, logger = console } = config;
  const router = express.Router();

  /**
   * POST /restart or GET /restart
   * Restart the WebSocket server
   */
  async function handleRestart(req, res) {
    try {
      logger.info?.('admin.eventbus.restart.requested');

      if (!eventBusAdministration?.available) {
        return res.status(503).json({
          error: 'EventBus not configured',
          timestamp: nowTs()
        });
      }

      await eventBusAdministration.restart();

      logger.info?.('admin.eventbus.restart.success');
      res.json({
        status: 'WebSocket server restarted successfully',
        timestamp: nowTs()
      });
    } catch (error) {
      logger.error?.('admin.eventbus.restart.failed', { error: error.message });
      sendInternalError(res, {
        error: error.message || 'Failed to restart WebSocket server',
        timestamp: nowTs()
      });
    }
  }

  router.post('/restart', handleRestart);
  router.get('/restart', handleRestart);

  /**
   * POST /broadcast or GET /broadcast
   * Broadcast a message to all connected WebSocket clients
   */
  router.all('/broadcast', (req, res) => {
    try {
      if (!eventBusAdministration?.available) {
        return res.status(503).json({
          error: 'EventBus not configured',
          timestamp: nowTs()
        });
      }

      // Accept payload from body, query, or params
      const payload = Object.keys(req.body || {}).length
        ? req.body
        : (Object.keys(req.query || {}).length
          ? req.query
          : (req.params || {}));

      const message = {
        timestamp: nowTs(),
        ...payload
      };

      eventBusAdministration.broadcastAdmin(message);

      logger.info?.('admin.eventbus.broadcast', { payload: Object.keys(payload) });
      res.json({
        status: 'payload broadcasted',
        message,
        description: 'Frontend will receive the raw payload data'
      });
    } catch (error) {
      logger.error?.('admin.eventbus.broadcast.failed', { error: error.message });
      sendInternalError(res, { error: error.message || 'Failed to broadcast' });
    }
  });

  /**
   * Legacy alias: /ws broadcasts directly (for /exe/ws parity)
   */
  router.all('/', (req, res, next) => {
    // If this is a request to the root of /admin/ws, treat it as broadcast
    if (req.method === 'GET' && Object.keys(req.query).length === 0) {
      // Just a status check, delegate to /status
      return next();
    }
    // Otherwise, treat as broadcast
    req.url = '/broadcast';
    return router.handle(req, res, next);
  });

  /**
   * GET /status
   * Get WebSocket server status and metrics
   */
  router.get('/status', (req, res) => {
    if (!eventBusAdministration?.available) {
      return res.status(503).json({
        error: 'EventBus not configured',
        timestamp: nowTs()
      });
    }

    const eventBusStatus = eventBusAdministration.status();
    res.json({
      status: eventBusStatus.running ? 'running' : 'stopped',
      metrics: eventBusStatus.metrics,
      timestamp: nowTs()
    });
  });

  return router;
}
