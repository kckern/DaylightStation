/**
 * Art API Router
 * Serves a selected classic artwork (image path + metadata) for ArtMode.
 *
 * @module api/v1/routers/art
 */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create Art API router
 *
 * @param {Object} config
 * @param {Object} config.artAdapter - Adapter with selectFeatured()
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createArtRouter(config = {}) {
  const { artAdapter, logger = console } = config;
  const router = express.Router();

  /**
   * GET /featured
   * Returns a selected artwork: { image, meta }.
   */
  router.get(
    '/featured',
    asyncHandler(async (req, res) => {
      try {
        const result = await artAdapter.selectFeatured();
        logger.debug?.('art.featured.served', { title: result?.meta?.title ?? null });
        res.json(result);
      } catch (err) {
        logger.warn?.('art.featured.unavailable', { error: err.message });
        res.status(503).json({ error: 'No artwork available', message: err.message });
      }
    })
  );

  return router;
}

export default createArtRouter;
