/**
 * Reload Guard - Rate limiting for page reloads
 *
 * Prevents reload loops by tracking recent reloads and blocking
 * when the rate exceeds safe thresholds.
 *
 * BUG-004 safety net: Even if we don't know what triggers rapid
 * reloads, this prevents the 11-reloads-in-6-seconds scenario.
 */

import getLogger from './logging/Logger.js';

const reloadHistory = [];
const MAX_RELOADS = 3;
const WINDOW_MS = 30000; // 30 seconds

/**
 * Check if a reload is allowed within rate limits.
 */
export function canReload() {
  const now = Date.now();
  // Prune old entries
  while (reloadHistory.length && reloadHistory[0] < now - WINDOW_MS) {
    reloadHistory.shift();
  }
  return reloadHistory.length < MAX_RELOADS;
}

/**
 * Track a reload attempt.
 */
export function trackReload() {
  reloadHistory.push(Date.now());
}

/**
 * Get current reload count in window.
 */
export function getReloadCount() {
  const now = Date.now();
  while (reloadHistory.length && reloadHistory[0] < now - WINDOW_MS) {
    reloadHistory.shift();
  }
  return reloadHistory.length;
}

/**
 * Perform a guarded reload with rate limiting.
 *
 * @param {Object} options
 * @param {Function} options.fallbackAction - Called if reload is blocked
 * @param {string} options.reason - Reason for the reload attempt
 */
export function guardedReload({ fallbackAction, reason = 'unknown' } = {}) {
  const logger = getLogger();

  if (canReload()) {
    trackReload();
    logger.info('reload_guard.allowed', {
      count: getReloadCount(),
      maxReloads: MAX_RELOADS,
      windowMs: WINDOW_MS,
      reason
    });
    window.location.reload();
  } else {
    logger.error('reload_guard.blocked', {
      count: getReloadCount(),
      maxReloads: MAX_RELOADS,
      windowMs: WINDOW_MS,
      reason
    });
    if (typeof fallbackAction === 'function') {
      fallbackAction();
    }
  }
}

// Export constants for testing
export { MAX_RELOADS, WINDOW_MS };
