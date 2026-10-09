// backend/src/4_api/v1/routers/queries.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create the queries CRUD router.
 * Manages saved query definitions (smart playlists).
 *
 * @param {Object} deps
 * @param {import('#apps/content/SavedQueryService.mjs').SavedQueryService} deps.savedQueryService
 * @returns {express.Router}
 */
export function createQueriesRouter({ savedQueryService }) {
  const router = express.Router();

  /**
   * GET /api/v1/queries
   * List all saved query names.
   */
  router.get('/', asyncHandler(async (req, res) => {
    const names = savedQueryService.listQueries();
    const queries = names.map(name => {
      const query = savedQueryService.getQuery(name);
      return { name, ...query };
    });
    res.json(queries);
  }));

  /**
   * GET /api/v1/queries/:name
   * Get a single query definition.
   */
  router.get('/:name', asyncHandler(async (req, res) => {
    const query = savedQueryService.getQuery(req.params.name);
    if (!query) {
      return res.status(404).json({ error: `Query not found: ${req.params.name}` });
    }
    res.json({ name: req.params.name, ...query });
  }));

  /**
   * POST /api/v1/queries/:name
   * Create or update a query definition.
   */
  router.post('/:name', asyncHandler(async (req, res) => {
    const { type, sources, sort, take } = req.body;
    if (!type) {
      return res.status(400).json({ error: 'type is required' });
    }
    const data = { type };
    if (sources) data.sources = sources;
    if (sort) data.sort = sort;
    if (take != null) data.take = take;

    savedQueryService.saveQuery(req.params.name, data);
    res.json({ name: req.params.name, ...savedQueryService.getQuery(req.params.name) });
  }));

  /**
   * DELETE /api/v1/queries/:name
   * Delete a query definition.
   */
  router.delete('/:name', asyncHandler(async (req, res) => {
    const existing = savedQueryService.getQuery(req.params.name);
    if (!existing) {
      return res.status(404).json({ error: `Query not found: ${req.params.name}` });
    }
    savedQueryService.deleteQuery(req.params.name);
    res.json({ deleted: req.params.name });
  }));

  return router;
}
