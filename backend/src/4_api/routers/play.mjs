// backend/src/4_api/routers/play.mjs
import express from 'express';

/**
 * Create play API router for retrieving playable media info
 *
 * Endpoints:
 * - GET /api/play/:source/(path) - Get playable item info
 * - GET /api/play/:source/(path)/shuffle - Get random item from container
 *
 * @param {Object} config
 * @param {Object} config.registry - ContentSourceRegistry
 * @param {Object} config.watchStore - WatchStateStore
 * @returns {express.Router}
 */
export function createPlayRouter(config) {
  const { registry, watchStore } = config;
  const router = express.Router();

  /**
   * Parse path modifiers (shuffle, etc.)
   */
  function parseModifiers(pathParts) {
    const modifiers = { shuffle: false };
    const cleanParts = [];

    for (const part of pathParts) {
      if (part === 'shuffle') {
        modifiers.shuffle = true;
      } else if (part.includes(',')) {
        const mods = part.split(',');
        for (const mod of mods) {
          if (mod === 'shuffle') modifiers.shuffle = true;
        }
      } else {
        cleanParts.push(part);
      }
    }

    return { modifiers, localId: cleanParts.join('/') };
  }

  /**
   * Transform internal item to legacy-compatible response
   */
  function toPlayResponse(item, watchState = null) {
    const response = {
      id: item.id,
      media_key: item.id,
      media_url: item.mediaUrl,
      media_type: item.mediaType,
      title: item.title,
      duration: item.duration,
      resumable: item.resumable ?? false,
      thumbnail: item.thumbnail,
      metadata: item.metadata
    };

    // Add resume position if in progress
    if (watchState?.isInProgress?.()) {
      response.resume_position = watchState.playhead;
      response.resume_percent = watchState.percent;
    }

    // Legacy field mapping for Plex items
    if (item.metadata) {
      if (item.metadata.grandparentTitle) response.show = item.metadata.grandparentTitle;
      if (item.metadata.parentTitle) response.season = item.metadata.parentTitle;
      if (item.metadata.type === 'episode') response.episode = item.title;
    }

    // Legacy field for source identification
    if (item.id.startsWith('plex:')) {
      response.plex = item.id.replace('plex:', '');
    }

    return response;
  }

  /**
   * GET /api/play/:source/*
   */
  router.get('/:source/*', async (req, res) => {
    try {
      const { source } = req.params;
      const rawPath = req.params[0] || '';
      const { modifiers, localId } = parseModifiers(rawPath.split('/'));

      const adapter = registry.get(source);
      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      // If shuffle modifier, resolve to playables and return random one
      if (modifiers.shuffle && adapter.resolvePlayables) {
        const playables = await adapter.resolvePlayables(localId);
        if (!playables.length) {
          return res.status(404).json({ error: 'No playable items found' });
        }

        const randomItem = playables[Math.floor(Math.random() * playables.length)];
        const storagePath = typeof adapter.getStoragePath === 'function'
          ? await adapter.getStoragePath(randomItem.id)
          : source;
        const watchState = watchStore ? await watchStore.get(randomItem.id, storagePath) : null;

        return res.json(toPlayResponse(randomItem, watchState));
      }

      // Get single item
      const compoundId = `${source}:${localId}`;
      const item = await adapter.getItem(compoundId);
      if (!item) {
        return res.status(404).json({ error: 'Item not found', source, localId });
      }

      // Check if it's a container (needs resolution to playable)
      if (item.isContainer?.() || item.itemType === 'container') {
        const playables = await adapter.resolvePlayables(compoundId);
        if (!playables.length) {
          return res.status(404).json({ error: 'No playable items in container' });
        }

        const firstPlayable = playables[0];
        const storagePath = typeof adapter.getStoragePath === 'function'
          ? await adapter.getStoragePath(firstPlayable.id)
          : source;
        const watchState = watchStore ? await watchStore.get(firstPlayable.id, storagePath) : null;

        return res.json(toPlayResponse(firstPlayable, watchState));
      }

      // Return playable item
      const storagePath = typeof adapter.getStoragePath === 'function'
        ? await adapter.getStoragePath(item.id)
        : source;
      const watchState = watchStore ? await watchStore.get(item.id, storagePath) : null;

      res.json(toPlayResponse(item, watchState));
    } catch (err) {
      console.error('[play] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
