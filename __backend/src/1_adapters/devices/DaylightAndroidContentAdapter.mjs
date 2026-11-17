/**
 * DaylightAndroidContentAdapter - Content control via the DaylightStation
 * Android kiosk app.
 *
 * Implements IContentControl against the app's control API. It exposes the
 * same public surface as FullyKioskContentAdapter and the same result fields,
 * so a device moves between the two by changing `content_control.provider`.
 *
 * Where it differs from the Fully adapter, it is because the app can answer
 * questions Fully cannot:
 *   - `POST /kiosk/load` answers after the page's main frame has finished, so
 *     a plain load needs no verification. A caller that cannot wait passes
 *     `verifyAsync`: the load is sent with `wait:false`, returns on the
 *     acknowledgement, and the outcome is read from `lastLoad` afterwards.
 *   - `POST /kiosk/foreground` answers after the app has checked it is in
 *     front, so there is no foreground polling loop.
 *   - The helpers Fully needed as companion apps live inside the app, so there
 *     are no companions to relaunch and no ADB force-restart.
 *
 * Contract: ops:docs/superpowers/specs/2026-11-16-daylight-android-control-api.md
 *
 * @module adapters/devices
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { nowTs24 } from '#system/utils/index.mjs';

import { IContentControl } from '#apps/devices/ports/IContentControl.mjs';
import { DaylightAndroidRestClient } from './DaylightAndroidRestClient.mjs';

const PROVIDER = 'daylight-android';
const MIC_CAPABILITY = 'mic-bridge';

/**
 * The device waits up to `webview.loadTimeoutSec` (default 20) for the page.
 * The request has to outlast that, or a slow page reads as a dead device.
 */
const LOAD_REQUEST_TIMEOUT_MS = 30_000;
const MAX_LOAD_ATTEMPTS = 3;
/** Async verification: poll `lastLoad` for a little longer than the device waits. */
const VERIFY_POLL_MS = 500;
const VERIFY_MAX_POLLS = 50;
const MAX_CAMERA_ATTEMPTS = 3;
const CAMERA_RETRY_MS = 2000;

export class DaylightAndroidContentAdapter extends IContentControl {
  #host;
  #port;
  #daylightHost;
  #logger;
  #restClient;
  #metrics;
  #adbAdapter;
  #sleep;

  /**
   * @param {Object} config
   * @param {string} config.host - Kiosk device address
   * @param {number} [config.port] - Control API port
   * @param {string} config.token - Control API token for this device
   * @param {string} config.daylightHost - Base URL for content loading
   * @param {Object} deps
   * @param {Object} deps.httpClient - HTTP client with get, post and delete
   * @param {Object} [deps.restClient] - Prebuilt client (tests)
   * @param {Object} [deps.logger]
   * @param {Object} [deps.adbAdapter] - Optional AdbAdapter: camera probe, reboot fallback
   * @param {Function} [deps.sleep] - Delay function (tests)
   */
  constructor(config = {}, deps = {}) {
    super();
    if (!deps.httpClient && !deps.restClient) {
      throw new InfrastructureError('DaylightAndroidContentAdapter requires httpClient', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'httpClient'
      });
    }

    this.#host = config.host;
    this.#port = config.port;
    this.#daylightHost = config.daylightHost;
    this.#logger = deps.logger || console;
    this.#restClient = deps.restClient || new DaylightAndroidRestClient({
      host: config.host,
      port: config.port,
      token: config.token,
    }, {
      httpClient: deps.httpClient,
      logger: this.#logger,
    });
    this.#adbAdapter = deps.adbAdapter || null;
    this.#sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));

    this.#metrics = {
      startedAt: Date.now(),
      loads: 0,
      prepares: 0,
      errors: 0,
      lastRequestAt: null
    };
  }

  // =============================================================================
  // IContentControl Implementation
  // =============================================================================

  /**
   * Prepare the device for content: wake the screen, bring the kiosk to the
   * front, and for the `full` profile make sure the mic bridge has the mic and
   * the camera is present.
   *
   * @param {Object} [options]
   * @param {boolean} [options.skipCameraCheck=false] - Skip the camera probe
   *   when the inbound content does not need the camera.
   * @param {'full'|'broadcast'} [options.profile='full'] - `broadcast` wakes
   *   and foregrounds only, for a widget that is already mounted.
   * @returns {Promise<Object>}
   */
  async prepareForContent({ skipCameraCheck = false, profile = 'full' } = {}) {
    const startTime = Date.now();
    this.#metrics.prepares++;
    this.#logger.debug?.('daylightandroid.prepareForContent.start', { host: this.#host, port: this.#port, profile });

    try {
      const screen = await this.#setScreen(true);
      if (!screen.ok) {
        this.#logger.error?.('daylightandroid.prepareForContent.screenOn.failed', { error: screen.error });
        return { ok: false, step: 'screenOn', error: screen.error };
      }

      // The route answers after the app has verified it is in front, so one
      // request replaces the Fully adapter's foreground-and-poll loop.
      const foreground = await this.#post('/kiosk/foreground');
      if (!foreground.ok) {
        const error = foreground.code === 'AUTH_REJECTED'
          ? `Kiosk app rejected credentials: ${foreground.error}`
          : foreground.error;
        this.#logger.error?.('daylightandroid.prepareForContent.foreground.failed', { code: foreground.code, error });
        return { ok: false, step: 'toForeground', error, ...(profile === 'broadcast' ? { profile } : {}) };
      }

      if (profile === 'broadcast') {
        const elapsedMs = Date.now() - startTime;
        this.#logger.info?.('daylightandroid.prepareForContent.broadcastReady', { elapsedMs });
        return {
          ok: true,
          profile,
          coldRestart: false,
          cameraAvailable: null,
          cameraSkipped: true,
          foregroundVerified: true,
          elapsedMs,
        };
      }

      const mic = await this.#ensureMic({ event: 'daylightandroid.prepareForContent' });

      // Camera check. cameraAvailable: true = present, false = missing or
      // unreachable, null = not checked. The probe runs on the host over ADB
      // and does not involve the kiosk app.
      let cameraAvailable = false;
      let cameraSkipped = false;
      if (skipCameraCheck) {
        cameraAvailable = null;
        cameraSkipped = true;
        this.#logger.info?.('daylightandroid.prepareForContent.cameraCheck.skipped', {
          reason: 'skipCameraCheck-flag',
        });
      } else if (this.#adbAdapter) {
        cameraAvailable = await this.#probeCamera();
      } else {
        cameraAvailable = true;
      }

      return {
        ok: true,
        coldRestart: false,
        cameraAvailable,
        cameraSkipped,
        micRestarted: mic.restarted,
        elapsedMs: Date.now() - startTime,
      };
    } catch (error) {
      this.#metrics.errors++;
      this.#logger.error?.('daylightandroid.prepareForContent.exception', { error: error.message, stack: error.stack });
      return { ok: false, error: error.message };
    }
  }

  /**
   * Reboot the device. The app can only do this as device owner; when it says
   * it cannot (or does not answer) and ADB is configured, ADB does it.
   * @returns {Promise<Object>}
   */
  async reboot() {
    this.#logger.info?.('daylightandroid.reboot', { host: this.#host, via: 'app' });
    const result = await this.#post('/device/reboot');
    if (result.ok) {
      return { ok: true, data: result.data, hint: 'Device is rebooting. Allow ~60s before reconnecting.' };
    }

    if (this.#adbAdapter) {
      this.#logger.info?.('daylightandroid.reboot', { host: this.#host, via: 'adb', after: result.code });
      const adbResult = await this.#adbAdapter.reboot();
      return {
        ok: adbResult.ok,
        error: adbResult.error,
        hint: adbResult.ok ? 'Device is rebooting. Allow ~60s before reconnecting.' : undefined
      };
    }

    this.#logger.warn?.('daylightandroid.reboot.failed', { code: result.code, error: result.error });
    return { ok: false, error: result.error || 'reboot failed' };
  }

  /**
   * Load a content URL on the device.
   *
   * By default the device answers once the page's main frame has finished
   * loading, so a success is a confirmed load (`verified: true`). Only an
   * unreachable device is retried (1s, then 2s): a refusal or a failed page
   * load would fail the same way again.
   *
   * @param {string} path - Path to load
   * @param {Object} [query] - Query parameters
   * @param {Object} [options]
   * @param {boolean} [options.verifyAsync=false] - When true, send the load
   *   with `wait:false`, return `ok` as soon as the device acknowledges it
   *   (`verified: 'async'`), and check the outcome in the background, where it
   *   is only logged. Used on the wake-and-load path, where the playback
   *   watchdog is the authoritative confirmation and the caller must not sit
   *   through a page load.
   * @returns {Promise<Object>}
   */
  async load(path, query = {}, { verifyAsync = false } = {}) {
    const startTime = Date.now();
    this.#metrics.loads++;

    const queryString = new URLSearchParams(query).toString();
    const fullUrl = `${this.#daylightHost}${path}${queryString ? `?${queryString}` : ''}`;
    this.#logger.info?.('daylightandroid.load.start', { path, query, fullUrl, kioskHost: this.#host });

    let lastError = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt++) {
      attempts = attempt;
      const result = verifyAsync
        ? await this.#post('/kiosk/load', { url: fullUrl, wait: false })
        : await this.#post('/kiosk/load', { url: fullUrl }, { timeout: LOAD_REQUEST_TIMEOUT_MS });
      if (result.ok && verifyAsync) {
        this.#logger.info?.('daylightandroid.load.acknowledged', {
          fullUrl, attempt, loadTimeMs: Date.now() - startTime,
        });
        // Fire-and-forget: the outcome is logged, never returned. Flat shape so
        // dashboards can filter on verified/currentUrl; unverified is a warn so
        // a kiosk that keeps failing its loads stays visible.
        this.#verifyLastLoad(fullUrl).then(
          (verification) => {
            const isVerified = verification?.verified === true;
            this.#logger[isVerified ? 'info' : 'warn']?.(
              isVerified ? 'daylightandroid.load.async-verified' : 'daylightandroid.load.async-unverified',
              {
                fullUrl,
                verified: isVerified,
                currentUrl: verification?.currentUrl,
                reason: verification?.reason,
              },
            );
          },
          (err) => {
            this.#logger.warn?.('daylightandroid.load.async-verify-failed', { fullUrl, error: err?.message });
          },
        );
        return { ok: true, url: fullUrl, attempt, verified: 'async', loadTimeMs: Date.now() - startTime };
      }
      if (result.ok) {
        const loadTimeMs = Date.now() - startTime;
        this.#logger.info?.('daylightandroid.load.success', {
          fullUrl, attempt, loadTimeMs, deviceLoadTimeMs: result.data?.loadTimeMs,
        });
        return { ok: true, url: fullUrl, attempt, verified: true, loadTimeMs };
      }

      lastError = result.error;
      this.#logger.warn?.('daylightandroid.load.attemptFailed', {
        fullUrl, attempt, maxAttempts: MAX_LOAD_ATTEMPTS, code: result.code, error: result.error,
      });
      if (result.code !== 'UNREACHABLE' || attempt === MAX_LOAD_ATTEMPTS) break;

      const backoffMs = 1000 * Math.pow(2, attempt - 1);
      this.#logger.info?.('daylightandroid.load.retrying', { attempt, nextAttempt: attempt + 1, backoffMs });
      await this.#sleep(backoffMs);
    }

    this.#metrics.errors++;
    this.#logger.error?.('daylightandroid.load.failed', {
      fullUrl, error: lastError, attempts, loadTimeMs: Date.now() - startTime,
    });
    return { ok: false, url: fullUrl, error: lastError, attempts };
  }

  /**
   * Return the WebView to the configured start URL.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async loadStartUrl() {
    this.#logger.info?.('daylightandroid.loadStartUrl.start', { host: this.#host });
    const result = await this.#post('/kiosk/load-start', {}, { timeout: LOAD_REQUEST_TIMEOUT_MS });
    if (!result.ok) {
      this.#logger.warn?.('daylightandroid.loadStartUrl.failed', { code: result.code, error: result.error });
      return { ok: false, error: result.error || 'load-start failed' };
    }
    return { ok: true };
  }

  /**
   * Turn the display on. Display only; the WebView keeps running.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async screenOn() {
    this.#logger.debug?.('daylightandroid.screenOn.start', { host: this.#host });
    const result = await this.#setScreen(true);
    if (!result.ok) this.#logger.warn?.('daylightandroid.screenOn.failed', { error: result.error });
    return result;
  }

  /**
   * Turn the display off. Display only; the WebView keeps running.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async screenOff() {
    this.#logger.debug?.('daylightandroid.screenOff.start', { host: this.#host });
    const result = await this.#setScreen(false);
    if (!result.ok) this.#logger.warn?.('daylightandroid.screenOff.failed', { error: result.error });
    return result;
  }

  /**
   * Get content control status.
   *
   * `ready` is the app's own word on whether its WebView can take a load. The
   * app version (the shell's version name, or the payload version when the
   * shell reports none) lives on the core `/status` route and is read
   * alongside; a failure there leaves `appVersion` undefined and does not
   * affect the rest.
   * @returns {Promise<Object>}
   */
  async getStatus() {
    try {
      const [kiosk, core] = await Promise.all([
        this.#get('/kiosk/status'),
        this.#get('/status'),
      ]);

      if (!kiosk.ok) {
        return { ready: false, provider: PROVIDER, error: kiosk.error };
      }
      return {
        ready: kiosk.data?.ready === true,
        provider: PROVIDER,
        currentUrl: kiosk.data?.currentUrl,
        screenOn: kiosk.data?.screenOn,
        appVersion: core.ok ? (core.data?.appVersion ?? core.data?.payloadVersion) : undefined,
      };
    } catch (error) {
      return { ready: false, provider: PROVIDER, error: error.message };
    }
  }

  /**
   * Heal the mic bridge on demand. The bridge is part of the kiosk app, so
   * healing is a restart of the bridge when another process holds the mic, or
   * whenever `force` is set. Returns `companions: []` because callers of the
   * Fully adapter read that field; this app has no companion apps.
   *
   * @param {Object} [opts]
   * @param {boolean} [opts.force=false] - Restart even when the mic is free.
   * @returns {Promise<{ok: boolean, companions: Array, micRestarted?: boolean, reason?: string, error?: string}>}
   */
  async healAudioBridge({ force = false } = {}) {
    const mic = await this.#ensureMic({ event: 'daylightandroid.healAudioBridge', force });
    if (!mic.supported) {
      return { ok: mic.error === undefined, companions: [], reason: mic.error ? 'capabilities-unreadable' : 'no-mic-bridge', ...(mic.error ? { error: mic.error } : {}) };
    }
    return {
      ok: mic.error === undefined,
      companions: [],
      micRestarted: mic.restarted,
      ...(mic.error ? { error: mic.error } : {}),
    };
  }

  /**
   * Get adapter metrics
   * @returns {Object}
   */
  getMetrics() {
    return {
      provider: PROVIDER,
      host: this.#host,
      uptime: Date.now() - this.#metrics.startedAt,
      loads: this.#metrics.loads,
      prepares: this.#metrics.prepares,
      errors: this.#metrics.errors,
      lastRequestAt: this.#metrics.lastRequestAt
    };
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  #get(route, options) {
    this.#metrics.lastRequestAt = nowTs24();
    return this.#restClient.get(route, options);
  }

  #post(route, body = {}, options) {
    this.#metrics.lastRequestAt = nowTs24();
    return this.#restClient.post(route, body, options);
  }

  /**
   * After a `wait:false` load, read the outcome from `lastLoad` in
   * `/kiosk/status`.
   *
   * Returns:
   *   { verified: true, currentUrl }           - lastLoad reports this URL loaded
   *   { verified: false, currentUrl, reason }  - it failed, or never showed up
   *
   * @private
   * @param {string} expectedUrl - URL passed to /kiosk/load
   * @returns {Promise<{verified: boolean, currentUrl?: string, reason?: string}>}
   */
  async #verifyLastLoad(expectedUrl) {
    const normalize = (url) => {
      if (typeof url !== 'string') return null;
      let normalized = url.trim();
      try {
        // Decode so queue=plex%3A1 and queue=plex:1 compare equal.
        normalized = decodeURIComponent(normalized);
      } catch {
        // Malformed encoding: compare as given.
      }
      return normalized.replace(/\/$/, '').toLowerCase();
    };
    const target = normalize(expectedUrl);
    let currentUrl;

    for (let poll = 1; poll <= VERIFY_MAX_POLLS; poll++) {
      const status = await this.#get('/kiosk/status');
      if (status.ok) {
        currentUrl = status.data?.currentUrl;
        const lastLoad = status.data?.lastLoad;
        if (lastLoad && typeof lastLoad.ok === 'boolean' && normalize(lastLoad.url) === target) {
          return lastLoad.ok
            ? { verified: true, currentUrl }
            : { verified: false, currentUrl, reason: lastLoad.error || 'load failed' };
        }
      }
      if (poll < VERIFY_MAX_POLLS) await this.#sleep(VERIFY_POLL_MS);
    }
    return { verified: false, currentUrl, reason: 'lastLoad never reported this URL' };
  }

  /**
   * Set the display state and check what the device read back.
   * @private
   */
  async #setScreen(on) {
    const result = await this.#post('/screen', { on });
    if (!result.ok) return { ok: false, error: result.error || `screen ${on ? 'on' : 'off'} failed` };
    const reported = result.data?.screenOn;
    if (typeof reported === 'boolean' && reported !== on) {
      return { ok: false, error: `Screen is still ${reported ? 'on' : 'off'} after the request` };
    }
    return { ok: true };
  }

  /**
   * On a device with the mic bridge, restart the bridge when another process
   * holds the mic (or when forced). Never throws and never fails a prepare:
   * the outcome is logged and returned.
   * @private
   * @returns {Promise<{supported: boolean, restarted: boolean, error?: string}>}
   */
  async #ensureMic({ event, force = false }) {
    const capabilities = await this.#get('/capabilities');
    if (!capabilities.ok) {
      this.#logger.warn?.(`${event}.capabilities.failed`, { code: capabilities.code, error: capabilities.error });
      return { supported: false, restarted: false, error: capabilities.error };
    }
    const list = capabilities.data?.capabilities;
    if (!Array.isArray(list) || !list.includes(MIC_CAPABILITY)) {
      return { supported: false, restarted: false };
    }

    const status = await this.#get('/mic/status');
    if (!status.ok) {
      this.#logger.warn?.(`${event}.micStatus.failed`, { code: status.code, error: status.error });
      if (!force) return { supported: true, restarted: false, error: status.error };
    }
    const heldByOther = status.ok && status.data?.heldByOther === true;
    if (!heldByOther && !force) {
      this.#logger.info?.(`${event}.micClear`, {});
      return { supported: true, restarted: false };
    }

    const restart = await this.#post('/mic/restart');
    if (!restart.ok) {
      this.#logger.warn?.(`${event}.micRestart.failed`, { code: restart.code, error: restart.error });
      return { supported: true, restarted: false, error: restart.error };
    }
    this.#logger.info?.(`${event}.micRestarted`, { heldByOther, force });
    return { supported: true, restarted: true };
  }

  /**
   * Count video device nodes over ADB, as the Fully adapter does.
   * @private
   * @returns {Promise<boolean>}
   */
  async #probeCamera() {
    const connect = await this.#adbAdapter.connect?.();
    if (connect && !connect.ok) {
      this.#logger.warn?.('daylightandroid.prepareForContent.adbPreconnect.failed', { error: connect.error });
    }

    for (let attempt = 1; attempt <= MAX_CAMERA_ATTEMPTS; attempt++) {
      const result = await this.#adbAdapter.shell('ls /dev/camera/video* /dev/video* 2>/dev/null | wc -l');
      const count = parseInt(result?.output?.trim(), 10) || 0;
      if (count > 0) {
        this.#logger.info?.('daylightandroid.prepareForContent.cameraCheck.passed', { attempt, videoDevices: count });
        return true;
      }
      this.#logger.warn?.('daylightandroid.prepareForContent.cameraCheck.failed', {
        attempt, maxAttempts: MAX_CAMERA_ATTEMPTS,
      });
      if (attempt < MAX_CAMERA_ATTEMPTS) await this.#sleep(CAMERA_RETRY_MS);
    }
    return false;
  }
}

export default DaylightAndroidContentAdapter;
