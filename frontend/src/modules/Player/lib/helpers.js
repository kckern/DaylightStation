import moment from 'moment';

/**
 * Generate a random GUID
 * @returns {string} 10-character random string
 */
export function guid() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Format seconds into MM:SS or HH:MM:SS format
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
export function formatTime(seconds) {
  return moment
    .utc(seconds * 1000)
    .format(seconds >= 3600 ? 'HH:mm:ss' : 'mm:ss')
    .replace(/^0(\d+)/, '$1');
}

/**
 * Calculate progress percentage
 * @param {number} progress - Current progress in seconds
 * @param {number} duration - Total duration in seconds
 * @returns {number} Progress percentage with 1 decimal place
 */
export function getProgressPercent(progress, duration) {
  if (!duration) return 0;
  return ((progress / duration) * 100).toFixed(1);
}

/**
 * Format seconds into MM:SS format for seek display
 * @param {number} s - Seconds to format
 * @returns {string} Formatted string MM:SS
 */
export function formatSeekTime(s) {
  if (!Number.isFinite(s)) return '';
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = Math.floor(s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Map media element ready state to human-readable text
 * @param {number} n - Ready state number
 * @returns {string} Ready state description
 */
export function mapReadyState(n) {
  const states = {
    0: 'HAVE_NOTHING',
    1: 'HAVE_METADATA',
    2: 'HAVE_CURRENT_DATA',
    3: 'HAVE_FUTURE_DATA',
    4: 'HAVE_ENOUGH_DATA'
  };
  return states[n] || String(n);
}

/**
 * Map media element network state to human-readable text
 * @param {number} n - Network state number
 * @returns {string} Network state description
 */
export function mapNetworkState(n) {
  const states = {
    0: 'NETWORK_EMPTY',
    1: 'NETWORK_IDLE',
    2: 'NETWORK_LOADING',
    3: 'NETWORK_NO_SOURCE'
  };
  return states[n] || String(n);
}
