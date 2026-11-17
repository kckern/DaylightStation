// __backend/src/4_api/routers/list.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { parseActionRouteId } from "#api/v1/utils/actionRouteParser.mjs";
import { splatPath } from '#api/utils/wildcard.mjs';

/**
 * Compact an object by removing falsy values and converting numeric strings
 * @param {Object} obj - Object to compact
 * @returns {Object} Compacted object
 */
function compactItem(obj, playbackAction = false) {
  if (typeof obj !== 'object' || obj === null) return obj;

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip metadata object entirely - fields already flattened to top level
    if (key === 'metadata') continue;

    // Fields where 0 is a meaningful value (episode 0, 0% progress, 0 seconds, etc.)
    const zeroIsValid = ['itemIndex', 'parentIndex', 'watchProgress', 'watchSeconds', 'resumePosition', 'resumeSeconds', 'playCount', 'index'].includes(key);

    // Explicit playback options must survive compaction, including start-at-zero.
    const explicitPlaybackIntent = playbackAction &&
      ((key === 'resume' && value === false) || (key === 'seconds' && value === 0));
    // Skip falsy defaults while preserving authored playback intent.
    if (!value && value !== 0 && !explicitPlaybackIntent) continue;
    // Skip 0 for fields where it's not meaningful (but allow for fields like itemIndex)
    if (value === 0 && !zeroIsValid && !explicitPlaybackIntent) continue;

    // Preserve arrays as-is (do not recurse into them)
    if (Array.isArray(value)) {
      result[key] = value;
      continue;
    }

    // Recurse into objects (including action objects like play, queue, list)
    if (typeof value === 'object' && value !== null) {
      const compacted = compactItem(value, key === 'play' || key === 'queue');
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
export function toListItem(item, { capabilities } = {}) {
  // Compute default play/queue/list actions using contentId only.
  // Legacy source-specific keys (plex, media, etc.) are derived generically.
  const isContainer = item.itemType === 'container';
  const localId = item.localId || item.id;
  const contentId = item.id;
  // Derive source key from compound ID for backward compat (e.g., "plex" from "plex:12345")
  const colonIdx = contentId.indexOf(':');
  const sourceKey = colonIdx > 0 ? contentId.slice(0, colonIdx) : null;
  const legacySourceField = sourceKey ? { [sourceKey]: localId } : {};
  const computedPlay = item.mediaUrl
    ? { contentId, ...legacySourceField }
    : undefined;
  const computedQueue = isContainer && (!capabilities || capabilities.includes('queueable'))
    ? { contentId, ...legacySourceField }
    : undefined;
  const computedList = isContainer
    ? { contentId, ...legacySourceField }
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

  // Android items are client-side only (FKB app launch) — pass through directly
  if (item.android) base.android = item.android;

  // Action properties from Item (check item.actions for open, display, launch)
  if (item.actions?.open) base.open = item.actions.open;
  if (item.actions?.display) base.display = item.actions.display;

  // Launch action from Item (check item.actions for launch)
  if (item.actions?.launch) base.launch = item.actions.launch;

  // Compute launch action for LaunchableItem entities (have launchIntent but no explicit actions)
  if (!base.launch && item.launchIntent) {
    base.launch = { contentId: item.id };
  }

  // Include intent data on launch items so FKB clients can launch directly without ADB
  if (base.launch && item.launchIntent) {
    base.launch.intent = item.launchIntent;
  }

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
      folder,
      // RetroArch thumbnail aspect ratio (height/width) and play stats
      thumbRatio,
      lastPlayed,
      // Playlist-as-show marker
      sourceType
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
    // RetroArch thumbnail aspect ratio
    if (thumbRatio !== undefined) base.thumbRatio = thumbRatio;
    if (lastPlayed !== undefined) base.lastPlayed = lastPlayed;
    // Playlist-as-show marker for frontend sorting
    if (sourceType !== undefined) base.sourceType = sourceType;

    // Piano curriculum metadata passthrough (preserve styles array unchanged)
    if (item.metadata.piano !== undefined) {
      base.piano = item.metadata.piano;
    }

    // Duration from PlayableItem
    if (item.duration !== undefined) base.duration = item.duration;
  }

  // Progress/resume fields from PlayableItem
  if (item.resumePosition !== undefined && item.resumePosition !== null) {
    base.resumePosition = item.resumePosition;
    base.resumeSeconds = item.resumePosition;
    // Only set watchSeconds/watchProgress from resumePosition if not already classified
    if (base.watchSeconds === undefined) {
      base.watchSeconds = item.resumePosition;
    }
    if (base.watchProgress === undefined && item.duration && item.duration > 0) {
      base.watchProgress = Math.round((item.resumePosition / item.duration) * 100);
    }
  }

  const result = compactItem(base);
  if (item.disabled !== undefined) result.disabled = item.disabled;
  if (item.notice !== undefined) result.notice = item.notice;
  if (item.participantLaunches) {
    const refs = {};
    for (const action of ['open', 'play', 'queue', 'display']) {
      const ref = item.participantLaunches[action];
      if (ref?.schema === 'participant-launch-ref/v1' && typeof ref.provider === 'string' && typeof ref.ref === 'string') {
        refs[action] = {schema:ref.schema, provider:ref.provider, ref:ref.ref};
      }
    }
    if (Object.keys(refs).length) result.participantLaunches = refs;
  }
  if (item.disabled) for (const action of ['open', 'play', 'queue', 'display', 'launch', 'list', 'android']) delete result[action];
  return result;
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
 * @param {Object} [config.browseCatalog] - Household Browse catalog query
 * @param {Object} config.listBrowse - Semantic list browsing facade
 * @returns {express.Router}
 */
/**
 * Optional `?take=N&skip=M` window over a container's items. Only a valid
 * positive `take` pages; without one (every caller but the Media browse hook)
 * the whole list goes out as before. An invalid `skip` reads as 0.
 * @returns {{ items: object[], total: number }}
 */
export function parseListPage(query = {}) {
  const take = Number.parseInt(query.take, 10);
  if (!Number.isInteger(take) || take < 1 || String(take) !== String(query.take).trim()) return null;
  const rawSkip = query.skip === undefined ? 0 : Number.parseInt(query.skip, 10);
  const skip = Number.isInteger(rawSkip) && rawSkip >= 0 && String(rawSkip) === String(query.skip ?? 0).trim() ? rawSkip : 0;
  return { skip, take };
}

export function pageListItems(items, query = {}) {
  const page = parseListPage(query);
  if (!page) return { items, total: items.length };
  return { items: items.slice(page.skip, page.skip + page.take), total: items.length };
}

export function createListRouter(config) {
  const { browseCatalog, listBrowse, recordMenuSelection, resourceAliases, viewerForRequest = req => req.user ?? null, logger = console } = config;
  const router = express.Router();

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
    const result = recordMenuSelection(assetId);
    logger.info?.('list.menu_log', { assetId });
    res.json(result);
  }));

  /**
   * GET /api/list/
   * Top-level catalog. The Browse nav tab pushes an empty path; instead of a
   * 404 we return the household's configured browse categories (media app
   * config), falling back to the registered content sources.
   */
  router.get('/', asyncHandler(async (req, res) => {
    const browse = browseCatalog?.getEntries?.() || [];

    let items;
    if (browse.length > 0) {
      items = browse
        .filter(entry => entry?.source)
        .map(entry => {
          const localId = entry.mediaType || '';
          const contentId = `${entry.source}:${localId}`;
          return {
            id: contentId,
            title: entry.label || entry.source,
            label: entry.label || entry.source,
            itemType: 'container',
            ...(entry.icon ? { icon: entry.icon } : {}),
            list: { contentId, [entry.source]: localId }
          };
        });
    } else {
      // No browse config — surface the registered sources themselves
      const sources = listBrowse?.getSourceNames?.() || [];
      items = sources.map(source => ({
        id: `${source}:`,
        title: source,
        label: source,
        itemType: 'container',
        list: { contentId: `${source}:`, [source]: '' }
      }));
    }

    logger.info?.('list.root_catalog', { itemCount: items.length, fromBrowseConfig: browse.length > 0 });

    res.json({
      assetId: '',
      source: '',
      path: '',
      title: 'Browse',
      label: 'Browse',
      info: null,
      parents: null,
      items
    });
  }));

  // Ownership is a neutral, exact lookup used by hosts before choosing a renderer.
  router.get('/_ownership/:kind/:id', asyncHandler(async (req,res) => {
    res.set('Cache-Control','private, no-store');
    let alias;
    try { alias=resourceAliases?.resolve({kind:req.params.kind,id:req.params.id}) ?? null; }
    catch (error) { if (error.code === 'ownership_unavailable') return res.status(503).json({code:'ownership_unavailable'}); throw error; }
    if (!alias) return res.json({alias:null});
    const viewer=await viewerForRequest(req);
    if (!viewer?.participant_id || !viewer?.householdId) return res.status(401).json({code:'authentication_required'});
    return res.json({alias:{owner:alias.owner,canonicalContentId:alias.canonicalContentId}});
  }));

  /**
   * GET /api/list/:source/(path)
   */
  router.get('/:source{/*splat}', asyncHandler(async (req, res) => {
      const requestStart = performance.now();
      const rawSource = req.params.source;
      const rawPath = splatPath(req);

      // Use parseActionRouteId to handle compound IDs (plex:12345) in source param
      let { source, localId, modifiers } = parseActionRouteId({
        source: rawSource,
        path: rawPath
      });

      let alias;
      try { alias=resourceAliases?.resolve({kind:source,id:localId}); }
      catch (error) { if (error.code === 'ownership_unavailable') return res.status(503).json({code:'ownership_unavailable',message:'Resource ownership unavailable'}); throw error; }
      if (alias) {
        const separator=alias.canonicalContentId.indexOf(':');
        source=alias.canonicalContentId.slice(0,separator);
        localId=alias.canonicalContentId.slice(separator+1);
      }

      logger.info?.('list.request', { source, localId, modifiers, ip: req.ip });

      const participantLaunchVersion = req.get('X-Daylight-Participant-Launch-Version') === '1' ? 1 : null;
      const viewer = await viewerForRequest(req);
      let browseResult;
      try { browseResult=await listBrowse.browse({ source, localId, modifiers, page: parseListPage(req.query), viewer, participantLaunchVersion }); }
      catch (error) { if (error.code === 'authorization_denied') return res.status(viewer ? 403 : 401).json({code:viewer ? 'authorization_denied' : 'authentication_required'}); throw error; }
      if (browseResult.kind === 'category') {
        return res.json({
          [source]: '',
          assetId: '',
          source,
          path: '',
          title: source,
          label: source,
          info: null,
          parents: null,
          items: browseResult.items.map(item => toListItem(item))
        });
      }
      if (browseResult.kind === 'unknown_source') {
        logger.warn?.('list.unknown_source', { source, localId });
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }
      if (browseResult.kind === 'unsupported_launchable') {
        return res.status(400).json({ error: 'Source does not support launchable resolution' });
      }
      if (browseResult.kind === 'unsupported_playable') {
        return res.status(400).json({ error: 'Source does not support playable resolution' });
      }
      let { items } = browseResult;
      const { containerInfo, info } = browseResult;

      // === Playlist-as-show wrapping ===
      // When the container is a playlist, return a single "show" container item
      // instead of the playlist's individual tracks. This makes playlists appear
      // as show cards in FitnessMenu. resolvePlayables() (used by FitnessShow)
      // calls the adapter directly and is NOT affected by this HTTP-layer change.
      if (!modifiers.expand && info?.type === 'playlist') {
        const playlistItem = {
          id: `${source}:${localId}`,
          localId: String(localId),
          title: containerInfo?.title || info?.title || localId,
          label: containerInfo?.title || info?.title || localId,
          itemType: 'container',
          childCount: info?.childCount || items.length,
          thumbnail: info?.image || containerInfo?.thumbnail,
          metadata: {
            type: 'show',
            sourceType: 'playlist',
            rating: null
          },
          actions: {
            list: { contentId: `${source}:${localId}`, [source]: String(localId) }
          }
        };
        items = [playlistItem];
      }

      // === Season-as-show wrapping ===
      // When the container is a Plex season, return a single "show" container
      // item instead of the season's episodes. The season is then surfaced as
      // its own tile in FitnessMenu alongside collection shows and playlists.
      // resolvePlayables() (used by FitnessShow) calls the adapter directly
      // and is NOT affected by this HTTP-layer change.
      // The `expand` modifier opts OUT of this wrapping so browse/selector
      // drill receives the real episodes (a user can then pick one).
      if (!modifiers.expand && info?.type === 'season') {
        // info.rating is already the best-available rating per PlexAdapter
        // convention (lines 509 and 623): item.userRating ?? item.rating
        // ?? item.audienceRating. We pass it through as-is so season tiles
        // sort consistently with collection items in FitnessMenu.
        const seasonItem = {
          id: `${source}:${localId}`,
          localId: String(localId),
          title: containerInfo?.title || info?.title || localId,
          label: containerInfo?.title || info?.title || localId,
          itemType: 'container',
          childCount: info?.childCount || items.length,
          thumbnail: info?.image || containerInfo?.thumbnail,
          metadata: {
            type: 'show',
            sourceType: 'season',
            rating: info?.rating ?? null,
            userRating: info?.userRating ?? null
          },
          actions: {
            list: { contentId: `${source}:${localId}`, [source]: String(localId) }
          }
        };
        items = [seasonItem];
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

      // A source that paged already returned just the window, with its own
      // total. Otherwise page AFTER wrapping and parents (both read the whole
      // container) and BEFORE toListItem, so an unrequested title is never
      // mapped or sent. (Sources never page playlists/seasons — see
      // PlexAdapter.getListPage — so wrapping always sees whole containers.)
      const page = browseResult.paged
        ? { items, total: browseResult.total }
        : pageListItems(items, req.query);

      // Note: v1 includes additional fields (id, itemType, metadata, etc.) beyond prod format.
      // This is intentional - extra fields don't break frontend, and provide richer data.
      // Critical parity requirements: plex, type, image, rating, title, label must match prod.
      const response = {
        // Add source-specific field for backward compatibility (e.g., plex: localId)
        ...(source && { [source]: localId }),
        // Legacy compat field - frontend uses this for menu logging
        assetId: localId,
        source,
        path: localId,
        title: (browseResult.sourceResult?.resolveCapabilities && browseResult.sourceResult.title) || containerInfo?.title || localId,
        label: (browseResult.sourceResult?.resolveCapabilities && browseResult.sourceResult.title) || containerInfo?.title || localId,
        image: containerInfo?.thumbnail,
        info,
        parents,
        total: page.total,
        items: page.items.map(item => toListItem(item, {capabilities:browseResult.sourceResult?.resolveCapabilities ? listBrowse.capabilitiesFor(item) : undefined}))
      };

      const presentation = browseResult.sourceResult;
      if (presentation) {
        for (const field of ['id','revision','notice','preview','disableAutoCountdown','navigationPolicy','fixedOrder','adminUrl']) {
          if (presentation[field] !== undefined) response[field] = presentation[field];
        }
        if (presentation.privateResponse) {
          res.set('Cache-Control', 'private, no-store');
          res.vary('X-Daylight-Participant-Launch-Version');
          res.vary('Authorization');
          res.vary('Cookie');
        }
      }
      const totalMs = Math.round(performance.now() - requestStart);
      logger.info?.('list.response', {
        source, localId,
        title: response.title,
        itemCount: response.items?.length ?? 0,
        total: page.total,
        hasParents: !!response.parents,
        totalMs,
        items: (response.items || []).slice(0, 10).map(i => ({ id: i.id, title: i.title, type: i.type }))
      });

      res.json(response);
  }));

  return router;
}

export default createListRouter;
