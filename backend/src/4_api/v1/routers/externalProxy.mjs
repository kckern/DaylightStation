/**
 * External Proxy Router
 *
 * Provides generic proxy endpoints for external services like
 * Plex, Immich, Audiobookshelf, FreshRSS.
 *
 * Uses ProxyService infrastructure with pluggable adapters.
 *
 * @module api/routers
 */

import express from 'express';

/**
 * Create external proxy router
 * @param {Object} config
 * @param {import('../../0_system/proxy/ProxyService.mjs').ProxyService} config.proxyService
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createExternalProxyRouter(config) {
  const router = express.Router();
  const { proxyService, logger = console } = config;

  /**
   * GET /external-proxy/status
   * Get status of all configured proxy services
   */
  router.get('/status', (req, res) => {
    const services = proxyService.getServices();
    const status = services.map(name => ({
      service: name,
      configured: proxyService.isConfigured(name)
    }));

    res.json({
      ok: true,
      services: status
    });
  });

  /**
   * ALL /external-proxy/:service/*
   * Proxy any request to the specified service
   */
  router.all('/:service/*', async (req, res) => {
    const { service } = req.params;

    // Rebuild the path without the service prefix
    const path = req.url.replace(`/${service}`, '');
    req.url = path || '/';

    await proxyService.proxy(service, req, res);
  });

  /**
   * ALL /external-proxy/:service
   * Proxy root request to service
   */
  router.all('/:service', async (req, res) => {
    const { service } = req.params;
    req.url = '/';
    await proxyService.proxy(service, req, res);
  });

  return router;
}

export default createExternalProxyRouter;
