// backend/src/4_api/v1/routers/api.mjs
/**
 * API Router (v1)
 *
 * Groups all DDD domain routers under the /api/v1 namespace.
 * This provides:
 * - Clean versioning (future /api/v2 possible)
 * - Single mount point for all DDD routes
 * - Easy to swap route names without changing frontend paths
 *
 * @module api/v1/routers/api
 */

import express from 'express';

/**
 * Create the v1 API router with all domain sub-routers
 *
 * @param {Object} config - All router configurations
 * @param {Object} config.safeConfig - Safe config values for status endpoint
 * @param {Object} config.routers - Pre-created router instances
 * @param {express.Router} config.routers.content - Content router
 * @param {express.Router} config.routers.proxy - Proxy router
 * @param {express.Router} config.routers.list - List router
 * @param {express.Router} config.routers.play - Play router
 * @param {express.Router} config.routers.localContent - LocalContent router
 * @param {express.Router} [config.routers.local] - Local media browsing router
 * @param {express.Router} config.routers.health - Health router
 * @param {express.Router} config.routers.finance - Finance router
 * @param {express.Router} config.routers.harvest - Harvest router
 * @param {express.Router} config.routers.entropy - Entropy router
 * @param {express.Router} config.routers.lifelog - Lifelog router
 * @param {express.Router} config.routers.static - Static router
 * @param {express.Router} config.routers.calendar - Calendar router
 * @param {express.Router} config.routers.gratitude - Gratitude router
 * @param {express.Router} config.routers.fitness - Fitness router
 * @param {express.Router} config.routers.home - Home automation router
 * @param {express.Router} config.routers.nutribot - Nutribot router
 * @param {express.Router} config.routers.journalist - Journalist router
 * @param {express.Router} config.routers.scheduling - Scheduling router
 * @param {express.Router} [config.routers.messaging] - Messaging router (optional)
 * @param {express.Router} [config.routers.printer] - Printer router (optional)
 * @param {express.Router} [config.routers.screens] - Screens router (optional)
 * @param {express.Router} [config.routers.tts] - TTS router (optional)
 * @param {Function} [config.plexProxyHandler] - Plex proxy handler function
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createApiRouter(config) {
  const router = express.Router();
  const { safeConfig, routers, plexProxyHandler, logger = console } = config;

  // Route mapping: { mountPath: routerKey }
  // Change mountPath here to rename routes without touching frontend
  const routeMap = {
    '/item': 'item',  // New unified item-centric API
    '/config': 'config',
    '/content': 'content',
    '/proxy': 'proxy',
    '/list': 'list',
    '/play': 'play',
    '/local-content': 'localContent',
    '/local': 'local',
    '/health': 'health',
    '/finance': 'finance',
    '/cost': 'cost',
    '/harvest': 'harvest',
    '/entropy': 'entropy',
    '/lifelog': 'lifelog',
    '/static': 'static',
    '/calendar': 'calendar',
    '/gratitude': 'gratitude',
    '/fitness': 'fitness',
    '/home': 'home',
    '/nutribot': 'nutribot',
    '/journalist': 'journalist',
    '/homebot': 'homebot',
    '/scheduling': 'scheduling',
    '/messaging': 'messaging',
    '/printer': 'printer',
    '/tts': 'tts',
    '/screens': 'screens',
    '/agents': 'agents',
    '/dev': 'dev',
    '/canvas': 'canvas',
    '/admin': 'admin'
  };

  // Mount each router at its path
  const mounted = [];
  for (const [path, key] of Object.entries(routeMap)) {
    if (routers[key]) {
      router.use(path, routers[key]);
      mounted.push(path);
    }
  }

  // Plex proxy is a handler function, not a router
  if (plexProxyHandler) {
    router.use('/plex_proxy', plexProxyHandler);
    mounted.push('/plex_proxy');
  }

  // Health check endpoints at root of /api/v1
  router.get('/ping', (req, res) => res.json({ ok: true, timestamp: Date.now() }));
  router.get('/status', (req, res) => res.json({
    ok: true,
    version: 'v1',
    routes: mounted,
    config: safeConfig
  }));

  logger.info?.('api.mounted', { routeCount: mounted.length, routes: mounted });

  return router;
}

export default createApiRouter;
