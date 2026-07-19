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
 * Launch a specific Android activity via FKB's two-arg startApplication API
 * (package + fully-qualified activity class). Unlike launchApp's 1-arg launcher
 * form, this targets an exact activity — e.g. the Bluetooth settings screen:
 *   startApplication('com.android.settings', 'com.android.settings.Settings$BluetoothSettingsActivity')
 * Fire-and-forget; no-op when FKB isn't present.
 *
 * @param {string} packageName - Android package name
 * @param {string} [activityName] - fully-qualified activity class (optional)
 * @returns {boolean} true if FKB was available and the launch was attempted
 */
export function startApplication(packageName, activityName) {
  if (!isFKBAvailable() || typeof fully.startApplication !== 'function') {
    logger().warn('fkb.startApplication.unavailable', { packageName, activityName });
    return false;
  }
  logger().info('fkb.startApplication.attempt', { packageName, activityName });
  if (activityName) fully.startApplication(packageName, activityName);
  else fully.startApplication(packageName);
  return true;
}

/**
 * Open an Android target (settings screen / app) via FKB, from a config object.
 * Prefers an intent ACTION (reliable across OEMs — e.g.
 * 'android.settings.BLUETOOTH_SETTINGS'), launched as an intent: URI through
 * fully.startIntent. Falls back to component launch only if no action is given.
 *
 * NOTE: fully.startApplication(pkg, x) treats x as an intent ACTION, not an
 * activity class — so a component must go through startIntent, not the 2-arg
 * startApplication form (which silently no-ops for a class string).
 *
 * @param {{action?: string, package?: string, activity?: string}} target
 * @returns {boolean} true if a launch was attempted
 */
export function launchAndroidTarget(target = {}) {
  const { action, package: pkg, activity } = target;
  if (!isFKBAvailable() || typeof fully.startIntent !== 'function') {
    logger().warn('fkb.launchTarget.unavailable', { action, pkg, activity });
    return false;
  }
  let uri;
  if (action) {
    uri = `intent:#Intent;action=${action};end`;
  } else if (pkg && activity) {
    uri = `intent:#Intent;component=${pkg}/${activity};end`;
  } else if (pkg) {
    logger().info('fkb.launchTarget.app', { pkg });
    fully.startApplication(pkg);
    return true;
  } else {
    logger().warn('fkb.launchTarget.empty', { target });
    return false;
  }
  logger().info('fkb.launchTarget.intent', { action, pkg, activity, uri });
  fully.startIntent(uri);
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

  // Keys and values are URL-encoded — Android's Intent.parseUri expects that,
  // and it keeps a ROM path's spaces/brackets intact and a stray ';' inside a
  // value from terminating the field and injecting intent structure.
  // (The sibling ADB path guards the same way — AdbLauncher#validateIntentParam.)
  // The component is NOT encoded: its dots and '/' are structural syntax.
  // encodeURIComponent leaves ! ' ( ) * raw. That's deliberate and safe here —
  // none of those are structural in an intent URI (only ';' '=' '#' are), and
  // ROM filenames are full of them, so encoding would only add noise.
  let uri = `intent:#Intent;component=${packageName}/${activityName};`;
  for (const [key, value] of Object.entries(extras)) {
    uri += `S.${encodeURIComponent(key)}=${encodeURIComponent(value)};`;
  }
  uri += 'end';

  logger().info('fkb.intent.attempt', { packageName, activityName, extraKeys: Object.keys(extras) });
  fully.startIntent(uri);
  return true;
}

/**
 * Turn the tablet screen OFF via FKB's JS bridge (`fully.turnScreenOff`).
 * Instant, dependency-free (no network, no deviceId) — the robust burn-in kill
 * switch. No-op (returns false) when FKB isn't present. Never throws.
 *
 * @returns {boolean} true if the FKB bridge handled the request
 */
export function screenOff() {
  if (!isFKBAvailable() || typeof fully.turnScreenOff !== 'function') {
    logger().warn('fkb.screenOff.unavailable', {});
    return false;
  }
  logger().info('fkb.screenOff', {});
  fully.turnScreenOff();
  return true;
}

/**
 * Turn the tablet screen ON via FKB's JS bridge (`fully.turnScreenOn`).
 * No-op (returns false) when FKB isn't present. Never throws.
 *
 * @returns {boolean} true if the FKB bridge handled the request
 */
export function screenOn() {
  if (!isFKBAvailable() || typeof fully.turnScreenOn !== 'function') {
    logger().warn('fkb.screenOn.unavailable', {});
    return false;
  }
  logger().info('fkb.screenOn', {});
  fully.turnScreenOn();
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
 * Bind FKB's hardware back button to trigger a browser history back.
 * Without this, FKB intercepts the back button and opens its own sidebar
 * instead of passing it to the WebView.
 *
 * Uses history.back() so the popstate trap in MenuNavigationContext handles
 * navigation — including pop guards (e.g. recording-in-progress confirmation).
 * This is more reliable than synthetic keyboard events, which only fire on
 * window and don't reach component-level keydown listeners.
 *
 * Call once at app startup.
 */
let _backBound = false;
export function bindBackButton() {
  if (_backBound || !isFKBAvailable()) return;
  fully.bind('onBackButton', () => {
    logger().info('fkb.backButton');
    window.history.back();
  });
  _backBound = true;
}

/**
 * Global key capture logger for Shield TV remote button audit.
 * Logs every keydown event (sampled) to identify which remote buttons
 * FKB passes through to the WebView vs swallows.
 * Call once at app startup.
 */
let _keyCaptureEnabled = false;
export function enableGlobalKeyCapture() {
  if (_keyCaptureEnabled) return;
  _keyCaptureEnabled = true;
  const log = logger();
  window.addEventListener('keydown', (e) => {
    log.sampled('fkb.keyCapture', {
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      which: e.which,
      repeat: e.repeat,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      synthetic: !e.isTrusted,
    }, { maxPerMinute: 60 });
  }, { capture: true }); // capture phase — logs before any handler can preventDefault
}
