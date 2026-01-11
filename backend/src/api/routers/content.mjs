// backend/src/api/routers/content.mjs
import express from 'express';

/**
 * Create content API router
 * @param {import('../../domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} registry
 * @returns {express.Router}
 */
export function createContentRouter(registry) {
  const router = express.Router();

  /**
   * GET /api/content/list/:source/*
   * List items from a content source
   */
  router.get('/list/:source/*', async (req, res) => {
    try {
      const { source } = req.params;
      const localId = req.params[0] || '';

      const adapter = registry.get(source);
      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      const items = await adapter.getList(localId);
      res.json({
        source,
        path: localId,
        items: items.map(item => ({
          id: item.id,
          title: item.title,
          itemType: item.itemType,
          childCount: item.childCount,
          thumbnail: item.thumbnail
        }))
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/content/item/:source/*
   * Get single item info
   */
  router.get('/item/:source/*', async (req, res) => {
    try {
      const { source } = req.params;
      const localId = req.params[0] || '';

      const adapter = registry.get(source);
      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      const item = await adapter.getItem(localId);
      if (!item) {
        return res.status(404).json({ error: 'Item not found', source, localId });
      }

      res.json(item);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/content/playables/:source/*
   * Resolve to playable items
   */
  router.get('/playables/:source/*', async (req, res) => {
    try {
      const { source } = req.params;
      const localId = req.params[0] || '';

      const adapter = registry.get(source);
      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      const playables = await adapter.resolvePlayables(localId);
      res.json({
        source,
        path: localId,
        items: playables
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
