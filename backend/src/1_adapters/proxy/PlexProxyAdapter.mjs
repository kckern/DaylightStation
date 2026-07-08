/**
 * PlexProxyAdapter - Proxy adapter for Plex Media Server
 *
 * Implements IProxyAdapter for forwarding requests to Plex
 * with token-based authentication.
 *
 * Includes test infrastructure for simulating network stalls.
 *
 * @module adapters/proxy
 */

/**
 * @implements {import('../../0_system/proxy/IProxyAdapter.mjs').IProxyAdapter}
 */
export class PlexProxyAdapter {
  #host;
  #token;
  #logger;

  // ═══════════════════════════════════════════════════════════════
  // Test Infrastructure: Shutoff Valve (per-instance state)
  // When enabled, proxy requests will be delayed or blocked.
  // ═══════════════════════════════════════════════════════════════
  #shutoff;

  /**
   * @param {Object} config
   * @param {string} config.host - Plex server URL (e.g., 'http://localhost:32400')
   * @param {string} config.token - Plex authentication token
   * @param {Object} [config.shutoff] - Initial shutoff valve state (test injection)
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(config, options = {}) {
    this.#host = config.host;
    this.#token = config.token;
    this.#logger = options.logger || console;
    this.#shutoff = {
      enabled: false,
      mode: 'block',  // 'block' | 'delay'
      delayMs: 30000, // Delay duration for 'delay' mode
      blockedRequests: 0,
      delayedRequests: 0,
      ...(config.shutoff || {})
    };
  }

  /**
   * Enable the Plex proxy shutoff valve (for testing network stalls)
   * @param {Object} options
   * @param {'block'|'delay'} [options.mode='block'] - Block requests entirely or delay them
   * @param {number} [options.delayMs=30000] - Delay duration in ms (for delay mode)
   */
  enableShutoff(options = {}) {
    this.#shutoff.enabled = true;
    this.#shutoff.mode = options.mode || 'block';
    this.#shutoff.delayMs = options.delayMs || 30000;
    this.#shutoff.blockedRequests = 0;
    this.#shutoff.delayedRequests = 0;
  }

  /**
   * Disable the Plex proxy shutoff valve
   */
  disableShutoff() {
    this.#shutoff.enabled = false;
  }

  /**
   * Get shutoff valve status
   * @returns {{ enabled: boolean, mode: string, delayMs: number, blockedRequests: number, delayedRequests: number }}
   */
  getShutoffStatus() {
    return { ...this.#shutoff };
  }

  /**
   * Check if request should be blocked/delayed
   * @returns {Promise<void>} - Resolves immediately if not blocked, delays or rejects if shutoff enabled
   */
  async checkShutoffValve() {
    if (!this.#shutoff.enabled) return;

    if (this.#shutoff.mode === 'block') {
      this.#shutoff.blockedRequests++;
      throw new Error('PLEX_SHUTOFF: Request blocked by test shutoff valve');
    }

    if (this.#shutoff.mode === 'delay') {
      this.#shutoff.delayedRequests++;
      await new Promise(resolve => setTimeout(resolve, this.#shutoff.delayMs));
    }
  }

  /**
   * Get service identifier
   * @returns {string}
   */
  getServiceName() {
    return 'plex';
  }

  /**
   * Get Plex server base URL
   * @returns {string}
   */
  getBaseUrl() {
    return this.#host;
  }

  /**
   * Check if adapter is configured
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.#host && this.#token);
  }

  /**
   * Get authentication query parameters
   * Plex uses X-Plex-Token as a query parameter
   * @returns {Object}
   */
  getAuthParams() {
    return {
      'X-Plex-Token': this.#token
    };
  }

  /**
   * No auth headers needed for Plex (uses query params)
   * @returns {null}
   */
  getAuthHeaders() {
    return null;
  }

  /**
   * Transform incoming path
   * Strips /plex_proxy prefix if present (for backward compatibility with legacy paths)
   * New canonical path is /api/v1/proxy/plex/* which doesn't need transformation
   * @param {string} path
   * @returns {string}
   */
  transformPath(path) {
    return path.replace(/^\/plex_proxy/, '');
  }

  /**
   * Plex-specific retry configuration
   * More aggressive than default for media server
   * @returns {{ maxRetries: number, delayMs: number }}
   */
  getRetryConfig() {
    return {
      maxRetries: 20,
      delayMs: 500
    };
  }

  /**
   * Retry only on transient errors
   * Don't retry permanent failures like 403 (auth) or 404 (not found)
   * @param {number} statusCode
   * @param {number} attempt
   * @returns {boolean}
   */
  shouldRetry(statusCode, attempt) {
    // Retry on rate limiting
    if (statusCode === 429) return true;
    
    // Retry on server errors (5xx) - these are typically transient
    if (statusCode >= 500 && statusCode < 600) return true;
    
    // Don't retry client errors (4xx) - these are permanent
    // 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, etc.
    return false;
  }

  /**
   * Inject caching headers for thumbnail responses.
   * Plex thumb URLs include a timestamp that changes when the image updates,
   * so they are safe to cache aggressively.
   * @param {string} path - Request path
   * @param {number} statusCode - Upstream status code
   * @returns {Object|null} Headers to merge into the response
   */
  getResponseHeaders(path, statusCode) {
    if (statusCode >= 200 && statusCode < 300 && /\/thumb\//.test(path)) {
      return { 'cache-control': 'public, max-age=31536000, immutable' };
    }
    return null;
  }

  /**
   * Longer timeout for media operations
   * @returns {number}
   */
  getTimeout() {
    return 60000; // 60 seconds
  }
}

export default PlexProxyAdapter;
