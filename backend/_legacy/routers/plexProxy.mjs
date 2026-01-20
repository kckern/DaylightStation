/**
 * Plex Proxy Router - Bridge to new ProxyService infrastructure
 *
 * This module provides backward-compatible routing while delegating
 * to the new ProxyService in 0_infrastructure/proxy.
 *
 * @module routers/plexProxy
 */

import express from 'express';
import { createLogger } from '../lib/logging/logger.js';
import { configService } from '../lib/config/index.mjs';
import { ProxyService } from '../../src/0_infrastructure/proxy/ProxyService.mjs';
import { PlexProxyAdapter } from '../../src/2_adapters/proxy/PlexProxyAdapter.mjs';

const router = express.Router();
const logger = createLogger({ source: 'backend', app: 'plex-proxy' });

// Lazy-initialized proxy service (initialized on first request)
let proxyService = null;

/**
 * Get or create the proxy service
 * @returns {ProxyService}
 */
function getProxyService() {
  if (proxyService) {
    return proxyService;
  }

  // Get Plex config
  const host = process.env.plex?.host;
  const auth = configService.getHouseholdAuth('plex') || {};
  const token = auth.token;

  // Create and configure proxy service
  proxyService = new ProxyService({ logger });
  proxyService.register(new PlexProxyAdapter(
    { host, token },
    { logger }
  ));

  logger.info('plex-proxy.initialized', { host, hasToken: !!token });

  return proxyService;
}

// Route all requests through the proxy service
router.use('/', async (req, res) => {
  const service = getProxyService();
  await service.proxy('plex', req, res);
});

export default router;
