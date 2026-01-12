/**
 * ProxyService - Generic HTTP proxy with retry logic
 *
 * Provides a reusable proxy service that can forward requests to
 * any external service using an IProxyAdapter for configuration.
 *
 * Features:
 * - Authentication injection (headers or query params)
 * - Configurable retry with exponential backoff
 * - Request/response streaming
 * - Timeout handling
 *
 * @module infrastructure/proxy
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

/**
 * ProxyService class
 */
export class ProxyService {
  #adapters = new Map();
  #logger;

  /**
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.#logger = options.logger || console;
  }

  /**
   * Register a proxy adapter
   * @param {import('./IProxyAdapter.mjs').IProxyAdapter} adapter
   */
  register(adapter) {
    const name = adapter.getServiceName();
    this.#adapters.set(name, adapter);
    this.#logger.debug?.('proxy.adapter.registered', { service: name });
  }

  /**
   * Get a registered adapter
   * @param {string} serviceName
   * @returns {import('./IProxyAdapter.mjs').IProxyAdapter | null}
   */
  getAdapter(serviceName) {
    return this.#adapters.get(serviceName) || null;
  }

  /**
   * Check if a service is configured
   * @param {string} serviceName
   * @returns {boolean}
   */
  isConfigured(serviceName) {
    const adapter = this.#adapters.get(serviceName);
    return adapter ? adapter.isConfigured() : false;
  }

  /**
   * List all registered services
   * @returns {string[]}
   */
  getServices() {
    return Array.from(this.#adapters.keys());
  }

  /**
   * Proxy a request to an external service
   * @param {string} serviceName - Service to proxy to
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Promise<void>}
   */
  async proxy(serviceName, req, res) {
    const adapter = this.#adapters.get(serviceName);
    if (!adapter) {
      res.status(404).json({ error: `Unknown service: ${serviceName}` });
      return;
    }

    if (!adapter.isConfigured()) {
      res.status(503).json({ error: `Service not configured: ${serviceName}` });
      return;
    }

    const retryConfig = adapter.getRetryConfig?.() || { maxRetries: 3, delayMs: 500 };
    const timeout = adapter.getTimeout?.() || 30000;

    await this.#proxyWithRetry(adapter, req, res, retryConfig, timeout, 0);
  }

  /**
   * Proxy with retry logic
   * @private
   */
  async #proxyWithRetry(adapter, req, res, retryConfig, timeout, attempt) {
    const serviceName = adapter.getServiceName();
    const baseUrl = adapter.getBaseUrl();
    const path = adapter.transformPath?.(req.url) || req.url;

    // Build target URL
    const targetUrl = new URL(path, baseUrl);

    // Add auth params if provided
    const authParams = adapter.getAuthParams?.();
    if (authParams) {
      for (const [key, value] of Object.entries(authParams)) {
        if (!targetUrl.searchParams.has(key)) {
          targetUrl.searchParams.set(key, value);
        }
      }
    }

    // Build headers
    const headers = { ...req.headers };
    delete headers.host; // Don't forward host header

    // Add auth headers if provided
    const authHeaders = adapter.getAuthHeaders?.();
    if (authHeaders) {
      Object.assign(headers, authHeaders);
    }

    const protocol = targetUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers,
      timeout
    };

    return new Promise((resolve) => {
      const proxyReq = protocol.request(options, (proxyRes) => {
        const statusCode = proxyRes.statusCode;

        // Check if should retry
        const shouldRetry = adapter.shouldRetry?.(statusCode, attempt) ??
          (statusCode >= 500 || statusCode === 429);

        if (shouldRetry && attempt < retryConfig.maxRetries) {
          this.#logger.debug?.('proxy.retry', {
            service: serviceName,
            statusCode,
            attempt: attempt + 1,
            maxRetries: retryConfig.maxRetries
          });

          // Consume response to free up connection
          proxyRes.resume();

          setTimeout(() => {
            this.#proxyWithRetry(adapter, req, res, retryConfig, timeout, attempt + 1)
              .then(resolve);
          }, retryConfig.delayMs);
          return;
        }

        // Forward response
        if (!res.headersSent) {
          res.writeHead(statusCode, proxyRes.headers);
        }
        proxyRes.pipe(res);
        proxyRes.on('end', resolve);
      });

      proxyReq.on('error', (err) => {
        this.#logger.error?.('proxy.error', {
          service: serviceName,
          error: err.message,
          attempt
        });

        if (!res.headersSent) {
          res.status(502).json({
            error: 'Proxy error',
            service: serviceName,
            details: err.message
          });
        }
        resolve();
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        this.#logger.error?.('proxy.timeout', {
          service: serviceName,
          timeout,
          attempt
        });

        if (!res.headersSent) {
          res.status(504).json({
            error: 'Gateway timeout',
            service: serviceName
          });
        }
        resolve();
      });

      // Pipe request body for POST/PUT/PATCH
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        req.pipe(proxyReq);
      } else {
        proxyReq.end();
      }
    });
  }

  /**
   * Create Express middleware for a service
   * @param {string} serviceName
   * @returns {Function} Express middleware
   */
  createMiddleware(serviceName) {
    return async (req, res) => {
      await this.proxy(serviceName, req, res);
    };
  }
}

/**
 * Create a ProxyService instance
 * @param {Object} [options]
 * @returns {ProxyService}
 */
export function createProxyService(options = {}) {
  return new ProxyService(options);
}

export default ProxyService;
