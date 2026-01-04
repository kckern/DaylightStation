import express from 'express';
import request from 'request';
import { createLogger } from '../lib/logging/logger.js';
import { householdLoadAuth, getCurrentHouseholdId } from '../lib/io.mjs';

const router = express.Router();
const logger = createLogger({ source: 'backend', app: 'plex-proxy' });

// Get Plex token from household auth with env fallback
const getPlexToken = () => {
  const hid = getCurrentHouseholdId();
  const auth = householdLoadAuth(hid, 'plex') || {};
  return auth.token || process.env.PLEX_TOKEN;
};

router.use('/', (req, res) => {
  const { host } = process.env.plex;
  const plexToken = getPlexToken();
  // req.url here is relative to the mount point (e.g. /library/metadata/...)
  // The original code attempted to replace /plex_proxy, which is likely redundant if mounted via app.use('/plex_proxy', router)
  // but we keep the logic safe.
  const relativeUrl = req.url.replace(/\/plex_proxy/, '');

  const url = `${host}${relativeUrl}${req.url.includes('?') ? '&' : '?'}${req.url.includes('X-Plex-Token') ? '' : `X-Plex-Token=${plexToken}`}`;
  
  // console.log(`Proxying request to: ${url}`);

  const maxRetries = 20; // Try for ~10 seconds (20 * 500ms)
  const retryDelay = 500;

  const attemptProxy = (retries) => {
    const proxyRequest = request({ qs: req.query, uri: url });

    proxyRequest.on('error', (err) => {
      if (!res.headersSent) {
        logger.error('proxy.error', { url, error: err?.message, stack: err?.stack });
        res.status(500).json({ error: 'Failed to proxy request', details: err.message });
      }
    });

    proxyRequest.on('response', (response) => {
      if (response.statusCode >= 400 && response.statusCode < 600 && retries < maxRetries) {
        // console.log(`${response.statusCode} detected for ${url}, retrying (${retries + 1}/${maxRetries})...`);
        setTimeout(() => attemptProxy(retries + 1), retryDelay);
      } else {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      }
    });

    req.pipe(proxyRequest);
  };

  attemptProxy(0);
});

export default router;
