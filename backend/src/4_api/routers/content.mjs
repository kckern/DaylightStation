// backend/src/4_api/routers/content.mjs
import express from 'express';
import fs from 'fs';
import path from 'path';
import { WatchState } from '../../1_domains/content/entities/WatchState.mjs';

/**
 * Create content API router
 *
 * Endpoints:
 * - GET /api/content/list/:source/* - List items from source
 * - GET /api/content/item/:source/* - Get single item info
 * - GET /api/content/playables/:source/* - Resolve to playable items
 * - POST /api/content/progress/:source/* - Update watch progress
 * - GET /api/content/plex/image/:id - Get Plex thumbnail image
 * - GET /api/content/plex/info/:id - Get Plex item metadata
 * - POST /api/content/menu-log - Log menu navigation
 *
 * @param {import('../../1_domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} registry
 * @param {import('../../2_adapters/persistence/yaml/YamlWatchStateStore.mjs').YamlWatchStateStore} [watchStore=null] - Optional watch state store
 * @param {Object} [options] - Additional options
 * @param {Function} [options.loadFile] - Function to load YAML files
 * @param {Function} [options.saveFile] - Function to save YAML files
 * @param {string} [options.cacheBasePath] - Base path for image cache
 * @param {Object} [options.logger] - Logger instance
 * @returns {express.Router}
 */
export function createContentRouter(registry, watchStore = null, options = {}) {
  const { loadFile, saveFile, cacheBasePath, logger = console } = options;
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
  router.post('/progress/:source/*', async (req, res) => {
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

  // ==========================================================================
  // Plex-specific Routes
  // ==========================================================================

  /**
   * GET /api/content/plex/image/:id - Get Plex thumbnail image
   *
   * Proxies and caches Plex thumbnail images.
   */
  router.get('/plex/image/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const plexAdapter = registry.get('plex');

      if (!plexAdapter) {
        return res.status(503).json({ error: 'Plex adapter not configured' });
      }

      // Check cache if available
      if (cacheBasePath) {
        const cacheDir = path.join(cacheBasePath, 'plex');
        const cacheFile = path.join(cacheDir, `${id}.jpg`);

        if (fs.existsSync(cacheFile)) {
          return res.sendFile(cacheFile);
        }
      }

      // Get thumbnail URL from adapter
      let thumbnailUrl;
      if (typeof plexAdapter.getThumbnailUrl === 'function') {
        thumbnailUrl = await plexAdapter.getThumbnailUrl(id);
      } else if (typeof plexAdapter.getItem === 'function') {
        const item = await plexAdapter.getItem(`plex:${id}`);
        thumbnailUrl = item?.thumbnail;
      }

      if (!thumbnailUrl) {
        return res.status(404).json({ error: 'Thumbnail not found', id });
      }

      // Redirect to proxy for the actual image fetch
      const proxyUrl = thumbnailUrl.replace(/https?:\/\/[^\/]+/, '/proxy/plex');
      res.redirect(proxyUrl);
    } catch (error) {
      logger.error?.('content.plex.image.error', { id: req.params.id, error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/content/plex/info/:id - Get Plex item metadata
   *
   * Returns full metadata for a Plex item.
   */
  router.get('/plex/info/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const plexAdapter = registry.get('plex');

      if (!plexAdapter) {
        return res.status(503).json({ error: 'Plex adapter not configured' });
      }

      const item = await plexAdapter.getItem(`plex:${id}`);
      if (!item) {
        return res.status(404).json({ error: 'Item not found', id });
      }

      res.json({
        id: item.id,
        title: item.title,
        itemType: item.itemType,
        mediaType: item.mediaType,
        duration: item.duration,
        thumbnail: item.thumbnail,
        metadata: item.metadata
      });
    } catch (error) {
      logger.error?.('content.plex.info.error', { id: req.params.id, error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================================================
  // Menu Navigation Logging
  // ==========================================================================

  /**
   * POST /api/content/menu-log - Log menu navigation
   *
   * Tracks when menu items are accessed for sorting purposes.
   * Body: { media_key: string }
   */
  router.post('/menu-log', async (req, res) => {
    try {
      const { media_key } = req.body;

      if (!media_key) {
        return res.status(400).json({ error: 'media_key is required' });
      }

      if (!loadFile || !saveFile) {
        return res.status(501).json({ error: 'Menu logging not configured' });
      }

      const menuPath = 'state/menu_memory';
      const menuLog = loadFile(menuPath) || {};
      const nowUnix = Math.floor(Date.now() / 1000);

      menuLog[media_key] = nowUnix;
      saveFile(menuPath, menuLog);

      logger.info?.('content.menu-log.updated', { media_key });
      res.json({ [media_key]: nowUnix });
    } catch (error) {
      logger.error?.('content.menu-log.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
