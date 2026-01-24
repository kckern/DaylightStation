/**
 * Dev Proxy Middleware
 *
 * Enables toggling of request forwarding to a dev host without redeployment.
 * Useful for debugging webhooks (Telegram, etc.) by routing prod traffic to dev.
 *
 * @module infrastructure/http/middleware/devProxy
 */

import express from 'express';

/**
 * Create dev proxy middleware and toggle router
 *
 * @param {Object} options
 * @param {Object} options.logger - Logger instance
 * @param {string} [options.devHost] - Override LOCAL_DEV_HOST env var
 * @returns {{ router: express.Router, middleware: Function, getState: Function }}
 */
export function createDevProxy({ logger, devHost } = {}) {
  let proxyEnabled = false;

  const getDevHost = () => devHost || process.env.LOCAL_DEV_HOST;

  /**
   * Forward a request to the dev host
   */
  async function proxyRequest(req, res) {
    const targetHost = getDevHost();
    if (!targetHost) {
      return res.status(500).json({ error: 'LOCAL_DEV_HOST not configured' });
    }

    const targetUrl = `http://${targetHost}${req.originalUrl}`;
    logger?.debug?.('devProxy.forwarding', {
      method: req.method,
      url: req.originalUrl,
      targetUrl
    });

    try {
      const fetchOptions = {
        method: req.method,
        headers: {
          'content-type': req.headers['content-type'] || 'application/json',
          'x-telegram-bot-api-secret-token': req.headers['x-telegram-bot-api-secret-token'] || '',
          'x-forwarded-for': req.ip || req.headers['x-forwarded-for'] || '',
          'x-proxy-source': 'daylight-ddd',
        },
      };

      // Add body for non-GET requests
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const response = await fetch(targetUrl, fetchOptions);
      const contentType = response.headers.get('content-type') || '';

      res.status(response.status);

      if (contentType) {
        res.set('content-type', contentType);
      }

      if (contentType.includes('application/json')) {
        const json = await response.json();
        return res.json(json);
      } else {
        const text = await response.text();
        return res.send(text);
      }
    } catch (error) {
      logger?.error?.('devProxy.forward.failed', {
        targetUrl,
        error: error.message
      });
      return res.status(502).json({
        error: 'Dev proxy error',
        message: error.message,
        targetUrl
      });
    }
  }

  // Toggle endpoint router
  const router = express.Router();

  router.all('/proxy_toggle', (req, res) => {
    proxyEnabled = !proxyEnabled;
    const targetHost = getDevHost() || 'not configured';

    logger?.info?.('devProxy.toggled', {
      enabled: proxyEnabled,
      targetHost
    });

    return res.status(200).json({
      proxyEnabled,
      targetHost,
      message: proxyEnabled
        ? `Dev proxy ENABLED - forwarding to http://${targetHost}`
        : 'Dev proxy DISABLED - using local handlers'
    });
  });

  router.get('/proxy_status', (req, res) => {
    const targetHost = getDevHost() || 'not configured';
    return res.status(200).json({
      proxyEnabled,
      targetHost,
      configured: !!getDevHost()
    });
  });

  // Middleware that intercepts requests when proxy is enabled
  const middleware = async (req, res, next) => {
    // Skip proxy endpoints themselves
    if (req.path === '/dev/proxy_toggle' || req.path === '/dev/proxy_status') {
      return next();
    }

    if (proxyEnabled) {
      return proxyRequest(req, res);
    }

    return next();
  };

  return {
    router,
    middleware,
    getState: () => ({ proxyEnabled, targetHost: getDevHost() })
  };
}
