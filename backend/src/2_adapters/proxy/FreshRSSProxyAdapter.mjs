/**
 * FreshRSSProxyAdapter - Proxy adapter for FreshRSS
 *
 * Implements IProxyAdapter for forwarding requests to FreshRSS
 * with HTTP Basic or API key authentication.
 *
 * @module adapters/proxy
 */

import { configService } from '../../0_infrastructure/config/index.mjs';

/**
 * @implements {import('../../0_infrastructure/proxy/IProxyAdapter.mjs').IProxyAdapter}
 */
export class FreshRSSProxyAdapter {
  #host;
  #username;
  #password;
  #apiKey;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.host - FreshRSS server URL (e.g., 'http://localhost:8080')
   * @param {string} [config.username] - FreshRSS username (for basic auth)
   * @param {string} [config.password] - FreshRSS password (for basic auth)
   * @param {string} [config.apiKey] - FreshRSS API key (alternative to basic auth)
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(config, options = {}) {
    this.#host = config.host;
    this.#username = config.username;
    this.#password = config.password;
    this.#apiKey = config.apiKey;
    this.#logger = options.logger || console;
  }

  /**
   * Get service identifier
   * @returns {string}
   */
  getServiceName() {
    return 'freshrss';
  }

  /**
   * Get FreshRSS server base URL
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
    const hasBasicAuth = Boolean(this.#username && this.#password);
    const hasApiKey = Boolean(this.#apiKey);
    return Boolean(this.#host && (hasBasicAuth || hasApiKey));
  }

  /**
   * Get authentication headers
   * Supports both Basic auth and API key
   * @returns {Object|null}
   */
  getAuthHeaders() {
    if (this.#apiKey) {
      return {
        'Authorization': `GoogleLogin auth=${this.#apiKey}`
      };
    }

    if (this.#username && this.#password) {
      const credentials = Buffer.from(`${this.#username}:${this.#password}`).toString('base64');
      return {
        'Authorization': `Basic ${credentials}`
      };
    }

    return null;
  }

  /**
   * No auth params needed for FreshRSS
   * @returns {null}
   */
  getAuthParams() {
    return null;
  }

  /**
   * Transform incoming path
   * Strips /freshrss prefix if present
   * @param {string} path
   * @returns {string}
   */
  transformPath(path) {
    return path.replace(/^\/freshrss/, '');
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
   * Default timeout
   * @returns {number}
   */
  getTimeout() {
    return 30000;
  }
}

/**
 * Create a FreshRSSProxyAdapter from ConfigService
 * @param {Object} [options]
 * @returns {FreshRSSProxyAdapter}
 */
export function createFreshRSSProxyAdapter(options = {}) {
  const adapterConfig = configService.getAdapterConfig('freshrss') || {};
  const host = adapterConfig.host;
  const username = configService.getSecret('FRESHRSS_USERNAME');
  const password = configService.getSecret('FRESHRSS_PASSWORD');
  const apiKey = configService.getSecret('FRESHRSS_API_KEY');

  return new FreshRSSProxyAdapter({ host, username, password, apiKey }, options);
}

export default FreshRSSProxyAdapter;
