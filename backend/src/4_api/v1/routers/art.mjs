/**
 * Art API Router
 * Serves a selected classic artwork (image path + metadata) for ArtMode.
 *
 * @module api/v1/routers/art
 */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { resolvePreset } from '#adapters/content/art/presetResolver.mjs';
import { loadArtmodeConfig, loadArtCollections } from '#adapters/content/art/artmodeConfig.mjs';

/**
 * Create Art API router
 *
 * @param {Object} config
 * @param {Object} config.artAdapter - Adapter with selectFeatured()
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createArtRouter(config = {}) {
  const { artAdapter, dataPath, logger = console } = config;
  const router = express.Router();

  /**
   * GET /featured
   * Returns a selected artwork: { image, meta }.
   */
  router.get(
    '/featured',
    asyncHandler(async (req, res) => {
      try {
        const result = await artAdapter.selectFeatured({ collection: req.query.collection });
        logger.debug?.('art.featured.served', { title: result?.meta?.title ?? null });
        res.json(result);
      } catch (err) {
        logger.warn?.('art.featured.unavailable', { error: err.message });
        res.status(503).json({ error: 'No artwork available', message: err.message });
      }
    })
  );

  /**
   * GET /preset/:key
   * Resolves a named ArtMode preset (artmode.yml) into props, with `defaults` +
   * the named-frame catalog merged in. A bare collection name (art.yml) resolves
   * via collection-fallback, so menu ids like `art:baroque` need no passthrough
   * preset. 404 only when the key is neither a preset nor a collection.
   */
  router.get(
    '/preset/:key',
    asyncHandler(async (req, res) => {
      const { key } = req.params;
      const { presets, defaults, frames } = await loadArtmodeConfig(dataPath, logger);
      const collections = await loadArtCollections(dataPath, logger);
      const known = Object.prototype.hasOwnProperty.call(presets, key)
        || Object.prototype.hasOwnProperty.call(collections, key);
      if (!known) {
        logger.debug?.('art.preset.unknown', { key });
        return res.status(404).json({ error: 'Unknown preset', key });
      }
      res.json(resolvePreset(presets, key, {}, { defaults, frames, collections }));
    })
  );

  return router;
}

export default createArtRouter;
