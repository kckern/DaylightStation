// frontend/src/lib/fkb.js
// Standalone kiosk-bridge integration: the page's one door to the kiosk app
// that hosts it. Two bridges are supported and the page does not choose:
//   - `window.daylight`, injected by the DaylightStation Android kiosk app;
//   - `window.fully`, injected by Fully Kiosk Browser (FKB).
// When both are present, `daylight` wins. The exports keep their FKB-era names
// and signatures so no importer changes when a device moves between the two.
// No React dependency. No-ops when neither bridge is present.

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
 * The FKB kiosk-control interface, or null when this page does not have one.
 *
 * WHAT IS ACTUALLY ON THE PAGE, probed on the school Portal (Facebook Portal,
 * Android 9, FKB 1.60.1 PLUS, `enableFullyJavascriptInterface` = true):
 *   - no `window.fully` at all — the alias FKB normally injects never lands;
 *   - a `window.FullyKiosk` that is NOT the control object. It carries exactly
 *     five methods: getBase64FromBlobData, getFullyVersion, getFullyVersionCode,
 *     grab, print. A blob/print helper. No turnScreenOff. No bind.
 *
 * So on that device there is no control interface, and `screenOff()` genuinely
 * cannot work from the page — a fact this module must REPORT rather than paper
 * over. Matching on a name alone claimed otherwise, and cost eighty minutes of
 * Portal outage: `isFKBAvailable()` went true, `bindBackButton()` (which runs
 * at app STARTUP) called `.bind()` on an object that has none, the throw
 * happened before any error listener the page installs, and React never
 * mounted. A black panel and a silent log.
 *
 * Hence two questions, asked separately, and a candidate that must prove
 * itself: `bridge()` answers "is a control interface actually here", and
 * `bridgeMethod(name)` answers the only question a caller has — "can I call
 * this?". Every call site goes through the second one.
 */
// What qualifies an object as Fully's control interface. `restartApp` and
// `reboot` are deliberately not on it: they are called on whichever object
// this list selects, and an object carrying only those does not qualify.
const CONTROL_METHODS = ['turnScreenOff', 'turnScreenOn', 'startApplication', 'startIntent', 'bind', 'reboot'];

/**
 * The `window.daylight` members this module calls. As with Fully, a name on
 * `window` is not a capability: the object must carry at least one of these.
 */
const DAYLIGHT_METHODS = ['launch', 'screen', 'setBackMode', 'restartApp', 'reboot'];
const DAYLIGHT_ADAPTER = Symbol('daylight-bridge-adapter');

/**
 * `window.daylight` behind Fully's method names, or null when it is not there.
 *
 * The exports below were written against Fully's bridge. Giving the daylight
 * bridge the same method names keeps each of them a single code path:
 *
 *   startApplication(pkg, activity?) -> daylight.launch('{"package","activity"}')
 *   startIntent(uri)                 -> daylight.launch('{"intent"}')
 *   turnScreenOff() / turnScreenOn() -> daylight.screen(false / true)
 *   bind('onResume', fn)             -> 'daylight:resume' CustomEvent on window
 *   bind('onBackButton', fn)         -> daylight.setBackMode('page') + 'daylight:back'
 *   restartApp() / reboot()          -> daylight.restartApp() / daylight.reboot()
 *
 * Two differences from Fully are kept, because they are improvements the
 * daylight bridge makes possible:
 *   - its calls answer `false` when the app did not accept the request, and
 *     that `false` is passed back (Fully's calls answer nothing);
 *   - the second argument of startApplication is the activity class. Fully
 *     reads that argument as an intent action.
 *
 * A method whose underlying daylight member is missing is left off, so
 * `bridgeMethod(name)` answers null and the caller logs `...unavailable`.
 * A daylight call that throws is contained here and reads as `false`.
 */
function daylightAdapter() {
  let raw;
  let has;
  try {
    raw = globalThis.daylight;
    if (!raw) return null;
    has = Object.fromEntries(DAYLIGHT_METHODS.map((name) => [name, typeof raw[name] === 'function']));
  } catch {
    return null; // A bridge object may throw on property access.
  }
  if (!Object.values(has).some(Boolean)) return null;

  const call = (name, ...args) => {
    try {
      return raw[name](...args);
    } catch (error) {
      logger().warn('fkb.bridge.failed', {
        bridge: 'daylight', method: name, error: error?.message ?? String(error),
      });
      return false;
    }
  };

  const adapter = { [DAYLIGHT_ADAPTER]: true };
  if (has.launch) {
    adapter.startApplication = (pkg, activity) => call(
      'launch',
      JSON.stringify(activity ? { package: pkg, activity } : { package: pkg }),
    );
    adapter.startIntent = (uri) => call('launch', JSON.stringify({ intent: uri }));
  }
  if (has.screen) {
    adapter.turnScreenOff = () => call('screen', false);
    adapter.turnScreenOn = () => call('screen', true);
  }
  // Not wrapped in `call`: restartApp()/reboot() below contain a throw
  // themselves and hand it to the caller's onError, as they do for Fully.
  if (has.restartApp) adapter.restartApp = () => raw.restartApp();
  if (has.reboot) adapter.reboot = () => raw.reboot();
  // Returns false when the event cannot be bound on this bridge.
  adapter.bind = (event, handler) => {
    if (event === 'onResume') {
      window.addEventListener('daylight:resume', (e) => handler(e?.detail));
      return true;
    }
    if (event === 'onBackButton') {
      // 'page' mode is what makes the app send daylight:back at all; without
      // it the app handles the button itself and the listener would be dead.
      if (!has.setBackMode || call('setBackMode', 'page') === false) return false;
      window.addEventListener('daylight:back', () => handler());
      return true;
    }
    return false;
  };
  return adapter;
}

function bridge() {
  if (typeof globalThis === 'undefined') return null;
  const daylight = daylightAdapter();
  if (daylight) return daylight;
  for (const candidate of [globalThis.fully, globalThis.FullyKiosk]) {
    if (!candidate) continue;
    try {
      if (CONTROL_METHODS.some((name) => typeof candidate[name] === 'function')) return candidate;
    } catch {
      // A bridge object may throw on property access; it simply does not qualify.
    }
  }
  return null;
}

/**
 * The named bridge method if it is callable here, else null.
 *
 * Reading the property is wrapped: a Java bridge can throw on unknown property
 * access, and this module's whole contract is that it never throws.
 */
function bridgeMethod(name) {
  const target = bridge();
  if (!target) return null;
  try {
    const fn = target[name];
    return typeof fn === 'function' ? fn.bind(target) : null;
  } catch {
    return null;
  }
}

/**
 * Which bridge is active: 'daylight', 'fully', or null when there is none.
 */
function bridgeKind() {
  const target = bridge();
  if (!target) return null;
  return target[DAYLIGHT_ADAPTER] ? 'daylight' : 'fully';
}

/**
 * The two bridge fields a log line carries. `bridge` is 'present' or 'absent',
 * the values it has always had, so existing log-store queries keep matching.
 * `bridgeKind` says which bridge it is.
 */
function bridgeFields() {
  const kind = bridgeKind();
  return { bridge: kind ? 'present' : 'absent', bridgeKind: kind };
}

/**
 * True when a real kiosk-control interface is present — see `bridge()`.
 *
 * Still not a promise about any PARTICULAR method: a bridge can carry
 * `turnScreenOff` and no `bind`. A caller that needs one asks by name.
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
  const startApplication = bridgeMethod('startApplication');
  if (!startApplication) {
    logger().warn('fkb.launch.unavailable', { packageName, ...bridgeFields() });
    return false;
  }
  logger().info('fkb.launch.attempt', { packageName });
  // Always use 1-arg form — FKB's 3-arg form (package, action, activity)
  // doesn't work reliably. Android resolves the default launcher activity.
  if (startApplication(packageName) === false) {
    logger().warn('fkb.launch.rejected', { packageName, ...bridgeFields() });
    return false;
  }
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
  const startApp = bridgeMethod('startApplication');
  if (!startApp) {
    logger().warn('fkb.startApplication.unavailable', {
      packageName, activityName, ...bridgeFields(),
    });
    return false;
  }
  logger().info('fkb.startApplication.attempt', { packageName, activityName });
  const accepted = activityName ? startApp(packageName, activityName) : startApp(packageName);
  if (accepted === false) {
    logger().warn('fkb.startApplication.rejected', { packageName, activityName, ...bridgeFields() });
    return false;
  }
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
  const startIntent = bridgeMethod('startIntent');
  if (!startIntent) {
    logger().warn('fkb.launchTarget.unavailable', {
      action, pkg, activity, ...bridgeFields(),
    });
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
    const startApp = bridgeMethod('startApplication');
    if (!startApp) {
      logger().warn('fkb.launchTarget.unavailable', { pkg, method: 'startApplication', bridgeKind: bridgeKind() });
      return false;
    }
    if (startApp(pkg) === false) {
      logger().warn('fkb.launchTarget.rejected', { pkg, ...bridgeFields() });
      return false;
    }
    return true;
  } else {
    logger().warn('fkb.launchTarget.empty', { target });
    return false;
  }
  logger().info('fkb.launchTarget.intent', { action, pkg, activity, uri });
  if (startIntent(uri) === false) {
    logger().warn('fkb.launchTarget.rejected', { action, pkg, activity, ...bridgeFields() });
    return false;
  }
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
  const startIntent = bridgeMethod('startIntent');
  if (!startIntent) {
    logger().warn('fkb.intent.unavailable', { packageName, ...bridgeFields() });
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
  if (startIntent(uri) === false) {
    logger().warn('fkb.intent.rejected', { packageName, activityName, ...bridgeFields() });
    return false;
  }
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
  const turnScreenOff = bridgeMethod('turnScreenOff');
  if (!turnScreenOff) {
    logger().warn('fkb.screenOff.unavailable', { ...bridgeFields() });
    return false;
  }
  logger().info('fkb.screenOff', {});
  try {
    if (turnScreenOff() === false) {
      logger().warn('fkb.screenOff.rejected', { ...bridgeFields() });
      return false;
    }
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
  const turnScreenOn = bridgeMethod('turnScreenOn');
  if (!turnScreenOn) {
    logger().warn('fkb.screenOn.unavailable', { ...bridgeFields() });
    return false;
  }
  logger().info('fkb.screenOn', {});
  try {
    if (turnScreenOn() === false) {
      logger().warn('fkb.screenOn.rejected', { ...bridgeFields() });
      return false;
    }
    return true;
  } catch (error) {
    logger().warn('fkb.screenOn.failed', { error: error?.message ?? String(error) });
    return false;
  }
}

/**
 * One no-argument bridge call that answers a boolean and never throws.
 * `call` is the method name on the bridge and the middle of the log events:
 * `fkb.<call>`, `fkb.<call>.unavailable`, `.rejected`, `.failed`.
 */
function simpleBridgeCall(call, { onError } = {}) {
  const method = bridgeMethod(call);
  if (!method) {
    logger().warn(`fkb.${call}.unavailable`, { ...bridgeFields() });
    return false;
  }
  logger().info(`fkb.${call}`, { ...bridgeFields() });
  try {
    if (method() === false) {
      logger().warn(`fkb.${call}.rejected`, { ...bridgeFields() });
      return false;
    }
    return true;
  } catch (error) {
    logger().warn(`fkb.${call}.failed`, { ...bridgeFields(), error: error?.message ?? String(error) });
    try { onError?.(error); } catch { /* a caller's handler must not make this throw */ }
    return false;
  }
}

/**
 * True when the active bridge can restart the kiosk app. Asks without calling
 * and without logging, for a caller that decides up front whether a restart
 * action exists (the piano render watchdog).
 *
 * @returns {boolean}
 */
export function canRestartApp() {
  return bridgeMethod('restartApp') !== null;
}

/**
 * Restart the kiosk app, which respawns the WebView's renderer process. A page
 * reload does not do that. `fully.restartApp()` on Fully,
 * `daylight.restartApp()` on the Android kiosk app. Never throws.
 *
 * @param {{onError?: (error: Error) => void}} [options] - called with the
 *   error when the bridge call throws, for a caller that reports it itself
 * @returns {boolean} true if the active bridge took the request
 */
export function restartApp(options) {
  return simpleBridgeCall('restartApp', options);
}

/**
 * Reboot the device. `fully.reboot()` on Fully (needs device admin there),
 * `daylight.reboot()` on the Android kiosk app, which answers false when the
 * device cannot do it (it needs device owner). Never throws.
 *
 * @param {{onError?: (error: Error) => void}} [options] - called with the
 *   error when the bridge call throws, for a caller that reports it itself
 * @returns {boolean} true if the active bridge took the request
 */
export function reboot(options) {
  return simpleBridgeCall('reboot', options);
}

/**
 * A member of `window.daylight` read directly, or null.
 *
 * The phone app's bridge carries the pin members and none of the kiosk members
 * `daylightAdapter()` qualifies on, so the pin calls cannot go through
 * `bridge()`. Fully never has them.
 */
function daylightMember(name) {
  try {
    const raw = globalThis.daylight;
    if (!raw) return null;
    const fn = raw[name];
    return typeof fn === 'function' ? fn.bind(raw) : null;
  } catch {
    return null; // A bridge object may throw on property access.
  }
}

/** A refusal reason is one lower-case word (phone.md); anything else reads as failed. */
const PIN_REASON_PATTERN = /^[a-z_]{1,40}$/;

function normalizePinAnswer(answer) {
  let value = answer;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { accepted: false, reason: 'failed' };
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.accepted !== 'boolean') {
    return { accepted: false, reason: 'failed' };
  }
  if (value.accepted) return { accepted: true };
  const reason = typeof value.reason === 'string' && PIN_REASON_PATTERN.test(value.reason)
    ? value.reason
    : 'failed';
  return { accepted: false, reason };
}

/**
 * True when this page can ask the phone app to pin media to the home screen:
 * the phone build's bridge is here, this document holds its token, it is the
 * top frame on an allowed origin, and the launcher can pin. False everywhere
 * else (kiosks, Fully, ordinary browsers, frames) and when the call throws.
 * Not rate limited; does not log.
 *
 * @returns {boolean}
 */
export function canPinMedia() {
  if (!daylightMember('pinMedia')) return false;
  const can = daylightMember('canPinMedia');
  if (!can) return false;
  try {
    return can() === true;
  } catch {
    return false;
  }
}

/**
 * Ask the phone app to pin one media item to the home screen.
 *
 * `accepted: true` means Android's own pin dialog is showing; whether the owner
 * confirms it is never reported. The answer holds `accepted` and, on a refusal,
 * one `reason` word (`refused`, `not_top_frame`, `rate_limited`, `bad_request`,
 * `invalid_content_id`, `invalid_label`, `not_available`, `launcher_cannot_pin`,
 * `launcher_refused`, `limit_reached`, `failed`). A missing member reads `not_available`; a throw,
 * an unparseable answer or an answer of another shape reads `failed`. Never
 * throws. The log line carries the outcome only, never the content id or label.
 *
 * @param {{contentId: string, label: string}} request
 * @returns {{accepted: boolean, reason?: string}}
 */
export function pinMedia({ contentId, label } = {}) {
  const pin = daylightMember('pinMedia');
  let result;
  if (!pin) {
    result = { accepted: false, reason: 'not_available' };
  } else {
    try {
      result = normalizePinAnswer(pin(JSON.stringify({ contentId, label })));
    } catch {
      // The error text could name the request, so it is not logged.
      result = { accepted: false, reason: 'failed' };
    }
  }
  logger().info('fkb.pinMedia.result', result.accepted
    ? { accepted: true, reason: null }
    : { accepted: false, reason: result.reason });
  return result;
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
  if (_bound) return;
  // `bind` lives on FKB's JS ALIAS ONLY. A device carrying just the native
  // `FullyKiosk` object has every direct method and none of the event wiring,
  // and this runs at app startup — calling it blind is what blanked the
  // Portal.
  // On the daylight bridge the same `bind` listens for the `daylight:resume`
  // CustomEvent instead, whose detail ({ awayMs, from }) goes into the log.
  const bind = bridgeMethod('bind');
  if (!bind) {
    if (isFKBAvailable()) logger().warn('fkb.bind.unavailable', { event: 'onResume', bridgeKind: bridgeKind() });
    return;
  }
  const onDaylight = bridgeKind() === 'daylight';
  const bound = bind('onResume', (detail) => {
    if (onDaylight && detail) logger().info('fkb.resume', detail);
    else logger().info('fkb.resume');
    if (_onResumeCallback) _onResumeCallback();
  });
  if (bound === false) {
    logger().warn('fkb.bind.unavailable', { event: 'onResume', bridgeKind: bridgeKind() });
    return;
  }
  _bound = true;
}

/**
 * Bind the kiosk's hardware back button to trigger a browser history back.
 * Without this, FKB intercepts the back button and opens its own sidebar
 * instead of passing it to the WebView, and the Android kiosk app keeps the
 * button to itself (back mode 'reload' or 'ignore').
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
  if (_backBound) return;
  // See `onResume` — event binding is alias-only, and this is a startup call.
  // On the daylight bridge `bind` switches the app to back mode 'page' and
  // listens for the `daylight:back` CustomEvent.
  const bind = bridgeMethod('bind');
  if (!bind) {
    if (isFKBAvailable()) logger().warn('fkb.bind.unavailable', { event: 'onBackButton', bridgeKind: bridgeKind() });
    return;
  }
  const bound = bind('onBackButton', () => {
    logger().info('fkb.backButton');
    window.history.back();
  });
  if (bound === false) {
    logger().warn('fkb.bind.unavailable', { event: 'onBackButton', bridgeKind: bridgeKind() });
    return;
  }
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
    const printable = typeof e.key === 'string' && e.key.length === 1;
    log.sampled('fkb.keyCapture', {
      // Never persist typed characters (or their identifying KeyA/Digit1 code).
      key: printable ? '[printable]' : e.key,
      code: printable ? '[printable]' : e.code,
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
