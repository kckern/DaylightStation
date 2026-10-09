// frontend/src/modules/Media/lib/urlParams.js
// Navigation params and playback deep-link params share one URL
// (docs/reference/media/media-app.md "Navigation model and paths"). These are
// disjoint namespaces: the nav stack writer and the URL-command reader must
// each touch only their own keys. This module is the single place either
// namespace is enumerated.

export const NAV_PARAM_KEYS = ['view', 'path', 'contentId', 'deviceId'];
export const PLAYBACK_PARAM_KEYS = ['play', 'queue', 'shuffle', 'shader', 'volume'];

/** Parse the nav entry { view, params } out of a search string. */
export function readNavFromSearch(search) {
  const sp = new URLSearchParams(search || '');
  const view = sp.get('view') || 'home';
  const params = {};
  for (const key of NAV_PARAM_KEYS) {
    if (key === 'view') continue;
    const v = sp.get(key);
    if (v != null) params[key] = v;
  }
  return { view, params };
}

/**
 * Return a new search string with the nav namespace replaced by
 * (view, params) and every non-nav param (playback deep-links included)
 * preserved untouched. `view === 'home'` with no params yields no nav keys.
 */
export function writeNavToSearch(search, view, params = {}) {
  const sp = new URLSearchParams(search || '');
  for (const key of NAV_PARAM_KEYS) sp.delete(key);
  if (view && view !== 'home') sp.set('view', view);
  for (const [k, v] of Object.entries(params)) {
    if (!NAV_PARAM_KEYS.includes(k) || k === 'view') continue;
    if (v != null && v !== '') sp.set(k, String(v));
  }
  return sp.toString();
}

/** Extract only the playback deep-link params from a search string. */
export function readPlaybackParams(search) {
  const sp = new URLSearchParams(search || '');
  const out = {};
  for (const key of PLAYBACK_PARAM_KEYS) {
    const v = sp.get(key);
    if (v != null) out[key] = v;
  }
  return out;
}
