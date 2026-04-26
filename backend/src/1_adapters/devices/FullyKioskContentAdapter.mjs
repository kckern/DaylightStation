/**
 * FullyKioskContentAdapter - Content control via Fully Kiosk Browser
 *
 * Implements IContentControl port using Fully Kiosk REST API.
 * Handles screenOn, toForeground, and loadURL commands.
 *
 * Note: Fully Kiosk v1.60+ handles screen/app control directly,
 * eliminating the need for Tasker on Shield devices.
 *
 * @module adapters/devices
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { nowTs24 } from '#system/utils/index.mjs';

export class FullyKioskContentAdapter {
  #host;
  #port;
  #password;
  #daylightHost;
  #logger;
  #httpClient;
  #metrics;
  #adbAdapter;
  #launchActivity;
  #companionApps;

  /**
   * @param {Object} config
   * @param {string} config.host - Kiosk device IP or hostname
   * @param {number} config.port - Fully Kiosk REST API port (usually 2323)
   * @param {string} config.password - Fully Kiosk remote admin password
   * @param {string} config.daylightHost - Base URL for content loading
   * @param {string} [config.launchActivity] - Fully qualified activity for ADB re-launch
   * @param {string[]} [config.companionApps] - Android packages to launch via FKB after prepare
   * @param {Object} deps
   * @param {Object} deps.httpClient - HTTP client for API calls
   * @param {Object} [deps.logger]
   * @param {Object} [deps.adbAdapter] - Optional AdbAdapter for force-restart
   */
  constructor(config, deps = {}) {
    if (!deps.httpClient) {
      throw new InfrastructureError('FullyKioskContentAdapter requires httpClient', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'httpClient'
      });
    }

    this.#host = config.host;
    this.#port = config.port;
    this.#password = config.password;
    this.#daylightHost = config.daylightHost;
    this.#logger = deps.logger || console;
    this.#httpClient = deps.httpClient;
    this.#adbAdapter = deps.adbAdapter || null;
    this.#launchActivity = config.launchActivity || null;
    this.#companionApps = config.companionApps || [];

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
   * Prepare device for content loading
   * Wakes screen and brings Fully Kiosk to foreground
   * @param {Object} [options]
   * @param {boolean} [options.skipCameraCheck=false] - Skip the ~4s camera-availability
   *   probe. Set true when the inbound content does not require the camera (e.g.
   *   plex/files playback). See contentRequiresCamera() in the application layer.
   * @returns {Promise<Object>}
   */
  async prepareForContent({ skipCameraCheck = false } = {}) {
    const startTime = Date.now();
    const MAX_PREPARE_MS = 60_000; // Hard ceiling — never stall longer than 60s
    this.#metrics.prepares++;
    const FK_PACKAGE = 'de.ozerov.fully';
    const MAX_FOREGROUND_ATTEMPTS = 15;
    const FOREGROUND_RETRY_MS = 1000;

    /** Check elapsed time and bail if we've exceeded the ceiling. */
    const checkTimeout = (phase) => {
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_PREPARE_MS) {
        this.#logger.warn?.('fullykiosk.prepareForContent.timeout', { phase, elapsedMs: elapsed, maxMs: MAX_PREPARE_MS });
        return true;
      }
      return false;
    };

    this.#logger.debug?.('fullykiosk.prepareForContent.start', { host: this.#host, port: this.#port });

    try {
      let coldRestart = false;

      // Wake screen
      const screenResult = await this.#sendCommand('screenOn');
      if (!screenResult.ok) {
        this.#logger.error?.('fullykiosk.prepareForContent.screenOn.failed', { error: screenResult.error });
        return { ok: false, step: 'screenOn', error: screenResult.error };
      }

      // Disable FKB background services that hold AUDIO_SOURCE_MIC and Camera 0.
      // These cause AudioRecord init failures and PiP windows.
      // Non-blocking: log failures but don't abort prepare.
      for (const setting of ['motionDetection', 'motionDetectionAcoustic', 'acousticScreenOn']) {
        const setResult = await this.#sendCommand('setBooleanSetting', { key: setting, value: 'false' });
        if (setResult.ok) {
          this.#logger.debug?.('fullykiosk.prepareForContent.disableSetting.ok', { setting });
        } else {
          this.#logger.warn?.('fullykiosk.prepareForContent.disableSetting.failed', { setting, error: setResult.error });
        }
      }

      // Pre-connect ADB once for all subsequent operations (companion launch,
      // mic check, camera check, force-restart). Without this, a cold ADB daemon
      // causes cascading 10s timeouts on every shell() call.
      if (this.#adbAdapter) {
        const adbConnect = await this.#adbAdapter.connect();
        if (!adbConnect.ok) {
          this.#logger.warn?.('fullykiosk.prepareForContent.adbPreconnect.failed', { error: adbConnect.error });
        }
      }

      // --- Phase 1: Soft prepare (no force-stop) ---
      const fgResult = await this.#verifyForeground(FK_PACKAGE, MAX_FOREGROUND_ATTEMPTS, FOREGROUND_RETRY_MS, startTime);
      if (!fgResult.ok) {
        return fgResult;
      }

      // Launch companion apps
      if (!checkTimeout('before-companions')) {
        await this.#launchCompanions();
      }

      // Check if mic-blocking FKB services are still running
      const micBlocked = checkTimeout('before-mic-check') ? false : await this.#isMicBlocked();

      if (micBlocked) {
        // --- Phase 2: Force restart needed ---
        this.#logger.info?.('fullykiosk.prepareForContent.micBlocked', { elapsedMs: Date.now() - startTime });

        if (this.#adbAdapter && this.#launchActivity && !checkTimeout('before-force-restart')) {
          try {
            // ADB shell() auto-reconnects on "device not found", no manual connect needed
            const stopResult = await this.#adbAdapter.shell('am force-stop de.ozerov.fully');
            this.#logger.info?.('fullykiosk.prepareForContent.adbForceStop', { ok: stopResult.ok });
            coldRestart = true;

            // Brief pause for process to fully terminate
            await new Promise(r => setTimeout(r, 500));

            const launchResult = await this.#adbAdapter.launchActivity(this.#launchActivity);
            this.#logger.info?.('fullykiosk.prepareForContent.adbRelaunch', { ok: launchResult.ok });

            if (!checkTimeout('before-re-verify')) {
              // Re-verify foreground after restart
              const fgResult2 = await this.#verifyForeground(FK_PACKAGE, MAX_FOREGROUND_ATTEMPTS, FOREGROUND_RETRY_MS, startTime);
              if (!fgResult2.ok) {
                return fgResult2;
              }

              // Re-launch companions with fresh foreground context
              await this.#launchCompanions();
            }
          } catch (err) {
            this.#logger.warn?.('fullykiosk.prepareForContent.adbRestart.failed', { error: err.message });
          }
        }
      } else {
        this.#logger.info?.('fullykiosk.prepareForContent.micClear', { elapsedMs: Date.now() - startTime });
      }

      // Camera check (runs after either phase) — skip if already timed out
      // or if caller opted out via skipCameraCheck (saves ~4s on non-camera flows).
      // cameraAvailable semantics: true = verified present, false = verified
      // missing/unreachable, null = not checked (skipped). The null sentinel is
      // important so downstream consumers can distinguish "we didn't look" from
      // "camera doesn't work" — see WakeAndLoadService propagation.
      let cameraAvailable = false;
      let cameraSkipped = false;
      if (skipCameraCheck) {
        cameraAvailable = null;
        cameraSkipped = true;
        this.#logger.info?.('fullykiosk.prepareForContent.cameraCheck.skipped', {
          reason: 'skipCameraCheck-flag',
        });
      } else if (this.#adbAdapter && !checkTimeout('before-camera-check')) {
        const MAX_CAMERA_ATTEMPTS = 3;
        const CAMERA_RETRY_MS = 2000;

        for (let camAttempt = 1; camAttempt <= MAX_CAMERA_ATTEMPTS; camAttempt++) {
          const camResult = await this.#adbAdapter.shell('ls /dev/camera/video* /dev/video* 2>/dev/null | wc -l');
          const count = parseInt(camResult.output?.trim(), 10) || 0;

          if (count > 0) {
            this.#logger.info?.('fullykiosk.prepareForContent.cameraCheck.passed', {
              attempt: camAttempt, videoDevices: count
            });
            cameraAvailable = true;
            break;
          }

          this.#logger.warn?.('fullykiosk.prepareForContent.cameraCheck.failed', {
            attempt: camAttempt, maxAttempts: MAX_CAMERA_ATTEMPTS
          });

          if (camAttempt < MAX_CAMERA_ATTEMPTS && !checkTimeout('camera-retry')) {
            await new Promise(r => setTimeout(r, CAMERA_RETRY_MS));
          } else {
            break;
          }
        }
      } else {
        cameraAvailable = true;
      }

      return { ok: true, coldRestart, cameraAvailable, cameraSkipped, elapsedMs: Date.now() - startTime };
    } catch (error) {
      this.#metrics.errors++;
      this.#logger.error?.('fullykiosk.prepareForContent.exception', { error: error.message, stack: error.stack });
      return { ok: false, error: error.message };
    }
  }

  /**
   * Reboot the device via ADB
   * @returns {Promise<Object>}
   */
  async reboot() {
    if (!this.#adbAdapter) {
      return { ok: false, error: 'No ADB adapter configured' };
    }

    this.#logger.info?.('fullykiosk.reboot', { host: this.#host });
    const result = await this.#adbAdapter.reboot();

    return {
      ok: result.ok,
      error: result.error,
      hint: result.ok ? 'Device is rebooting. Allow ~60s before reconnecting.' : undefined
    };
  }

  /**
   * Load content URL on the device with retry logic.
   *
   * Retries up to MAX_LOAD_RETRIES times on transient failures (socket hang up,
   * timeout, connection refused) before giving up. Each retry waits with
   * exponential backoff (1s, 2s, 4s).
   *
   * @param {string} path - Path to load
   * @param {Object} [query] - Query parameters
   * @param {Object} [options]
   * @param {boolean} [options.verifyAsync=false] - When true, return `ok` as
   *   soon as `loadURL` is acknowledged and run `#verifyLoadedUrl` as a
   *   fire-and-forget background task that just logs the outcome. Use on the
   *   wake-and-load path where the playback watchdog is the authoritative
   *   confirmation signal — avoids the ~10s `currentUrl` poll that routinely
   *   never matches on Shield TV.
   * @returns {Promise<Object>}
   */
  async load(path, query = {}, { verifyAsync = false } = {}) {
    const MAX_LOAD_RETRIES = 3;
    const startTime = Date.now();
    this.#metrics.loads++;

    this.#logger.info?.('fullykiosk.load.start', {
      path,
      query,
      daylightHost: this.#daylightHost,
      kioskHost: this.#host,
      kioskPort: this.#port
    });

    // Build destination URL
    const queryString = new URLSearchParams(query).toString();
    const fullUrl = `${this.#daylightHost}${path}${queryString ? `?${queryString}` : ''}`;

    this.#logger.info?.('fullykiosk.load.builtUrl', { fullUrl });

    let lastError = null;

    for (let attempt = 1; attempt <= MAX_LOAD_RETRIES; attempt++) {
      try {
        const result = await this.#sendCommand('loadURL', { url: fullUrl });

        if (result.ok) {
          this.#logger.info?.('fullykiosk.load.acknowledged', {
            fullUrl,
            attempt,
            loadTimeMs: Date.now() - startTime
          });

          // verifyAsync: fire-and-forget the verification poll, return on ack.
          // Used by the wake-and-load FKB-fallback path where the playback
          // watchdog is the real "user is seeing media" signal.
          if (verifyAsync) {
            this.#verifyLoadedUrl(fullUrl).then(
              (verifyResult) => {
                // Flat shape so dashboards can filter on verified/currentUrl
                // without digging into a nested object. async-unverified is a
                // warn so a perpetually-failing FKB stays visible.
                const isVerified = verifyResult?.verified === true;
                const event = isVerified
                  ? 'fullykiosk.load.async-verified'
                  : 'fullykiosk.load.async-unverified';
                const level = isVerified ? 'info' : 'warn';
                this.#logger[level]?.(event, {
                  fullUrl,
                  verified: isVerified,
                  currentUrl: verifyResult?.currentUrl,
                  reason: verifyResult?.reason,
                });
              },
              (err) => {
                this.#logger.warn?.('fullykiosk.load.async-verify-failed', {
                  fullUrl, error: err?.message
                });
              }
            );
            return {
              ok: true,
              url: fullUrl,
              attempt,
              verified: 'async',
              loadTimeMs: Date.now() - startTime
            };
          }

          // Verify the WebView actually navigated. FKB acknowledges loadURL on
          // receipt, not on completion — poll currentUrl to confirm.
          const verification = await this.#verifyLoadedUrl(fullUrl);

          if (verification.verified) {
            this.#logger.info?.('fullykiosk.load.success', {
              fullUrl,
              attempt,
              loadTimeMs: Date.now() - startTime,
              verified: true
            });
            return {
              ok: true,
              url: fullUrl,
              attempt,
              verified: true,
              loadTimeMs: Date.now() - startTime
            };
          }

          // If FKB reports currentUrl as undefined but the command was accepted,
          // treat as unverified success (don't block playback on a known FKB quirk).
          if (verification.currentUrl == null) {
            this.#logger.warn?.('fullykiosk.load.unverified', {
              fullUrl,
              reason: verification.reason,
              loadTimeMs: Date.now() - startTime
            });
            return {
              ok: true,
              url: fullUrl,
              attempt,
              verified: false,
              loadTimeMs: Date.now() - startTime,
              warning: 'FKB did not report currentUrl'
            };
          }

          // Real mismatch — FKB was reachable but the WebView is showing a different
          // page. Fall through to retry (the original incident was resolved by a
          // subsequent loadURL getting through).
          lastError = `URL mismatch: got ${verification.currentUrl}, expected ${fullUrl}`;
          this.#logger.warn?.('fullykiosk.load.urlMismatch', {
            fullUrl,
            actualUrl: verification.currentUrl,
            attempt,
            loadTimeMs: Date.now() - startTime
          });
          // Continue retry loop via natural fall-through (no break / no return)
        } else {
          lastError = result.error;
          this.#logger.warn?.('fullykiosk.load.attemptFailed', {
            fullUrl, attempt, maxRetries: MAX_LOAD_RETRIES, error: result.error
          });
        }
      } catch (error) {
        lastError = error.message;
        this.#logger.warn?.('fullykiosk.load.attemptException', {
          fullUrl, attempt, maxRetries: MAX_LOAD_RETRIES, error: error.message
        });
      }

      // Exponential backoff before retry (1s, 2s, 4s)
      if (attempt < MAX_LOAD_RETRIES) {
        const backoffMs = 1000 * Math.pow(2, attempt - 1);
        this.#logger.info?.('fullykiosk.load.retrying', { attempt, nextAttempt: attempt + 1, backoffMs });
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    // All retries exhausted
    this.#metrics.errors++;
    this.#logger.error?.('fullykiosk.load.failed', {
      fullUrl,
      error: lastError,
      attempts: MAX_LOAD_RETRIES,
      loadTimeMs: Date.now() - startTime
    });
    return {
      ok: false,
      url: fullUrl,
      error: lastError,
      attempts: MAX_LOAD_RETRIES
    };
  }

  /**
   * Navigate FKB to its configured Start URL.
   *
   * Sends FKB's `loadStartURL` REST command, which returns the WebView to
   * whatever the user has configured as the kiosk Start URL. Used to "clear"
   * the screen back to the kiosk home state without waking or rebooting the
   * device.
   *
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async loadStartUrl() {
    this.#logger.info?.('fullykiosk.loadStartUrl.start', { host: this.#host });
    const result = await this.#sendCommand('loadStartURL');
    if (!result.ok) {
      this.#logger.warn?.('fullykiosk.loadStartUrl.failed', { error: result.error });
      return { ok: false, error: result.error || 'loadStartURL failed' };
    }
    return { ok: true };
  }

  /**
   * Get content control status
   * @returns {Promise<Object>}
   */
  async getStatus() {
    try {
      const result = await this.#sendCommand('getDeviceInfo');

      if (result.ok) {
        const data = result.data;
        return {
          ready: true,
          provider: 'fully-kiosk',
          currentUrl: data?.currentUrl,
          screenOn: data?.isScreenOn,
          appVersion: data?.appVersion
        };
      }

      return {
        ready: false,
        provider: 'fully-kiosk',
        error: result.error
      };
    } catch (error) {
      return {
        ready: false,
        provider: 'fully-kiosk',
        error: error.message
      };
    }
  }

  /**
   * Get adapter metrics
   * @returns {Object}
   */
  getMetrics() {
    return {
      provider: 'fully-kiosk',
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

  /**
   * Send command to Fully Kiosk REST API
   * @private
   */
  async #sendCommand(cmd, params = {}) {
    const queryParams = new URLSearchParams({
      cmd,
      password: this.#password,
      type: 'json',
      ...params
    });

    // Log URL without password for security
    const logParams = { ...params };
    const url = `http://${this.#host}:${this.#port}/?${queryParams}`;
    const logUrl = `http://${this.#host}:${this.#port}/?cmd=${cmd}&password=***${Object.keys(logParams).length ? '&' + new URLSearchParams(logParams) : ''}`;

    this.#metrics.lastRequestAt = nowTs24();
    const startTime = Date.now();

    this.#logger.debug?.('fullykiosk.sendCommand.start', { cmd, host: this.#host, port: this.#port, params: logParams, logUrl });

    try {
      const response = await this.#httpClient.get(url, { timeout: 10_000 });
      const elapsedMs = Date.now() - startTime;

      this.#logger.debug?.('fullykiosk.sendCommand.response', {
        cmd,
        status: response.status,
        statusText: response.statusText,
        hasData: !!response.data,
        dataType: typeof response.data,
        elapsedMs
      });

      // axios uses response.status, not response.ok
      if (response.status >= 200 && response.status < 300) {
        let data = response.data;

        // Parse JSON if string
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch {
            // Keep as string if not valid JSON
          }
        }

        this.#logger.debug?.('fullykiosk.sendCommand.success', { cmd, elapsedMs });
        return { ok: true, data };
      } else {
        this.#logger.warn?.('fullykiosk.sendCommand.httpError', { cmd, status: response.status, elapsedMs });
        return { ok: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      const elapsedMs = Date.now() - startTime;
      this.#logger.error?.('fullykiosk.sendCommand.error', {
        cmd,
        error: error.message,
        code: error.code,
        host: this.#host,
        port: this.#port,
        elapsedMs
      });
      return { ok: false, error: error.message };
    }
  }

  /**
   * Bring FKB to foreground and verify via polling loop.
   * @private
   * @param {string} fkPackage - Expected foreground package name
   * @param {number} maxAttempts - Maximum verification attempts
   * @param {number} retryMs - Delay between attempts in ms
   * @param {number} startTime - Start time for elapsed logging
   * @returns {Promise<{ok: boolean, step?: string, error?: string}>}
   */
  async #verifyForeground(fkPackage, maxAttempts, retryMs, startTime) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.#sendCommand('toForeground');
      await new Promise(r => setTimeout(r, retryMs));

      const info = await this.#sendCommand('getDeviceInfo', { type: 'json' });
      const foreground = info.data?.foreground;

      if (foreground === fkPackage) {
        this.#logger.info?.('fullykiosk.prepareForContent.foregroundConfirmed', {
          attempt, elapsedMs: Date.now() - startTime
        });
        return { ok: true };
      }

      this.#logger.warn?.('fullykiosk.prepareForContent.notInForeground', {
        attempt, foreground, expected: fkPackage
      });
    }

    this.#logger.error?.('fullykiosk.prepareForContent.foregroundFailed', {
      attempts: maxAttempts, elapsedMs: Date.now() - startTime
    });
    return { ok: false, step: 'toForeground', error: 'Could not bring Fully Kiosk to foreground' };
  }

  /**
   * Launch companion apps from FKB's foreground context.
   * On Android 11+, apps started by the foreground app inherit
   * foreground privileges (createdFromFg=true), enabling microphone
   * access that background-started services are denied.
   * @private
   */
  async #launchCompanions() {
    for (const pkg of this.#companionApps) {
      // Force-stop first so the app's Activity recreates the service
      // with fresh foreground context (restarting over a BootReceiver
      // instance that has createdFromFg=false).
      if (this.#adbAdapter) {
        try {
          await this.#adbAdapter.shell(`am force-stop ${pkg}`);
          await new Promise(r => setTimeout(r, 300));
        } catch (err) {
          this.#logger.debug?.('fullykiosk.prepareForContent.companionForceStop.failed', { pkg, error: err.message });
        }
      }
      const appResult = await this.#sendCommand('startApplication', { package: pkg });
      this.#logger.info?.('fullykiosk.prepareForContent.companionApp', { pkg, ok: appResult.ok });
    }
  }

  /**
   * Poll FKB deviceInfo.currentUrl until it matches the expected URL.
   * FKB's loadURL REST call is fire-and-forget — HTTP 200 means "received",
   * not "rendered". This closes the verification gap.
   *
   * Returns:
   *   { verified: true }                    — currentUrl matched within budget
   *   { verified: false, reason: '...' }    — timed out or never set
   *
   * @private
   * @param {string} expectedUrl - URL passed to loadURL
   * @param {Object} [opts]
   * @param {number} [opts.timeoutMs=10000] - Total poll budget
   * @param {number} [opts.intervalMs=500]  - Delay between polls
   * @returns {Promise<{verified: boolean, currentUrl?: string, reason?: string}>}
   */
  async #verifyLoadedUrl(expectedUrl, { timeoutMs = 10_000, intervalMs = 500 } = {}) {
    const normalize = (url) => {
      if (typeof url !== 'string') return null;
      let normalized = url.trim();
      try {
        // Decode percent-encoding so queue=plex%3A1 and queue=plex:1 compare equal.
        // FKB often reports currentUrl with URL params decoded.
        normalized = decodeURIComponent(normalized);
      } catch {
        // Malformed encoding — use original
      }
      return normalized.replace(/\/$/, '').toLowerCase();
    };
    const target = normalize(expectedUrl);
    const deadline = Date.now() + timeoutMs;
    let lastSeen = null;

    while (Date.now() < deadline) {
      const info = await this.#sendCommand('getDeviceInfo');
      if (info.ok) {
        const current = info.data?.currentUrl;
        lastSeen = current;
        if (current && normalize(current) === target) {
          return { verified: true, currentUrl: current };
        }
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }

    return {
      verified: false,
      currentUrl: lastSeen,
      reason: lastSeen == null ? 'currentUrl never populated' : 'currentUrl did not match'
    };
  }

  /**
   * Check if FKB background services are holding mic/camera resources.
   * Uses ADB dumpsys to inspect running services for known problematic ones.
   * @private
   * @returns {Promise<boolean>} true if mic-blocking services are detected
   */
  async #isMicBlocked() {
    if (!this.#adbAdapter) return false;

    try {
      const result = await this.#adbAdapter.shell('dumpsys activity services de.ozerov.fully');
      if (!result.ok) {
        this.#logger.warn?.('fullykiosk.isMicBlocked.dumpsysFailed', { error: result.error });
        return false;
      }

      const output = result.output || '';
      const blocked = output.includes('SoundMeterService') || output.includes('MotionDetectorService');
      this.#logger.info?.('fullykiosk.isMicBlocked.result', { blocked, outputLength: output.length });
      return blocked;
    } catch (err) {
      this.#logger.warn?.('fullykiosk.isMicBlocked.error', { error: err.message });
      return false;
    }
  }
}

export default FullyKioskContentAdapter;
