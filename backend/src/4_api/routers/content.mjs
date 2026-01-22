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
   *
   * Supports legacy modifiers in path:
   * - /playable - resolve to playable items
   * - /shuffle or ,shuffle - randomize order
   * Examples:
   *   /list/plex/123 - list children
   *   /list/plex/123/playable - resolve to playable items
   *   /list/plex/123/playable,shuffle - playable + shuffled
   */
  router.get('/list/:source/*', async (req, res) => {
    try {
      const { source } = req.params;
      let localId = req.params[0] || '';

      // Parse modifiers from path (e.g., "123/playable,shuffle" or "123/playable")
      const playable = /playable/i.test(localId);
      const shuffle = /shuffle/i.test(localId);

      // Strip modifiers from localId to get the actual content ID
      localId = localId.replace(/\/(playable|shuffle|playable,shuffle|shuffle,playable)$/i, '');

      const adapter = registry.get(source);
      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      let items;
      if (playable && typeof adapter.resolvePlayables === 'function') {
        items = await adapter.resolvePlayables(localId);
      } else {
        items = await adapter.getList(localId);
      }

      // Shuffle if requested
      if (shuffle && Array.isArray(items)) {
        for (let i = items.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [items[i], items[j]] = [items[j], items[i]];
        }
      }

      // Get container info for show metadata
      const compoundId = source === 'folder' || source === 'local' ? `folder:${localId}` : `${source}:${localId}`;
      const containerInfo = adapter.getItem ? await adapter.getItem(compoundId) : null;

      // Build info object for FitnessShow compatibility
      let info = null;
      if (adapter.getContainerInfo) {
        info = await adapter.getContainerInfo(compoundId);
      }

      // Build seasons map from items' season metadata (for playable mode)
      let seasons = null;
      if (playable && items.length > 0) {
        const seasonsMap = {};
        for (const item of items) {
          const seasonId = item.metadata?.seasonId || item.metadata?.parent;
          if (seasonId && !seasonsMap[seasonId]) {
            seasonsMap[seasonId] = {
              num: item.metadata?.seasonNumber ?? item.metadata?.parentIndex,
              title: item.metadata?.seasonName || item.metadata?.parentTitle || `Season`,
              img: item.metadata?.seasonThumbUrl || item.metadata?.parentThumb || item.metadata?.showThumbUrl || item.metadata?.grandparentThumb
            };
          }
        }
        if (Object.keys(seasonsMap).length > 0) {
          seasons = seasonsMap;
        }
      }

      res.json({
        // Add plex field for plex source (matches prod format)
        ...(source === 'plex' && { plex: localId }),
        // Legacy compat field
        media_key: localId,
        source,
        path: localId,
        title: containerInfo?.title || localId,
        label: containerInfo?.title || localId,
        image: containerInfo?.thumbnail,
        info,
        seasons,
        items: items.map(item => {
          // Flatten metadata fields to top level for legacy compatibility
          const metadata = item.metadata || {};
          return {
            // Core fields
            id: item.id,
            title: item.title,
            itemType: item.itemType,
            childCount: item.childCount,
            thumbnail: item.thumbnail,
            // Legacy field aliases
            label: item.title,
            image: item.thumbnail,
            plex: item.id?.replace(/^plex:/, '') || item.id,
            // Flatten metadata for frontend (seasonId, episodeNumber, etc.)
            ...metadata,
            // Spread remaining item properties (duration, mediaUrl, etc.)
            ...item,
            // Keep metadata object for backwards compat with code expecting nested
            metadata
          };
        })
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
   * Returns full metadata for a Plex item with legacy-compatible fields.
   * Legacy fields: listkey, listType, key, type, show, season, labels,
   *                media_type, media_url, thumb_id, image, percent, seconds
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

      // Determine media_type for legacy compat
      const itemType = item.metadata?.type;
      const videoTypes = ['movie', 'episode', 'clip', 'short', 'trailer'];
      const audioTypes = ['track'];
      let media_type = itemType;
      if (videoTypes.includes(itemType)) media_type = 'dash_video';
      else if (audioTypes.includes(itemType)) media_type = 'audio';

      // Generate streaming URL for playable items
      let media_url = null;
      if (videoTypes.includes(itemType) || audioTypes.includes(itemType)) {
        media_url = await plexAdapter.loadMediaUrl(id);
      }

      // Load watch state from viewing history
      let percent = 0;
      let seconds = 0;
      if (typeof plexAdapter._loadViewingHistory === 'function') {
        const history = plexAdapter._loadViewingHistory();
        const entry = history[id];
        if (entry) {
          seconds = entry.playhead || entry.seconds || 0;
          const duration = entry.mediaDuration || entry.duration || 0;
          percent = duration > 0 ? Math.round((seconds / duration) * 100) : (entry.percent || 0);
        }
      }

      // Extract thumb_id from Media Part if available, else use rating key
      let thumb_id = id;
      const mediaPart = item.metadata?.Media?.[0]?.Part?.[0];
      if (mediaPart?.id) {
        thumb_id = mediaPart.id;
      }

      res.json({
        // Legacy identifiers
        listkey: id,
        listType: itemType,
        key: id,
        // Core fields
        title: item.title,
        type: itemType,
        // Show/season info (for episodes)
        show: item.metadata?.show || item.metadata?.grandparentTitle || null,
        season: item.metadata?.season || item.metadata?.parentTitle || null,
        // Labels for governance
        labels: item.metadata?.labels || [],
        // Media playback
        media_type,
        media_url,
        // Thumbnail
        thumb_id,
        image: item.thumbnail,
        // Watch state
        percent,
        seconds,
        // Preserve new DDD fields too
        id: item.id,
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
