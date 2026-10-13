// dashStreamUrl.js — URL rewriting helpers for VideoPlayer.jsx's dash.js
// hard-reset path, split out so Fast Refresh can hot-reload the player
// component on its own.

/**
 * Append or replace a cache-buster query param on a URL.
 * Used by hardReset to force dash.js to re-fetch the MPD manifest,
 * which causes the backend proxy to mint a fresh Plex transcode session.
 * Works on absolute and relative URLs. Idempotent with respect to an
 * existing _refresh param. Preserves URL fragments (#anchor).
 */
export function appendRefreshParam(url, nonce) {
  if (!url) return url;
  const hashIndex = url.indexOf('#');
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  // Strip any existing _refresh=<value>, whether it's the first/middle/last param.
  // After stripping, also clean up an orphaned '?' or trailing '&'.
  const stripped = base
    .replace(/([?&])_refresh=[^&]*&/g, '$1')  // middle or first-of-many
    .replace(/[?&]_refresh=[^&]*$/g, '')       // last
    .replace(/\?$/, '');                        // orphaned '?' after strip
  const sep = stripped.includes('?') ? '&' : '?';
  return `${stripped}${sep}_refresh=${nonce}${hash}`;
}

/**
 * Rewrite (or add) the Plex transcode `offset=` (start position, in seconds) on a
 * stream URL. Critical for recovering a far-forward-seek stall: a plain URL refresh
 * re-mints the transcode at the ORIGINAL offset, so the seek target is still past
 * the transcoder's head and stalls again. Pointing offset at the seek target makes
 * Plex transcode FROM there, so the seeked position is immediately available.
 * Preserves other params + fragment. No-op for a non-positive/NaN offset.
 */
export function withOffsetParam(url, offsetSec) {
  if (!url || !Number.isFinite(offsetSec) || offsetSec <= 0) return url;
  const off = Math.floor(offsetSec);
  const hashIndex = url.indexOf('#');
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  if (/[?&]offset=/.test(base)) {
    return `${base.replace(/([?&]offset=)[^&]*/, `$1${off}`)}${hash}`;
  }
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}offset=${off}${hash}`;
}
