// backend/src/4_api/routers/content.mjs
import express from 'express';
import fs from 'fs';
import path from 'path';
import { nowTs24 } from '../../0_system/utils/index.mjs';

/**
 * Create content API router
 *
 * Endpoints:
 * - GET /api/content/item/:source/* - Get single item info
 * - GET /api/content/playables/:source/* - Resolve to playable items
 * - POST /api/content/progress/:source/* - Update watch progress
 * - GET /api/content/plex/image/:id - Get Plex thumbnail image
 * - GET /api/content/plex/info/:id - Get Plex item metadata
 *
 * Note: List endpoint moved to /api/v1/list/:source/* (list.mjs)
 * Note: Menu logging moved to /api/v1/item/menu-log (item.mjs)
 *
 * @param {import('../../1_domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} registry
 * @param {import('../../2_adapters/persistence/yaml/YamlWatchStateStore.mjs').YamlWatchStateStore} [watchStore=null] - Optional watch state store
 * @param {Object} [options] - Additional options
 * @param {string} [options.cacheBasePath] - Base path for image cache
 * @param {Object} [options.logger] - Logger instance
 * @returns {express.Router}
 */
export function createContentRouter(registry, watchStore = null, options = {}) {
  const { cacheBasePath, logger = console } = options;
  const router = express.Router();

  /**
   * Create watch state object with toJSON method for datastore compatibility
   * @param {Object} props - Watch state properties
   * @returns {Object}
   */
  function createWatchStateDTO(props) {
    const { itemId, playhead = 0, duration = 0, playCount = 0, lastPlayed = null, watchTime = 0 } = props;
    const percent = duration > 0 ? Math.round((playhead / duration) * 100) : 0;
    return {
      itemId,
      playhead,
      duration,
      percent,
      playCount,
      lastPlayed,
      watchTime,
      toJSON() {
        return {
          itemId: this.itemId,
          playhead: this.playhead,
          duration: this.duration,
          percent: this.percent,
          playCount: this.playCount,
          lastPlayed: this.lastPlayed,
          watchTime: this.watchTime
        };
      }
    };
  }

  /**
   * Check if watch state indicates the item is fully watched
   * @param {Object} state - Plain watch state object
   * @returns {boolean}
   */
  function isWatched(state) {
    if (!state || !state.duration) return false;
    const percent = state.percent ?? (state.playhead && state.duration > 0
      ? Math.round((state.playhead / state.duration) * 100)
      : 0);
    return percent >= 90;
  }

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
      const state = createWatchStateDTO({
        itemId,
        playhead: seconds,
        duration,
        playCount: (existing?.playCount || 0) + (seconds === 0 ? 1 : 0),
        lastPlayed: nowTs24(),
        watchTime: (existing?.watchTime || 0) + Math.max(0, seconds - (existing?.playhead || 0))
      });

      await watchStore.set(state, storagePath);

      res.json({
        itemId,
        playhead: state.playhead,
        duration: state.duration,
        percent: state.percent,
        watched: isWatched(state)
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
   * GET /api/content/plex/info/:id/:modifiers? - Get Plex item metadata
   *
   * Returns full metadata for a Plex item with legacy-compatible fields.
   * For containers (shows, albums), can use smart selection to pick a playable item.
   *
   * Modifiers (path or query):
   * - shuffle: Randomly select from unwatched items
   *
   * Legacy fields: listkey, listType, key, type, show, season, labels,
   *                media_type, media_url, thumb_id, image, percent, seconds
   */
  router.get('/plex/info/:id/:modifiers?', async (req, res) => {
    try {
      const { id, modifiers } = req.params;
      const shuffle = modifiers === 'shuffle' || 'shuffle' in req.query;

      const plexAdapter = registry.get('plex');

      if (!plexAdapter) {
        return res.status(503).json({ error: 'Plex adapter not configured' });
      }

      // For containers with shuffle, use smart selection to pick a playable item
      let item;
      let selectedId = id;
      if (shuffle && typeof plexAdapter.loadPlayableItemFromKey === 'function') {
        const selected = await plexAdapter.loadPlayableItemFromKey(id, { shuffle: true });
        if (selected) {
          item = selected;
          selectedId = item.localId || item.id?.replace(/^plex:/, '') || id;
        }
      }

      // If no smart selection or not a container, get item directly
      if (!item) {
        item = await plexAdapter.getItem(`plex:${id}`);
      }
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
        media_url = await plexAdapter.loadMediaUrl(selectedId);
      }

      // Load watch state from viewing history
      let percent = 0;
      let seconds = 0;
      if (typeof plexAdapter._loadViewingHistory === 'function') {
        const history = plexAdapter._loadViewingHistory();
        const entry = history[selectedId];
        if (entry) {
          seconds = entry.playhead || entry.seconds || 0;
          const duration = entry.mediaDuration || entry.duration || 0;
          percent = duration > 0 ? Math.round((seconds / duration) * 100) : (entry.percent || 0);
        }
      }

      // Extract thumb_id from Media Part if available, else use rating key
      let thumb_id = selectedId;
      const mediaPart = item.metadata?.Media?.[0]?.Part?.[0];
      if (mediaPart?.id) {
        thumb_id = mediaPart.id;
      }

      res.json({
        // Legacy identifiers
        listkey: id,  // Original container ID (for queue context)
        listType: itemType,
        key: selectedId,  // Actual item to play (may differ if smart selection used)
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

  return router;
}
