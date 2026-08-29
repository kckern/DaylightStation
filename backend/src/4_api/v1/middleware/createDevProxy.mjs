import { sendInternalError } from '#api/utils/internalError.mjs';
import express from 'express';

export function createDevProxy({ logger, forwarder } = {}) {
  if (!forwarder?.getTargetHost || !forwarder?.forward) {
    throw new Error('createDevProxy requires a forwarder');
  }

  let proxyEnabled = false;
  const notConfigured = (res) => sendInternalError(res, { error: 'LOCAL_DEV_HOST not configured' });

  async function proxyRequest(req, res) {
    const targetHost = forwarder.getTargetHost();
    if (!targetHost) return notConfigured(res);

    try {
      const response = await forwarder.forward({
        method: req.method,
        originalUrl: req.originalUrl,
        contentType: req.headers['content-type'],
        secretToken: req.headers['x-telegram-bot-api-secret-token'],
        forwardedFor: req.ip || req.headers['x-forwarded-for'],
        body: req.body,
      });
      res.status(response.status);
      if (response.contentType) res.set('content-type', response.contentType);
      return response.json ? res.json(response.body) : res.send(response.body);
    } catch (error) {
      if (error.code === 'DEV_HOST_NOT_CONFIGURED') {
        return notConfigured(res);
      }
      return res.status(502).json({
        error: 'Dev proxy error',
        message: error.message,
        targetUrl: error.targetUrl,
      });
    }
  }

  const router = express.Router();

  router.all('/proxy_toggle', (req, res) => {
    proxyEnabled = !proxyEnabled;
    const targetHost = forwarder.getTargetHost() || 'not configured';
    logger?.info?.('devProxy.toggled', { enabled: proxyEnabled, targetHost });
    return res.status(200).json({
      proxyEnabled,
      targetHost,
      message: proxyEnabled
        ? `Dev proxy ENABLED - forwarding to http://${targetHost}`
        : 'Dev proxy DISABLED - using local handlers',
    });
  });

  router.get('/proxy_status', (req, res) => {
    const targetHost = forwarder.getTargetHost() || 'not configured';
    return res.status(200).json({ proxyEnabled, targetHost, configured: !!forwarder.getTargetHost() });
  });

  const middleware = async (req, res, next) => {
    if (req.path === '/dev/proxy_toggle' || req.path === '/dev/proxy_status') return next();
    if (proxyEnabled) return proxyRequest(req, res);
    return next();
  };

  return { router, middleware, getState: () => ({ proxyEnabled, targetHost: forwarder.getTargetHost() }) };
}
