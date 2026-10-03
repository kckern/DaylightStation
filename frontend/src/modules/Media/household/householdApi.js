// frontend/src/modules/Media/household/householdApi.js
// Client for the household media memory, screen registry, played-earlier and
// suggestions routes (tech doc §2.4–2.9). Content ids travel in the body or
// query, never the path. Every call goes through DaylightAPI, so it carries
// this device's X-Daylight-Device id.
import { DaylightAPI } from '../../../lib/api.mjs';
import { invalidateApiResources } from '../../../lib/hooks/useApiResource.js';

const BASE = 'api/v1/media';

export const HOUSEHOLD_PATHS = Object.freeze({
  recent: `${BASE}/household/recent?limit=24`,
  carryOn: `${BASE}/household/carry-on?limit=20`,
  favourites: `${BASE}/household/favourites`,
  screens: `${BASE}/screens`,
});

export function suggestionsPath(deviceId) {
  return `${BASE}/suggestions?deviceId=${encodeURIComponent(deviceId)}`;
}

export function playedEarlierPath(screenId, { limit = 20, before = null } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (before) query.set('before', before);
  return `${BASE}/screens/${encodeURIComponent(screenId)}/played-earlier?${query.toString()}`;
}

/** Everything a household write can change: lists, suggestions, played earlier. */
export function refreshHouseholdViews() {
  invalidateApiResources(path => typeof path === 'string'
    && (path.startsWith(`${BASE}/household/`) || path.startsWith(`${BASE}/suggestions`)
      || /\/played-earlier/.test(path)));
}

export function addFavourite(item) {
  return DaylightAPI(`${BASE}/household/favourites`, {
    id: item.id,
    kind: item.itemType === 'container' || item.kind === 'collection' ? 'collection' : 'item',
    ...(item.title ? { title: item.title } : {}),
    ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}),
    ...(item.type ? { type: item.type } : {}),
  }, 'POST');
}

export function removeFavourite(id) {
  return DaylightAPI(`${BASE}/household/favourites?id=${encodeURIComponent(id)}`, {}, 'DELETE');
}

export function removeFromHouseholdList(id) {
  return DaylightAPI(`${BASE}/household/removed`, { id }, 'POST');
}

/** Undo of a removal (FIND.13a): the server shows the item again. */
export function restoreToHouseholdList(id) {
  return DaylightAPI(`${BASE}/household/removed?id=${encodeURIComponent(id)}`, {}, 'DELETE');
}

export function markWatched(contentId, watched) {
  return DaylightAPI(`${BASE}/household/watched`, { contentId, watched: !!watched }, 'POST');
}
