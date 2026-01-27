# Backend Toggle Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a runtime toggle between legacy and new backends via `/api/toggle_backend` endpoint.

**Architecture:** Entry point (`index.js`) loads both backends, provides toggle endpoint, and routes requests to the active backend based on in-memory state. Defaults to legacy, resets on restart.

**Tech Stack:** Express.js, ES Modules, Node.js HTTP server

---

## Task 1: Extract Legacy App to app.mjs

**Files:**
- Create: `backend/_legacy/app.mjs`
- Modify: `backend/_legacy/index.js`

**Step 1: Create _legacy/app.mjs with createApp factory**

Create a new file that exports a factory function. This extracts the Express app setup from index.js.

```javascript
// backend/_legacy/app.mjs
/**
 * Legacy Backend App Factory
 *
 * Extracted from index.js to support toggle-based routing.
 * Call createApp() to get an Express app without starting the server.
 */

import express from 'express';
import cors from 'cors';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import path, { join } from 'path';

import { createWebsocketServer } from './routers/websocket.mjs';
import { loadFile } from './lib/io.mjs';
import { initMqttSubscriber } from './lib/mqtt.mjs';
import { userDataService } from './lib/config/UserDataService.mjs';
import { configService } from './lib/config/index.mjs';

import { loadRoutingConfig, ShimMetrics } from '../src/0_infrastructure/routing/index.mjs';
import { allShims } from '../src/4_api/shims/index.mjs';
import { createShimsRouter } from '../src/4_api/routers/admin/shims.mjs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

/**
 * Create and configure the legacy Express app
 * @param {Object} options
 * @param {Object} options.server - HTTP server instance for WebSocket attachment
 * @param {Object} options.logger - Logger instance
 * @param {Object} options.configPaths - Resolved config paths
 * @param {boolean} options.configExists - Whether config files exist
 * @returns {Promise<express.Application>}
 */
export async function createApp({ server, logger, configPaths, configExists }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Skip WebSocket paths from Express middleware
  app.use((req, res, next) => {
    if (req.path.startsWith('/ws')) {
      return next('route');
    }
    next();
  });

  if (!configExists) {
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/ws/')) return next();
      res.status(500).json({ error: 'Not configured. Ensure system.yml exists.' });
    });
    return app;
  }

  // Initialize WebSocket server
  await createWebsocketServer(server);

  // Initialize MQTT subscriber
  try {
    const householdId = configService.getDefaultHouseholdId();
    const householdConfig = userDataService.readHouseholdAppData(householdId, 'fitness', 'config');
    const equipmentConfig = householdConfig?.equipment || [];
    if (process.env.mqtt) {
      initMqttSubscriber(equipmentConfig);
    }
  } catch (err) {
    logger.error('mqtt.init.failed', { error: err?.message });
  }

  // Initialize routing toggle system
  const shimMetrics = new ShimMetrics();
  let routingConfig;
  try {
    routingConfig = loadRoutingConfig('./backend/config/routing.yml', allShims);
  } catch (error) {
    routingConfig = { default: 'legacy', routing: {} };
  }

  // Mount admin shims router
  app.use('/admin/shims', createShimsRouter({ metrics: shimMetrics }));

  // Import and mount all routers
  const { default: cron } = await import('./routers/cron.mjs');
  const { default: fetchRouter } = await import('./routers/fetch.mjs');
  const { default: harvestRouter } = await import('./routers/harvest.mjs');
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

  // Backend API endpoints
  app.post('/api/logs', (req, res) => {
    // Log ingestion endpoint - simplified for app.mjs
    const entries = Array.isArray(req.body) ? req.body : [req.body];
    let accepted = 0;
    for (const entry of entries) {
      if (entry?.event) accepted++;
    }
    res.status(accepted ? 202 : 400).json({ status: accepted ? 'ok' : 'error', accepted });
  });

  app.get('/debug', (_, res) => res.json({ process: { env: process.env } }));
  app.get('/api/ping', (_, res) => res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() }));
  app.get('/api/status', (_, res) => res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    serverdata: loadFile("state/cron")
  }));

  // Content domain (new DDD structure)
  const { createContentRegistry, createWatchStore, createFinanceServices, createFinanceApiRouter, createEntropyServices, createEntropyApiRouter } = await import('../src/0_infrastructure/bootstrap.mjs');
  const { createContentRouter } = await import('../src/4_api/routers/content.mjs');
  const { createProxyRouter } = await import('../src/4_api/routers/proxy.mjs');
  const { createListRouter } = await import('../src/4_api/routers/list.mjs');
  const { createPlayRouter } = await import('../src/4_api/routers/play.mjs');

  const mediaBasePath = process.env.path?.media || '/data/media';
  const dataBasePath = process.env.path?.data || '/data';
  const householdId = configService.getDefaultHouseholdId() || 'default';
  const householdDir = userDataService.getHouseholdDir(householdId) || `${dataBasePath}/households/${householdId}`;
  const plexConfig = process.env.media?.plex ? {
    host: process.env.media.plex.host,
    token: process.env.media.plex.token
  } : null;
  const watchlistPath = `${householdDir}/state/lists.yml`;
  const watchStatePath = process.env.path?.watchState || '/data/media_memory';

  const contentRegistry = createContentRegistry({ mediaBasePath, plex: plexConfig, dataPath: dataBasePath, watchlistPath });
  const watchStore = createWatchStore({ watchStatePath });

  app.use('/api/content', createContentRouter(contentRegistry, watchStore));
  app.use('/proxy', createProxyRouter({ registry: contentRegistry }));
  app.use('/api/list', createListRouter({ registry: contentRegistry }));
  app.use('/api/play', createPlayRouter({ registry: contentRegistry, watchStore }));

  // Finance domain
  const financeServices = createFinanceServices({
    dataRoot: dataBasePath,
    defaultHouseholdId: householdId,
    buxfer: process.env.finance?.buxfer,
    logger: logger.child({ module: 'finance' })
  });
  app.use('/api/finance', createFinanceApiRouter({ financeServices, configService, logger: logger.child({ module: 'finance-api' }) }));

  // Entropy domain
  const { userLoadFile, userLoadCurrent } = await import('./lib/io.mjs');
  const ArchiveService = (await import('./lib/ArchiveService.mjs')).default;
  const entropyServices = createEntropyServices({ io: { userLoadFile, userLoadCurrent }, archiveService: ArchiveService, configService, logger: logger.child({ module: 'entropy' }) });
  app.use('/api/entropy', createEntropyApiRouter({ entropyServices, configService, logger: logger.child({ module: 'entropy-api' }) }));

  // Legacy media/log endpoint with new WatchState system
  const { legacyMediaLogMiddleware } = await import('../src/4_api/middleware/legacyCompat.mjs');
  app.post('/media/log', legacyMediaLogMiddleware(watchStore));

  // Legacy finance shims
  app.get('/data/budget', (req, res) => res.redirect(307, '/api/finance/data'));
  app.get('/data/budget/daytoday', (req, res) => res.redirect(307, '/api/finance/data/daytoday'));
  app.get('/harvest/budget', (req, res) => res.redirect(307, '/api/finance/refresh'));
  app.post('/harvest/budget', (req, res) => res.redirect(307, '/api/finance/refresh'));

  // Mount routers
  app.use('/data', fetchRouter);
  app.use('/cron', cron);
  app.use('/harvest', harvestRouter);
  app.use('/home', homeRouter);
  app.use('/media', mediaRouter);
  app.use('/api/health', healthRouter);
  app.use('/api/lifelog', lifelogRouter);
  app.use('/api/fitness', fitnessRouter);
  app.use('/exe', exe);
  app.use('/print', printerRouter);
  app.use('/tts', tts);
  app.use('/api/gratitude', gratitudeRouter);
  app.use('/plex_proxy', plexProxyRouter);

  // Mount API router
  const { default: apiRouter } = await import('./api.mjs');
  app.use('/api', apiRouter);

  // Frontend static files
  const frontendPath = join(__dirname, '../frontend/dist');
  if (existsSync(frontendPath)) {
    app.use(express.static(frontendPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/ws')) return next();
      res.sendFile(join(frontendPath, 'index.html'));
    });
  } else {
    app.use('/', (req, res, next) => {
      if (req.path.startsWith('/ws/')) return next();
      res.redirect('http://localhost:3111');
    });
  }

  return app;
}

export default createApp;
```

**Step 2: Verify file was created**

Run: `ls -la backend/_legacy/app.mjs`
Expected: File exists

**Step 3: Commit**

```bash
git add backend/_legacy/app.mjs
git commit -m "feat(toggle): extract legacy app to app.mjs factory"
```

---

## Task 2: Slim Down Legacy index.js

**Files:**
- Modify: `backend/_legacy/index.js`

**Step 1: Replace index.js with minimal bootstrap**

Replace the entire file with a slim version that imports app.mjs and starts the server:

```javascript
// backend/_legacy/index.js
/**
 * Legacy Backend Entry Point
 *
 * Standalone entry point for running legacy backend directly.
 * For toggle-based routing, use backend/index.js instead.
 */

import { existsSync } from 'fs';
import { createServer } from 'http';
import path, { join } from 'path';
import 'dotenv/config';

import { resolveConfigPaths, getConfigFilePaths } from './lib/config/pathResolver.mjs';
import { loadAllConfig, logConfigSummary } from './lib/config/loader.mjs';
import { initConfigService, ConfigValidationError } from './lib/config/index.mjs';
import { hydrateProcessEnvFromConfigs } from './lib/logging/config.js';
import { initializeLogging } from './lib/logging/dispatcher.js';
import { createConsoleTransport, createFileTransport, createLogglyTransport } from './lib/logging/transports/index.js';
import { createLogger } from './lib/logging/logger.js';
import { loadLoggingConfig, resolveLoggerLevel, getLoggingTags, resolveLogglyToken } from './lib/logging/config.js';

import { createApp } from './app.mjs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const isDocker = existsSync('/.dockerenv');

async function main() {
  // Config initialization
  const configPaths = resolveConfigPaths({ isDocker, codebaseDir: join(__dirname, '..') });
  if (configPaths.error) {
    console.error('[FATAL] Configuration error:', configPaths.error);
    process.exit(1);
  }

  const configFiles = getConfigFilePaths(configPaths.configDir);
  const configExists = configFiles && existsSync(configFiles.system);

  hydrateProcessEnvFromConfigs(configPaths.configDir);

  try {
    initConfigService(configPaths.dataDir);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error('[FATAL] Config validation failed:', err.message);
      process.exit(1);
    }
    throw err;
  }

  // Load full config
  if (configExists) {
    const configResult = loadAllConfig({ configDir: configPaths.configDir, dataDir: configPaths.dataDir, isDocker, isDev: !isDocker });
    process.env = { ...process.env, isDocker, ...configResult.config };
  }

  // Logging initialization
  const loggingConfig = loadLoggingConfig();
  const dispatcher = initializeLogging({
    defaultLevel: resolveLoggerLevel('backend', loggingConfig),
    componentLevels: loggingConfig.loggers || {}
  });

  dispatcher.addTransport(createConsoleTransport({ colorize: !isDocker, format: isDocker ? 'json' : 'pretty' }));

  if (!isDocker) {
    dispatcher.addTransport(createFileTransport({
      filename: join(__dirname, '..', 'dev.log'),
      format: 'json',
      maxSize: 50 * 1024 * 1024,
      maxFiles: 3,
      colorize: false
    }));
  }

  const logglyToken = resolveLogglyToken();
  const logglySubdomain = process.env.LOGGLY_SUBDOMAIN || process.env.LOGGLY_SUB_DOMAIN;
  if (logglyToken && logglySubdomain) {
    dispatcher.addTransport(createLogglyTransport({ token: logglyToken, subdomain: logglySubdomain, tags: getLoggingTags(loggingConfig) }));
  }

  const logger = createLogger({ source: 'backend', app: 'api', context: { env: process.env.NODE_ENV } });

  // Create HTTP server and app
  const server = createServer();
  const app = await createApp({ server, logger, configPaths, configExists });

  // Mount app on server
  server.on('request', app);

  // Start server
  const port = process.env.PORT || 3112;
  server.listen(port, '0.0.0.0', () => {
    logger.info('server.started', { port, host: '0.0.0.0', mode: 'standalone-legacy' });
  });
}

main().catch(err => {
  console.error('[FATAL] Server initialization failed:', err.message, err.stack);
  process.exit(1);
});
```

**Step 2: Verify syntax**

Run: `node --check backend/_legacy/index.js`
Expected: No output (syntax valid)

**Step 3: Commit**

```bash
git add backend/_legacy/index.js
git commit -m "refactor(legacy): slim down index.js to use app.mjs factory"
```

---

## Task 3: Create New Backend app.mjs

**Files:**
- Create: `backend/src/app.mjs`
- Modify: `backend/src/server.mjs`

**Step 1: Create src/app.mjs with createApp factory**

Extract the app setup from server.mjs into a factory function that accepts `enableScheduler` option:

```javascript
// backend/src/app.mjs
/**
 * New Backend App Factory
 *
 * Extracted from server.mjs to support toggle-based routing.
 * Call createApp() to get an Express app without starting the server.
 */

import express from 'express';
import cors from 'cors';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import path, { join } from 'path';

import { configService } from '../_legacy/lib/config/index.mjs';
import { userDataService } from '../_legacy/lib/config/UserDataService.mjs';
import { loadFile, saveFile } from '../_legacy/lib/io.mjs';

import {
  createContentRegistry,
  createWatchStore,
  createApiRouters,
  createFitnessServices,
  createFitnessApiRouter,
  createFinanceServices,
  createFinanceApiRouter,
  createEntropyServices,
  createEntropyApiRouter,
  createHealthServices,
  createHealthApiRouter,
  createGratitudeServices,
  createGratitudeApiRouter,
  createHomeAutomationAdapters,
  createHomeAutomationApiRouter,
  createHardwareAdapters,
  createPrinterApiRouter,
  createTTSApiRouter,
  createProxyService,
  createExternalProxyApiRouter,
  createMessagingServices,
  createMessagingApiRouter,
  createJournalistServices,
  createJournalistApiRouter,
  createNutribotServices,
  createNutribotApiRouter,
  createLifelogServices,
  createLifelogApiRouter,
  createStaticApiRouter,
  createCalendarApiRouter,
  createEventBus,
  broadcastEvent
} from './0_infrastructure/bootstrap.mjs';

import { loadRoutingConfig, ShimMetrics } from './0_infrastructure/routing/index.mjs';
import { allShims } from './4_api/shims/index.mjs';
import { createShimsRouter } from './4_api/routers/admin/shims.mjs';
import { createEventBusRouter } from './4_api/routers/admin/eventbus.mjs';
import { getLegacyTracker } from './4_api/middleware/legacyTracker.mjs';
import { createLegacyAdminRouter } from './4_api/routers/admin/legacy.mjs';

import { SchedulerService } from './1_domains/scheduling/services/SchedulerService.mjs';
import { YamlJobStore } from './2_adapters/scheduling/YamlJobStore.mjs';
import { YamlStateStore } from './2_adapters/scheduling/YamlStateStore.mjs';
import { Scheduler } from './0_infrastructure/scheduling/Scheduler.mjs';
import { createSchedulingRouter } from './4_api/routers/scheduling.mjs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

/**
 * Create and configure the new DDD-based Express app
 * @param {Object} options
 * @param {Object} options.server - HTTP server instance for WebSocket attachment
 * @param {Object} options.logger - Logger instance
 * @param {Object} options.configPaths - Resolved config paths
 * @param {boolean} options.configExists - Whether config files exist
 * @param {boolean} [options.enableScheduler=true] - Whether to start the scheduler
 * @returns {Promise<express.Application>}
 */
export async function createApp({ server, logger, configPaths, configExists, enableScheduler = true }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Skip WebSocket paths
  app.use((req, res, next) => {
    if (req.path.startsWith('/ws')) return next('route');
    next();
  });

  if (!configExists) {
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/ws/')) return next();
      res.status(500).json({ error: 'Not configured. Ensure system.yml exists.' });
    });
    return app;
  }

  // Initialize WebSocket and EventBus
  const { createWebsocketServer } = await import('../_legacy/routers/websocket.mjs');
  await createWebsocketServer(server);
  const eventBus = createEventBus({ logger: logger.child({ module: 'eventbus' }) });

  // Core paths
  const dataBasePath = process.env.path?.data || process.env.DATA_PATH || '/data';
  const mediaBasePath = process.env.path?.media || process.env.MEDIA_PATH || '/data/media';
  const householdId = configService.getDefaultHouseholdId() || 'default';
  const householdDir = userDataService.getHouseholdDir(householdId) || `${dataBasePath}/households/${householdId}`;
  const watchStatePath = process.env.path?.watchState || process.env.WATCH_STATE_PATH || '/data/media_memory';

  // Shim metrics and admin
  const shimMetrics = new ShimMetrics();
  app.use('/admin/shims', createShimsRouter({ metrics: shimMetrics }));
  app.use('/admin/eventbus', createEventBusRouter({ eventBus, logger }));

  // Health endpoints
  app.get('/api/ping', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
  app.get('/api/status', (_, res) => res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() }));

  // Content domain
  const plexConfig = process.env.media?.plex ? { host: process.env.media.plex.host, token: process.env.media.plex.token } : null;
  const watchlistPath = `${householdDir}/state/lists.yml`;
  const contentRegistry = createContentRegistry({ mediaBasePath, plex: plexConfig, dataPath: dataBasePath, watchlistPath });
  const watchStore = createWatchStore({ watchStatePath });
  const contentRouters = createApiRouters({ registry: contentRegistry, watchStore, logger });

  app.use('/api/content', contentRouters.content);
  app.use('/api/list', contentRouters.list);
  app.use('/api/play', contentRouters.play);
  app.use('/proxy', contentRouters.proxy);
  app.post('/media/log', contentRouters.legacyShims.mediaLog);

  // Fitness domain
  const fitnessServices = createFitnessServices({ dataRoot: dataBasePath, householdId, configService, logger: logger.child({ module: 'fitness' }) });
  app.use('/api/fitness', createFitnessApiRouter({ fitnessServices, configService, userDataService, logger: logger.child({ module: 'fitness-api' }) }));

  // Finance domain
  const financeServices = createFinanceServices({ dataRoot: dataBasePath, defaultHouseholdId: householdId, buxfer: process.env.finance?.buxfer, logger: logger.child({ module: 'finance' }) });
  app.use('/api/finance', createFinanceApiRouter({ financeServices, configService, logger: logger.child({ module: 'finance-api' }) }));

  // Health domain
  const healthServices = createHealthServices({ dataRoot: dataBasePath, householdId, configService, logger: logger.child({ module: 'health' }) });
  app.use('/api/health', createHealthApiRouter({ healthServices, configService, logger: logger.child({ module: 'health-api' }) }));

  // Gratitude domain
  const gratitudeServices = createGratitudeServices({ dataRoot: dataBasePath, householdId, configService, logger: logger.child({ module: 'gratitude' }) });
  app.use('/api/gratitude', createGratitudeApiRouter({ gratitudeServices, configService, logger: logger.child({ module: 'gratitude-api' }) }));

  // Entropy domain
  const { userLoadFile, userLoadCurrent } = await import('../_legacy/lib/io.mjs');
  const ArchiveService = (await import('../_legacy/lib/ArchiveService.mjs')).default;
  const entropyServices = createEntropyServices({ io: { userLoadFile, userLoadCurrent }, archiveService: ArchiveService, configService, logger: logger.child({ module: 'entropy' }) });
  app.use('/api/entropy', createEntropyApiRouter({ entropyServices, configService, logger: logger.child({ module: 'entropy-api' }) }));

  // Home automation domain
  const homeAdapters = createHomeAutomationAdapters({ logger: logger.child({ module: 'home' }) });
  app.use('/api/home', createHomeAutomationApiRouter({ adapters: homeAdapters, configService, logger: logger.child({ module: 'home-api' }) }));

  // Hardware adapters
  const hardwareAdapters = createHardwareAdapters({ logger: logger.child({ module: 'hardware' }) });
  app.use('/print', createPrinterApiRouter({ adapter: hardwareAdapters.printer, logger: logger.child({ module: 'printer-api' }) }));
  app.use('/tts', createTTSApiRouter({ adapter: hardwareAdapters.tts, logger: logger.child({ module: 'tts-api' }) }));

  // External proxy
  const proxyService = createProxyService({ logger: logger.child({ module: 'proxy' }) });
  app.use('/plex_proxy', createExternalProxyApiRouter({ proxyService, serviceName: 'plex', logger: logger.child({ module: 'plex-proxy-api' }) }));

  // Messaging services
  const messagingServices = createMessagingServices({ configService, logger: logger.child({ module: 'messaging' }) });
  app.use('/api/messaging', createMessagingApiRouter({ messagingServices, logger: logger.child({ module: 'messaging-api' }) }));

  // Journalist bot
  const journalistServices = createJournalistServices({ dataRoot: dataBasePath, householdId, messagingServices, configService, logger: logger.child({ module: 'journalist' }) });
  app.use('/api/journalist', createJournalistApiRouter({ journalistServices, logger: logger.child({ module: 'journalist-api' }) }));

  // Nutribot
  const nutribotServices = createNutribotServices({ dataRoot: dataBasePath, householdId, messagingServices, configService, logger: logger.child({ module: 'nutribot' }) });
  app.use('/api/nutribot', createNutribotApiRouter({ nutribotServices, logger: logger.child({ module: 'nutribot-api' }) }));

  // Lifelog
  const lifelogServices = createLifelogServices({ dataRoot: dataBasePath, householdId, configService, logger: logger.child({ module: 'lifelog' }) });
  app.use('/api/lifelog', createLifelogApiRouter({ lifelogServices, logger: logger.child({ module: 'lifelog-api' }) }));

  // Calendar
  app.use('/api/calendar', createCalendarApiRouter({ dataRoot: dataBasePath, householdId, configService, logger: logger.child({ module: 'calendar-api' }) }));

  // Static assets
  app.use('/api/static', createStaticApiRouter({ dataRoot: dataBasePath, mediaRoot: mediaBasePath, logger: logger.child({ module: 'static-api' }) }));

  // Scheduling domain - only start scheduler if enabled
  const schedulingJobStore = new YamlJobStore({ loadFile, logger: logger.child({ module: 'scheduling-jobs' }) });
  const schedulingStateStore = new YamlStateStore({ loadFile, saveFile, logger: logger.child({ module: 'scheduling-state' }) });
  const schedulerService = new SchedulerService({ jobStore: schedulingJobStore, stateStore: schedulingStateStore, timezone: 'America/Los_Angeles', logger: logger.child({ module: 'scheduler-service' }) });
  const scheduler = new Scheduler({ schedulerService, intervalMs: 5000, logger: logger.child({ module: 'scheduler' }) });

  if (enableScheduler) {
    scheduler.start();
    logger.info('scheduler.started', { enabled: true });
  } else {
    logger.info('scheduler.disabled', { reason: 'toggle mode - legacy scheduler active' });
  }

  app.use('/api/scheduling', createSchedulingRouter({ schedulerService, scheduler, logger: logger.child({ module: 'scheduling-api' }) }));

  // Legacy compatibility redirects
  app.get('/data/budget', (req, res) => res.redirect(307, '/api/finance/data'));
  app.get('/data/budget/daytoday', (req, res) => res.redirect(307, '/api/finance/data/daytoday'));
  app.get('/harvest/budget', (req, res) => res.redirect(307, '/api/finance/refresh'));
  app.post('/harvest/budget', (req, res) => res.redirect(307, '/api/finance/refresh'));
  app.use('/media/plex/list', (req, res) => res.redirect(307, `/api/list/plex${req.url}`));
  app.use('/data/list', (req, res) => res.redirect(307, `/api/list/folder${req.url}`));
  app.get('/data/events', (req, res) => res.redirect(307, '/api/calendar/events'));
  app.get('/data/lifelog/weight', (req, res) => res.redirect(307, '/api/health/weight'));

  // Mount legacy routers with tracking
  const legacyTracker = getLegacyTracker({ logger });
  const { default: fetchRouter } = await import('../_legacy/routers/fetch.mjs');
  const { default: harvestRouter } = await import('../_legacy/routers/harvest.mjs');
  const { default: homeRouter } = await import('../_legacy/routers/home.mjs');
  const { default: mediaRouter } = await import('../_legacy/routers/media.mjs');
  const { default: cronRouter } = await import('../_legacy/routers/cron.mjs');
  const { default: plexProxyRouter } = await import('../_legacy/routers/plexProxy.mjs');
  const { default: exeRouter } = await import('../_legacy/routers/exe.mjs');
  const { default: apiRouter } = await import('../_legacy/api.mjs');

  app.use('/data', legacyTracker.middleware, fetchRouter);
  app.use('/harvest', legacyTracker.middleware, harvestRouter);
  app.use('/home', legacyTracker.middleware, homeRouter);
  app.use('/media', legacyTracker.middleware, mediaRouter);
  app.use('/cron', legacyTracker.middleware, cronRouter);
  app.use('/plex_proxy', legacyTracker.middleware, plexProxyRouter);
  app.use('/exe', legacyTracker.middleware, exeRouter);
  app.use('/api', legacyTracker.middleware, apiRouter);

  // Frontend
  const frontendPath = join(__dirname, '..', 'frontend', 'dist');
  if (existsSync(frontendPath)) {
    app.use(express.static(frontendPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/ws')) return next();
      res.sendFile(join(frontendPath, 'index.html'));
    });
  } else {
    app.use('/', (req, res, next) => {
      if (req.path.startsWith('/ws/')) return next();
      res.redirect('http://localhost:3111');
    });
  }

  return app;
}

export default createApp;
```

**Step 2: Verify file was created**

Run: `ls -la backend/src/app.mjs`
Expected: File exists

**Step 3: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(toggle): extract new backend app to app.mjs factory"
```

---

## Task 4: Slim Down src/server.mjs

**Files:**
- Modify: `backend/src/server.mjs`

**Step 1: Replace server.mjs with minimal bootstrap**

Replace with a slim version that uses app.mjs:

```javascript
// backend/src/server.mjs
/**
 * DaylightStation Server Entry Point (New DDD Backend)
 *
 * Standalone entry point for running new backend directly.
 * For toggle-based routing, use backend/index.js instead.
 */

import { existsSync } from 'fs';
import { createServer } from 'http';
import path, { join } from 'path';
import 'dotenv/config';

import { resolveConfigPaths, getConfigFilePaths } from '../_legacy/lib/config/pathResolver.mjs';
import { loadAllConfig, logConfigSummary } from '../_legacy/lib/config/loader.mjs';
import { initConfigService, ConfigValidationError } from '../_legacy/lib/config/index.mjs';
import { hydrateProcessEnvFromConfigs } from '../_legacy/lib/logging/config.js';
import { initializeLogging } from './0_infrastructure/logging/dispatcher.js';
import { createConsoleTransport, createFileTransport, createLogglyTransport } from './0_infrastructure/logging/transports/index.js';
import { createLogger } from './0_infrastructure/logging/logger.js';
import { loadLoggingConfig, resolveLoggerLevel, getLoggingTags, resolveLogglyToken } from '../_legacy/lib/logging/config.js';

import { createApp } from './app.mjs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const isDocker = existsSync('/.dockerenv');

async function main() {
  // Config initialization
  const configPaths = resolveConfigPaths({ isDocker, codebaseDir: join(__dirname, '..', '..') });
  if (configPaths.error) {
    console.error('[FATAL] Configuration error:', configPaths.error);
    process.exit(1);
  }

  const configFiles = getConfigFilePaths(configPaths.configDir);
  const configExists = configFiles && existsSync(configFiles.system);

  hydrateProcessEnvFromConfigs(configPaths.configDir);

  try {
    initConfigService(configPaths.dataDir);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error('[FATAL] Config validation failed:', err.message);
      process.exit(1);
    }
    throw err;
  }

  // Load full config
  if (configExists) {
    const configResult = loadAllConfig({ configDir: configPaths.configDir, dataDir: configPaths.dataDir, isDocker, isDev: !isDocker });
    process.env = { ...process.env, isDocker, ...configResult.config };
  }

  // Logging initialization
  const loggingConfig = loadLoggingConfig();
  const dispatcher = initializeLogging({
    defaultLevel: resolveLoggerLevel('backend', loggingConfig),
    componentLevels: loggingConfig.loggers || {}
  });

  dispatcher.addTransport(createConsoleTransport({ colorize: !isDocker, format: isDocker ? 'json' : 'pretty' }));

  if (!isDocker) {
    dispatcher.addTransport(createFileTransport({
      filename: join(__dirname, '..', 'dev.log'),
      format: 'json',
      maxSize: 50 * 1024 * 1024,
      maxFiles: 3,
      colorize: false
    }));
  }

  const logglyToken = resolveLogglyToken();
  const logglySubdomain = process.env.LOGGLY_SUBDOMAIN || process.env.LOGGLY_SUB_DOMAIN;
  if (logglyToken && logglySubdomain) {
    dispatcher.addTransport(createLogglyTransport({ token: logglyToken, subdomain: logglySubdomain, tags: getLoggingTags(loggingConfig) }));
  }

  const logger = createLogger({ source: 'backend', app: 'api', context: { env: process.env.NODE_ENV } });

  // Create HTTP server and app
  const server = createServer();
  const app = await createApp({ server, logger, configPaths, configExists, enableScheduler: true });

  // Mount app on server
  server.on('request', app);

  // Start server
  const port = process.env.PORT || 3112;
  server.listen(port, '0.0.0.0', () => {
    logger.info('server.started', { port, host: '0.0.0.0', mode: 'standalone-new' });
  });
}

main().catch(err => {
  console.error('[FATAL] Server initialization failed:', err.message, err.stack);
  process.exit(1);
});
```

**Step 2: Verify syntax**

Run: `node --check backend/src/server.mjs`
Expected: No output (syntax valid)

**Step 3: Commit**

```bash
git add backend/src/server.mjs
git commit -m "refactor(new): slim down server.mjs to use app.mjs factory"
```

---

## Task 5: Create Toggle Entry Point

**Files:**
- Modify: `backend/index.js`

**Step 1: Rewrite index.js with toggle logic**

Replace the current proxy with full toggle implementation:

```javascript
// backend/index.js
/**
 * DaylightStation Backend Entry Point with Toggle
 *
 * Provides runtime toggle between legacy and new backends via /api/toggle_backend.
 * Defaults to 'legacy' on every restart for safety.
 */

import express from 'express';
import { createServer } from 'http';
import { existsSync } from 'fs';
import path, { join } from 'path';
import 'dotenv/config';

import { resolveConfigPaths, getConfigFilePaths } from './_legacy/lib/config/pathResolver.mjs';
import { loadAllConfig } from './_legacy/lib/config/loader.mjs';
import { initConfigService, ConfigValidationError } from './_legacy/lib/config/index.mjs';
import { hydrateProcessEnvFromConfigs } from './_legacy/lib/logging/config.js';
import { initializeLogging } from './_legacy/lib/logging/dispatcher.js';
import { createConsoleTransport, createFileTransport, createLogglyTransport } from './_legacy/lib/logging/transports/index.js';
import { createLogger } from './_legacy/lib/logging/logger.js';
import { loadLoggingConfig, resolveLoggerLevel, getLoggingTags, resolveLogglyToken } from './_legacy/lib/logging/config.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const isDocker = existsSync('/.dockerenv');

// Toggle state - defaults to legacy, resets on restart
let activeBackend = 'legacy';

async function main() {
  // ==========================================================================
  // Shared Configuration (runs once for both backends)
  // ==========================================================================

  const configPaths = resolveConfigPaths({ isDocker, codebaseDir: __dirname });
  if (configPaths.error) {
    console.error('[FATAL] Configuration error:', configPaths.error);
    process.exit(1);
  }

  console.log(`[Config] Source: ${configPaths.source}, Config: ${configPaths.configDir}`);

  const configFiles = getConfigFilePaths(configPaths.configDir);
  const configExists = configFiles && existsSync(configFiles.system);

  hydrateProcessEnvFromConfigs(configPaths.configDir);

  try {
    initConfigService(configPaths.dataDir);
    console.log('[Config] ConfigService initialized');
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error('[FATAL] Config validation failed:', err.message);
      process.exit(1);
    }
    throw err;
  }

  // Load full config into process.env
  if (configExists) {
    const configResult = loadAllConfig({
      configDir: configPaths.configDir,
      dataDir: configPaths.dataDir,
      isDocker,
      isDev: !isDocker
    });
    process.env = { ...process.env, isDocker, ...configResult.config };
  }

  // ==========================================================================
  // Shared Logging (runs once for both backends)
  // ==========================================================================

  const loggingConfig = loadLoggingConfig();
  const dispatcher = initializeLogging({
    defaultLevel: resolveLoggerLevel('backend', loggingConfig),
    componentLevels: loggingConfig.loggers || {}
  });

  dispatcher.addTransport(createConsoleTransport({
    colorize: !isDocker,
    format: isDocker ? 'json' : 'pretty'
  }));

  if (!isDocker) {
    dispatcher.addTransport(createFileTransport({
      filename: join(__dirname, 'dev.log'),
      format: 'json',
      maxSize: 50 * 1024 * 1024,
      maxFiles: 3,
      colorize: false
    }));
  }

  const logglyToken = resolveLogglyToken();
  const logglySubdomain = process.env.LOGGLY_SUBDOMAIN || process.env.LOGGLY_SUB_DOMAIN;
  if (logglyToken && logglySubdomain) {
    dispatcher.addTransport(createLogglyTransport({
      token: logglyToken,
      subdomain: logglySubdomain,
      tags: getLoggingTags(loggingConfig)
    }));
  }

  const logger = createLogger({
    source: 'backend',
    app: 'toggle',
    context: { env: process.env.NODE_ENV }
  });

  // ==========================================================================
  // Create HTTP Server and Load Both Backends
  // ==========================================================================

  const server = createServer();

  logger.info('toggle.loading_backends', { message: 'Loading legacy and new backends...' });

  // Load legacy backend (scheduler runs here)
  const { createApp: createLegacyApp } = await import('./_legacy/app.mjs');
  const legacyApp = await createLegacyApp({ server, logger, configPaths, configExists });
  logger.info('toggle.legacy_loaded', { message: 'Legacy backend loaded' });

  // Load new backend (scheduler disabled - legacy handles it)
  const { createApp: createNewApp } = await import('./src/app.mjs');
  const newApp = await createNewApp({ server, logger, configPaths, configExists, enableScheduler: false });
  logger.info('toggle.new_loaded', { message: 'New backend loaded (scheduler disabled)' });

  // ==========================================================================
  // Toggle Router
  // ==========================================================================

  const toggleRouter = express.Router();
  toggleRouter.use(express.json());

  // GET /api/toggle_backend - Get current state
  toggleRouter.get('/api/toggle_backend', (req, res) => {
    res.json({ active: activeBackend });
  });

  // POST /api/toggle_backend - Switch backend
  toggleRouter.post('/api/toggle_backend', (req, res) => {
    const { target } = req.body;
    if (target !== 'legacy' && target !== 'new') {
      return res.status(400).json({ error: 'target must be "legacy" or "new"' });
    }
    const previous = activeBackend;
    activeBackend = target;
    logger.info('toggle.switched', { from: previous, to: target });
    res.json({ active: activeBackend, switched: true, previous });
  });

  // ==========================================================================
  // Request Routing
  // ==========================================================================

  server.on('request', (req, res) => {
    // Add header to indicate which backend served the request
    res.setHeader('X-Backend', activeBackend);

    // Handle toggle endpoint first (before routing to backends)
    if (req.url === '/api/toggle_backend' || req.url.startsWith('/api/toggle_backend?')) {
      return toggleRouter(req, res);
    }

    // Route to active backend
    const targetApp = activeBackend === 'legacy' ? legacyApp : newApp;
    targetApp(req, res);
  });

  // ==========================================================================
  // Start Server
  // ==========================================================================

  const port = process.env.PORT || 3112;
  server.listen(port, '0.0.0.0', () => {
    logger.info('server.started', {
      port,
      host: '0.0.0.0',
      mode: 'toggle',
      active: activeBackend,
      message: `Toggle active: ${activeBackend}. Use POST /api/toggle_backend to switch.`
    });
  });
}

main().catch(err => {
  console.error('[FATAL] Server initialization failed:', err.message, err.stack);
  process.exit(1);
});
```

**Step 2: Verify syntax**

Run: `node --check backend/index.js`
Expected: No output (syntax valid)

**Step 3: Commit**

```bash
git add backend/index.js
git commit -m "feat(toggle): implement backend toggle via /api/toggle_backend"
```

---

## Task 6: Manual Testing

**Step 1: Start the server**

Run: `cd /root/Code/DaylightStation && npm run dev`
Expected: Server starts, logs show "Toggle active: legacy"

**Step 2: Test GET toggle status**

Run: `curl http://localhost:3112/api/toggle_backend`
Expected: `{"active":"legacy"}`

**Step 3: Test switching to new**

Run: `curl -X POST http://localhost:3112/api/toggle_backend -H "Content-Type: application/json" -d '{"target":"new"}'`
Expected: `{"active":"new","switched":true,"previous":"legacy"}`

**Step 4: Verify X-Backend header**

Run: `curl -I http://localhost:3112/api/ping`
Expected: Headers include `X-Backend: new`

**Step 5: Test switching back to legacy**

Run: `curl -X POST http://localhost:3112/api/toggle_backend -H "Content-Type: application/json" -d '{"target":"legacy"}'`
Expected: `{"active":"legacy","switched":true,"previous":"new"}`

**Step 6: Commit test confirmation**

```bash
git commit --allow-empty -m "test: manual toggle verification complete"
```

---

## Task 7: Update Design Doc with Implementation Status

**Files:**
- Modify: `docs/plans/2026-01-20-backend-toggle-design.md`

**Step 1: Add implementation status**

Add to the top of the design doc:

```markdown
**Implementation:** Complete - see `docs/plans/2026-01-20-backend-toggle-implementation.md`
```

**Step 2: Commit**

```bash
git add docs/plans/2026-01-20-backend-toggle-design.md
git commit -m "docs: mark toggle design as implemented"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Extract legacy app to app.mjs | `_legacy/app.mjs` (new) |
| 2 | Slim down legacy index.js | `_legacy/index.js` |
| 3 | Create new backend app.mjs | `src/app.mjs` (new) |
| 4 | Slim down src/server.mjs | `src/server.mjs` |
| 5 | Create toggle entry point | `index.js` |
| 6 | Manual testing | - |
| 7 | Update design doc | `docs/plans/*.md` |

**Total commits:** 7
