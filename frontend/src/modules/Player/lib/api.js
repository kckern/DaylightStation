import { DaylightAPI } from '../../../lib/api.mjs';
import { guid } from './helpers.js';

/**
 * @deprecated Recursive flattening now happens server-side in /api/v1/queue.
 * Retained for backward compatibility — do not use in new code.
 */
export async function flattenQueueItems(items, level = 1) {
  const flattened = [];

  for (const item of items) {
    if (item.queue) {
      const shuffle = !!item.queue.shuffle || item.shuffle || false;
      const modifiers = ['playable', ...(shuffle ? ['shuffle'] : [])].join(',');

      if (item.queue.contentId) {
        // Unified path: contentId is a compound ID like "plex:12345" or "watchlist:path"
        const { items: nestedItems } = await DaylightAPI(`api/v1/list/${item.queue.contentId}/${modifiers}`);
        const nestedFlattened = await flattenQueueItems(nestedItems, level + 1);
        flattened.push(...nestedFlattened);
      } else if (item.queue.playlist || item.queue.queue) {
        // Legacy: watchlist-based playlists
        const queueKey = item.queue.playlist ?? item.queue.queue;
        const { items: nestedItems } = await DaylightAPI(`api/v1/list/watchlist/${queueKey}/${modifiers}`);
        const nestedFlattened = await flattenQueueItems(nestedItems, level + 1);
        flattened.push(...nestedFlattened);
      } else if (item.queue.plex) {
        // Legacy: plex-specific queue
        const { items: plexItems } = await DaylightAPI(`api/v1/list/plex/${item.queue.plex}/${modifiers}`);
        const nestedFlattened = await flattenQueueItems(plexItems, level + 1);
        flattened.push(...nestedFlattened);
      }
    } else if (item.play) {
      flattened.push(item);
    } else {
      flattened.push(item);
    }
  }

  return flattened.filter(item => item?.active !== false);
}

/**
 * Fetch media information from API
 * @param {Object} params - Parameters for fetching media
 * @param {string} params.contentId - Unified compound content ID (e.g., "plex:12345", "immich:abc")
 * @param {string} params.plex - Legacy: Plex media key
 * @param {string} params.media - Legacy: Media key (compound ID)
 * @param {boolean} params.shuffle - Whether to shuffle
 * @param {string|number} params.maxVideoBitrate - Preferred maximum video bitrate param
 * @param {string|number} params.maxResolution - Preferred maximum resolution param
 * @param {string} params.session - Optional session identifier
 * @returns {Promise<Object>} Media information
 */
export async function fetchMediaInfo({ contentId, plex, media, shuffle, maxVideoBitrate, maxResolution, session }) {
  // Helper to build a URL with query params safely
  const buildUrl = (base, params = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== false) searchParams.append(k, v);
    });
    const qs = searchParams.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const queryCommon = {};
  if (maxVideoBitrate !== undefined) {
    queryCommon.maxVideoBitrate = maxVideoBitrate;
  }
  if (maxResolution !== undefined) {
    queryCommon.maxResolution = maxResolution;
  }
  if (session !== undefined && session !== null) {
    queryCommon.session = session;
  }

  // Unified contentId path — compound ID like "plex:12345" or "watchlist:path"
  // Uses the play API which handles container resolution and includes resume state.
  if (contentId && !plex && !media) {
    if (shuffle) {
      const url = buildUrl(`api/v1/play/${contentId}/shuffle`, queryCommon);
      const playResponse = await DaylightAPI(url);
      if (playResponse) {
        return { ...playResponse, assetId: playResponse.assetId || playResponse.id };
      }
      return null;
    }
    const url = buildUrl(`api/v1/play/${contentId}`, queryCommon);
    const playResponse = await DaylightAPI(url);
    // Map resume_position → seconds so VideoPlayer/AudioPlayer can seek on load
    if (playResponse.resume_position !== undefined && playResponse.seconds === undefined) {
      playResponse.seconds = playResponse.resume_position;
    }
    return { ...playResponse, assetId: playResponse.assetId || playResponse.id };
  }

  // Legacy plex path
  if (plex) {
    if (shuffle) {
      const { items } = await DaylightAPI(
        buildUrl(`api/v1/queue/plex/${plex}`, { ...queryCommon, shuffle: true })
      );
      if (items?.length > 0) {
        return { ...items[0], assetId: items[0].id };
      }
      return null;
    }
    const url = buildUrl(`api/v1/info/plex/${plex}`, queryCommon);
    const infoResponse = await DaylightAPI(url);
    return { ...infoResponse, assetId: infoResponse.plex };
  }

  // Legacy media path
  if (media) {
    // Parse compound ID (e.g., "immich:uuid" or "plex:123") to route to correct source
    const colonIndex = media.indexOf(':');
    let source = 'files';
    let localId = media;
    if (colonIndex > 0) {
      source = media.substring(0, colonIndex);
      localId = media.substring(colonIndex + 1);
    }
    if (shuffle) {
      const { items } = await DaylightAPI(`api/v1/queue/${source}/${localId}?shuffle=true`);
      if (items?.length > 0) {
        return items[0];
      }
      return null;
    }
    const url = buildUrl(`api/v1/info/${source}/${localId}`, queryCommon);
    const infoResponse = await DaylightAPI(url);
    return infoResponse;
  }

  return null;
}

/**
 * Initialize queue from play or queue props
 * @param {Object|Array} play - Play prop
 * @param {Object|Array} queue - Queue prop
 * @returns {Promise<Array>} Initialized queue with GUIDs
 */
export async function initializeQueue(play, queue) {
  let newQueue = [];

  if (Array.isArray(play)) {
    newQueue = play.map(item => ({ ...item, guid: guid() }));
  } else if (Array.isArray(queue)) {
    newQueue = queue.map(item => ({ ...item, guid: guid() }));
  } else if ((play && typeof play === 'object') || (queue && typeof queue === 'object')) {
    const queueAssetId = play?.playlist || play?.queue || queue?.playlist || queue?.queue || queue?.media;
    if (queueAssetId) {
      const shuffle = !!play?.shuffle || !!queue?.shuffle || false;
      const shuffleParam = shuffle ? '?shuffle=true' : '';
      const { items } = await DaylightAPI(`api/v1/queue/watchlist/${queueAssetId}${shuffleParam}`);
      newQueue = items.map(item => ({ ...item, guid: guid() }));
    } else {
      newQueue = [{ ...(play || queue), guid: guid() }];
    }
  }

  return newQueue;
}
