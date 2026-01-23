/**
 * Legacy App Factory
 *
 * Creates and configures an Express app with all legacy routes and middleware.
 * This is extracted from index.js to support the backend toggle system.
 *
 * @module backend/_legacy/app
 */

import express from 'express';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import path, { join } from 'path';
import cors from 'cors';
import { createWebsocketServer } from './routers/websocket.mjs';
import { loadFile } from './lib/io.mjs';
import { initMqttSubscriber } from './lib/mqtt.mjs';
import { userDataService } from '../src/0_infrastructure/config/UserDataService.mjs';

// Config loader
import { loadAllConfig, logConfigSummary } from '../src/0_infrastructure/config/configLoader.mjs';

// ConfigService v2 (primary config system)
import { configService } from '../src/0_infrastructure/config/index.mjs';

// Routing toggle system for legacy/new route migration
import { loadRoutingConfig, createRoutingMiddleware, ShimMetrics } from '../src/0_infrastructure/routing/index.mjs';
import { allShims } from '../src/4_api/shims/index.mjs';
import { createShimsRouter } from '../src/4_api/routers/admin/shims.mjs';

// Logging system (from new infrastructure)
import { getDispatcher } from '../src/0_infrastructure/logging/dispatcher.js';
import { createLogger } from '../src/0_infrastructure/logging/logger.js';
import { loadLoggingConfig, resolveLoggerLevel } from '../src/0_infrastructure/logging/config.js';

// Legacy route hit tracking for cutover monitoring
import { getLegacyTracker } from '../src/4_api/middleware/legacyTracker.mjs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

/**
 * Create and configure the Express app with all legacy routes
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.server - HTTP server instance (for WebSocket attachment)
 * @param {Object} options.logger - Root logger instance
 * @param {Object} options.configPaths - Resolved config paths { configDir, dataDir }
 * @param {boolean} options.configExists - Whether config files exist
 * @returns {Promise<express.Application>} Configured Express app
 */
export async function createApp({
  server,
  logger,
  configPaths,
  configExists,
  enableWebSocket = true,
  enableScheduler = true
}) {
  const isDocker = existsSync('/.dockerenv');

  // Create Express app with base middleware
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' })); // Parse JSON request bodies with increased limit for voice memos
  app.use(express.urlencoded({ limit: '50mb', extended: true })); // Parse URL-encoded bodies

  // Initialize routing toggle system for legacy/new route migration
  const shimMetrics = new ShimMetrics();
  let routingConfig;
  try {
    routingConfig = loadRoutingConfig('./backend/config/routing.yml', allShims);
    logger.info('routing.config.loaded', { message: 'Config loaded successfully' });
  } catch (error) {
    logger.error('routing.config.error', { error: error.message });
    logger.info('routing.config.fallback', { message: 'Defaulting all routes to legacy' });
    routingConfig = { default: 'legacy', routing: {} };
  }

  // Create separate routers for legacy and new implementations (currently unused but available)
  const legacyRouter = express.Router();
  const newRouter = express.Router();

  // Get dispatcher for logging metrics
  const dispatcher = getDispatcher();

  // Mutable logger reference for reloading after config changes
  let rootLogger = logger;
  let loggingConfig = loadLoggingConfig();

  // Exclude WebSocket paths from all Express middleware
  app.use((req, res, next) => {
    if (req.path.startsWith('/ws')) {
      return next('route'); // Skip all remaining middleware for this route
    }
    next();
  });

  if (configExists) {
    // Load all config using unified loader
    // NOTE: We no longer spread config into process.env - use ConfigService instead
    loadAllConfig({
      configDir: configPaths.configDir,
      dataDir: configPaths.dataDir,
      isDocker,
      isDev: !isDocker
    });

    loggingConfig = loadLoggingConfig();

    // Update dispatcher level and component levels if needed
    dispatcher.setLevel(resolveLoggerLevel('backend', loggingConfig));
    dispatcher.componentLevels = loggingConfig.loggers || {};

    // Recreate root logger with updated context (new system)
    rootLogger = createLogger({
      source: 'backend',
      app: 'api',
      context: { env: process.env.NODE_ENV }
    });

    // Log config loading summary (no-op in new config system)
    logConfigSummary({}, rootLogger);

    // Config validation now done by ConfigService during initialization
    // Legacy healthcheck removed - validation happens in initConfigService

    // Initialize WebSocket server after config is loaded
    if (enableWebSocket) {
      await createWebsocketServer(server);
    } else {
      rootLogger.info('websocket.disabled', { reason: 'Infrastructure owned by new backend' });
    }

    // Initialize MQTT subscriber for vibration sensors (fitness)
    try {
      const householdId = configService.getDefaultHouseholdId();
      const householdConfig = userDataService.readHouseholdAppData(householdId, 'fitness', 'config');
      let legacyFitnessConfig = {};
      const dataRoot = process.env.path?.data;
      const legacyYml = dataRoot && path.join(dataRoot, 'config/apps/fitness.yml');
      const legacyYaml = dataRoot && path.join(dataRoot, 'config/apps/fitness.yaml');
      if ((legacyYml && existsSync(legacyYml)) || (legacyYaml && existsSync(legacyYaml))) {
        legacyFitnessConfig = loadFile('config/apps/fitness') || {};
      }
      const equipmentConfig = householdConfig?.equipment || legacyFitnessConfig.equipment || [];

      if (process.env.DISABLE_MQTT || !enableWebSocket) {
        rootLogger.info('mqtt.disabled', {
          reason: process.env.DISABLE_MQTT
            ? 'DISABLE_MQTT environment variable set'
            : 'Infrastructure owned by new backend'
        });
      } else if (process.env.mqtt) {
        initMqttSubscriber(equipmentConfig);
      } else {
        rootLogger.warn('mqtt.not_configured', { message: 'process.env.mqtt missing; skipping MQTT init' });
      }
    } catch (err) {
      rootLogger.error('mqtt.init.failed', { error: err?.message });
    }

    // Import routers dynamically after configuration is set
    const { default: cron } = await import('./routers/cron.mjs');
    const { default: fetchRouter } = await import('./routers/fetch.mjs');
    const { default: harvestRouter } = await import('./routers/harvest.mjs');
    // JournalistRouter now handled in api.mjs for proxy_toggle support
    const { default: homeRouter } = await import('./routers/home.mjs');
    const { default: mediaRouter } = await import('./routers/media.mjs');
    const { default: healthRouter } = await import('./routers/health.mjs');
    const { default: lifelogRouter } = await import('./routers/lifelog.mjs');
    const { default: fitnessRouter } = await import('./routers/fitness.mjs');
    const { default: printerRouter } = await import('./routers/printer.mjs');
    const { default: gratitudeRouter } = await import('./routers/gratitude.mjs');
    const { default: plexProxyRouter } = await import('./routers/plexProxy.mjs');

    const { default: exe } = await import('./routers/exe.mjs');
    const { default: tts } = await import('./routers/tts.mjs');

    // Mount admin shims router for monitoring shim usage (before routing middleware)
    app.use('/admin/shims', createShimsRouter({ metrics: shimMetrics }));
    rootLogger.info('routing.toggle.initialized', {
      default: routingConfig.default,
      routes: Object.keys(routingConfig.routing || {}),
      adminPath: '/admin/shims'
    });

    // Content domain (new DDD structure)
    const { createContentRegistry, createWatchStore, createFinanceServices, createFinanceApiRouter, createEntropyServices, createEntropyApiRouter } = await import('../src/0_infrastructure/bootstrap.mjs');
    const { createContentRouter } = await import('../src/4_api/routers/content.mjs');
    const { createProxyRouter } = await import('../src/4_api/routers/proxy.mjs');
    const { createListRouter } = await import('../src/4_api/routers/list.mjs');
    const { createPlayRouter } = await import('../src/4_api/routers/play.mjs');

    // Backend API
    app.post('/api/logs', (req, res) => {
      const body = req.body;
      const entries = Array.isArray(body) ? body : [body];
      const ingestLogger = rootLogger.child({ module: 'http-logs' });
      const allowedLevels = new Set(['debug', 'info', 'warn', 'error']);
      let accepted = 0;

      for (const entry of entries) {
        if (!entry || typeof entry.event !== 'string') continue;
        const level = String(entry.level || 'info').toLowerCase();
        const safeLevel = allowedLevels.has(level) ? level : 'info';
        const data = entry.data || entry.payload || {};
        const context = entry.context || {};
        const tags = entry.tags || [];
        ingestLogger[safeLevel](entry.event, data, {
          message: entry.message,
          context,
          tags,
          source: entry.source || 'http-logs'
        });
        accepted += 1;
      }

      if (!accepted) {
        return res.status(400).json({ status: 'error', message: 'No valid log events' });
      }
      return res.status(202).json({ status: 'ok', accepted });
    });
    app.get('/debug', (_, res) => res.json({ process: { __dirname, env: process.env } }));
    app.get('/debug/log', (req, res) => {
      const msg = req.query.message || 'Test log from /debug/log';
      rootLogger.info('debug.log.test', { message: msg, type: 'info' });
      rootLogger.warn('debug.log.test', { message: msg, type: 'warn' });
      rootLogger.error('debug.log.test', { message: msg, type: 'error' });
      res.json({ status: 'ok', message: 'Logs emitted', content: msg });
    });

    // Logging health/metrics endpoint
    app.get('/api/logging/health', (_, res) => {
      const metrics = dispatcher.getMetrics();
      const transports = dispatcher.getTransportNames();
      res.json({
        status: 'ok',
        dispatcher: metrics,
        transports: transports.map(name => ({ name, status: 'ok' })),
        level: loggingConfig.defaultLevel || 'info'
      });
    });

    // Health check endpoints
    app.get('/api/ping', (_, res) => res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() }));
    app.get('/api/status', (_, res) => res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      serverdata: loadFile("state/cron")
    }));
    app.get('/api/status/nas', (_, res) => res.status(200).json({
      status: 'ok',
      accessible: true,
      timestamp: new Date().toISOString()
    }));

    // Helper to get household head user
    const getHouseholdHead = () => {
      const dataPath = process.env.path?.data || '/usr/src/app/data';
      const hid = process.env.household_id || 'default';
      const householdPath = `${dataPath}/households/${hid}/household.yml`;
      try {
        const householdData = parse(readFileSync(householdPath, 'utf8'));
        return householdData?.head || '{username}';
      } catch (err) {
        rootLogger.warn('household.head.error', { error: err.message });
        return '{username}';
      }
    };

    // Redirect /data/lifelog/* to /data/users/{head}/lifelog/*
    // This allows frontend to use simple paths without specifying user
    app.get('/data/lifelog/*', (req, res) => {
      const headUser = getHouseholdHead();
      const remainder = req.params[0];
      res.redirect(`/data/users/${headUser}/lifelog/${remainder}`);
    });

    // Redirect household-level data to households/{hid}/shared/
    app.get('/data/weather', (req, res) => {
      const hid = process.env.household_id || 'default';
      res.redirect(`/data/households/${hid}/shared/weather`);
    });
    app.get('/data/events', (req, res) => {
      const hid = process.env.household_id || 'default';
      res.redirect(`/data/households/${hid}/shared/events`);
    });
    app.get('/data/calendar', (req, res) => {
      const hid = process.env.household_id || 'default';
      res.redirect(`/data/households/${hid}/shared/calendar`);
    });

    // Legacy route hit tracking for cutover monitoring
    const legacyTracker = getLegacyTracker({ logger: rootLogger });

    // Expose tracker stats via admin endpoint
    app.get('/admin/legacy-hits', (req, res) => {
      res.json({
        hits: legacyTracker.getHits(),
        totalHits: legacyTracker.getTotalHits(),
        serverUptime: process.uptime()
      });
    });

    // Cutover status dashboard
    app.get('/admin/cutover-status', async (req, res) => {
      const { getFlags } = await import('../src/4_api/middleware/cutoverFlags.mjs');

      res.json({
        flags: getFlags(),
        legacyHits: legacyTracker.getHits(),
        totalLegacyHits: legacyTracker.getTotalHits(),
        serverUptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    });

    // Legacy finance endpoint shims (redirect to new API - must be before legacy routers)
    app.get('/data/budget', (req, res) => res.redirect(307, '/api/finance/data'));
    app.get('/data/budget/daytoday', (req, res) => res.redirect(307, '/api/finance/data/daytoday'));
    app.get('/harvest/budget', (req, res) => res.redirect(307, '/api/finance/refresh'));
    app.post('/harvest/budget', (req, res) => res.redirect(307, '/api/finance/refresh'));

    app.use('/data', legacyTracker.middleware, fetchRouter);

    if (enableScheduler) {
      app.use('/cron', cron);
      rootLogger.info('cron.router.mounted', { path: '/cron' });
    } else {
      // Mount read-only status endpoint only
      app.get('/cron/status', (req, res) => {
        res.json({
          status: 'disabled',
          reason: 'Scheduler owned by new backend',
          redirect: '/api/scheduling/status'
        });
      });
      rootLogger.info('cron.disabled', { reason: 'Scheduler owned by new backend' });
    }
    app.use("/harvest", legacyTracker.middleware, harvestRouter);
    // JournalistRouter now handled via /api/journalist in api.mjs
    app.use("/home", legacyTracker.middleware, homeRouter);

    // Create watch state store for progress tracking (needed by legacy media/log)
    const watchStatePath = process.env.path?.watchState || process.env.WATCH_STATE_PATH || '/data/media_memory';
    const watchStore = createWatchStore({ watchStatePath });

    // NOTE: legacyMediaLogMiddleware was removed - it intercepted /media/log with broken
    // field mapping (expected 'library' but frontend sends 'media_key'). The legacy
    // mediaRouter.post('/log') handles this correctly until full cutover.

    app.use("/media", legacyTracker.middleware, mediaRouter);
    app.use("/api/health", legacyTracker.middleware, healthRouter);
    app.use("/api/lifelog", legacyTracker.middleware, lifelogRouter);
    app.use("/api/fitness", legacyTracker.middleware, fitnessRouter);
    app.use("/exe", exe);
    app.use("/print", printerRouter);
    app.use("/tts", tts);
    app.use("/api/gratitude", gratitudeRouter);
    app.use("/plex_proxy", plexProxyRouter);

    // Initialize content registry and mount content router (new DDD structure)
    const mediaBasePath = process.env.path?.media || process.env.MEDIA_PATH || '/data/media';
    const dataBasePath = process.env.path?.data || process.env.DATA_PATH || '/data';
    const householdId = configService.getDefaultHouseholdId() || 'default';
    const householdDir = userDataService.getHouseholdDir(householdId) || `${dataBasePath}/households/${householdId}`;
    const plexConfig = process.env.media?.plex ? {
      host: process.env.media.plex.host,
      token: process.env.media.plex.token
    } : null;
    const watchlistPath = `${householdDir}/state/lists.yml`;
    const contentRegistry = createContentRegistry({
      mediaBasePath,
      plex: plexConfig,
      dataPath: dataBasePath,
      watchlistPath
    });

    app.use('/api/content', createContentRouter(contentRegistry, watchStore));
    rootLogger.info('content.mounted', { path: '/api/content', mediaBasePath, plexEnabled: !!plexConfig });

    // Mount proxy router for streaming and thumbnails
    app.use('/proxy', createProxyRouter({ registry: contentRegistry }));
    rootLogger.info('proxy.mounted', { path: '/proxy' });

    // Mount list and play routers for Content Domain API
    app.use('/api/list', createListRouter({ registry: contentRegistry }));
    app.use('/api/play', createPlayRouter({ registry: contentRegistry, watchStore }));
    rootLogger.info('content.api.mounted', { paths: ['/api/list', '/api/play'] });

    // Finance domain (new DDD structure)
    const financeServices = createFinanceServices({
      dataRoot: dataBasePath,
      defaultHouseholdId: householdId,
      buxfer: process.env.finance?.buxfer ? {
        email: process.env.finance.buxfer.email,
        password: process.env.finance.buxfer.password
      } : null,
      // AI gateway can be added when needed for transaction categorization
      logger: rootLogger.child({ module: 'finance' })
    });
    app.use('/api/finance', createFinanceApiRouter({
      financeServices,
      configService,
      logger: rootLogger.child({ module: 'finance-api' })
    }));
    rootLogger.info('finance.api.mounted', { path: '/api/finance', buxferConfigured: !!financeServices.buxferAdapter });

    // Entropy domain (new DDD structure)
    const { userLoadFile, userLoadCurrent } = await import('./lib/io.mjs');
    const ArchiveService = (await import('./lib/ArchiveService.mjs')).default;
    const entropyServices = createEntropyServices({
      io: { userLoadFile, userLoadCurrent },
      archiveService: ArchiveService,
      configService,
      logger: rootLogger.child({ module: 'entropy' })
    });
    app.use('/api/entropy', createEntropyApiRouter({
      entropyServices,
      configService,
      logger: rootLogger.child({ module: 'entropy-api' })
    }));
    rootLogger.info('entropy.api.mounted', { path: '/api/entropy' });

    // Mount API router on main app for webhook routes (journalist, foodlog)
    const { default: apiRouter } = await import('./api.mjs');
    app.use("/api", apiRouter);

    // Webhook route aliases (for backwards compatibility with Telegram webhook URLs)
    app.all('/foodlog', (req, res, next) => {
      req.url = '/api/foodlog';
      app.handle(req, res, next);
    });
    app.all('/journalist', (req, res, next) => {
      req.url = '/api/journalist';
      app.handle(req, res, next);
    });
    app.all('/journalist/*', (req, res, next) => {
      req.url = '/api' + req.url;
      app.handle(req, res, next);
    });

    // Frontend - only serve dist in production (Docker), not in dev
    const frontendPath = join(__dirname, '../../frontend/dist');
    const frontendExists = existsSync(frontendPath);

    if (isDocker && frontendExists) {
      // Production: Serve the frontend from the root URL
      app.use(express.static(frontendPath));

      // Forward non-matching paths to frontend for React Router to handle, but skip /ws/* for WebSocket
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/ws')) {
          // Let the WebSocket server handle this
          return next();
        }
        res.sendFile(join(frontendPath, 'index.html'));
      });
    } else if (isDocker) {
      rootLogger.warn('frontend.not_found', { path: frontendPath });
      app.use('/', (req, res, next) => {
        if (req.path.startsWith('/ws/') || req.path.startsWith('/api/')) return next();
        res.status(502).json({ error: 'Frontend not available', detail: 'Frontend dist not found. Build frontend or check deployment.' });
      });
    } else {
      // Dev mode: Don't serve frontend - use Vite dev server instead
      rootLogger.info('frontend.dev_mode', { message: 'Dev mode: frontend served by Vite, not backend' });
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/ws') || req.path.startsWith('/api')) {
          return next();
        }
        res.status(503).json({
          error: 'Dev mode - frontend not served by backend',
          detail: 'In development, use Vite dev server for frontend (default port 5173). Backend only handles /api/* routes.',
          hint: 'Run "npm run dev" to start both Vite and backend, or point your proxy to the Vite port.'
        });
      });
    }

  } else {
    // No config exists - return error for all routes
    app.get("*", function (req, res, next) {
      if (req.path.startsWith('/ws/')) return next();
      res.status(500).json({ error: 'This application is not configured yet. Ensure system.yml exists in the data mount.' });
    });
  }

  return app;
}
