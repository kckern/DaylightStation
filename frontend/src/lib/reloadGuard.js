/**
 * Reload Guard - Rate limiting for page reloads
 *
 * Prevents reload loops by tracking recent reloads and blocking
 * when the rate exceeds safe thresholds.
 *
 * BUG-004 safety net: Even if we don't know what triggers rapid
 * reloads, this prevents the 11-reloads-in-6-seconds scenario.
 *
 * History lives in sessionStorage, not a module-level array. A module-level
 * array is wiped by the very reload it exists to count — every
 * `window.location.reload()` tears down the whole JS context, so an in-memory
 * guard always wakes up empty and can never see the reload that just
 * happened. That is why this guard had zero effect the one time it mattered:
 * the garage kiosk reload-looped 8 times in under 5 minutes on 2026-09-19
 * with no caller ever tripping it, because nothing was wired to it AND the
 * counter could not have survived past reload #1 even if something had been.
 * sessionStorage survives a same-tab reload and is cleared only when the tab
 * closes, so the count is real across the whole loop.
 */

import getLogger from './logging/Logger.js';

const HISTORY_KEY = 'daylight.reloadGuard.history';
const MAX_RELOADS = 3;
const WINDOW_MS = 30000; // 30 seconds

/**
 * Read the persisted reload history, pruned to the current window.
 * Missing/corrupt/unavailable storage reads as "no recent reloads" — failing
 * toward allowing a reload, because a kiosk that can never reload is worse
 * than one that occasionally reloads once too often.
 */
function readHistory(now = Date.now()) {
  let history;
  try {
    const raw = window.sessionStorage?.getItem(HISTORY_KEY);
    history = raw ? JSON.parse(raw) : [];
  } catch {
    history = [];
  }
  if (!Array.isArray(history)) history = [];
  return history.filter((t) => Number.isFinite(t) && t > now - WINDOW_MS && t <= now);
}

function writeHistory(history) {
  try {
    window.sessionStorage?.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* sessionStorage unavailable (private mode, etc.) — guard degrades to allowing every reload */
  }
}

/**
 * Check if a reload is allowed within rate limits.
 */
export function canReload() {
  return readHistory().length < MAX_RELOADS;
}

/**
 * Track a reload attempt.
 */
export function trackReload() {
  const now = Date.now();
  const history = readHistory(now);
  history.push(now);
  writeHistory(history);
}

/**
 * Get current reload count in window.
 */
export function getReloadCount() {
  return readHistory().length;
}

/**
 * Clear the reload history. Exists for tests and for a caller that just
 * confirmed the page is healthy (e.g. a successful load) and wants a fresh
 * budget rather than waiting out the window.
 */
export function clearReloadGuard() {
  try {
    window.sessionStorage?.removeItem(HISTORY_KEY);
  } catch {
    /* no-op */
  }
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
