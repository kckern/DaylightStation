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
   * Retry on any 4xx or 5xx error
   * Plex can return transient errors during transcoding
   * @param {number} statusCode
   * @param {number} attempt
   * @returns {boolean}
   */
  shouldRetry(statusCode, attempt) {
    return statusCode >= 400 && statusCode < 600;
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
