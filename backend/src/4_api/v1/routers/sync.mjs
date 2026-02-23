/**
 * Sync API Router
 *
 * Endpoints:
 * - POST /api/v1/sync/:source - Trigger sync for a content source
 * - GET  /api/v1/sync/:source/status - Get sync status for a source
 *
 * @module api/v1/routers/sync
 */
import express from 'express';

/**
 * Create sync API router
 *
 * @param {Object} config
 * @param {Object} config.syncService - SyncService for orchestrating content syncs
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createSyncRouter(config) {
  const { syncService, logger = console } = config;
  const router = express.Router();

  /**
   * POST /:source - Trigger sync for a content source
   *
   * Params:
   * - source: string - Source identifier (e.g., 'retroarch')
   */
  router.post('/:source', async (req, res) => {
    const { source } = req.params;
    try {
      const result = await syncService.sync(source);
      res.json(result);
    } catch (error) {
      const status = error.name === 'EntityNotFoundError' ? 404 : 500;
      logger.error?.('sync.api.error', { source, error: error.message });
      res.status(status).json({ error: error.message });
    }
  });

  /**
   * GET /:source/status - Get sync status for a source
   *
   * Params:
   * - source: string - Source identifier (e.g., 'retroarch')
   */
  router.get('/:source/status', async (req, res) => {
    const { source } = req.params;
    try {
      const result = await syncService.getStatus(source);
      res.json(result);
    } catch (error) {
      const status = error.name === 'EntityNotFoundError' ? 404 : 500;
      logger.error?.('sync.api.statusError', { source, error: error.message });
      res.status(status).json({ error: error.message });
    }
  });

  return router;
}

export default createSyncRouter;
