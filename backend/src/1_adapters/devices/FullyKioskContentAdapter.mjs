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

  /**
   * @param {Object} config
   * @param {string} config.host - Kiosk device IP or hostname
   * @param {number} config.port - Fully Kiosk REST API port (usually 2323)
   * @param {string} config.password - Fully Kiosk remote admin password
   * @param {string} config.daylightHost - Base URL for content loading
   * @param {Object} deps
   * @param {Object} deps.httpClient - HTTP client for API calls
   * @param {Object} [deps.logger]
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

    this.#logger.debug?.('fullykiosk.prepareForContent.start', { host: this.#host, port: this.#port });

    try {
      // Wake screen
      this.#logger.debug?.('fullykiosk.prepareForContent.screenOn.start');
      const screenResult = await this.#sendCommand('screenOn');
      this.#logger.debug?.('fullykiosk.prepareForContent.screenOn.done', { result: screenResult });
      if (!screenResult.ok) {
        this.#logger.error?.('fullykiosk.prepareForContent.screenOn.failed', { error: screenResult.error });
        return { ok: false, step: 'screenOn', error: screenResult.error };
      }

      // Bring to foreground
      this.#logger.debug?.('fullykiosk.prepareForContent.toForeground.start');
      const foregroundResult = await this.#sendCommand('toForeground');
      this.#logger.debug?.('fullykiosk.prepareForContent.toForeground.done', { result: foregroundResult });
      if (!foregroundResult.ok) {
        this.#logger.error?.('fullykiosk.prepareForContent.toForeground.failed', { error: foregroundResult.error });
        return { ok: false, step: 'toForeground', error: foregroundResult.error };
      }

      this.#logger.debug?.('fullykiosk.prepareForContent.success', { elapsedMs: Date.now() - startTime });
      return {
        ok: true,
        elapsedMs: Date.now() - startTime
      };
    } catch (error) {
      this.#metrics.errors++;
      this.#logger.error?.('fullykiosk.prepareForContent.exception', { error: error.message, stack: error.stack });
      return { ok: false, error: error.message };
    }
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
