// backend/src/4_api/routers/list.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { loadYaml, saveYaml } from '#system/utils/FileIO.mjs';
import { parseModifiers } from '../utils/modifierParser.mjs';
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';

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
  // Compute default play/queue/list actions, but allow item.actions to override
  // Emit both contentId (unified) and legacy keys (plex/media/playlist/watchlist) for backward compat
  const isPlex = item.source === 'plex';
  const isContainer = item.itemType === 'container';
  // Use localId from Item entity (extracted from compound ID at construction)
  const localId = item.localId || item.id;
  // item.id is the compound ID (e.g., "plex:12345", "watchlist:FHE")
  const contentId = item.id;
  const computedPlay = item.mediaUrl
    ? { contentId, ...(isPlex ? { plex: localId } : { media: item.id }) }
    : undefined;
  const computedQueue = isContainer
    ? { contentId, ...(isPlex ? { plex: localId } : { playlist: item.id }) }
    : undefined;
  // List action for containers - allows navigation into the container
  const computedList = isContainer
    ? { contentId, ...(isPlex ? { plex: localId } : { watchlist: item.id }) }
    : undefined;

  const base = {
    id: item.id,
    title: item.title,
    // Include 'label' for legacy FitnessShow compatibility
    // Top-level label takes priority over metadata.label
    label: item.label ?? item.metadata?.label ?? item.title,
    // Include Plex type at top level for PlexMenuRouter (show, season, episode, etc.)
    type: item.metadata?.type,
    itemType: item.itemType || (item.children ? 'container' : 'leaf'),
    childCount: item.childCount || item.children?.length,
    thumbnail: item.thumbnail,
    image: item.thumbnail,
    metadata: item.metadata,
    // Legacy fields - item.actions takes priority over computed defaults
    play: item.actions?.play ?? computedPlay,
    queue: item.actions?.queue ?? computedQueue,
    list: item.actions?.list ?? computedList
  };

  // Action properties from Item (check item.actions for open)
  if (item.actions?.open) base.open = item.actions.open;

  // Note: plex and assetId are NOT copied to top-level.
  // These identifiers belong in action objects (play.plex, queue.plex, list.plex).
  // Frontend should access them via item.play?.plex || item.queue?.plex || item.list?.plex

  // Watch state from PlayableItem (top-level)
  if (item.watchProgress !== undefined) base.watchProgress = item.watchProgress;
  if (item.watchSeconds !== undefined) base.watchSeconds = item.watchSeconds;
  if (item.lastPlayed !== undefined) base.lastPlayed = item.lastPlayed;
  if (item.watchedDate !== undefined) base.watchedDate = item.watchedDate;
  if (item.playCount !== undefined) base.playCount = item.playCount;
  if (item.isWatched !== undefined) base.isWatched = item.isWatched;

  // Also check metadata for watch state (watchlist pattern)
  if (!base.lastPlayed && item.metadata?.lastPlayed) base.lastPlayed = item.metadata.lastPlayed;
  if (base.watchProgress === undefined && item.metadata?.percent !== undefined) base.watchProgress = item.metadata.percent;
  if (base.watchSeconds === undefined && item.metadata?.seconds !== undefined) base.watchSeconds = item.metadata.seconds;

  // Behavior flags (top-level takes priority)
  if (item.shuffle !== undefined) base.shuffle = item.shuffle;
  if (item.continuous !== undefined) base.continuous = item.continuous;
  if (item.resume !== undefined) base.resume = item.resume;
  if (item.active !== undefined) base.active = item.active;

  // Flatten episode-specific metadata to top level for FitnessShow compatibility
  // Note: plex and assetId are intentionally NOT extracted here.
  // They belong in action objects (play.plex, queue.plex, list.plex), not top-level.
  if (item.metadata) {
    const {
      key, summary, tagline, studio, thumbId, type,
      artist, albumArtist, album, albumId, artistId,
      // Canonical relative hierarchy fields (thumbs excluded - access via parents map)
      parentId, parentTitle, parentIndex, parentType,
      grandparentId, grandparentTitle, grandparentType,
      itemIndex,
      // Rating fields for FitnessMenu sorting
      rating, userRating, year,
      // Watchlist watch state fields
      percent, seconds, priority,
      // Watchlist scheduling fields
      hold, skipAfter, waitUntil,
      // Watchlist grouping and legacy fields
      program, src, shuffle, continuous, playable, uid,
      // Watchlist display fields
      folder
    } = item.metadata;

    // Note: plex is NOT copied to top-level from metadata.
    // It belongs in action objects (play.plex, queue.plex, list.plex).
    if (key !== undefined) base.key = key;
    // Canonical relative hierarchy fields
    if (parentId !== undefined) base.parentId = parentId;
    if (parentTitle !== undefined) base.parentTitle = parentTitle;
    if (parentIndex !== undefined) base.parentIndex = parentIndex;
    if (parentType !== undefined) base.parentType = parentType;
    if (grandparentId !== undefined) base.grandparentId = grandparentId;
    if (grandparentTitle !== undefined) base.grandparentTitle = grandparentTitle;
    if (grandparentType !== undefined) base.grandparentType = grandparentType;
    // Note: parentThumb and grandparentThumb are NOT copied to top-level.
    // Thumbnails should be accessed via parents[parentId].thumbnail per content-stack-reference.md
    if (itemIndex !== undefined) base.itemIndex = itemIndex;
    if (summary !== undefined) {
      base.summary = summary;
      base.episodeDescription = summary;  // Alias for prod parity
    }
    if (tagline !== undefined) base.tagline = tagline;
    if (studio !== undefined) base.studio = studio;
    if (thumbId !== undefined) base.thumbId = thumbId;
    if (type !== undefined) base.type = type;
    // Music fields
    if (artist !== undefined) base.artist = artist;
    if (albumArtist !== undefined) base.albumArtist = albumArtist;
    if (album !== undefined) base.album = album;
    if (albumId !== undefined) base.albumId = albumId;
    if (artistId !== undefined) base.artistId = artistId;
    // Rating fields for FitnessMenu sorting
    if (rating !== undefined) base.rating = rating;
    if (userRating !== undefined) base.userRating = userRating;
    if (year !== undefined) base.year = year;

    // Watchlist watch state fields
    if (percent !== undefined) base.percent = percent;
    if (seconds !== undefined) base.seconds = seconds;
    if (priority !== undefined) base.priority = priority;
    // Watchlist scheduling fields
    if (hold !== undefined) base.hold = hold;
    if (skipAfter !== undefined) base.skipAfter = skipAfter;
    if (waitUntil !== undefined) base.waitUntil = waitUntil;
    // Watchlist grouping and legacy fields
    if (program !== undefined) base.program = program;
    if (src !== undefined) base.src = src;
    // Note: assetId is NOT copied to top-level from metadata.
    // The canonical identifier is in action objects or item.id.
    if (shuffle !== undefined && base.shuffle === undefined) base.shuffle = shuffle;
    if (continuous !== undefined && base.continuous === undefined) base.continuous = continuous;
    if (playable !== undefined) base.playable = playable;
    if (uid !== undefined) base.uid = uid;
    // Watchlist display fields
    if (folder !== undefined) base.folder = folder;

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
 * @param {Object} [config.contentQueryService] - ContentQueryService for watch state enrichment
 * @returns {express.Router}
 */
export function createListRouter(config) {
  const { registry, loadFile, configService, contentQueryService, menuMemoryPath } = config;
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
   * POST /api/v1/list/menu-log
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
    res.json({ [assetId]: nowUnix });
  }));

  /**
   * GET /api/list/:source/(path)
   */
  router.get('/:source/*', asyncHandler(async (req, res) => {
      const rawSource = req.params.source;
      const rawPath = req.params[0] || '';

      // Use parseActionRouteId to handle compound IDs (plex:12345) in source param
      const { source, localId, modifiers } = parseActionRouteId({
        source: rawSource,
        path: rawPath
      });

      // Try exact source match first, then fall back to prefix resolution
      let adapter = registry.get(source);
      let resolvedLocalId = localId;
      let resolvedViaPrefix = false;

      if (!adapter) {
        // Try prefix resolution (e.g., "media" prefix -> FilesystemAdapter)
        const resolved = registry.resolve(`${source}:${localId}`);
        if (resolved) {
          adapter = resolved.adapter;
          resolvedLocalId = resolved.localId;
          resolvedViaPrefix = true;
        }
      }

      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      let items;

      // When resolved via prefix, localId already includes transform (e.g., 'talk:ldsgc202510')
      // Don't add source prefix again. For watchlist: source, registry.get('watchlist') returns
      // ListAdapter which accepts watchlist:X compound IDs.
      const compoundId = resolvedViaPrefix ? resolvedLocalId : `${source}:${resolvedLocalId}`;

      if (modifiers.playable) {
        // Resolve to playable items only
        if (!adapter.resolvePlayables) {
          return res.status(400).json({ error: 'Source does not support playable resolution' });
        }
        items = await adapter.resolvePlayables(compoundId);
      } else {
        // Get container contents
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

      // Check if any item has fixed_order flag - maintain YAML order
      const hasFixedOrder = items.some(item => item.metadata?.fixedOrder);

      // Apply shuffle if requested (skip if fixed order)
      if (modifiers.shuffle && !hasFixedOrder) {
        items = shuffleArray([...items]);
      }

      // Apply recent_on_top sorting if requested (uses menu_memory, not play history)
      // Skip if fixed order - maintain YAML order
      if (modifiers.recent_on_top && !hasFixedOrder) {
        // Load menu_memory for sorting by menu selection time
        // Note: loadFile is scoped to data dir; household path built by caller
        const menuMemory = loadFile?.('history/menu_memory') || {};

        items = [...items].sort((a, b) => {
          const aKey = getMenuMemoryKey(a);
          const bKey = getMenuMemoryKey(b);

          const aTime = aKey ? (menuMemory[aKey] || 0) : 0;
          const bTime = bKey ? (menuMemory[bKey] || 0) : 0;

          return bTime - aTime; // Most recent first
        });
      }

      // Build response
      const containerInfo = adapter.getItem ? await adapter.getItem(compoundId) : null;

      // Build info object for FitnessShow compatibility
      let info = null;
      if (adapter.getContainerInfo) {
        info = await adapter.getContainerInfo(compoundId);
      }

      // Build parents map from items' hierarchy metadata (canonical relative fields)
      let parents = null;
      if (modifiers.playable && items.length > 0) {
        const parentsMap = {};
        for (const item of items) {
          const pId = item.metadata?.parentId;
          if (pId && !parentsMap[pId]) {
            parentsMap[pId] = {
              index: item.metadata?.parentIndex,
              title: item.metadata?.parentTitle || 'Parent',
              // Use parent (season) thumbnail from metadata, or construct proxy URL for parent
              thumbnail: item.metadata?.parentThumb || `/api/v1/display/${source}/${pId}`,
              type: item.metadata?.parentType
            };
          }
        }
        // Only include parents if we found any
        if (Object.keys(parentsMap).length > 0) {
          parents = parentsMap;
        }
      }

      // Note: v1 includes additional fields (id, itemType, metadata, etc.) beyond prod format.
      // This is intentional - extra fields don't break frontend, and provide richer data.
      // Critical parity requirements: plex, type, image, rating, title, label must match prod.
      const response = {
        // Add plex field for plex source (matches prod format)
        ...(source === 'plex' && { plex: localId }),
        // Legacy compat field - frontend uses this for menu logging
        assetId: localId,
        source,
        path: localId,
        title: containerInfo?.title || localId,
        label: containerInfo?.title || localId,
        image: containerInfo?.thumbnail,
        info,
        parents,
        items: items.map(toListItem)
      };

      res.json(response);
  }));

  return router;
}

export default createListRouter;
