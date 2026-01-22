import { DaylightAPI } from '../../../lib/api.mjs';
import { guid } from './helpers.js';

/**
 * Recursively flatten queue items, handling nested playlists and queues
 * @param {Array} items - Array of queue items
 * @param {number} level - Current recursion level
 * @returns {Promise<Array>} Flattened array of playable items
 */
export async function flattenQueueItems(items, level = 1) {
  const flattened = [];

  for (const item of items) {
    if (item.queue) {
      const shuffle = !!item.queue.shuffle || item.shuffle || false;
      if (item.queue.playlist || item.queue.queue) {
        const queueKey = item.queue.playlist ?? item.queue.queue;
        const { items: nestedItems } = await DaylightAPI(`api/v1/list/folder/${queueKey}/playable${shuffle ? ',shuffle' : ''}`);
        const nestedFlattened = await flattenQueueItems(nestedItems, level + 1);
        flattened.push(...nestedFlattened);
      } else if (item.queue.plex) {
        const { items: plexItems } = await DaylightAPI(`/api/v1/list/plex/${item.queue.plex}/playable${shuffle ? ',shuffle' : ''}`);
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
 * @param {string} params.plex - Plex media key
 * @param {string} params.media - Media key
 * @param {boolean} params.shuffle - Whether to shuffle
 * @param {string|number} params.maxVideoBitrate - Preferred maximum video bitrate param
 * @param {string|number} params.maxResolution - Preferred maximum resolution param
 * @param {string} params.session - Optional session identifier
 * @returns {Promise<Object>} Media information
 */
export async function fetchMediaInfo({ plex, media, shuffle, maxVideoBitrate, maxResolution, session }) {
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

  if (plex) {
    const base = shuffle ? `api/v1/content/plex/info/${plex}/shuffle` : `api/v1/content/plex/info/${plex}`;
    const url = buildUrl(base, queryCommon);
    const infoResponse = await DaylightAPI(url);
    return { ...infoResponse, media_key: infoResponse.plex };
  } else if (media) {
    const url = buildUrl(`api/v1/content/local/info/${media}`, { shuffle });
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
    const queue_media_key = play?.playlist || play?.queue || queue?.playlist || queue?.queue || queue?.media;
    if (queue_media_key) {
      const shuffle = !!play?.shuffle || !!queue?.shuffle || false;
      const { items } = await DaylightAPI(`api/v1/list/folder/${queue_media_key}/playable${shuffle ? ',shuffle' : ''}`);
      const flatItems = await flattenQueueItems(items);
      newQueue = flatItems.map(item => ({ ...item, guid: guid() }));
    } else {
      newQueue = [{ ...(play || queue), guid: guid() }];
    }
  }
  
  return newQueue;
}
