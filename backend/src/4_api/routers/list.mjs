// backend/src/4_api/routers/list.mjs
import express from 'express';

/**
 * Create list API router for browsing content containers
 *
 * Endpoints:
 * - GET /api/list/:source/(path) - List container contents
 * - GET /api/list/:source/(path)/playable - List only playable items
 * - GET /api/list/:source/(path)/shuffle - Shuffled list
 *
 * @param {Object} config
 * @param {Object} config.registry - ContentSourceRegistry
 * @returns {express.Router}
 */
export function createListRouter(config) {
  const { registry } = config;
  const router = express.Router();

  /**
   * Parse path modifiers (playable, shuffle, recent_on_top)
   */
  function parseModifiers(rawPath) {
    const parts = rawPath.split('/');
    const modifiers = {
      playable: false,
      shuffle: false,
      recent_on_top: false
    };
    const cleanParts = [];

    for (const part of parts) {
      if (part === 'playable') {
        modifiers.playable = true;
      } else if (part === 'shuffle') {
        modifiers.shuffle = true;
      } else if (part === 'recent_on_top') {
        modifiers.recent_on_top = true;
      } else if (part.includes(',')) {
        const mods = part.split(',');
        for (const mod of mods) {
          if (mod === 'playable') modifiers.playable = true;
          if (mod === 'shuffle') modifiers.shuffle = true;
          if (mod === 'recent_on_top') modifiers.recent_on_top = true;
        }
      } else if (part) {
        cleanParts.push(part);
      }
    }

    return { modifiers, localId: cleanParts.join('/') };
  }

  /**
   * Shuffle array in place
   */
  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Transform item to list response format
   */
  function toListItem(item) {
    return {
      id: item.id,
      title: item.title,
      itemType: item.itemType || (item.children ? 'container' : 'leaf'),
      childCount: item.childCount || item.children?.length,
      thumbnail: item.thumbnail,
      image: item.thumbnail,
      metadata: item.metadata,
      // Legacy fields
      play: item.mediaUrl ? { media: item.id } : undefined,
      queue: item.itemType === 'container' ? { playlist: item.id } : undefined
    };
  }

  /**
   * GET /api/list/:source/(path)
   */
  router.get('/:source/*', async (req, res) => {
    try {
      const { source } = req.params;
      const rawPath = req.params[0] || '';
      const { modifiers, localId } = parseModifiers(rawPath);

      const adapter = registry.get(source);
      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      let items;

      if (modifiers.playable) {
        // Resolve to playable items only
        if (!adapter.resolvePlayables) {
          return res.status(400).json({ error: 'Source does not support playable resolution' });
        }
        const compoundId = source === 'folder' ? localId : `${source}:${localId}`;
        items = await adapter.resolvePlayables(compoundId);
      } else {
        // Get container contents
        const compoundId = source === 'folder' ? localId : `${source}:${localId}`;
        const result = await adapter.getList(compoundId);

        // Handle different response shapes
        if (Array.isArray(result)) {
          items = result;
        } else if (result?.children) {
          items = result.children;
        } else {
          items = [];
        }
      }

      // Apply shuffle if requested
      if (modifiers.shuffle) {
        items = shuffleArray([...items]);
      }

      // Build response
      const compoundId = source === 'folder' ? localId : `${source}:${localId}`;
      const containerInfo = adapter.getItem ? await adapter.getItem(compoundId) : null;

      res.json({
        source,
        path: localId,
        title: containerInfo?.title || localId,
        label: containerInfo?.title || localId,
        image: containerInfo?.thumbnail,
        items: items.map(toListItem)
      });
    } catch (err) {
      console.error('[list] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
