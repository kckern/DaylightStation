// backend/src/4_api/routers/item.mjs
import express from 'express';
import { toListItem } from './list.mjs';

/**
 * Parse path modifiers (playable, shuffle, recent_on_top)
 * @param {string} rawPath - Raw path from URL
 * @returns {Object} { modifiers, localId }
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
 * Shuffle array in place (Fisher-Yates)
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Extract media key from item's action objects for menu_memory lookup
 * @param {Object} item - Item entity or list item
 * @returns {string|null} Media key for lookup
 */
function getMenuMemoryKey(item) {
  const action = item.actions?.play || item.actions?.queue || item.actions?.list || item.actions?.open ||
                 item.play || item.queue || item.list || item.open;
  if (!action) return null;
  const values = Object.values(action);
  return values.length > 0 ? values[0] : null;
}

/**
 * Create unified item API router
 *
 * Endpoints:
 * - GET /api/v1/item/:source/(path) - Get single item info
 * - GET /api/v1/item/:source/(path)/playable - Get playable items from container
 * - GET /api/v1/item/:source/(path)/shuffle - Get shuffled container items
 * - GET /api/v1/item/:source/(path)/recent_on_top - Sort by recent menu selection
 *
 * @param {Object} options
 * @param {import('../../1_domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} options.registry
 * @param {Function} [options.loadFile] - Function to load state files
 * @param {Object} [options.configService] - ConfigService for household paths
 * @param {Object} [options.logger] - Logger instance
 * @returns {express.Router}
 */
export function createItemRouter(options = {}) {
  const { registry, loadFile, configService, logger = console } = options;
  const router = express.Router();

  /**
   * GET /api/v1/item/:source/*
   * Get single item info or container contents with modifiers
   */
  router.get('/:source/*', async (req, res) => {
    try {
      const { source } = req.params;
      const rawPath = req.params[0] || '';
      const { modifiers, localId } = parseModifiers(rawPath);
      const hasModifiers = modifiers.playable || modifiers.shuffle || modifiers.recent_on_top;

      const adapter = registry.get(source);
      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      // 'local' is an alias for 'folder' - both use FolderAdapter
      const isFolderSource = source === 'folder' || source === 'local';
      const compoundId = isFolderSource ? `folder:${localId}` : `${source}:${localId}`;

      // Get the item first
      const item = await adapter.getItem(compoundId);
      if (!item) {
        return res.status(404).json({ error: 'Item not found', source, localId });
      }

      // If no modifiers and not a container, return single item
      if (!hasModifiers && item.itemType !== 'container') {
        res.json(toListItem(item));
        return;
      }

      // Container handling with modifiers
      let items;

      if (modifiers.playable) {
        // Resolve to playable items only
        if (!adapter.resolvePlayables) {
          return res.status(400).json({ error: 'Source does not support playable resolution' });
        }
        items = await adapter.resolvePlayables(compoundId);
      } else {
        // Get container contents
        const result = await adapter.getList(compoundId);
        if (Array.isArray(result)) {
          items = result;
        } else if (result?.children) {
          items = result.children;
        } else {
          items = [];
        }
      }

      // Merge viewing history for sources that support it (e.g., Plex)
      if (typeof adapter._loadViewingHistory === 'function') {
        const viewingHistory = adapter._loadViewingHistory();
        if (viewingHistory && Object.keys(viewingHistory).length > 0) {
          items = items.map(childItem => {
            const itemKey = childItem.localId || childItem.metadata?.plex || childItem.metadata?.key;
            const watchData = viewingHistory[itemKey] || viewingHistory[String(itemKey)];
            if (watchData) {
              const playhead = parseInt(watchData.playhead) || parseInt(watchData.seconds) || 0;
              const mediaDuration = parseInt(watchData.mediaDuration) || parseInt(watchData.duration) || 0;
              const percent = mediaDuration > 0 ? (playhead / mediaDuration) * 100 : (watchData.percent || 0);
              return {
                ...childItem,
                watchProgress: percent,
                watchSeconds: playhead,
                watchedDate: watchData.lastPlayed || null,
                lastPlayed: watchData.lastPlayed || null
              };
            }
            return childItem;
          });
        }
      }

      // Check if any item has folder_color - if so, maintain fixed order from YAML
      const hasFixedOrder = items.some(childItem => childItem.metadata?.folder_color || childItem.folder_color);

      // Apply shuffle if requested (skip if folder_color present)
      if (modifiers.shuffle && !hasFixedOrder) {
        items = shuffleArray([...items]);
      }

      // Apply recent_on_top sorting if requested (uses menu_memory)
      if (modifiers.recent_on_top && !hasFixedOrder) {
        const menuMemoryPath = configService?.getHouseholdPath('history/menu_memory') ?? 'households/default/history/menu_memory';
        const menuMemory = loadFile?.(menuMemoryPath) || {};

        items = [...items].sort((a, b) => {
          const aKey = getMenuMemoryKey(a);
          const bKey = getMenuMemoryKey(b);
          const aTime = aKey ? (menuMemory[aKey] || 0) : 0;
          const bTime = bKey ? (menuMemory[bKey] || 0) : 0;
          return bTime - aTime; // Most recent first
        });
      }

      // Build info object for FitnessShow compatibility (show-level metadata)
      let info = null;
      if (modifiers.playable && adapter.getContainerInfo) {
        info = await adapter.getContainerInfo(compoundId);
      }

      // Build seasons map from items' season metadata for FitnessShow
      let seasons = null;
      if (modifiers.playable && items.length > 0) {
        const seasonsMap = {};
        for (const childItem of items) {
          const seasonId = childItem.metadata?.seasonId || childItem.metadata?.parent;
          if (seasonId && !seasonsMap[seasonId]) {
            seasonsMap[seasonId] = {
              num: childItem.metadata?.seasonNumber ?? childItem.metadata?.parentIndex,
              title: childItem.metadata?.seasonName || childItem.metadata?.parentTitle || 'Season',
              // Fallback chain: season thumb -> parent thumb -> show thumb
              img: childItem.metadata?.seasonThumbUrl || childItem.metadata?.parentThumb || childItem.metadata?.showThumbUrl || childItem.metadata?.grandparentThumb
            };
          }
        }
        // Only include seasons if we found any
        if (Object.keys(seasonsMap).length > 0) {
          seasons = seasonsMap;
        }
      }

      // Build response
      const response = {
        id: item.id,
        // Add plex field for plex source (matches legacy format)
        ...(source === 'plex' && { plex: localId }),
        source,
        path: localId,
        title: item.title || localId,
        label: item.title || localId,
        itemType: item.itemType,
        thumbnail: item.thumbnail,
        image: item.thumbnail,
        // Include info and seasons for FitnessShow compatibility
        ...(info && { info }),
        ...(seasons && { seasons }),
        items: items.map(toListItem)
      };

      res.json(response);
    } catch (err) {
      logger.error?.('item.get.error', { error: err.message }) || console.error('[item] get error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

export default { createItemRouter };
