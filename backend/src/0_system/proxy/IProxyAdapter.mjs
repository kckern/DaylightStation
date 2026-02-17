/**
 * IProxyAdapter - Interface for external service proxies
 *
 * Defines the contract for proxy adapters that forward requests
 * to external services with authentication and retry logic.
 *
 * @module infrastructure/proxy
 */

/**
 * Check if an object implements IProxyAdapter
 * @param {Object} obj
 * @returns {boolean}
 */
export function isProxyAdapter(obj) {
  return (
    obj &&
    typeof obj.getServiceName === 'function' &&
    typeof obj.getBaseUrl === 'function' &&
    typeof obj.isConfigured === 'function'
  );
}

/**
 * IProxyAdapter interface definition
 *
 * Required methods:
 *
 * getServiceName(): string
 *   Return service identifier ('plex', 'immich', 'audiobookshelf', 'freshrss').
 *
 * getBaseUrl(): string
 *   Return target service base URL.
 *
 * isConfigured(): boolean
 *   Check if adapter has valid configuration (host, credentials).
 *
 * Optional methods:
 *
 * getAuthHeaders(): object | null
 *   Return headers for authentication (e.g., { 'Authorization': 'Bearer ...' }).
 *   Default: null (no auth headers)
 *
 * getAuthParams(): object | null
 *   Return query params for authentication (e.g., { 'X-Plex-Token': '...' }).
 *   Default: null (no auth params)
 *
 * transformPath(path: string): string
 *   Transform incoming path to target path (path rewriting).
 *   Default: identity (no transformation)
 *
 * getRetryConfig(): { maxRetries: number, delayMs: number }
 *   Return retry configuration for this service.
 *   Default: { maxRetries: 3, delayMs: 500 }
 *
 * shouldRetry(statusCode: number, attempt: number): boolean
 *   Determine if request should be retried for given status.
 *   Default: retry on 5xx errors and 429
 *
 * getTimeout(): number
 *   Request timeout in milliseconds.
 *   Default: 30000 (30 seconds)
 *
 * getErrorFallback(): string | undefined
 *   If defined, ProxyService returns a placeholder SVG instead of JSON errors
 *   on upstream failure. Use for image-serving proxies (Reddit, Komga, Immich).
 *   Return 'svg' to opt in. Omit to get default JSON error behavior.
 */

export const IProxyAdapter = {
  // Required
  getServiceName() {},
  getBaseUrl() {},
  isConfigured() {},

  // Optional (have defaults in ProxyService)
  getAuthHeaders() { return null; },
  getAuthParams() { return null; },
  transformPath(path) { return path; },
  getRetryConfig() { return { maxRetries: 3, delayMs: 500 }; },
  shouldRetry(statusCode, attempt) { return statusCode >= 500 || statusCode === 429; },
  getTimeout() { return 30000; }
};

export default { IProxyAdapter, isProxyAdapter };
