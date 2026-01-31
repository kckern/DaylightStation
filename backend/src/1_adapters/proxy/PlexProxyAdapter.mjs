/**
 * PlexProxyAdapter - Proxy adapter for Plex Media Server
 *
 * Implements IProxyAdapter for forwarding requests to Plex
 * with token-based authentication.
 *
 * @module adapters/proxy
 */

import { configService } from '#system/config/index.mjs';

/**
 * @implements {import('../../0_system/proxy/IProxyAdapter.mjs').IProxyAdapter}
 */
export class PlexProxyAdapter {
  #host;
  #token;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.host - Plex server URL (e.g., 'http://localhost:32400')
   * @param {string} config.token - Plex authentication token
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(config, options = {}) {
    this.#host = config.host;
    this.#token = config.token;
    this.#logger = options.logger || console;
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
   * Longer timeout for media operations
   * @returns {number}
   */
  getTimeout() {
    return 60000; // 60 seconds
  }
}

/**
 * Create a PlexProxyAdapter from ConfigService
 * @param {Object} [options]
 * @param {Object} [options.logger] - Logger instance
 * @returns {PlexProxyAdapter}
 */
export function createPlexProxyAdapter(options = {}) {
  const adapterConfig = configService.getAdapterConfig('plex') || {};
  const host = adapterConfig.host;
  const token = configService.getSecret('PLEX_TOKEN');

  return new PlexProxyAdapter({ host, token }, options);
}

export default PlexProxyAdapter;
