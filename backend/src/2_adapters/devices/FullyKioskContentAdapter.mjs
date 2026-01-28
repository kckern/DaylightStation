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

    try {
      // Wake screen
      const screenResult = await this.#sendCommand('screenOn');
      if (!screenResult.ok) {
        return { ok: false, step: 'screenOn', error: screenResult.error };
      }

      // Bring to foreground
      const foregroundResult = await this.#sendCommand('toForeground');
      if (!foregroundResult.ok) {
        return { ok: false, step: 'toForeground', error: foregroundResult.error };
      }

      return {
        ok: true,
        elapsedMs: Date.now() - startTime
      };
    } catch (error) {
      this.#metrics.errors++;
      this.#logger.error?.('fullykiosk.prepareForContent.error', { error: error.message });
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

    try {
      // Build destination URL
      const queryString = new URLSearchParams(query).toString();
      const fullUrl = `${this.#daylightHost}${path}${queryString ? `?${queryString}` : ''}`;

      this.#logger.info?.('fullykiosk.load', { path, query, fullUrl });

      // Send load command
      const result = await this.#sendCommand('loadURL', { url: fullUrl });

      if (result.ok) {
        return {
          ok: true,
          url: fullUrl,
          loadTimeMs: Date.now() - startTime
        };
      } else {
        this.#metrics.errors++;
        return {
          ok: false,
          url: fullUrl,
          error: result.error
        };
      }
    } catch (error) {
      this.#metrics.errors++;
      this.#logger.error?.('fullykiosk.load.error', { path, error: error.message });
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

    const url = `http://${this.#host}:${this.#port}/?${queryParams}`;
    this.#metrics.lastRequestAt = nowTs24();

    try {
      const response = await this.#httpClient.get(url);

      if (response.ok) {
        let data = response.data;

        // Parse JSON if string
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch {
            // Keep as string if not valid JSON
          }
        }

        return { ok: true, data };
      } else {
        return { ok: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      this.#logger.error?.('fullykiosk.command.error', { cmd, error: error.message });
      return { ok: false, error: error.message };
    }
  }
}

export default FullyKioskContentAdapter;
