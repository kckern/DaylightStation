/**
 * Shared utilities for feed card components.
 */

/**
 * Format a timestamp into a compact relative age string.
 * @param {string|number|Date} timestamp
 * @returns {string} e.g. "3m", "2h", "5d"
 */
export function formatAge(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

/**
 * Proxy a raw source icon URL through the feed icon endpoint.
 * @param {string} rawUrl
 * @returns {string|null}
 */
export function proxyIcon(rawUrl) {
  if (!rawUrl) return null;
  if (rawUrl.startsWith('/api/')) return rawUrl;
  return `/api/v1/feed/icon?url=${encodeURIComponent(rawUrl)}`;
}

/**
 * Format an ISO date into a human-readable relative age (long form).
 * @param {string} isoDate
 * @returns {string|null}
 */
export function memoryAge(isoDate) {
  if (!isoDate) return null;
  const diff = Date.now() - new Date(isoDate).getTime();
  if (diff < 0) return null;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365.25);
  const remMonths = Math.floor((days - years * 365.25) / 30.44);
  if (remMonths > 0) return `${years} year${years === 1 ? '' : 's'}, ${remMonths} month${remMonths === 1 ? '' : 's'} ago`;
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * Check whether a URL looks like it can be rendered as an <img> src.
 * Rejects known non-image media types (video streams, audio, etc.).
 * @param {string} url
 * @returns {boolean}
 */
const NON_IMAGE_RE = /\.(?:m3u8|mp4|webm|ogg|mp3|m4a|wav|flac|mpd)(?:[?#]|$)/i;
export function isImageUrl(url) {
  if (!url) return false;
  return !NON_IMAGE_RE.test(url);
}

/**
 * Generate a deterministic color from a string label.
 * Returns a hex color from a curated palette.
 * @param {string} label
 * @returns {string} hex color
 */
export function colorFromLabel(label) {
  const palette = [
    '#228be6', '#be4bdb', '#f06595', '#ff6b6b',
    '#fab005', '#82c91e', '#20c997', '#15aabf',
    '#7950f2', '#e64980', '#fd7e14', '#51cf66',
  ];
  if (!label) return palette[0];
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = label.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}
