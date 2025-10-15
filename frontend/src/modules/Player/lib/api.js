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
        const { items: nestedItems } = await DaylightAPI(`data/list/${queueKey}/playable${shuffle ? ',shuffle' : ''}`);
        const nestedFlattened = await flattenQueueItems(nestedItems, level + 1);
        flattened.push(...nestedFlattened);
      } else if (item.queue.plex) {
        const { items: plexItems } = await DaylightAPI(`media/plex/list/${item.queue.plex}/playable${shuffle ? ',shuffle' : ''}`);
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
 * @param {string} params.maxVideoBitrate - Maximum video bitrate
 * @returns {Promise<Object>} Media information
 */
export async function fetchMediaInfo({ plex, media, shuffle, maxVideoBitrate }) {
  if (plex) {
    const bitrate = maxVideoBitrate 
      ? (shuffle ? `&maxVideoBitrate=${encodeURIComponent(maxVideoBitrate)}` : `?maxVideoBitrate=${encodeURIComponent(maxVideoBitrate)}`) 
      : '';
    const url = shuffle 
      ? `media/plex/info/${plex}/shuffle${bitrate}` 
      : `media/plex/info/${plex}${bitrate}`;
    const infoResponse = await DaylightAPI(url);
    return { ...infoResponse, media_key: infoResponse.plex };
  } else if (media) {
    const url = shuffle 
      ? `media/info/${media}?shuffle=${shuffle}` 
      : `media/info/${media}`;
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
      const { items } = await DaylightAPI(`data/list/${queue_media_key}/playable${shuffle ? ',shuffle' : ''}`);
      const flatItems = await flattenQueueItems(items);
      newQueue = flatItems.map(item => ({ ...item, guid: guid() }));
    } else {
      newQueue = [{ ...(play || queue), guid: guid() }];
    }
  }
  
  return newQueue;
}
