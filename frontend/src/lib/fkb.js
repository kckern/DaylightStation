// frontend/src/lib/fkb.js
// Standalone FKB (Fully Kiosk Browser) integration.
// No React dependency. No-ops when FKB is not present.

import getLogger from './logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'fkb' });
  return _logger;
}

/**
 * Check if the FKB JavaScript interface is available.
 * The `fully` global is injected by FKB into all WebView pages.
 */
export function isFKBAvailable() {
  return typeof fully !== 'undefined';
}

/**
 * Launch an Android app via FKB's startApplication API.
 * Fire-and-forget — FKB provides no success/failure callback.
 *
 * @param {string} packageName - Android package name (e.g., 'org.lds.stream')
 * @param {string} [activityName] - Activity class name (e.g., '.TvMainActivity')
 * @returns {boolean} true if FKB was available and launch was attempted
 */
export function launchApp(packageName) {
  if (!isFKBAvailable()) {
    logger().warn('fkb.launch.unavailable', { packageName });
    return false;
  }
  logger().info('fkb.launch.attempt', { packageName });
  // Always use 1-arg form — FKB's 3-arg form (package, action, activity)
  // doesn't work reliably. Android resolves the default launcher activity.
  fully.startApplication(packageName);
  return true;
}

// Singleton pattern: each call overwrites previous callback
// to avoid stale handler accumulation (FKB has no unbind API).
let _onResumeCallback = null;
let _bound = false;

/**
 * Register a callback for FKB's onResume event (fires when FKB
 * returns to foreground after another app exits).
 *
 * Uses singleton pattern — only one callback active at a time.
 * Each call replaces the previous callback.
 *
 * @param {Function} callback
 */
export function onResume(callback) {
  _onResumeCallback = callback;
  if (!_bound && isFKBAvailable()) {
    fully.bind('onResume', () => {
      logger().info('fkb.resume');
      if (_onResumeCallback) _onResumeCallback();
    });
    _bound = true;
  }
}
