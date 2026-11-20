import { sendInternalError } from '#api/utils/internalError.mjs';
// __backend/src/4_api/routers/admin/eventbus.mjs
import express from 'express';
import { nowTs } from '#system/utils/index.mjs';

/**
 * Create admin eventbus router for WebSocket server management
 *
 * Endpoints:
 * - POST /restart - Restart the WebSocket server
 * - POST /broadcast (or POST /) - Broadcast message to all clients
 * - GET /status - Get WebSocket server status and metrics
 *
 * State changes are POST only. A GET can be sent by any page a household
 * member opens (an <img>, a link), and the cross-site guard lets GETs through,
 * so a GET must never restart the bus or broadcast.
 * __docs/reference/core/network-exposure.md (Cross-site requests).
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
   * POST /restart
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

  /**
   * POST /broadcast
   * Broadcast a message to all connected WebSocket clients
   */
  function handleBroadcast(req, res) {
    try {
      if (!eventBusAdministration?.available) {
        return res.status(503).json({
          error: 'EventBus not configured',
          timestamp: nowTs()
        });
      }

      // Payload from the body, else the query string of the POST
      const payload = Object.keys(req.body || {}).length
        ? req.body
        : (req.query || {});

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
  }

  router.post('/broadcast', handleBroadcast);
  // Legacy alias: POST to the root broadcasts (for /exe/ws parity)
  router.post('/', handleBroadcast);

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
