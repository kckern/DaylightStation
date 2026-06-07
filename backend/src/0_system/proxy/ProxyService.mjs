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
import { sendPlaceholderSvg } from './placeholders.mjs';

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

        // Follow upstream redirects internally (opt-in via getMaxRedirects).
        // Immich's `?size=fullsize` 302-redirects to `?size=preview` when
        // full-size generation is disabled; the relative Location would
        // otherwise resolve against the app origin and return HTML (a blank
        // <img>). Following it server-side keeps the response an actual image.
        const maxRedirects = adapter.getMaxRedirects?.() ?? 0;
        const isRedirect = [301, 302, 303, 307, 308].includes(statusCode);
        if (maxRedirects > 0 && isRedirect && proxyRes.headers.location) {
          proxyRes.resume(); // discard redirect body
          this.#followRedirect(
            adapter, proxyRes.headers.location, headers, timeout, res, maxRedirects
          ).then(resolve);
          return;
        }

        // Forward response — or fall back to placeholder SVG for image proxies
        const isImageProxy = typeof adapter.getErrorFallback === 'function';
        if (statusCode >= 400 && isImageProxy) {
          proxyRes.resume(); // discard upstream error body
          this.#logger.warn?.('proxy.imageFallback', {
            service: serviceName,
            statusCode,
            url: targetUrl.href,
          });
          sendPlaceholderSvg(res);
          resolve();
          return;
        }

        if (!res.headersSent) {
          const responseHeaders = { ...proxyRes.headers };

          // Let adapters inject/override response headers (e.g. Cache-Control)
          const cacheHeaders = adapter.getResponseHeaders?.(req.url, statusCode, responseHeaders);
          if (cacheHeaders) {
            Object.assign(responseHeaders, cacheHeaders);
          }

          res.writeHead(statusCode, responseHeaders);
        }
        proxyRes.pipe(res);
        proxyRes.on('end', resolve);
      });

      const isImageProxy = typeof adapter.getErrorFallback === 'function';

      proxyReq.on('error', (err) => {
        this.#logger.error?.('proxy.error', {
          service: serviceName,
          error: err.message,
          attempt
        });

        if (isImageProxy) {
          sendPlaceholderSvg(res);
        } else if (!res.headersSent) {
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

        if (isImageProxy) {
          sendPlaceholderSvg(res);
        } else if (!res.headersSent) {
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
   * Follow an upstream redirect server-side (GET), resolving the Location
   * against the adapter's base URL and re-applying auth. Recurses up to
   * `depth` hops, then pipes the final response. Used so redirects that
   * point back at the upstream (e.g. Immich size fallbacks) don't leak a
   * relative Location to the browser. Reuses the image-proxy SVG fallback.
   * @private
   */
  #followRedirect(adapter, location, reqHeaders, timeout, res, depth) {
    const serviceName = adapter.getServiceName();
    const targetUrl = new URL(location, adapter.getBaseUrl());

    const headers = { ...reqHeaders };
    delete headers.host;
    const authHeaders = adapter.getAuthHeaders?.();
    if (authHeaders) Object.assign(headers, authHeaders);

    const protocol = targetUrl.protocol === 'https:' ? https : http;
    const isImageProxy = typeof adapter.getErrorFallback === 'function';
    const failover = () => {
      if (isImageProxy) sendPlaceholderSvg(res);
      else if (!res.headersSent) res.status(502).json({ error: 'Proxy error', service: serviceName });
    };

    return new Promise((resolve) => {
      const proxyReq = protocol.request({
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: 'GET',
        headers,
        timeout,
      }, (proxyRes) => {
        const statusCode = proxyRes.statusCode;

        if ([301, 302, 303, 307, 308].includes(statusCode) && proxyRes.headers.location && depth > 1) {
          proxyRes.resume();
          this.#followRedirect(adapter, proxyRes.headers.location, reqHeaders, timeout, res, depth - 1)
            .then(resolve);
          return;
        }

        if (statusCode >= 400 && isImageProxy) {
          proxyRes.resume();
          this.#logger.warn?.('proxy.imageFallback', { service: serviceName, statusCode, url: targetUrl.href });
          sendPlaceholderSvg(res);
          resolve();
          return;
        }

        if (!res.headersSent) {
          const responseHeaders = { ...proxyRes.headers };
          const cacheHeaders = adapter.getResponseHeaders?.(targetUrl.pathname + targetUrl.search, statusCode, responseHeaders);
          if (cacheHeaders) Object.assign(responseHeaders, cacheHeaders);
          res.writeHead(statusCode, responseHeaders);
        }
        proxyRes.pipe(res);
        proxyRes.on('end', resolve);
      });

      proxyReq.on('error', (err) => {
        this.#logger.error?.('proxy.redirectError', { service: serviceName, error: err.message });
        failover();
        resolve();
      });
      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        this.#logger.error?.('proxy.redirectTimeout', { service: serviceName, timeout });
        failover();
        resolve();
      });
      proxyReq.end();
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
