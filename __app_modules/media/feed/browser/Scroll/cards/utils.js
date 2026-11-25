/**
 * Shared utilities for feed card components.
 */
import { webLink, feedImageSrc } from '../../../shared/webLink.mjs';

/**
 * Format a timestamp into a compact relative age string.
 * @param {string|number|Date} timestamp
 * @returns {string} e.g. "3m", "2h", "5d"
 */
export function formatAge(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(diff)) return '';
  if (diff < 0) {
    const mins = Math.ceil(-diff / 60000);
    if (mins < 60) return `in ${mins}m`;
    const hrs = Math.ceil(mins / 60);
    if (hrs < 24) return `in ${hrs}h`;
    return `in ${Math.ceil(hrs / 24)}d`;
  }
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
  const external = webLink(rawUrl);
  if (external && !isOwnOrigin(external)) return `/api/v1/feed/icon?url=${encodeURIComponent(external)}`;
  return safeImage(rawUrl);
}

/**
 * Proxy a raw image URL through the feed image endpoint.
 * The backend returns an SVG placeholder on upstream failure,
 * so the result is always renderable.
 * Returns null if already proxied or empty.
 * @param {string} rawUrl
 * @returns {string|null}
 */
export function proxyImage(rawUrl) {
  const external = webLink(rawUrl);
  if (!external || isOwnOrigin(external)) return null;
  return `/api/v1/feed/image?url=${encodeURIComponent(external)}`;
}

function pageOrigin() {
  return typeof window !== 'undefined' ? window.location.origin : '';
}

function isOwnOrigin(link) {
  try { return new URL(link).origin === new URL(pageOrigin()).origin; } catch { return false; }
}

/**
 * The URL an <img> in the feed may load, or null. Feed images are other
 * people's data and a same-origin <img> carries the household member's
 * trust: on this app's origin only the read-only image endpoints load
 * (feedImageSrc in feed/shared/webLink.mjs).
 * @param {string} rawUrl
 * @returns {string|null}
 */
export function safeImage(rawUrl) {
  return feedImageSrc(rawUrl, pageOrigin());
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
 * Format a date as "Mon 1 Jan at 6:12pm" (current year) or "Mon 1 Jan 2024 at 6:12pm".
 * @param {string|number|Date} date
 * @returns {string|null}
 */
export function formatPhotoDate(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d)) return null;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = days[d.getDay()];
  const dom = d.getDate();
  const mon = months[d.getMonth()];
  const year = d.getFullYear();
  const currentYear = new Date().getFullYear();
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  const datePart = year === currentYear
    ? `${day} ${dom} ${mon}`
    : `${day} ${dom} ${mon} ${year}`;
  return `${datePart} at ${h}:${m}${ampm}`;
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
    '#228be6', '#be4bdb', '#f06595', '#ff6b6b', // data-color: source label palette
    '#fab005', '#82c91e', '#20c997', '#15aabf', // data-color: source label palette
    '#7950f2', '#e64980', '#fd7e14', '#51cf66', // data-color: source label palette
  ];
  if (!label) return palette[0];
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = label.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}
