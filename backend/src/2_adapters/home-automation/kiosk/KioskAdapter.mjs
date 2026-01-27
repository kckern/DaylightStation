/**
 * KioskAdapter - Fully Kiosk Browser control adapter
 *
 * Provides control over Android devices running Fully Kiosk Browser.
 * Handles URL loading, waiting for kiosk readiness, and screen control.
 *
 * @module adapters/home-automation/kiosk
 */

/**
 * @typedef {Object} KioskLoadResult
 * @property {boolean} ok - Whether operation succeeded
 * @property {string} [url] - URL that was loaded
 * @property {number} [waitTimeMs] - Time waiting for kiosk to be ready
 * @property {number} [loadTimeMs] - Time to load URL
 * @property {number} [totalTimeMs] - Total operation time
 * @property {string} [error] - Error message if failed
 */

import { nowTs24 } from '#system/utils/index.mjs';

export class KioskAdapter {
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
   * @param {string} config.daylightHost - Base URL of Daylight app for the kiosk
   * @param {Object} deps
   * @param {import('#system/services/HttpClient.mjs').HttpClient} deps.httpClient
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor(config, deps = {}) {
    if (!deps.httpClient) {
      throw new Error('KioskAdapter requires httpClient');
    }
    this.#host = config.host;
    this.#port = config.port;
    this.#password = config.password;
    this.#daylightHost = config.daylightHost;
    this.#logger = deps.logger || console;
    this.#httpClient = deps.httpClient;

    this.#metrics = {
      startedAt: Date.now(),
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      lastRequestAt: null
    };
  }

  // =============================================================================
  // Public API
  // =============================================================================

  /**
   * Wait for kiosk to be ready (responding to API)
   * @param {Object} [options]
   * @param {number} [options.maxAttempts=15] - Max attempts (2s each)
   * @param {number} [options.intervalMs=2000] - Poll interval
   * @returns {Promise<{ok: boolean, elapsedMs: number, attempts: number}>}
   */
  async waitForKiosk(options = {}) {
    const maxAttempts = options.maxAttempts ?? 15;
    const intervalMs = options.intervalMs ?? 2000;
    const startTime = Date.now();
    let attempts = 0;

    this.#logger.debug?.('kiosk.waitForKiosk.start', { host: this.#host, maxAttempts });

    while (attempts < maxAttempts) {
      try {
        const response = await this.#apiGet('/home');
        if (response.ok) {
          const elapsedMs = Date.now() - startTime;
          this.#logger.info?.('kiosk.ready', { elapsedMs, attempts: attempts + 1 });
          return { ok: true, elapsedMs, attempts: attempts + 1 };
        }
      } catch (error) {
        this.#logger.debug?.('kiosk.waitAttempt', {
          attempt: attempts + 1,
          error: error.message
        });
      }

      attempts++;
      if (attempts < maxAttempts) {
        await this.#sleep(intervalMs);
      }
    }

    const elapsedMs = Date.now() - startTime;
    this.#logger.error?.('kiosk.timeout', { elapsedMs, attempts });
    return { ok: false, elapsedMs, attempts };
  }

  /**
   * Load a URL in the kiosk browser
   * @param {string} path - Path to load (appended to daylightHost)
   * @param {Object} [query] - Query parameters
   * @param {Object} [options]
   * @param {number} [options.maxRetries=10] - Max load retries
   * @returns {Promise<KioskLoadResult>}
   */
  async loadUrl(path, query = {}, options = {}) {
    const maxRetries = options.maxRetries ?? 10;
    return this.#loadUrlWithRetry(path, query, maxRetries, 1, Date.now());
  }

  /**
   * Wait for a specific URL to be loaded
   * @param {string} needle - URL substring to look for
   * @param {Object} [options]
   * @param {number} [options.maxAttempts] - Max attempts (null = unlimited)
   * @param {number} [options.intervalMs=1000] - Poll interval
   * @returns {Promise<boolean>}
   */
  async waitForUrl(needle, options = {}) {
    const maxAttempts = options.maxAttempts ?? null;
    const intervalMs = options.intervalMs ?? 1000;
    const testString = needle.replace(/[ +]/g, '%20');
    let tries = 0;

    while (maxAttempts === null || tries < maxAttempts) {
      try {
        const response = await this.#apiGet('/home');
        if (response.ok) {
          const text = await response.text();
          if (text.includes(testString)) {
            return true;
          }
        }
      } catch (error) {
        this.#logger.debug?.('kiosk.waitForUrl.attempt', {
          attempt: tries + 1,
          error: error.message
        });
      }

      tries++;
      if (maxAttempts === null || tries < maxAttempts) {
        await this.#sleep(intervalMs);
      }
    }

    return false;
  }

  /**
   * Wait for blank page to be loaded
   * @param {Object} [options]
   * @param {number} [options.maxAttempts=10] - Max attempts
   * @returns {Promise<{ok: boolean, elapsedMs: number}>}
   */
  async waitForBlank(options = {}) {
    const startTime = Date.now();
    const url = `${this.#daylightHost}/blank`;
    const found = await this.waitForUrl(url, {
      maxAttempts: options.maxAttempts ?? 10
    });

    return {
      ok: found,
      elapsedMs: Date.now() - startTime
    };
  }

  /**
   * Send a raw command to the kiosk
   * @param {string} cmd - Command name
   * @param {Object} [params] - Additional parameters
   * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
   */
  async sendCommand(cmd, params = {}) {
    try {
      const queryParams = new URLSearchParams({
        cmd,
        password: this.#password,
        ...params
      });
      const response = await this.#fetch(`http://${this.#host}:${this.#port}/?${queryParams}`);

      if (response.ok) {
        this.#metrics.successCount++;
        return { ok: true, data: await response.text() };
      } else {
        this.#metrics.errorCount++;
        return { ok: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      this.#metrics.errorCount++;
      this.#logger.error?.('kiosk.command.error', { cmd, error: error.message });
      return { ok: false, error: error.message };
    }
  }

  /**
   * Check if adapter is configured
   * @returns {boolean}
   */
  isConfigured() {
    return !!(this.#host && this.#port && this.#password && this.#daylightHost);
  }

  /**
   * Get adapter metrics
   * @returns {Object}
   */
  getMetrics() {
    const uptimeMs = Date.now() - this.#metrics.startedAt;
    return {
      provider: 'fully-kiosk',
      host: this.#host,
      uptime: {
        ms: uptimeMs,
        formatted: this.#formatDuration(uptimeMs)
      },
      requests: {
        total: this.#metrics.requestCount,
        success: this.#metrics.successCount,
        errors: this.#metrics.errorCount
      },
      lastRequestAt: this.#metrics.lastRequestAt
    };
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Load URL with retry logic
   * @private
   */
  async #loadUrlWithRetry(path, query, maxRetries, attempt, startTime) {
    if (attempt > maxRetries) {
      return {
        ok: false,
        error: `Failed to load URL after ${maxRetries} attempts`
      };
    }

    // Wait for kiosk to be ready
    const waitResult = await this.waitForKiosk();
    if (!waitResult.ok) {
      return {
        ok: false,
        error: 'Kiosk not ready',
        waitTimeMs: waitResult.elapsedMs
      };
    }

    // Build destination URL
    const queryString = new URLSearchParams(query).toString();
    const dstUrl = `${this.#daylightHost}${path}${queryString ? `?${queryString}` : ''}`;
    const encodedUrl = encodeURIComponent(dstUrl);

    // Send load command
    const loadStartTime = Date.now();
    const loadResult = await this.sendCommand('loadUrl', { url: encodedUrl });

    if (!loadResult.ok) {
      return {
        ok: false,
        error: loadResult.error,
        waitTimeMs: waitResult.elapsedMs
      };
    }

    // Wait for URL to be loaded
    const isLoaded = await this.waitForUrl(dstUrl, { maxAttempts: 10 });
    const loadTimeMs = Date.now() - loadStartTime;

    this.#logger.debug?.('kiosk.loadUrl', { isLoaded, dstUrl, attempt });

    if (isLoaded) {
      return {
        ok: true,
        url: dstUrl,
        waitTimeMs: waitResult.elapsedMs,
        loadTimeMs,
        totalTimeMs: Date.now() - startTime
      };
    }

    // Retry
    this.#logger.debug?.('kiosk.loadUrl.retry', { attempt });
    await this.#sleep(1000);
    return this.#loadUrlWithRetry(path, query, maxRetries, attempt + 1, startTime);
  }

  /**
   * Make API GET request
   * @private
   */
  async #apiGet(path) {
    const url = `http://${this.#host}:${this.#port}${path}?password=${this.#password}`;
    return this.#fetch(url);
  }

  /**
   * Fetch wrapper - returns a fetch-like response object
   * @private
   */
  async #fetch(url) {
    this.#metrics.requestCount++;
    this.#metrics.lastRequestAt = nowTs24();

    const response = await this.#httpClient.get(url);
    // Return fetch-like object for compatibility with existing code
    return {
      ok: response.ok,
      status: response.status,
      text: async () => typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
    };
  }

  /**
   * Sleep helper
   * @private
   */
  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Format duration
   * @private
   */
  #formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

export default KioskAdapter;
