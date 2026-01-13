/**
 * DaylightStation Server Entry Point
 *
 * Clean DDD-based server that wires domain services and API routers.
 * Gradually replacing backend/_legacy/index.js
 *
 * @module server
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import path, { join } from 'path';
import 'dotenv/config';

// Infrastructure imports
import { resolveConfigPaths, getConfigFilePaths } from '../_legacy/lib/config/pathResolver.mjs';
import { loadAllConfig, logConfigSummary } from '../_legacy/lib/config/loader.mjs';
import { initConfigService, ConfigValidationError, configService } from '../_legacy/lib/config/index.mjs';
import { userDataService } from '../_legacy/lib/config/UserDataService.mjs';
import { userService } from '../_legacy/lib/config/UserService.mjs';
import { hydrateProcessEnvFromConfigs } from '../_legacy/lib/logging/config.js';

// Logging system
import { initializeLogging, getDispatcher } from './0_infrastructure/logging/dispatcher.js';
import { createConsoleTransport, createFileTransport, createLogglyTransport } from './0_infrastructure/logging/transports/index.js';
import { createLogger } from './0_infrastructure/logging/logger.js';
import { loadLoggingConfig, resolveLoggerLevel, getLoggingTags, resolveLogglyToken } from '../_legacy/lib/logging/config.js';

// Bootstrap functions
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
  createEventBus,
  broadcastEvent
} from './0_infrastructure/bootstrap.mjs';

// Routing toggle system
import { loadRoutingConfig, ShimMetrics } from './0_infrastructure/routing/index.mjs';
import { allShims } from './4_api/shims/index.mjs';
import { createShimsRouter } from './4_api/routers/admin/shims.mjs';

// Legacy tracking
import { getLegacyTracker } from './4_api/middleware/legacyTracker.mjs';
import { createLegacyAdminRouter } from './4_api/routers/admin/legacy.mjs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const isDocker = existsSync('/.dockerenv');

/**
 * Initialize and start the server
 */
async function main() {
  // ==========================================================================
  // Configuration
  // ==========================================================================

  const configPaths = resolveConfigPaths({ isDocker, codebaseDir: join(__dirname, '..', '..') });

  if (configPaths.error) {
    console.error('[FATAL] Configuration error:', configPaths.error);
    console.error('[FATAL] Set DAYLIGHT_CONFIG_PATH and DAYLIGHT_DATA_PATH environment variables');
    process.exit(1);
  }

  console.log(`[Config] Source: ${configPaths.source}, Config: ${configPaths.configDir}`);

  // Check for config files
  const configFiles = getConfigFilePaths(configPaths.configDir);
  const configExists = configFiles && existsSync(configFiles.system);

  // Hydrate process.env with config values (for logging)
  hydrateProcessEnvFromConfigs(configPaths.configDir);

  // Initialize ConfigService v2
  try {
    initConfigService(configPaths.dataDir);
    console.log('[Config] ConfigService v2 initialized with dataDir:', configPaths.dataDir);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error('[FATAL] Config validation failed:', err.message);
      process.exit(1);
    }
    throw err;
  }

  // ==========================================================================
  // Logging
  // ==========================================================================

  let loggingConfig = loadLoggingConfig();

  const dispatcher = initializeLogging({
    defaultLevel: resolveLoggerLevel('backend', loggingConfig),
    componentLevels: loggingConfig.loggers || {}
  });

  // Console transport
  dispatcher.addTransport(createConsoleTransport({
    colorize: !isDocker,
    format: isDocker ? 'json' : 'pretty'
  }));

  // File transport in development
  if (!isDocker) {
    dispatcher.addTransport(createFileTransport({
      filename: join(__dirname, '..', 'dev.log'),
      format: 'json',
      maxSize: 50 * 1024 * 1024,
      maxFiles: 3,
      colorize: false
    }));
    console.log('[Logging] File transport enabled: dev.log (max 50MB, 3 files)');
  }

  // Loggly transport if configured
  const logglyToken = resolveLogglyToken();
  const logglySubdomain = process.env.LOGGLY_SUBDOMAIN || process.env.LOGGLY_SUB_DOMAIN;
  if (logglyToken && logglySubdomain) {
    dispatcher.addTransport(createLogglyTransport({
      token: logglyToken,
      subdomain: logglySubdomain,
      tags: getLoggingTags(loggingConfig) || ['daylight', 'backend']
    }));
  }

  let logger = createLogger({
    source: 'backend',
    app: 'api',
    context: { env: process.env.NODE_ENV }
  });

  // ==========================================================================
  // Express App Setup
  // ==========================================================================

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Create HTTP server
  const server = createServer(app);

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
      res.status(500).json({ error: 'Application not configured. Ensure system.yml exists.' });
    });
    startServer(server, logger);
    return;
  }

  // ==========================================================================
  // Load Full Configuration
  // ==========================================================================

  const configResult = loadAllConfig({
    configDir: configPaths.configDir,
    dataDir: configPaths.dataDir,
    isDocker,
    isDev: !isDocker
  });

  process.env = { ...process.env, isDocker, ...configResult.config };

  // Update logging with final config
  loggingConfig = loadLoggingConfig();
  dispatcher.setLevel(resolveLoggerLevel('backend', loggingConfig));
  dispatcher.componentLevels = loggingConfig.loggers || {};

  logger = createLogger({
    source: 'backend',
    app: 'api',
    context: { env: process.env.NODE_ENV }
  });

  logConfigSummary(configResult, logger);

  // ==========================================================================
  // Routing Toggle System
  // ==========================================================================

  const shimMetrics = new ShimMetrics();
  let routingConfig;
  try {
    routingConfig = loadRoutingConfig('./backend/config/routing.yml', allShims);
    logger.info('routing.toggle.loaded', { default: routingConfig.default });
  } catch (error) {
    logger.warn('routing.toggle.fallback', { error: error.message });
    routingConfig = { default: 'legacy', routing: {} };
  }

  // Admin routers
  app.use('/admin/shims', createShimsRouter({ metrics: shimMetrics }));
  app.use('/admin/legacy', createLegacyAdminRouter({ logger }));

  // ==========================================================================
  // Initialize Services
  // ==========================================================================

  const dataBasePath = process.env.path?.data || process.env.DATA_PATH || '/data';
  const mediaBasePath = process.env.path?.media || process.env.MEDIA_PATH || '/data/media';
  const householdId = configService.getDefaultHouseholdId() || 'default';
  const householdDir = userDataService.getHouseholdDir(householdId) || `${dataBasePath}/households/${householdId}`;

  // EventBus (WebSocket)
  const eventBus = await createEventBus({
    httpServer: server,
    path: '/ws',
    logger
  });

  // Content domain
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

  const watchStatePath = process.env.path?.watchState || process.env.WATCH_STATE_PATH || '/data/media_memory';
  const watchStore = createWatchStore({ watchStatePath });

  const contentRouters = createApiRouters({ registry: contentRegistry, watchStore });

  // Health domain
  const healthServices = createHealthServices({
    userDataService,
    configService,
    logger
  });

  // Finance domain
  const financeServices = createFinanceServices({
    dataRoot: dataBasePath,
    defaultHouseholdId: householdId,
    buxfer: process.env.finance?.buxfer ? {
      email: process.env.finance.buxfer.email,
      password: process.env.finance.buxfer.password
    } : null,
    logger: logger.child({ module: 'finance' })
  });

  // Entropy domain
  const { userLoadFile, userLoadCurrent } = await import('../_legacy/lib/io.mjs');
  const ArchiveService = (await import('../_legacy/lib/ArchiveService.mjs')).default;
  const entropyServices = createEntropyServices({
    io: { userLoadFile, userLoadCurrent },
    archiveService: ArchiveService,
    configService,
    logger: logger.child({ module: 'entropy' })
  });

  // Gratitude domain
  const gratitudeServices = createGratitudeServices({
    userDataService,
    logger: logger.child({ module: 'gratitude' })
  });

  // Fitness domain
  const homeAssistantConfig = process.env.home_assistant || {};
  const loadFitnessConfig = (hid) => {
    const householdId = hid || configService.getDefaultHouseholdId();
    return userDataService.readHouseholdAppData(householdId, 'fitness', 'config');
  };

  const fitnessServices = createFitnessServices({
    dataRoot: dataBasePath,
    mediaRoot: mediaBasePath,
    defaultHouseholdId: householdId,
    homeAssistant: {
      baseUrl: homeAssistantConfig.base_url || homeAssistantConfig.host || '',
      token: homeAssistantConfig.token || ''
    },
    loadFitnessConfig,
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    logger: logger.child({ module: 'fitness' })
  });

  // ==========================================================================
  // Mount API Routers
  // ==========================================================================

  // Health check endpoints
  app.get('/api/ping', (_, res) => res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() }));
  app.get('/api/status', (_, res) => res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  }));

  // Content domain routers
  app.use('/api/content', contentRouters.content);
  app.use('/proxy', contentRouters.proxy);
  app.use('/api/list', contentRouters.list);
  app.use('/api/play', contentRouters.play);
  app.use('/api/local-content', contentRouters.localContent);
  app.post('/media/log', contentRouters.legacyShims.mediaLog);
  logger.info('content.mounted', { paths: ['/api/content', '/proxy', '/api/list', '/api/play', '/api/local-content'] });

  // Health domain router
  app.use('/api/health', createHealthApiRouter({
    healthServices,
    configService,
    logger: logger.child({ module: 'health-api' })
  }));
  logger.info('health.mounted', { path: '/api/health' });

  // Finance domain router
  app.use('/api/finance', createFinanceApiRouter({
    financeServices,
    configService,
    logger: logger.child({ module: 'finance-api' })
  }));
  logger.info('finance.mounted', { path: '/api/finance', buxferConfigured: !!financeServices.buxferAdapter });

  // Entropy domain router
  app.use('/api/entropy', createEntropyApiRouter({
    entropyServices,
    configService,
    logger: logger.child({ module: 'entropy-api' })
  }));
  logger.info('entropy.mounted', { path: '/api/entropy' });

  // Gratitude domain router
  app.use('/api/gratitude', createGratitudeApiRouter({
    gratitudeServices,
    configService,
    broadcastToWebsockets: broadcastEvent,
    logger: logger.child({ module: 'gratitude-api' })
  }));
  logger.info('gratitude.mounted', { path: '/api/gratitude' });

  // Fitness domain router
  app.use('/api/fitness', createFitnessApiRouter({
    fitnessServices,
    userService,
    userDataService,
    configService,
    logger: logger.child({ module: 'fitness-api' })
  }));
  logger.info('fitness.mounted', { path: '/api/fitness' });

  // Legacy finance endpoint shims
  app.get('/data/budget', (req, res) => res.redirect(307, '/api/finance/data'));
  app.get('/data/budget/daytoday', (req, res) => res.redirect(307, '/api/finance/data/daytoday'));
  app.get('/harvest/budget', (req, res) => res.redirect(307, '/api/finance/refresh'));
  app.post('/harvest/budget', (req, res) => res.redirect(307, '/api/finance/refresh'));

  // ==========================================================================
  // Legacy Router Integration
  // ==========================================================================

  // Import and mount legacy routers that haven't been fully migrated yet
  // These are tracked via legacyTracker to monitor usage before deletion
  const { default: fetchRouter } = await import('../_legacy/routers/fetch.mjs');
  const { default: harvestRouter } = await import('../_legacy/routers/harvest.mjs');
  const { default: homeRouter } = await import('../_legacy/routers/home.mjs');
  const { default: mediaRouter } = await import('../_legacy/routers/media.mjs');
  const { default: cronRouter } = await import('../_legacy/routers/cron.mjs');
  const { default: plexProxyRouter } = await import('../_legacy/routers/plexProxy.mjs');
  const { default: exeRouter } = await import('../_legacy/routers/exe.mjs');
  const { default: apiRouter } = await import('../_legacy/api.mjs');

  // Get legacy tracker for monitoring route usage
  const legacyTracker = getLegacyTracker({ logger });

  // Mount legacy routers with tracking middleware
  app.use('/data', legacyTracker.middleware, fetchRouter);
  app.use('/harvest', legacyTracker.middleware, harvestRouter);
  app.use('/home', legacyTracker.middleware, homeRouter);
  app.use('/media', legacyTracker.middleware, mediaRouter);
  app.use('/cron', legacyTracker.middleware, cronRouter);
  app.use('/plex_proxy', legacyTracker.middleware, plexProxyRouter);
  app.use('/exe', legacyTracker.middleware, exeRouter);
  app.use('/api', legacyTracker.middleware, apiRouter);

  logger.info('legacy.routers.mounted', {
    paths: ['/data', '/harvest', '/home', '/media', '/cron', '/plex_proxy', '/exe', '/api'],
    tracking: true
  });

  // ==========================================================================
  // Frontend Static Files
  // ==========================================================================

  const frontendPath = join(__dirname, '..', 'frontend', 'dist');
  const frontendExists = existsSync(frontendPath);

  if (frontendExists) {
    app.use(express.static(frontendPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/ws')) return next();
      res.sendFile(join(frontendPath, 'index.html'));
    });
  } else {
    logger.debug('frontend.dev.redirect', { target: 'http://localhost:3111' });
    app.use('/', (req, res, next) => {
      if (req.path.startsWith('/ws/')) return next();
      res.redirect('http://localhost:3111');
    });
  }

  // ==========================================================================
  // Start Server
  // ==========================================================================

  startServer(server, logger);
}

/**
 * Start HTTP server
 */
function startServer(server, logger) {
  const port = process.env.PORT || 3112;
  const host = '0.0.0.0';

  server.listen(port, host, () => {
    logger.info('server.started', {
      port,
      host,
      env: process.env.NODE_ENV || 'development'
    });
  });
}

// Run the server
main().catch(err => {
  console.error('[FATAL] Server initialization failed:', err.message, err.stack);
  process.exit(1);
});
