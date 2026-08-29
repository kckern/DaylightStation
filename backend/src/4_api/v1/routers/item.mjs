// backend/src/4_api/routers/item.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { toListItem } from './list.mjs';
import { parseModifiers } from '../utils/modifierParser.mjs';
import { splatPath } from '#api/utils/wildcard.mjs';

/**
 * Create unified item API router
 *
 * Endpoints:
 * - GET /api/v1/item/:source/(path) - Get single item info
 * - GET /api/v1/item/:source/(path)/playable - Get playable items from container
 * - GET /api/v1/item/:source/(path)/shuffle - Get shuffled container items
 * - GET /api/v1/item/:source/(path)/recent_on_top - Sort by recent menu selection
 * - POST /api/v1/item/menu-log - Log menu navigation for recent_on_top sorting
 *
 * Query params:
 * - ?select=watchlist - Use ItemSelectionService to pick item based on watch history
 *
 * @param {Object} options
 * @param {Object} options.itemService - Semantic item query and menu-memory operations
 * @param {Object} [options.logger] - Logger instance
 * @returns {express.Router}
 */
export function createItemRouter(options = {}) {
  const { itemService, logger = console } = options;
  const router = express.Router();

  /**
   * GET /api/v1/item/:source/*
   * Get single item info or container contents with modifiers
   */
  // {/*splat} (optional wildcard) so /item/:source and /item/:source/ still match
  // (Express 4's bare * matched an empty wildcard; *splat alone would not).
  router.get('/:source{/*splat}', asyncHandler(async (req, res) => {
      const { source } = req.params;
      const rawPath = splatPath(req);
      const { modifiers, localId } = parseModifiers(rawPath);
      const outcome = await itemService.get({ source, localId, modifiers, selectStrategy: req.query.select });
      if (outcome.kind === 'unknown_source') return res.status(404).json({ error: `Unknown source: ${source}` });
      if (outcome.kind === 'selection_empty') return res.status(404).json({
        error: 'No items available after selection', source, localId, strategy: outcome.strategy,
      });
      if (outcome.kind === 'not_found') return res.status(404).json({ error: 'Item not found', source, localId });
      if (outcome.kind === 'playable_unsupported') return res.status(400).json({ error: 'Source does not support playable resolution' });
      if (outcome.kind === 'selected') return res.json({
        ...outcome.item,
        _selection: { strategy: outcome.strategy, totalCandidates: outcome.totalCandidates },
      });
      if (outcome.kind === 'content_item') return res.json(outcome.item);
      if (outcome.kind === 'item') return res.json(toListItem(outcome.item));

      const parents = Object.fromEntries(Object.entries(outcome.parents).map(([id, parent]) => [id, {
        ...parent,
        thumbnail: parent.thumbnail || `/api/v1/display/plex/${id}`,
      }]));
      const response = {
        id: outcome.item.id,
        // Add plex field for plex source (matches legacy format)
        ...(source === 'plex' && { plex: localId }),
        source,
        path: localId,
        title: outcome.item.title || localId,
        label: outcome.item.title || localId,
        // Include Plex type at top level for PlexMenuRouter (show, season, episode, etc.)
        type: outcome.item.metadata?.type,
        itemType: outcome.item.itemType,
        thumbnail: outcome.item.thumbnail,
        image: outcome.item.thumbnail,
        // Include info and parents for FitnessShow compatibility
        ...(outcome.info && { info: outcome.info }),
        ...(Object.keys(parents).length > 0 && { parents }),
        items: outcome.items.map(toListItem)
      };

      res.json(response);
  }));

  /**
   * POST /api/v1/item/menu-log
   * Log menu navigation for recent_on_top sorting
   * Body: { assetId: string }
   */
  router.post('/menu-log', asyncHandler(async (req, res) => {
    const { assetId } = req.body;

    if (!assetId) {
      return res.status(400).json({ error: 'assetId is required' });
    }

    const result = itemService.recordMenuSelection(assetId);

    logger.info?.('item.menu-log.updated', { assetId });
    res.json(result);
  }));

  return router;
}

export default createItemRouter;
