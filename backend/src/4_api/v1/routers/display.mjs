/**
 * Display Router
 *
 * Provides displayable content retrieval (images/thumbnails) with unified ID format support.
 * Returns thumbnail images via redirect to proxy.
 *
 * Supported formats:
 * - Path segments: /display/plex/12345
 * - Compound ID: /display/plex:12345
 * - Heuristic: /display/12345 (auto-detects plex)
 *
 * @module api/v1/routers/display
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';

/**
 * Create display API router for retrieving displayable content (images/thumbnails)
 *
 * Endpoints:
 * - GET /api/v1/display/:source/:id - Get displayable image
 * - GET /api/v1/display/:source::id - Get displayable image (compound ID)
 * - GET /api/v1/display/:id - Get displayable image (heuristic resolution)
 *
 * @param {Object} config
 * @param {Object} config.registry - ContentSourceRegistry
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createDisplayRouter(config) {
  const { registry, contentIdResolver, logger = console } = config;
  const router = express.Router();

  /**
   * Handler for display requests.
   *
   * Supports:
   * - /display/plex/12345 (path segments)
   * - /display/plex:12345 (compound ID)
   * - /display/12345 (heuristic detection)
   */
  const handleDisplayRequest = asyncHandler(async (req, res) => {
    const { source } = req.params;
    const pathParam = req.params[0] || '';

    // Parse ID using unified parser
    const { source: parsedSource, localId: parsedLocalId, compoundId } = parseActionRouteId({ source, path: pathParam });

    // Resolve through ContentIdResolver (handles aliases, prefixes, exact matches)
    const resolved = contentIdResolver.resolve(compoundId);

    const adapter = resolved?.adapter;
    const resolvedSource = resolved?.source ?? parsedSource;
    const localId = resolved?.localId ?? parsedLocalId;

    if (!adapter) {
      return res.status(404).json({
        error: `Unknown source: ${resolvedSource}`,
        hint: 'Valid sources: plex, immich, watchlist, filesystem, canvas'
      });
    }

    if (!localId) {
      return res.status(400).json({ error: 'Missing item ID' });
    }

    // Get thumbnail URL from adapter
    let thumbnailUrl;
    try {
      if (typeof adapter.getThumbnailUrl === 'function') {
        thumbnailUrl = await adapter.getThumbnailUrl(localId);
      }

      // Fallback: try getItem if getThumbnailUrl doesn't exist or returns null
      if (!thumbnailUrl && typeof adapter.getItem === 'function') {
        const item = await adapter.getItem(compoundId);
        thumbnailUrl = item?.thumbnail || item?.imageUrl;
      }
    } catch (err) {
      logger.error?.('display.getThumbnail.error', { compoundId, error: err.message });
      return res.status(500).json({ error: err.message });
    }

    if (!thumbnailUrl) {
      return res.status(404).json({
        error: `Thumbnail not found: ${compoundId}`,
        source: resolvedSource,
        localId,
        hint: 'Item may not have a displayable representation'
      });
    }

    // Redirect through proxy (replace external host with proxy path)
    const proxyUrl = thumbnailUrl.replace(/https?:\/\/[^\/]+/, `/api/v1/proxy/${resolvedSource}`);
    res.redirect(proxyUrl);
  });

  // Register routes: order matters - more specific first
  // GET /:source/* - handles path segments like /plex/12345
  router.get('/:source/*', handleDisplayRequest);

  // GET /:source - handles compound IDs like /plex:12345 and heuristics like /12345
  router.get('/:source', handleDisplayRequest);

  return router;
}

export default createDisplayRouter;
