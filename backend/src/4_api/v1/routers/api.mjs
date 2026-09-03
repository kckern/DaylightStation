import { sendInternalError } from '#api/utils/internalError.mjs';
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
import { getDispatcher, isLoggingInitialized } from '#system/logging/dispatcher.mjs';
import { createLogger } from '#system/logging/logger.mjs';
import { getSessionFileTransport } from '#system/logging/transports/sessionFile.mjs';

/**
 * What the logging pipeline has thrown away, for the status route.
 *
 * The dispatcher has counted `dropped` since it was written and nothing has
 * ever read it; the session-file transport now counts its own skips the same
 * way. A counter with no reader is not observability, and during a storm the
 * drop is the signal — so both surface here, next to the route list, where
 * anyone debugging already looks.
 *
 * @returns {object|null} null when logging has not been initialized
 */
function loggingStatus() {
  if (!isLoggingInitialized()) return null;
  const dispatcher = getDispatcher();
  return {
    metrics: dispatcher.getMetrics(),
    transports: dispatcher.getTransportNames(),
    transportStatus: dispatcher.getTransportStatuses(),
    sessionFile: getSessionFileTransport()?.getStatus() ?? null,
  };
}

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
 * @param {express.Router} [config.routers.life] - Life (lifeplan) router
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
 * @param {express.Router} [config.routers.device] - Device router (optional)
 * @param {Function} [config.plexProxyHandler] - Plex proxy handler function
 * @param {Object} [config.configReloadService] - Injected household app-config reloader.
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createApiRouter(config) {
  const router = express.Router();
  const { safeConfig, routers, plexProxyHandler, configReloadService = null, logger = console } = config;

  // Route mapping: { mountPath: routerKey }
  // Change mountPath here to rename routes without touching frontend
  const routeMap = {
    '/item': 'item',  // New unified item-centric API
    '/info': 'info',  // Action-based metadata (unified ID format)
    '/display': 'display',  // Action-based images (unified ID format)
    '/config': 'config',
    '/content': 'content',
    '/proxy': 'proxy',
    '/list': 'list',
    '/siblings': 'siblings',
    '/queue': 'queue',
    '/play': 'play',
    '/local-content': 'localContent',
    '/local': 'local',
    '/health/mentions': 'healthMentions',
    '/health': 'health',
    '/health-dashboard': 'health-dashboard',
    '/feed': 'feed',
    '/finance': 'finance',
    '/cost': 'cost',
    '/harvest': 'harvest',
    '/entropy': 'entropy',
    '/life': 'life',
    '/lifelog': 'lifelog',
    '/static': 'static',
    '/art': 'art',
    '/emulator': 'emulator',
    '/calendar': 'calendar',
    '/gratitude': 'gratitude',
    '/fitness': 'fitness',
    '/media': 'media',
    '/home': 'home',
    '/home-automation': 'home',  // alias — matches the router's own docstrings and external callers (e.g. playback-hub)
    '/home-dashboard': 'home-dashboard',
    '/playback-hub': 'playback-hub',
    '/nutribot': 'nutribot',
    '/journalist': 'journalist',
    '/homebot': 'homebot',
    '/scheduling': 'scheduling',
    '/newsreporter': 'newsreporter',
    '/messaging': 'messaging',
    '/printer': 'printer',
    '/tts': 'tts',
    '/screens': 'screens',
    '/eink': 'eink',  // Hardware e-paper panels (Seeed reTerminal) — see _extensions/eink-panel
    '/pressure-mats': 'pressure-mats', // TrampleTek Blue pressure surfaces
    // '/agents' mounted directly by app.mjs via mountAgentHttp() per agent +
    // createAgentMemoryRouter / createAgentMetaRouter (Phase 3 HTTP unification).
    '/dev': 'dev',
    '/device': 'device',
    '/homeline': 'homeline',
    '/trigger': 'trigger',
    '/canvas': 'canvas',
    '/auth': 'auth',
    '/admin': 'admin',
    '/stream': 'stream',
    '/queries': 'queries',
    '/test': 'test',  // Test infrastructure (dev/test only)
    '/launch': 'launch',
    '/sync': 'sync',
    '/prewarm': 'prewarm',
    '/weekly-review': 'weekly-review',
    '/qrcode': 'qrcode',
    '/catalog': 'catalog',
    '/sheets': 'sheets',      // Printable interaction surfaces — see _wip/plans/2026-07-29-printable-sheet-framework-design.md
    '/livestream': 'livestream',
    '/camera': 'camera',
    '/piano': 'piano',
    '/economy': 'economy',
    '/state-gates': 'stateGates',
    '/entitlements': 'entitlements',
    '/automotive': 'automotive',  // Vehicle record system — see _extensions/obd-relay
    '/feedback': 'feedback',
    '/gaming': 'gaming',
    '/piano-games': 'piano-games',
    '/presentation': 'presentation',
    '/school': 'school',
    '/donow': 'donow',
    '/content-filter': 'content-filter',
    '/wikipedia': 'wikipedia',
    '/shutdown': 'shutdown',
    // Weekly measures (rings, and whatever follows). Note this table is the
    // ONLY thing that mounts a router: adding one to `v1Routers` in app.mjs
    // gets it into the api.mounted log and still 404s until its path appears
    // here, which is a convincing way to look wired and not be.
    '/measures': 'measures',
    '/books': 'books',  // Book metadata resolution (OpenLibrary/Google Books) — the School shelf is under /school/books
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
    config: safeConfig,
    logging: loggingStatus()
  }));

  /**
   * A SCREEN THAT COULD NOT START, reported by the page shell.
   *
   * The frontend's own logger ships over a WebSocket that lives inside the app
   * bundle — so when the bundle itself throws, the one transport that could
   * report it is the thing that failed. Nothing reached the log store, and a
   * blank kiosk was indistinguishable from a dead display without walking up
   * to it (school Portal, 2026-08-25, eighty minutes).
   *
   * This is the one log route that must not depend on the app: plain HTTP,
   * called by an inline script in `index.html` before the module loads.
   * Fire-and-forget by design — the caller is a page that is already broken,
   * so it always answers 204 and never makes the client handle a failure.
   */
  const bootLogger = createLogger({ source: 'frontend', app: 'boot' });
  router.post('/system/boot-error', express.json({ limit: '16kb' }), (req, res) => {
    const body = req.body ?? {};
    const data = body.data ?? {};
    bootLogger.error('boot.failed', {
      kind: String(data.kind ?? 'unknown').slice(0, 40),
      detail: String(data.detail ?? '').slice(0, 500),
      url: String(data.url ?? '').slice(0, 200),
      userAgent: String(body.context?.userAgent ?? req.get('user-agent') ?? '').slice(0, 300),
      ip: req.ip,
    });
    res.status(204).end();
  });

  // System reload — re-read household app YAML configs from disk without
  // restarting the process. Useful when an admin edits a config file.
  // Optional ?app=<name> reloads just that app; otherwise reloads every app
  // configLoader knows about (the colocated + legacy-config/ + apps/ union
  // it built at boot — task-13 review, Important 3: a bare readdirSync over
  // the legacy household/config/ directory used to enumerate "every app",
  // which silently stopped covering the 8 apps colocation moved OUT of that
  // directory, reporting ok:true with a shrunken list and no failure signal).
  router.post('/system/reload', (req, res) => {
    if (!configReloadService) {
      return res.status(503).json({ ok: false, error: 'config_reload_unavailable' });
    }
    const requestedApp = req.query?.app || req.body?.app || null;
    const reloaded = [];
    const failed = [];

    const tryReload = (app) => {
      try {
        const cfg = configReloadService.reloadHouseholdAppConfig(null, app);
        if (cfg !== null && cfg !== undefined) reloaded.push(app);
        else failed.push({ app, reason: 'not_found' });
      } catch (err) {
        failed.push({ app, reason: err.message });
      }
    };

    if (requestedApp) {
      tryReload(requestedApp);
    } else {
      let apps = [];
      try {
        apps = configReloadService.getHouseholdAppNames(null);
      } catch (err) {
        return sendInternalError(res, { ok: false, error: 'cannot_list_apps', message: err.message });
      }
      for (const app of apps) tryReload(app);
    }

    logger.info?.('system.reload', { reloaded: reloaded.length, failed: failed.length, requestedApp });
    res.json({
      ok: true,
      reloaded,
      count: reloaded.length,
      ...(failed.length ? { failed } : {}),
    });
  });

  logger.info?.('api.mounted', { routeCount: mounted.length, routes: mounted });

  return router;
}

export default createApiRouter;
