// backend/src/4_api/routers/item.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { toListItem } from './list.mjs';
import { loadYaml, saveYaml } from '#system/utils/FileIO.mjs';
import { parseModifiers } from '../utils/modifierParser.mjs';

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
 * - POST /api/v1/item/menu-log - Log menu navigation for recent_on_top sorting
 *
 * Query params:
 * - ?select=watchlist - Use ItemSelectionService to pick item based on watch history
 *
 * @param {Object} options
 * @param {import('#domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} options.registry
 * @param {import('#apps/content/ContentQueryService.mjs').ContentQueryService} [options.contentQueryService]
 * @param {string} options.menuMemoryPath - Absolute path to menu memory file
 * @param {Object} [options.logger] - Logger instance
 * @returns {express.Router}
 */
export function createItemRouter(options = {}) {
  const { registry, contentQueryService, menuMemoryPath, logger = console } = options;
  const router = express.Router();

  /**
   * GET /api/v1/item/:source/*
   * Get single item info or container contents with modifiers
   */
  router.get('/:source/*', asyncHandler(async (req, res) => {
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

      // Handle ?select=<strategy> for item selection from containers
      // Uses ContentQueryService.resolve() with ItemSelectionService
      const selectStrategy = req.query.select;
      if (selectStrategy && contentQueryService) {
        try {
          const context = { now: new Date() };
          const overrides = { strategy: selectStrategy, allowFallback: true };
          const { items: selected, strategy } = await contentQueryService.resolve(
            source,
            localId,
            context,
            overrides
          );

          if (selected.length === 0) {
            return res.status(404).json({
              error: 'No items available after selection',
              source,
              localId,
              strategy: strategy.name
            });
          }

          // Load full item content for the selected item
          // Selection returns lightweight items; need full content for playback
          const selectedItem = selected[0];
          let fullItem = selectedItem;

          // If the item is lightweight (no content), load the full item
          if (!selectedItem.content && selectedItem.id) {
            const fullItemData = await adapter.getItem(selectedItem.id);
            if (fullItemData) {
              // Merge full item with watch state from enriched selection
              fullItem = {
                ...fullItemData,
                percent: selectedItem.percent,
                watched: selectedItem.watched,
                playhead: selectedItem.playhead,
                duration: selectedItem.duration ?? fullItemData.duration
              };
            }
          }

          // Return selected item with selection metadata
          res.json({
            ...fullItem,
            _selection: {
              strategy: strategy.name,
              totalCandidates: selected.length
            }
          });
          return;
        } catch (error) {
          logger.warn?.('item.select.error', { source, localId, strategy: selectStrategy, error: error.message });
          // Fall through to normal item handling
        }
      }

      // Get the item first
      const item = await adapter.getItem(compoundId);
      if (!item) {
        return res.status(404).json({ error: 'Item not found', source, localId });
      }

      // If no modifiers and not a container, return single item
      if (!hasModifiers && item.itemType !== 'container') {
        // For content with playback data (singing, narrated), return full item
        // These have 'content' field needed by frontend scrollers
        if (item.content || item.category === 'singing' || item.category === 'narrated') {
          res.json(item);
          return;
        }
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

      // Enrich with watch state via ContentQueryService (DDD-compliant)
      if (contentQueryService) {
        const enriched = await contentQueryService.enrichWithWatchState(items, source, compoundId);
        // Map domain fields to API contract field names
        items = enriched.map(item => ({
          ...item,
          watchProgress: item.percent ?? null,
          watchSeconds: item.playhead ?? null,
          watchedDate: item.lastPlayed ?? null
        }));
      }

      // Check if any item has folderColor - if so, maintain fixed order from YAML
      const hasFixedOrder = items.some(childItem => childItem.metadata?.folderColor || childItem.folderColor);

      // Apply shuffle if requested (skip if folderColor present)
      if (modifiers.shuffle && !hasFixedOrder) {
        items = shuffleArray([...items]);
      }

      // Apply recent_on_top sorting if requested (uses menu_memory)
      if (modifiers.recent_on_top && !hasFixedOrder) {
        const menuMemory = loadYaml(menuMemoryPath) || {};

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

      // Build parents map from items' hierarchy metadata (canonical relative fields)
      let parents = null;
      if (modifiers.playable && items.length > 0) {
        const parentsMap = {};
        for (const childItem of items) {
          const pId = childItem.metadata?.parentId;
          if (pId && !parentsMap[pId]) {
            parentsMap[pId] = {
              index: childItem.metadata?.parentIndex,
              title: childItem.metadata?.parentTitle || 'Parent',
              // Use parent (season) thumbnail from metadata, or construct proxy URL for parent
              thumbnail: childItem.metadata?.parentThumb || `/api/v1/content/plex/image/${pId}`,
              type: childItem.metadata?.parentType
            };
          }
        }
        // Only include parents if we found any
        if (Object.keys(parentsMap).length > 0) {
          parents = parentsMap;
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
        // Include Plex type at top level for PlexMenuRouter (show, season, episode, etc.)
        type: item.metadata?.type,
        itemType: item.itemType,
        thumbnail: item.thumbnail,
        image: item.thumbnail,
        // Include info and parents for FitnessShow compatibility
        ...(info && { info }),
        ...(parents && { parents }),
        items: items.map(toListItem)
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

    const menuLog = loadYaml(menuMemoryPath) || {};
    const nowUnix = Math.floor(Date.now() / 1000);

    menuLog[assetId] = nowUnix;
    saveYaml(menuMemoryPath, menuLog);

    logger.info?.('item.menu-log.updated', { assetId });
    res.json({ [assetId]: nowUnix });
  }));

  return router;
}

export default createItemRouter;
