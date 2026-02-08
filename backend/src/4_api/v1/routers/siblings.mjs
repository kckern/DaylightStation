// backend/src/4_api/v1/routers/siblings.mjs
/**
 * Siblings Router
 * 
 * Thin HTTP translation layer for sibling resolution.
 * Delegates all business logic to SiblingsService (application layer).
 * 
 * @module siblings
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';

/**
 * Create siblings router
 * @param {Object} config
 * @param {import('#apps/content/services/SiblingsService.mjs').SiblingsService} config.siblingsService
 * @returns {express.Router}
 */
export function createSiblingsRouter(config) {
  const { siblingsService } = config;
  const router = express.Router();

  const handleSiblingsRequest = asyncHandler(async (req, res) => {
    const rawSource = req.params.source;
    const rawPath = req.params[0] || '';

    const { source, localId } = parseActionRouteId({
      source: rawSource,
      path: rawPath
    });

    const result = await siblingsService.resolveSiblings(source, localId);

    // Handle error results
    if (result.error) {
      const status = result.status || 404;
      return res.status(status).json({
        error: result.error,
        ...(result.source && { source: result.source }),
        ...(result.localId && { localId: result.localId })
      });
    }

    // Success response
    res.json({
      parent: result.parent,
      items: result.items
    });
  });

  router.get('/:source/*', handleSiblingsRequest);
  router.get('/:source', handleSiblingsRequest);

  return router;
}

export default createSiblingsRouter;
