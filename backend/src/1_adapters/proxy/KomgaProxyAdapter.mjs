/**
 * KomgaProxyAdapter - Proxy adapter for Komga
 *
 * Implements IProxyAdapter for forwarding requests to Komga
 * with X-API-Key header authentication.
 *
 * @module adapters/proxy
 */

import { configService } from '#system/config/index.mjs';

/**
 * @implements {import('../../0_system/proxy/IProxyAdapter.mjs').IProxyAdapter}
 */
export class KomgaProxyAdapter {
  #host;
  #apiKey;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.host - Komga server URL (e.g., 'http://localhost:25600')
   * @param {string} config.apiKey - Komga API key
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(config, options = {}) {
    // Normalize host by removing trailing slash
    this.#host = config.host ? config.host.replace(/\/$/, '') : config.host;
    this.#apiKey = config.apiKey;
    this.#logger = options.logger || console;
  }

  /**
   * Get service identifier
   * @returns {string}
   */
  getServiceName() {
    return 'komga';
  }

  /**
   * Get Komga server base URL
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
   * Komga uses X-API-Key header
   * @returns {Object}
   */
  getAuthHeaders() {
    return {
      'X-API-Key': this.#apiKey
    };
  }

  /**
   * No auth params needed for Komga
   * @returns {null}
   */
  getAuthParams() {
    return null;
  }

  /**
   * Transform incoming path
   * Strips /komga prefix if present
   * @param {string} path
   * @returns {string}
   */
  transformPath(path) {
    return path.replace(/^\/komga/, '');
  }

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
   * Longer timeout for page image loading
   * @returns {number}
   */
  getTimeout() {
    return 60000;
  }
}

/**
 * Create a KomgaProxyAdapter from ConfigService
 * @param {Object} [options]
 * @returns {KomgaProxyAdapter}
 */
export function createKomgaProxyAdapter(options = {}) {
  const adapterConfig = configService.getAdapterConfig('komga') || {};
  const host = adapterConfig.host;
  const apiKey = configService.getSecret('KOMGA_API_KEY');

  return new KomgaProxyAdapter({ host, apiKey }, options);
}

export default KomgaProxyAdapter;
