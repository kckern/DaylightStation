/**
 * Screens API Router
 * Serves screen configurations from YAML files
 *
 * @module api/v1/routers/screens
 */
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create Screens API router
 *
 * @param {Object} config
 * @param {string} config.dataPath - Path to data directory
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createScreensRouter(config = {}) {
  const { dataPath = process.env.DAYLIGHT_DATA_PATH || '/data', logger = console } = config;
  const router = express.Router();

  /**
   * GET /screens
   * List available screens
   */
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const screensDir = path.join(dataPath, 'household', 'screens');

      try {
        const files = await fs.readdir(screensDir);
        const screens = files
          .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
          .map(f => f.replace(/\.ya?ml$/, ''));

        logger.debug?.('screens.list.success', { count: screens.length });
        res.json({ screens });
      } catch (err) {
        if (err.code === 'ENOENT') {
          // Directory doesn't exist yet
          logger.debug?.('screens.list.empty', { reason: 'directory not found' });
          res.json({ screens: [] });
        } else {
          throw err;
        }
      }
    })
  );

  /**
   * GET /screens/:screenId
   * Get screen configuration by ID
   */
  router.get(
    '/:screenId',
    asyncHandler(async (req, res) => {
      const { screenId } = req.params;

      // Validate screenId contains only safe characters (prevent path traversal)
      if (!/^[a-zA-Z0-9_-]+$/.test(screenId)) {
        logger.warn?.('screens.get.invalid_id', { screenId });
        return res.status(400).json({
          error: 'Invalid screen ID',
          message: 'Screen ID must contain only letters, numbers, hyphens, and underscores'
        });
      }

      const screenPath = path.join(dataPath, 'household', 'screens', `${screenId}.yml`);

      try {
        const content = await fs.readFile(screenPath, 'utf-8');
        const config = yaml.load(content);

        // Validate required fields
        if (!config.screen) {
          logger.warn?.('screens.get.invalid', { screenId, reason: 'missing screen field' });
          return res.status(400).json({
            error: 'Invalid screen config',
            message: 'Missing required "screen" field'
          });
        }

        logger.debug?.('screens.get.success', { screenId });
        res.json(config);
      } catch (err) {
        if (err.code === 'ENOENT') {
          logger.debug?.('screens.get.notfound', { screenId });
          return res.status(404).json({
            error: 'Screen not found',
            screenId
          });
        }
        logger.error?.('screens.get.error', { screenId, error: err.message });
        throw err;
      }
    })
  );

  // ==========================================================================
  // Error Handler Middleware
  // ==========================================================================

  router.use((err, req, res, next) => {
    logger.error?.('screens.router.error', {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
    });
    res.status(500).json({ error: err.message });
  });

  return router;
}

export default createScreensRouter;
