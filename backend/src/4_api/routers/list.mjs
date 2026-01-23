// backend/src/4_api/routers/list.mjs
import express from 'express';

/**
 * Compact an object by removing falsy values and converting numeric strings
 * @param {Object} obj - Object to compact
 * @returns {Object} Compacted object
 */
function compactItem(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip metadata object entirely - fields already flattened to top level
    if (key === 'metadata') continue;

    // Skip falsy values (null, undefined, 0, false, "")
    if (!value && value !== 0) continue;
    // Also skip 0 explicitly (falsy but sometimes meaningful - we decided to filter it)
    if (value === 0) continue;

    // Recurse into objects (including action objects like play, queue, list)
    if (typeof value === 'object' && value !== null) {
      const compacted = compactItem(value);
      // Only include non-empty objects
      if (Object.keys(compacted).length > 0) {
        result[key] = compacted;
      }
      continue;
    }

    // Convert numeric strings to numbers
    if (typeof value === 'string') {
      // Integer pattern
      if (/^-?\d+$/.test(value)) {
        result[key] = parseInt(value, 10);
        continue;
      }
      // Float pattern
      if (/^-?\d+\.\d+$/.test(value)) {
        result[key] = parseFloat(value);
        continue;
      }
    }

    result[key] = value;
  }
  return result;
}

/**
 * Transform item to list response format
 * Flattens metadata properties to top level for FitnessShow compatibility
 * @param {Object} item - Item entity or similar object
 * @returns {Object} Flattened list item
 */
export function toListItem(item) {
  // Compute default play/queue actions, but allow item.actions to override
  // For plex items, use plex key with numeric ID; otherwise use media key with full compound ID
  const isPlex = item.source === 'plex';
  // Use localId from Item entity (extracted from compound ID at construction)
  const localId = item.localId || item.id;
  const computedPlay = item.mediaUrl ? (isPlex ? { plex: localId } : { media: item.id }) : undefined;
  const computedQueue = item.itemType === 'container' ? (isPlex ? { plex: localId } : { playlist: item.id }) : undefined;

  const base = {
    id: item.id,
    title: item.title,
    // Include 'label' for legacy FitnessShow compatibility
    // Top-level label takes priority over metadata.label
    label: item.label ?? item.metadata?.label ?? item.title,
    itemType: item.itemType || (item.children ? 'container' : 'leaf'),
    childCount: item.childCount || item.children?.length,
    thumbnail: item.thumbnail,
    image: item.thumbnail,
    metadata: item.metadata,
    // Legacy fields - item.actions takes priority over computed defaults
    play: item.actions?.play ?? computedPlay,
    queue: item.actions?.queue ?? computedQueue
  };

  // Action properties from Item (check item.actions for list and open)
  if (item.actions?.list) base.list = item.actions.list;
  if (item.actions?.open) base.open = item.actions.open;

  // Note: plex and media_key are NOT copied to top-level.
  // These identifiers belong in action objects (play.plex, queue.plex, list.plex).
  // Frontend should access them via item.play?.plex || item.queue?.plex || item.list?.plex

  // Watch state from PlayableItem (top-level)
  if (item.watchProgress !== undefined) base.watchProgress = item.watchProgress;
  if (item.watchSeconds !== undefined) base.watchSeconds = item.watchSeconds;
  if (item.lastPlayed !== undefined) base.lastPlayed = item.lastPlayed;
  if (item.watchedDate !== undefined) base.watchedDate = item.watchedDate;
  if (item.playCount !== undefined) base.playCount = item.playCount;

  // Also check metadata for watch state (FolderAdapter pattern)
  if (!base.lastPlayed && item.metadata?.lastPlayed) base.lastPlayed = item.metadata.lastPlayed;
  if (base.watchProgress === undefined && item.metadata?.percent !== undefined) base.watchProgress = item.metadata.percent;
  if (base.watchSeconds === undefined && item.metadata?.seconds !== undefined) base.watchSeconds = item.metadata.seconds;

  // Behavior flags (top-level takes priority)
  if (item.shuffle !== undefined) base.shuffle = item.shuffle;
  if (item.continuous !== undefined) base.continuous = item.continuous;
  if (item.resume !== undefined) base.resume = item.resume;
  if (item.active !== undefined) base.active = item.active;

  // Flatten episode-specific metadata to top level for FitnessShow compatibility
  // Note: plex and media_key are intentionally NOT extracted here.
  // They belong in action objects (play.plex, queue.plex, list.plex), not top-level.
  if (item.metadata) {
    const {
      key, seasonId, seasonName, seasonNumber, seasonThumbUrl,
      episodeNumber, index, summary, tagline, studio, thumb_id, type,
      artist, albumArtist, album, albumId, artistId, grandparentTitle,
      // TV show fields
      show, season,
      // Parent (season) fields
      parent, parentTitle, parentIndex, parentThumb,
      // Grandparent (show) fields
      showId, grandparent, showThumbUrl, grandparentThumb,
      // Rating fields for FitnessMenu sorting
      rating, userRating, year,
      // FolderAdapter watch state fields
      percent, seconds, priority,
      // FolderAdapter scheduling fields
      hold, skip_after, wait_until,
      // FolderAdapter grouping and legacy fields
      program, src, shuffle, continuous, playable, uid,
      // FolderAdapter display fields
      folder, folder_color
    } = item.metadata;

    // Note: plex is NOT copied to top-level from metadata.
    // It belongs in action objects (play.plex, queue.plex, list.plex).
    if (key !== undefined) base.key = key;
    if (seasonId !== undefined) base.seasonId = seasonId;
    if (seasonName !== undefined) base.seasonName = seasonName;
    if (seasonNumber !== undefined) base.seasonNumber = seasonNumber;
    if (seasonThumbUrl !== undefined) base.seasonThumbUrl = seasonThumbUrl;
    if (episodeNumber !== undefined) base.episodeNumber = episodeNumber;
    if (index !== undefined) base.index = index;
    if (summary !== undefined) {
      base.summary = summary;
      base.episodeDescription = summary;  // Alias for prod parity
    }
    if (tagline !== undefined) base.tagline = tagline;
    if (studio !== undefined) base.studio = studio;
    if (thumb_id !== undefined) base.thumb_id = thumb_id;
    if (type !== undefined) base.type = type;
    // Music fields
    if (artist !== undefined) base.artist = artist;
    if (albumArtist !== undefined) base.albumArtist = albumArtist;
    if (album !== undefined) base.album = album;
    if (albumId !== undefined) base.albumId = albumId;
    if (artistId !== undefined) base.artistId = artistId;
    if (grandparentTitle !== undefined) base.grandparentTitle = grandparentTitle;
    // TV show fields
    if (show !== undefined) base.show = show;
    if (season !== undefined) base.season = season;
    // Parent (season) fields
    if (parent !== undefined) base.parent = parent;
    if (parentTitle !== undefined) base.parentTitle = parentTitle;
    if (parentIndex !== undefined) base.parentIndex = parentIndex;
    if (parentThumb !== undefined) base.parentThumb = parentThumb;
    // Grandparent (show) fields
    if (showId !== undefined) base.showId = showId;
    if (grandparent !== undefined) base.grandparent = grandparent;
    if (showThumbUrl !== undefined) base.showThumbUrl = showThumbUrl;
    if (grandparentThumb !== undefined) base.grandparentThumb = grandparentThumb;
    // Rating fields for FitnessMenu sorting
    if (rating !== undefined) base.rating = rating;
    if (userRating !== undefined) base.userRating = userRating;
    if (year !== undefined) base.year = year;

    // FolderAdapter watch state fields
    if (percent !== undefined) base.percent = percent;
    if (seconds !== undefined) base.seconds = seconds;
    if (priority !== undefined) base.priority = priority;
    // FolderAdapter scheduling fields
    if (hold !== undefined) base.hold = hold;
    if (skip_after !== undefined) base.skip_after = skip_after;
    if (wait_until !== undefined) base.wait_until = wait_until;
    // FolderAdapter grouping and legacy fields
    if (program !== undefined) base.program = program;
    if (src !== undefined) base.src = src;
    // Note: media_key is NOT copied to top-level from metadata.
    // The canonical identifier is in action objects or item.id.
    if (shuffle !== undefined && base.shuffle === undefined) base.shuffle = shuffle;
    if (continuous !== undefined && base.continuous === undefined) base.continuous = continuous;
    if (playable !== undefined) base.playable = playable;
    if (uid !== undefined) base.uid = uid;
    // FolderAdapter display fields
    if (folder !== undefined) base.folder = folder;
    if (folder_color !== undefined) base.folder_color = folder_color;

    // Duration from PlayableItem
    if (item.duration !== undefined) base.duration = item.duration;
  }

  // Progress/resume fields from PlayableItem
  if (item.resumePosition !== undefined && item.resumePosition !== null) {
    base.resumePosition = item.resumePosition;
    base.resumeSeconds = item.resumePosition;
    base.watchSeconds = item.resumePosition;
    // Calculate watchProgress percentage
    if (item.duration && item.duration > 0) {
      base.watchProgress = Math.round((item.resumePosition / item.duration) * 100);
    }
  }

  return compactItem(base);
}

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
 * @param {Function} [config.loadFile] - Function to load state files
 * @param {Object} [config.configService] - ConfigService for household paths
 * @returns {express.Router}
 */
export function createListRouter(config) {
  const { registry, loadFile, configService } = config;
  const router = express.Router();

  /**
   * Extract media key from item's action objects for menu_memory lookup
   * Items may be raw Item entities (with item.actions) or transformed (with top-level play/queue/etc)
   * @param {Object} item - Item entity or list item
   * @returns {string|null} Media key for lookup
   */
  function getMenuMemoryKey(item) {
    // Check both Item entity format (item.actions.X) and transformed format (item.X)
    const action = item.actions?.play || item.actions?.queue || item.actions?.list || item.actions?.open ||
                   item.play || item.queue || item.list || item.open;
    if (!action) return null;
    // Action is an object like { plex: "123" } or { list: "FHE" }
    // Get the first value from the action object
    const values = Object.values(action);
    return values.length > 0 ? values[0] : null;
  }

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

      // 'local' is an alias for 'folder' - both use FolderAdapter which expects folder: prefix
      const isFolderSource = source === 'folder' || source === 'local';

      if (modifiers.playable) {
        // Resolve to playable items only
        if (!adapter.resolvePlayables) {
          return res.status(400).json({ error: 'Source does not support playable resolution' });
        }
        const compoundId = isFolderSource ? `folder:${localId}` : `${source}:${localId}`;
        items = await adapter.resolvePlayables(compoundId);
      } else {
        // Get container contents
        const compoundId = isFolderSource ? `folder:${localId}` : `${source}:${localId}`;
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

      // Merge viewing history for sources that support it (e.g., Plex)
      let viewingHistory = null;
      if (typeof adapter._loadViewingHistory === 'function') {
        viewingHistory = adapter._loadViewingHistory();
        if (viewingHistory && Object.keys(viewingHistory).length > 0) {
          items = items.map(item => {
            // Use localId from Item entity (extracted from compound ID at construction)
            const itemKey = item.localId || item.metadata?.plex || item.metadata?.key;
            const watchData = viewingHistory[itemKey] || viewingHistory[String(itemKey)];
            if (watchData) {
              // Calculate progress from playhead and duration (canonical field names)
              const playhead = parseInt(watchData.playhead) || parseInt(watchData.seconds) || 0;
              const mediaDuration = parseInt(watchData.mediaDuration) || parseInt(watchData.duration) || 0;
              const percent = mediaDuration > 0 ? (playhead / mediaDuration) * 100 : (watchData.percent || 0);

              // Merge watch data into item (matching legacy field names)
              return {
                ...item,
                watchProgress: percent,
                watchSeconds: playhead,
                watchedDate: watchData.lastPlayed || null,
                // Also include lastPlayed for v1 consumers
                lastPlayed: watchData.lastPlayed || null
              };
            }
            return item;
          });
        }
      }

      // Apply shuffle if requested
      if (modifiers.shuffle) {
        items = shuffleArray([...items]);
      }

      // Apply recent_on_top sorting if requested (uses menu_memory, not play history)
      if (modifiers.recent_on_top) {
        // Load menu_memory for sorting by menu selection time
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

      // Build response
      const compoundId = isFolderSource ? `folder:${localId}` : `${source}:${localId}`;
      const containerInfo = adapter.getItem ? await adapter.getItem(compoundId) : null;

      // Build info object for FitnessShow compatibility
      let info = null;
      if (adapter.getContainerInfo) {
        info = await adapter.getContainerInfo(compoundId);
      }

      // Build seasons map from items' season metadata
      let seasons = null;
      if (modifiers.playable && items.length > 0) {
        const seasonsMap = {};
        for (const item of items) {
          const seasonId = item.metadata?.seasonId || item.metadata?.parent;
          if (seasonId && !seasonsMap[seasonId]) {
            seasonsMap[seasonId] = {
              num: item.metadata?.seasonNumber ?? item.metadata?.parentIndex,
              title: item.metadata?.seasonName || item.metadata?.parentTitle || `Season`,
              // Fallback chain: season thumb -> parent thumb -> show thumb
              img: item.metadata?.seasonThumbUrl || item.metadata?.parentThumb || item.metadata?.showThumbUrl || item.metadata?.grandparentThumb
            };
          }
        }
        // Only include seasons if we found any
        if (Object.keys(seasonsMap).length > 0) {
          seasons = seasonsMap;
        }
      }

      // Note: v1 includes additional fields (id, itemType, metadata, etc.) beyond prod format.
      // This is intentional - extra fields don't break frontend, and provide richer data.
      // Critical parity requirements: plex, type, image, rating, title, label must match prod.
      const response = {
        // Add plex field for plex source (matches prod format)
        ...(source === 'plex' && { plex: localId }),
        // Legacy compat field - frontend uses this for menu logging
        media_key: localId,
        source,
        path: localId,
        title: containerInfo?.title || localId,
        label: containerInfo?.title || localId,
        image: containerInfo?.thumbnail,
        info,
        seasons,
        items: items.map(toListItem)
      };

      // Add debug info for plex source (matches legacy format for troubleshooting)
      if (source === 'plex' && viewingHistory) {
        const historyKeys = Object.keys(viewingHistory);
        response._debug = {
          historyCount: historyKeys.length,
          sampleKeys: historyKeys.slice(0, 5),
          firstItemPlex: items[0]?.localId || items[0]?.metadata?.plex
        };
      }

      res.json(response);
    } catch (err) {
      console.error('[list] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
