/**
 * ImmichProxyAdapter - Proxy adapter for Immich photo management
 *
 * Implements IProxyAdapter for forwarding requests to Immich
 * with API key authentication.
 *
 * @module adapters/proxy
 */

import { configService } from '#system/config/index.mjs';

/**
 * @implements {import('../../0_system/proxy/IProxyAdapter.mjs').IProxyAdapter}
 */
export class ImmichProxyAdapter {
  #host;
  #apiKey;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.host - Immich server URL (e.g., 'http://localhost:2283')
   * @param {string} config.apiKey - Immich API key
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(config, options = {}) {
    this.#host = config.host;
    this.#apiKey = config.apiKey;
    this.#logger = options.logger || console;
  }

  /**
   * Get service identifier
   * @returns {string}
   */
  getServiceName() {
    return 'immich';
  }

  /**
   * Get Immich server base URL
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
    return Boolean(this.#host && this.#apiKey);
  }

  /**
   * Get authentication headers
   * Immich uses x-api-key header
   * @returns {Object}
   */
  getAuthHeaders() {
    return {
      'x-api-key': this.#apiKey
    };
  }

  /**
   * No auth params needed for Immich
   * @returns {null}
   */
  getAuthParams() {
    return null;
  }

  /**
   * Transform incoming path
   * Strips /immich prefix if present and prepends /api for Immich API
   * @param {string} path
   * @returns {string}
   */
  transformPath(path) {
    let transformed = path.replace(/^\/immich/, '');
    // Immich API endpoints are under /api/
    if (!transformed.startsWith('/api/')) {
      transformed = '/api' + transformed;
    }
    return transformed;
  }

  /**
   * Opt in to SVG placeholder on upstream failure
   */
  getErrorFallback() { return 'svg'; }

  /**
   * Default retry configuration
   * @returns {{ maxRetries: number, delayMs: number }}
   */
  getRetryConfig() {
    return {
      maxRetries: 3,
      delayMs: 500
    };
  }

  /**
   * Standard retry logic
   * @param {number} statusCode
   * @returns {boolean}
   */
  shouldRetry(statusCode) {
    return statusCode >= 500 || statusCode === 429;
  }

  /**
   * Default timeout
   * @returns {number}
   */
  getTimeout() {
    return 30000;
  }
}

/**
 * Create an ImmichProxyAdapter from ConfigService
 * @param {Object} [options]
 * @returns {ImmichProxyAdapter}
 */
export function createImmichProxyAdapter(options = {}) {
  const adapterConfig = configService.getAdapterConfig('immich') || {};
  const host = adapterConfig.host;
  const apiKey = configService.getSecret('IMMICH_API_KEY');

  return new ImmichProxyAdapter({ host, apiKey }, options);
}

export default ImmichProxyAdapter;
