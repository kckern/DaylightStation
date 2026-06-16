/**
 * Art API Router
 * Serves a selected classic artwork (image path + metadata) for ArtMode.
 *
 * @module api/v1/routers/art
 */
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { resolvePreset } from '../../../1_adapters/content/art/presetResolver.mjs';

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
   * Resolves a named ArtMode preset (artmode.yml) into props. 404 if unknown.
   */
  router.get(
    '/preset/:key',
    asyncHandler(async (req, res) => {
      const { key } = req.params;
      let presets = {};
      try {
        const raw = await fs.readFile(
          path.join(dataPath, 'household', 'config', 'artmode.yml'), 'utf-8');
        presets = (yaml.load(raw) || {}).presets || {};
      } catch (err) {
        if (err.code !== 'ENOENT') logger.warn?.('art.presets.read_failed', { error: err.message });
      }
      if (!Object.prototype.hasOwnProperty.call(presets, key)) {
        logger.debug?.('art.preset.unknown', { key });
        return res.status(404).json({ error: 'Unknown preset', key });
      }
      res.json(resolvePreset(presets, key));
    })
  );

  return router;
}

export default createArtRouter;
