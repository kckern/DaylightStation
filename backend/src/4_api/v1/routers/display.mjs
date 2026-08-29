import { sendInternalError } from '#api/utils/internalError.mjs';
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
import { generatePlaceholderSvg } from '../utils/placeholderSvg.mjs';
import { splatPath } from '#api/utils/wildcard.mjs';

/**
 * Create display API router for retrieving displayable content (images/thumbnails)
 *
 * Endpoints:
 * - GET /api/v1/display/:source/:id - Get displayable image
 * - GET /api/v1/display/:source::id - Get displayable image (compound ID)
 * - GET /api/v1/display/:id - Get displayable image (heuristic resolution)
 *
 * @param {Object} config
 * @param {Object} config.contentAccessService - Semantic content display query
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createDisplayRouter(config) {
  const { contentAccessService, logger = console } = config;
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
    const pathParam = splatPath(req);

    // Parse ID using unified parser
    const { source: parsedSource, localId: parsedLocalId, compoundId } = parseActionRouteId({ source, path: pathParam });

    const outcome = await contentAccessService.display(compoundId, parsedSource, parsedLocalId);
    const resolvedSource = outcome.source;
    const localId = outcome.localId;
    if (outcome.kind === 'unknown_source') {
      return res.status(404).json({
        error: `Unknown source: ${resolvedSource}`,
        hint: 'Valid sources: plex, immich, watchlist, filesystem, canvas'
      });
    }

    if (outcome.kind === 'missing_id') {
      return res.status(400).json({ error: 'Missing item ID' });
    }

    if (outcome.kind === 'failed') {
      logger.error?.('display.getThumbnail.error', { compoundId, error: outcome.error.message });
      return sendInternalError(res, { error: outcome.error.message });
    }
    const { thumbnailUrl, title: itemTitle } = outcome;

    if (!thumbnailUrl) {
      const svg = generatePlaceholderSvg({ type: resolvedSource, title: itemTitle || localId });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(svg);
    }

    // Redirect through proxy (replace external host with proxy path). Covers are
    // immutable per ratingKey, so let the browser cache the mapping — a cold reload
    // otherwise re-resolves every cover (the "no caching" the kiosk felt).
    const proxyUrl = thumbnailUrl.replace(/https?:\/\/[^\/]+/, `/api/v1/proxy/${resolvedSource}`);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.redirect(proxyUrl);
  });

  // Register routes: order matters - more specific first
  // GET /:source/* - handles path segments like /plex/12345
  router.get('/:source/*splat', handleDisplayRequest);

  // GET /:source - handles compound IDs like /plex:12345 and heuristics like /12345
  router.get('/:source', handleDisplayRequest);

  return router;
}

export default createDisplayRouter;
