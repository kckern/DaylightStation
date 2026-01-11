// backend/src/api/routers/content.mjs
import express from 'express';
import { WatchState } from '../../domains/content/entities/WatchState.mjs';

/**
 * Create content API router
 * @param {import('../../domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} registry
 * @param {import('../../adapters/persistence/yaml/YamlWatchStateStore.mjs').YamlWatchStateStore} [watchStore=null] - Optional watch state store
 * @returns {express.Router}
 */
export function createContentRouter(registry, watchStore = null) {
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

  /**
   * POST /api/content/progress/:source/*
   * Update watch progress for an item
   */
  router.post('/progress/:source/*', express.json(), async (req, res) => {
    try {
      if (!watchStore) {
        return res.status(501).json({ error: 'Watch state storage not configured' });
      }

      const { source } = req.params;
      const localId = req.params[0] || '';
      const { seconds, duration } = req.body;

      if (typeof seconds !== 'number' || typeof duration !== 'number') {
        return res.status(400).json({ error: 'seconds and duration are required numbers' });
      }

      const adapter = registry.get(source);
      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      const itemId = `${source}:${localId}`;
      const storagePath = typeof adapter.getStoragePath === 'function'
        ? await adapter.getStoragePath(localId)
        : source;

      // Get existing state or create new one
      const existing = await watchStore.get(itemId, storagePath);
      const state = new WatchState({
        itemId,
        playhead: seconds,
        duration,
        playCount: (existing?.playCount || 0) + (seconds === 0 ? 1 : 0),
        lastPlayed: new Date().toISOString(),
        watchTime: (existing?.watchTime || 0) + Math.max(0, seconds - (existing?.playhead || 0))
      });

      await watchStore.set(state, storagePath);

      res.json({
        itemId,
        playhead: state.playhead,
        duration: state.duration,
        percent: state.percent,
        watched: state.isWatched()
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
