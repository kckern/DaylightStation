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
import { splatPath } from '#api/utils/wildcard.mjs';

/**
 * Create siblings router
 * @param {Object} config
 * @param {import('#apps/content/services/SiblingsService.mjs').SiblingsService} config.siblingsService
 * @returns {express.Router}
 */
export function createSiblingsRouter(config) {
  const { siblingsService, contentIdResolver } = config;
  const router = express.Router();

  const handleSiblingsRequest = asyncHandler(async (req, res) => {
    const rawSource = req.params.source;
    const rawPath = splatPath(req);

    const { source: parsedSource, localId: parsedLocalId, compoundId } = parseActionRouteId({
      source: rawSource,
      path: rawPath
    });

    // Resolve through ContentIdResolver (handles aliases, prefixes, exact matches)
    const resolved = contentIdResolver.resolve(compoundId);
    const source = resolved?.source ?? parsedSource;
    const localId = resolved?.localId ?? parsedLocalId;

    // Parse pagination query params
    const offset = req.query.offset != null ? parseInt(req.query.offset, 10) : undefined;
    const limit = req.query.limit != null ? parseInt(req.query.limit, 10) : undefined;
    const opts = {};
    if (Number.isFinite(offset)) opts.offset = offset;
    if (Number.isFinite(limit)) opts.limit = limit;

    const result = await siblingsService.resolveSiblings(source, localId, opts);

    if (result.kind === 'source_unknown') {
      return res.status(404).json({
        error: `Unknown source: ${result.source}`,
        ...(result.source && { source: result.source }),
      });
    }

    // Success response
    res.json({
      parent: result.parent,
      items: result.items,
      ...(result.referenceIndex != null && { referenceIndex: result.referenceIndex }),
      ...(result.pagination && { pagination: result.pagination }),
      ...(result.ancestors && { ancestors: result.ancestors })
    });
  });

  router.get('/:source/*splat', handleSiblingsRequest);
  router.get('/:source', handleSiblingsRequest);

  return router;
}

export default createSiblingsRouter;
