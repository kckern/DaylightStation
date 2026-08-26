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
 * Percent-encode one piece of an Android intent: URI.
 *
 * Everything interpolated into an intent URI must be encoded. An unencoded ';'
 * ends the field and injects intent structure (parseUri finds each value with
 * indexOf('=')/indexOf(';')). An unencoded '#' is worse and silent: parseUri
 * locates the marker with lastIndexOf("#") and then checks
 * startsWith("#Intent;", i), so a '#' anywhere later in the URI — in a ROM
 * filename, say — makes that check fail and drops the WHOLE URI into the
 * legacy getIntentOld path, which has different semantics.
 * This must be percent-encoding, not form-encoding: AOSP decodes with
 * Uri.decode, i.e. UriCodec.decode(convertPlus=false), which does NOT map '+'
 * to a space, so a '+' in a filename has to survive as %2B (URLSearchParams
 * would corrupt both cases).
 * (Verified against AOSP Intent.java parseUriInternal and Uri.java decode.)
 *
 * Returns null rather than throwing — encodeURIComponent raises URIError on a
 * lone surrogate, and every export in this module is documented to return a
 * boolean and never throw.
 *
 * @param {string} part
 * @returns {string|null} encoded part, or null if it cannot be encoded
 */
function encodeIntentPart(part) {
  try {
    return encodeURIComponent(part);
  } catch {
    return null; // lone surrogate → URIError
  }
}

/**
 * The FKB JavaScript interface object, or null when we are not inside FKB.
 *
 * TWO NAMES, AND ONLY ONE OF THEM IS THE BRIDGE ITSELF. `FullyKiosk` is the
 * NATIVE object Android's `addJavascriptInterface` attaches; `fully` is a
 * JavaScript alias FKB creates for it by injecting its own script into the
 * page. Every function in this file used to test for `fully` alone, so on any
 * device where that alias does not land the whole module went quietly inert —
 * `screenOff()` returned false and logged `fkb.screenOff.unavailable` forever,
 * which is exactly what the school Portal (Facebook Portal, Android 9, FKB
 * 1.60.1 PLUS, JS interface ENABLED) has been doing: probed on-device, the
 * page had `FullyKiosk` and `FullyLicense` on `window` and no `fully` at all.
 *
 * The native object carries the same method names, so preferring the alias and
 * falling back to it costs nothing and makes the module work on both.
 */
function bridge() {
  if (typeof globalThis === 'undefined') return null;
  return globalThis.fully ?? globalThis.FullyKiosk ?? null;
}

/**
 * Check if the FKB JavaScript interface is available (under either name).
 */
export function isFKBAvailable() {
  return bridge() !== null;
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
  bridge().startApplication(packageName);
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
  if (!isFKBAvailable() || typeof bridge().startApplication !== 'function') {
    logger().warn('fkb.startApplication.unavailable', { packageName, activityName });
    return false;
  }
  logger().info('fkb.startApplication.attempt', { packageName, activityName });
  if (activityName) bridge().startApplication(packageName, activityName);
  else bridge().startApplication(packageName);
  return true;
}

/**
 * Open an Android target (settings screen / app) via FKB, from a config object.
 * Prefers an intent ACTION (reliable across OEMs — e.g.
 * 'android.settings.BLUETOOTH_SETTINGS'), launched as an intent: URI through
 * the bridge's `startIntent`. Falls back to component launch only if no action
 * is given.
 *
 * NOTE: bridge().startApplication(pkg, x) treats x as an intent ACTION, not an
 * activity class — so a component must go through startIntent, not the 2-arg
 * startApplication form (which silently no-ops for a class string).
 *
 * @param {{action?: string, package?: string, activity?: string}} target
 * @returns {boolean} true if a launch was attempted; false if FKB is absent or
 *   a target field could not be percent-encoded
 */
export function launchAndroidTarget(target = {}) {
  const { action, package: pkg, activity } = target;
  if (!isFKBAvailable() || typeof bridge().startIntent !== 'function') {
    logger().warn('fkb.launchTarget.unavailable', { action, pkg, activity });
    return false;
  }
  let uri;
  if (action) {
    const encodedAction = encodeIntentPart(action);
    if (encodedAction === null) {
      logger().warn('fkb.launchTarget.unencodable', { action });
      return false;
    }
    uri = `intent:#Intent;action=${encodedAction};end`;
  } else if (pkg && activity) {
    // Each half is encoded; the '/' between them stays literal. AOSP decodes
    // the component value before ComponentName.unflattenFromString, so an
    // encoded half still unflattens correctly.
    const encodedPkg = encodeIntentPart(pkg);
    const encodedActivity = encodeIntentPart(activity);
    if (encodedPkg === null || encodedActivity === null) {
      logger().warn('fkb.launchTarget.unencodable', { pkg, activity });
      return false;
    }
    uri = `intent:#Intent;component=${encodedPkg}/${encodedActivity};end`;
  } else if (pkg) {
    logger().info('fkb.launchTarget.app', { pkg });
    bridge().startApplication(pkg);
    return true;
  } else {
    logger().warn('fkb.launchTarget.empty', { target });
    return false;
  }
  logger().info('fkb.launchTarget.intent', { action, pkg, activity, uri });
  bridge().startIntent(uri);
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
 * @returns {boolean} true if FKB was available and intent was sent; false if
 *   FKB is absent or the component/an extra could not be percent-encoded
 */
// Intent URI fields are `;`-delimited and `=`-separated, so an extra KEY carrying
// either character would terminate its field and inject intent structure. Keys
// are ours (ROM/LIBRETRO/CONFIGFILE), never user input, so reject rather than
// escape — a key that needs escaping is a bug, not a value to sanitize. VALUES
// are the opposite: they carry arbitrary ROM filenames, so they get encoded.
const INTENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Build an Android intent URI with string extras.
 *
 * Throws rather than returning a sentinel so every failure mode — an
 * unencodable component, a structural key, a lone-surrogate value — funnels
 * through one `catch` in `launchIntent`. Exported for testing; callers should
 * use `launchIntent`.
 *
 * @param {string} packageName
 * @param {string} activityName
 * @param {Object} extras - string-valued extras
 * @returns {string} intent URI
 * @throws {Error} on an unencodable component/value or a structural extra key
 */
export function buildIntentUri(packageName, activityName, extras = {}) {
  // The component's two halves are encoded individually; the '/' between them
  // stays literal, since AOSP decodes the value before unflattening it. The
  // target and the params arrive from the same untrusted JSON response, so
  // neither half gets to be the trusted one.
  const encodedPkg = encodeIntentPart(packageName);
  const encodedActivity = encodeIntentPart(activityName);
  if (encodedPkg === null || encodedActivity === null) {
    throw new Error(`Unencodable intent component: ${packageName}/${activityName}`);
  }

  let uri = `intent:#Intent;component=${encodedPkg}/${encodedActivity};`;
  for (const [key, value] of Object.entries(extras)) {
    if (!INTENT_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid intent extra key: ${key}`);
    }
    const encodedValue = encodeIntentPart(value);
    if (encodedValue === null) {
      throw new Error(`Unencodable intent extra value for key: ${key}`);
    }
    uri += `S.${key}=${encodedValue};`;
  }
  return uri + 'end';
}

export function launchIntent(packageName, activityName, extras = {}) {
  if (!isFKBAvailable() || typeof bridge().startIntent !== 'function') {
    logger().warn('fkb.intent.unavailable', { packageName });
    return false;
  }

  let uri;
  try {
    uri = buildIntentUri(packageName, activityName, extras);
  } catch (err) {
    logger().warn('fkb.intent.invalid', { packageName, activityName, error: err.message });
    return false;
  }

  logger().info('fkb.intent.attempt', { packageName, activityName, extraKeys: Object.keys(extras), uri });
  bridge().startIntent(uri);
  return true;
}

/**
 * Turn the tablet screen OFF via FKB's JS bridge (`turnScreenOff`).
 * Instant, dependency-free (no network, no deviceId) — the robust burn-in kill
 * switch. No-op (returns false) when FKB isn't present. Never throws.
 *
 * @returns {boolean} true if the FKB bridge handled the request
 */
export function screenOff() {
  if (!isFKBAvailable() || typeof bridge().turnScreenOff !== 'function') {
    logger().warn('fkb.screenOff.unavailable', {
      bridge: bridge() ? 'present' : 'absent',
      method: typeof bridge()?.turnScreenOff,
    });
    return false;
  }
  logger().info('fkb.screenOff', {});
  try {
    bridge().turnScreenOff();
    return true;
  } catch (error) {
    logger().warn('fkb.screenOff.failed', { error: error?.message ?? String(error) });
    return false;
  }
}

/**
 * Turn the tablet screen ON via FKB's JS bridge (`turnScreenOn`).
 * No-op (returns false) when FKB isn't present. Never throws.
 *
 * @returns {boolean} true if the FKB bridge handled the request
 */
export function screenOn() {
  if (!isFKBAvailable() || typeof bridge().turnScreenOn !== 'function') {
    logger().warn('fkb.screenOn.unavailable', {
      bridge: bridge() ? 'present' : 'absent',
      method: typeof bridge()?.turnScreenOn,
    });
    return false;
  }
  logger().info('fkb.screenOn', {});
  try {
    bridge().turnScreenOn();
    return true;
  } catch (error) {
    logger().warn('fkb.screenOn.failed', { error: error?.message ?? String(error) });
    return false;
  }
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
    bridge().bind('onResume', () => {
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
  bridge().bind('onBackButton', () => {
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
