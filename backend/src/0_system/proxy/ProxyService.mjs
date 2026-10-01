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
  #errorReplacedListeners = [];

  /**
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.#logger = options.logger || console;
  }

  /**
   * Be told when an upstream error is replaced (see getErrorReplacement). The
   * listener runs after the response is sent and must not throw; a slow or
   * failing listener never touches the request.
   * @param {(event: {service: string, path: string, statusCode: number, reason: string|null}) => void} listener
   */
  onErrorReplaced(listener) {
    if (typeof listener === 'function') this.#errorReplacedListeners.push(listener);
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
   * @param {string|null} [pathOverride] - Upstream path to fetch INSTEAD of the
   *   one derived from `req.url`. Set only when re-issuing against an adapter's
   *   `getFallbackPath()`; its presence is also what stops a fallback chaining
   *   into another fallback.
   * @private
   */
  async #proxyWithRetry(adapter, req, res, retryConfig, timeout, attempt, pathOverride = null) {
    const serviceName = adapter.getServiceName();
    // The client already hung up (a <video> that moved on, a remount that
    // swapped its src): nothing to fetch for, and a retry would only open
    // another upstream stream nobody reads.
    if (res.destroyed || res.writableEnded) return;
    const baseUrl = adapter.getBaseUrl();
    const path = pathOverride ?? (adapter.transformPath?.(req.url) || req.url);

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
      // When the client disconnects, abort the upstream request too. Without
      // this an abandoned media stream kept pulling from Plex until the 60s
      // timeout — on 2026-09-28 the Player's remounts left ~2.9 GB of such
      // orphaned transfers competing with the stream actually being watched.
      let clientClosed = false;
      const onClientClose = () => {
        if (res.writableFinished) return;
        clientClosed = true;
        this.#logger.debug?.('proxy.client-closed', { service: serviceName, attempt });
        proxyReq.destroy();
        resolve();
      };
      res.once('close', onClientClose);

      const proxyReq = protocol.request(options, (proxyRes) => {
        const statusCode = proxyRes.statusCode;
        // Stop watching the client once the upstream body is fully delivered.
        proxyRes.once('end', () => res.removeListener('close', onClientClose));

        // Check if should retry
        const shouldRetry = adapter.shouldRetry?.(statusCode, attempt, path) ??
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
          res.removeListener('close', onClientClose);

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

        // An upstream can advertise an asset at one path and serve it at
        // another: a Plex playlist whose thumb field is set but whose image file
        // is gone still has its auto-composite. Give the adapter one chance to
        // name where the asset actually lives before this becomes an error.
        // `pathOverride` guards the recursion — a fallback gets no fallback.
        if (statusCode >= 400 && !pathOverride) {
          const fallbackPath = adapter.getFallbackPath?.(path, statusCode);
          if (fallbackPath) {
            proxyRes.resume(); // discard the miss
            this.#logger.debug?.('proxy.fallbackPath', {
              service: serviceName,
              statusCode,
              from: path,
              to: fallbackPath,
            });
            this.#proxyWithRetry(adapter, req, res, retryConfig, timeout, 0, fallbackPath)
              .then(resolve);
            return;
          }
        }

        // An adapter can say an upstream error means something other than what
        // its status says — Plex answers 404 for a media file it exists-but-
        // cannot-read (the NAS zeroed its mode), and a 404 tells the player
        // "gone for good". See PlexProxyAdapter.getErrorReplacement.
        if (statusCode >= 400 && !res.headersSent) {
          const replacement = adapter.getErrorReplacement?.(path, statusCode);
          if (replacement) {
            proxyRes.resume(); // discard upstream error body
            this.#logger.warn?.('proxy.error-replaced', {
              service: serviceName,
              statusCode,
              replacedWith: replacement.status,
              reason: replacement.body?.reason ?? null,
              attempt,
            });
            res.writeHead(replacement.status, {
              'content-type': 'application/json',
              ...(replacement.headers || {}),
            });
            res.end(JSON.stringify(replacement.body ?? {}));
            resolve();
            const event = {
              service: serviceName, path, statusCode, reason: replacement.body?.reason ?? null,
            };
            for (const listener of this.#errorReplacedListeners) {
              try { listener(event); } catch (error) {
                this.#logger.warn?.('proxy.error-replaced.listener-failed', { error: error.message });
              }
            }
            return;
          }
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
        if (clientClosed) return; // our own abort after the client left
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
