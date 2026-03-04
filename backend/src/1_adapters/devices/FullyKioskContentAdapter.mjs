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
   * @returns {Promise<Object>}
   */
  async prepareForContent() {
    const startTime = Date.now();
    this.#metrics.prepares++;
    const FK_PACKAGE = 'de.ozerov.fully';
    const MAX_FOREGROUND_ATTEMPTS = 5;
    const FOREGROUND_RETRY_MS = 500;

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

      // Force-restart FKB via ADB to guarantee audio services release MIC.
      // Settings are already persisted above, so FKB restarts clean.
      // Non-blocking: log failures but don't abort prepare.
      if (this.#adbAdapter && this.#launchActivity) {
        try {
          const connectResult = await this.#adbAdapter.connect();
          if (connectResult.ok) {
            const stopResult = await this.#adbAdapter.shell('am force-stop de.ozerov.fully');
            this.#logger.info?.('fullykiosk.prepareForContent.adbForceStop', { ok: stopResult.ok });
            coldRestart = true;
            // Brief pause for process to fully terminate
            await new Promise(r => setTimeout(r, 500));
            const launchResult = await this.#adbAdapter.launchActivity(this.#launchActivity);
            this.#logger.info?.('fullykiosk.prepareForContent.adbRelaunch', { ok: launchResult.ok });
          } else {
            this.#logger.warn?.('fullykiosk.prepareForContent.adbRestart.failed', {
              error: connectResult.error || 'ADB connect failed'
            });
          }
        } catch (err) {
          this.#logger.warn?.('fullykiosk.prepareForContent.adbRestart.failed', { error: err.message });
        }
      }

      // Bring to foreground with verification loop
      for (let attempt = 1; attempt <= MAX_FOREGROUND_ATTEMPTS; attempt++) {
        await this.#sendCommand('toForeground');
        await new Promise(r => setTimeout(r, FOREGROUND_RETRY_MS));

        // Verify FK is actually in the foreground
        const info = await this.#sendCommand('getDeviceInfo', { type: 'json' });
        const foreground = info.data?.foreground;

        if (foreground === FK_PACKAGE) {
          this.#logger.info?.('fullykiosk.prepareForContent.foregroundConfirmed', {
            attempt, elapsedMs: Date.now() - startTime
          });

          // Launch companion apps from FKB's foreground context.
          // On Android 11+, apps started by the foreground app inherit
          // foreground privileges (createdFromFg=true), enabling microphone
          // access that background-started services are denied.
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

          // Check if USB camera is available via /dev/video* nodes.
          // After cold restart, the UVC driver may need time to re-enumerate.
          let cameraAvailable = false;
          if (this.#adbAdapter) {
            const MAX_CAMERA_ATTEMPTS = 3;
            const CAMERA_RETRY_MS = 2000;

            for (let camAttempt = 1; camAttempt <= MAX_CAMERA_ATTEMPTS; camAttempt++) {
              const camResult = await this.#adbAdapter.shell('ls /dev/video* 2>/dev/null | wc -l');
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

              if (camAttempt < MAX_CAMERA_ATTEMPTS) {
                await new Promise(r => setTimeout(r, CAMERA_RETRY_MS));
              }
            }
          } else {
            // No ADB adapter — can't check, assume available
            cameraAvailable = true;
          }

          return { ok: true, coldRestart, cameraAvailable, elapsedMs: Date.now() - startTime };
        }

        this.#logger.warn?.('fullykiosk.prepareForContent.notInForeground', {
          attempt, foreground, expected: FK_PACKAGE
        });
      }

      // All attempts exhausted
      this.#logger.error?.('fullykiosk.prepareForContent.foregroundFailed', {
        attempts: MAX_FOREGROUND_ATTEMPTS, elapsedMs: Date.now() - startTime
      });
      return { ok: false, step: 'toForeground', error: 'Could not bring Fully Kiosk to foreground' };
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
   * Load content URL on the device
   * @param {string} path - Path to load
   * @param {Object} [query] - Query parameters
   * @returns {Promise<Object>}
   */
  async load(path, query = {}) {
    const startTime = Date.now();
    this.#metrics.loads++;

    this.#logger.info?.('fullykiosk.load.start', {
      path,
      query,
      daylightHost: this.#daylightHost,
      kioskHost: this.#host,
      kioskPort: this.#port
    });

    try {
      // Build destination URL
      const queryString = new URLSearchParams(query).toString();
      const fullUrl = `${this.#daylightHost}${path}${queryString ? `?${queryString}` : ''}`;

      this.#logger.info?.('fullykiosk.load.builtUrl', { fullUrl });

      // Send load command
      const result = await this.#sendCommand('loadURL', { url: fullUrl });

      if (result.ok) {
        this.#logger.info?.('fullykiosk.load.success', { fullUrl, loadTimeMs: Date.now() - startTime });
        return {
          ok: true,
          url: fullUrl,
          loadTimeMs: Date.now() - startTime
        };
      } else {
        this.#metrics.errors++;
        this.#logger.error?.('fullykiosk.load.failed', { fullUrl, error: result.error, loadTimeMs: Date.now() - startTime });
        return {
          ok: false,
          url: fullUrl,
          error: result.error
        };
      }
    } catch (error) {
      this.#metrics.errors++;
      this.#logger.error?.('fullykiosk.load.exception', { path, error: error.message, stack: error.stack });
      return { ok: false, error: error.message };
    }
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
      const response = await this.#httpClient.get(url);
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
}

export default FullyKioskContentAdapter;
