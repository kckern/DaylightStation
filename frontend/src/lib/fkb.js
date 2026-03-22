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

/**
 * Launch an Android intent with extras via FKB's startIntent API.
 * Uses Android intent URI format: intent:#Intent;component=pkg/act;S.key=val;end
 *
 * This replaces ADB-based launching for apps that need intent extras
 * (e.g., RetroArch with ROM/LIBRETRO/CONFIGFILE params).
 *
 * @param {string} packageName - Android package name
 * @param {string} activityName - Full activity class name
 * @param {Object} extras - Key-value pairs for intent string extras
 * @returns {boolean} true if FKB was available and intent was sent
 */
export function launchIntent(packageName, activityName, extras = {}) {
  if (!isFKBAvailable() || typeof fully.startIntent !== 'function') {
    logger().warn('fkb.intent.unavailable', { packageName });
    return false;
  }

  let uri = `intent:#Intent;component=${packageName}/${activityName};`;
  for (const [key, value] of Object.entries(extras)) {
    uri += `S.${key}=${value};`;
  }
  uri += 'end';

  logger().info('fkb.intent.attempt', { packageName, activityName, extraKeys: Object.keys(extras) });
  fully.startIntent(uri);
  return true;
}

/**
 * Schedule dismiss after an FKB app launch.
 * Auto-dismisses after a delay + registers onResume as backup.
 * Call this AFTER the launch succeeds.
 *
 * @param {Function} onDismiss - Callback to dismiss the launch UI (e.g., pop MenuStack)
 * @param {number} [delayMs=1500] - Delay before auto-dismiss
 */
export function scheduleDismissAfterLaunch(onDismiss, delayMs = 1500) {
  setTimeout(() => onDismiss?.(), delayMs);
  onResume(() => onDismiss?.());
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

/**
 * Bind FKB's hardware back button to dispatch a keydown Escape event.
 * Without this, FKB intercepts the back button and opens its own sidebar
 * instead of passing it to the WebView.
 * Call once at app startup.
 */
let _backBound = false;
export function bindBackButton() {
  if (_backBound || !isFKBAvailable()) return;
  fully.bind('onBackButton', () => {
    logger().info('fkb.backButton');
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true
    }));
  });
  _backBound = true;
}
