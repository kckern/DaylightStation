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
