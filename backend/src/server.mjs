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
  createLifelogServices,
  createLifelogApiRouter,
  createStaticApiRouter,
  createCalendarApiRouter,
  createEventBus,
  broadcastEvent
} from './0_infrastructure/bootstrap.mjs';

// Routing toggle system
import { loadRoutingConfig, ShimMetrics } from './0_infrastructure/routing/index.mjs';
import { allShims } from './4_api/shims/index.mjs';
import { createShimsRouter } from './4_api/routers/admin/shims.mjs';
import { createEventBusRouter } from './4_api/routers/admin/eventbus.mjs';

// Legacy tracking
import { getLegacyTracker } from './4_api/middleware/legacyTracker.mjs';
import { createLegacyAdminRouter } from './4_api/routers/admin/legacy.mjs';

// Scheduling domain
import { SchedulerService } from './1_domains/scheduling/services/SchedulerService.mjs';
import { YamlJobStore } from './2_adapters/scheduling/YamlJobStore.mjs';
import { YamlStateStore } from './2_adapters/scheduling/YamlStateStore.mjs';
import { Scheduler } from './0_infrastructure/scheduling/Scheduler.mjs';
import { createSchedulingRouter } from './4_api/routers/scheduling.mjs';

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

  // EventBus admin router (requires eventBus to be created first)
  app.use('/admin/ws', createEventBusRouter({ eventBus, logger }));

  // Content domain
  // Get Plex auth from ConfigService (same source as legacy)
  const plexAuth = configService.getHouseholdAuth('plex') || {};
  const plexConfig = process.env.media?.plex ? {
    host: plexAuth.server_url || process.env.media.plex.host,
    token: plexAuth.token || process.env.media.plex.token
  } : null;

  const watchlistPath = `${householdDir}/state/lists.yml`;
  const contentPath = `${dataBasePath}/content`;  // LocalContentAdapter expects content/ subdirectory
  const contentRegistry = createContentRegistry({
    mediaBasePath,
    plex: plexConfig,
    dataPath: contentPath,
    watchlistPath
  });

  const watchStatePath = process.env.path?.watchState || process.env.WATCH_STATE_PATH || '/data/media_memory';
  const watchStore = createWatchStore({ watchStatePath });

  // Import IO functions for content domain
  const { loadFile: contentLoadFile, saveFile: contentSaveFile } = await import('../_legacy/lib/io.mjs');

  const contentRouters = createApiRouters({
    registry: contentRegistry,
    watchStore,
    loadFile: contentLoadFile,
    saveFile: contentSaveFile,
    cacheBasePath: mediaBasePath ? `${mediaBasePath}/img/cache` : null,
    logger: logger.child({ module: 'content' })
  });

  // Health domain
  const healthServices = createHealthServices({
    userDataService,
    configService,
    dataRoot: dataBasePath,
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

  // Lifelog domain
  const lifelogServices = createLifelogServices({
    userLoadFile,
    logger: logger.child({ module: 'lifelog' })
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

  // Entropy domain router - import legacy function for parity
  const { getEntropyReport: legacyGetEntropyReport } = await import('../_legacy/lib/entropy.mjs');
  app.use('/api/entropy', createEntropyApiRouter({
    entropyServices,
    configService,
    legacyGetEntropyReport,
    logger: logger.child({ module: 'entropy-api' })
  }));
  logger.info('entropy.mounted', { path: '/api/entropy' });

  // Lifelog domain router
  app.use('/api/lifelog', createLifelogApiRouter({
    lifelogServices,
    configService,
    logger: logger.child({ module: 'lifelog-api' })
  }));
  logger.info('lifelog.mounted', { path: '/api/lifelog' });

  // Static assets router
  const imgBasePath = process.env.path?.img || `${mediaBasePath}/img`;
  app.use('/api/static', createStaticApiRouter({
    imgBasePath,
    dataBasePath,
    logger: logger.child({ module: 'static-api' })
  }));
  logger.info('static.mounted', { path: '/api/static' });

  // Calendar domain router
  app.use('/api/calendar', createCalendarApiRouter({
    userDataService,
    configService,
    logger: logger.child({ module: 'calendar-api' })
  }));
  logger.info('calendar.mounted', { path: '/api/calendar' });

  // Hardware adapters (printer, TTS, MQTT sensors)
  const printerConfig = process.env.printer || {};
  const mqttConfig = process.env.mqtt || {};
  const ttsApiKey = process.env.OPENAI_API_KEY || process.env.openai?.api_key || '';

  const hardwareAdapters = createHardwareAdapters({
    printer: {
      host: printerConfig.host || '',
      port: printerConfig.port || 9100,
      timeout: printerConfig.timeout || 5000,
      upsideDown: printerConfig.upsideDown !== false
    },
    mqtt: {
      host: mqttConfig.host || '',
      port: mqttConfig.port || 1883
    },
    tts: {
      apiKey: ttsApiKey,
      model: 'tts-1',
      defaultVoice: 'alloy'
    },
    onMqttMessage: (payload) => {
      // Broadcast MQTT sensor messages to WebSocket clients
      broadcastEvent('sensor', payload);
    },
    logger: logger.child({ module: 'hardware' })
  });

  // Initialize MQTT sensor adapter if configured
  if (hardwareAdapters.mqttAdapter?.isConfigured()) {
    // Load equipment with vibration sensors for MQTT topic mapping
    const fitnessConfig = userDataService.readHouseholdAppData(householdId, 'fitness', 'config') || {};
    const equipment = fitnessConfig.equipment || [];
    if (hardwareAdapters.mqttAdapter.init(equipment)) {
      logger.info('mqtt.initialized', {
        sensorCount: hardwareAdapters.mqttAdapter.getStatus().sensorCount,
        topics: hardwareAdapters.mqttAdapter.getStatus().topics
      });
    }
  } else if (mqttConfig.host) {
    logger.warn?.('mqtt.disabled', { reason: 'MQTT configured but adapter not initialized' });
  }

  logger.info('hardware.initialized', {
    printer: hardwareAdapters.printerAdapter?.isConfigured() || false,
    tts: hardwareAdapters.ttsAdapter?.isConfigured() || false,
    mqtt: hardwareAdapters.mqttAdapter?.isConfigured() || false
  });

  // Gratitude domain router - import legacy canvas function for card generation
  let createPrayerCardCanvas = null;
  try {
    const printerModule = await import('../_legacy/routers/printer.mjs');
    createPrayerCardCanvas = printerModule.createCanvasTypographyDemo;
  } catch (e) {
    logger.warn?.('gratitude.canvas.import_failed', { error: e.message });
  }

  app.use('/api/gratitude', createGratitudeApiRouter({
    gratitudeServices,
    configService,
    broadcastToWebsockets: broadcastEvent,
    createPrayerCardCanvas,
    printerAdapter: hardwareAdapters.printerAdapter,
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

  // Home automation domain
  const kioskConfig = process.env.kiosk || {};
  const taskerConfig = process.env.tasker || {};
  const remoteExecConfig = process.env.remote_exec || process.env.remoteExec || {};
  const homeAutomationAdapters = createHomeAutomationAdapters({
    homeAssistant: {
      baseUrl: homeAssistantConfig.base_url || homeAssistantConfig.host || '',
      token: homeAssistantConfig.token || ''
    },
    kiosk: {
      host: kioskConfig.host || '',
      port: kioskConfig.port || 5000,
      password: kioskConfig.password || '',
      daylightHost: kioskConfig.daylightHost || `http://localhost:${process.env.PORT || 3112}`
    },
    tasker: {
      host: taskerConfig.host || '',
      port: taskerConfig.port || 1821
    },
    remoteExec: {
      host: remoteExecConfig.host || '',
      user: remoteExecConfig.user || '',
      port: remoteExecConfig.port || 22,
      privateKey: remoteExecConfig.privateKey || remoteExecConfig.private_key || '',
      knownHostsPath: remoteExecConfig.knownHostsPath || remoteExecConfig.known_hosts_path || ''
    },
    logger: logger.child({ module: 'home-automation' })
  });

  // Import IO functions for state persistence
  const { loadFile, saveFile } = await import('../_legacy/lib/io.mjs');

  app.use('/api/home', createHomeAutomationApiRouter({
    adapters: homeAutomationAdapters,
    loadFile,
    saveFile,
    householdId,
    logger: logger.child({ module: 'home-automation-api' })
  }));
  logger.info('homeAutomation.mounted', { path: '/api/home' });

  // Messaging domain (provides telegramAdapter for chatbots)
  const telegramConfig = process.env.telegram || {};
  const gmailConfig = process.env.gmail || {};
  const messagingServices = createMessagingServices({
    userDataService,
    telegram: {
      token: telegramConfig.token || ''
    },
    gmail: gmailConfig.credentials ? {
      credentials: gmailConfig.credentials,
      token: gmailConfig.token
    } : null,
    logger: logger.child({ module: 'messaging' })
  });

  // NutriBot application
  const nutribotConfig = process.env.nutribot || {};
  const openaiApiKey = process.env.OPENAI_API_KEY || process.env.openai?.api_key || '';

  // Create AI adapter for nutribot (optional)
  let nutribotAiGateway = null;
  if (openaiApiKey) {
    const { OpenAIAdapter } = await import('./2_adapters/ai/OpenAIAdapter.mjs');
    nutribotAiGateway = new OpenAIAdapter({ apiKey: openaiApiKey }, { logger: logger.child({ module: 'nutribot-ai' }) });
  }

  const nutribotServices = createNutribotServices({
    dataRoot: dataBasePath,
    telegramAdapter: messagingServices.telegramAdapter,
    aiGateway: nutribotAiGateway,
    upcGateway: null,  // TODO: Add UPC gateway when available
    googleImageGateway: null,  // TODO: Add Google Image gateway when available
    conversationStateStore: null,  // Uses in-memory by default
    reportRenderer: null,  // Uses default renderer
    nutribotConfig,
    logger: logger.child({ module: 'nutribot' })
  });

  app.use('/api/nutribot', createNutribotApiRouter({
    nutribotServices,
    botId: nutribotConfig.telegram?.botId || telegramConfig.botId || '',
    gateway: messagingServices.telegramAdapter,
    logger: logger.child({ module: 'nutribot-api' })
  }));
  logger.info('nutribot.mounted', { path: '/api/nutribot', telegramConfigured: !!messagingServices.telegramAdapter });

  // Journalist application
  const journalistConfig = process.env.journalist || {};

  // Create AI adapter for journalist (reuse pattern from nutribot, or share adapter)
  let journalistAiGateway = nutribotAiGateway;  // Reuse the same adapter
  if (!journalistAiGateway && openaiApiKey) {
    const { OpenAIAdapter } = await import('./2_adapters/ai/OpenAIAdapter.mjs');
    journalistAiGateway = new OpenAIAdapter({ apiKey: openaiApiKey }, { logger: logger.child({ module: 'journalist-ai' }) });
  }

  const journalistServices = createJournalistServices({
    userDataService,
    configService,
    telegramAdapter: messagingServices.telegramAdapter,
    aiGateway: journalistAiGateway,
    userResolver: null,  // TODO: Add UserResolver when available
    conversationStateStore: null,  // Uses in-memory by default
    quizRepository: null,  // TODO: Add quiz repository when available
    logger: logger.child({ module: 'journalist' })
  });

  app.use('/api/journalist', createJournalistApiRouter({
    journalistServices,
    configService,
    secretToken: journalistConfig.telegram?.secretToken || telegramConfig.secretToken || '',
    logger: logger.child({ module: 'journalist-api' })
  }));
  logger.info('journalist.mounted', { path: '/api/journalist', telegramConfigured: !!messagingServices.telegramAdapter });

  // Scheduling domain - DDD replacement for legacy /cron
  const schedulingJobStore = new YamlJobStore({
    loadFile,
    logger: logger.child({ module: 'scheduling-jobs' })
  });

  const schedulingStateStore = new YamlStateStore({
    loadFile,
    saveFile,
    logger: logger.child({ module: 'scheduling-state' })
  });

  const schedulerService = new SchedulerService({
    jobStore: schedulingJobStore,
    stateStore: schedulingStateStore,
    timezone: 'America/Los_Angeles',
    logger: logger.child({ module: 'scheduler-service' })
  });

  const scheduler = new Scheduler({
    schedulerService,
    intervalMs: 5000,
    logger: logger.child({ module: 'scheduler' })
  });

  // Start scheduler (only runs in production/Docker unless ENABLE_CRON=true)
  scheduler.start();

  app.use('/api/scheduling', createSchedulingRouter({
    schedulerService,
    scheduler,
    logger: logger.child({ module: 'scheduling-api' })
  }));
  logger.info('scheduling.mounted', { path: '/api/scheduling', schedulerEnabled: scheduler.enabled });

  // Legacy finance endpoint shims
  app.get('/data/budget', (req, res) => res.redirect(307, '/api/finance/data'));
  app.get('/data/budget/daytoday', (req, res) => res.redirect(307, '/api/finance/data/daytoday'));
  app.get('/harvest/budget', (req, res) => res.redirect(307, '/api/finance/refresh'));
  app.post('/harvest/budget', (req, res) => res.redirect(307, '/api/finance/refresh'));

  // ==========================================================================
  // Legacy Compatibility Redirects (Phase 4)
  // ==========================================================================
  // These redirect legacy paths to DDD equivalents while keeping backwards compatibility

  // Content/Media redirects
  app.use('/media/plex/list', (req, res) => res.redirect(307, `/api/list/plex${req.url}`));
  app.use('/data/list', (req, res) => res.redirect(307, `/api/list/folder${req.url}`));
  // Note: /media/log is handled by legacyShims.mediaLog earlier in the middleware chain
  app.get('/media/plex/info/:id', (req, res) => res.redirect(307, `/api/content/plex/info/${req.params.id}`));
  app.get('/media/plex/mpd/:id', (req, res) => res.redirect(307, `/api/play/plex/mpd/${req.params.id}`));
  app.post('/harvest/watchlist', (req, res) => res.redirect(307, '/api/content/refresh-watchlist'));

  // Home/Calendar redirects
  app.get('/home/entropy', (req, res) => res.redirect(307, '/api/entropy'));
  app.get('/home/calendar', (req, res) => res.redirect(307, '/api/calendar/events'));
  app.get('/data/events', (req, res) => res.redirect(307, '/api/calendar/events'));

  // Weather data redirect (was in legacy index.js, redirects to household data file)
  app.get('/data/weather', (req, res) => {
    const hid = configService?.getDefaultHouseholdId?.() || process.env.household_id || 'default';
    res.redirect(307, `/data/households/${hid}/shared/weather`);
  });

  // Health redirects
  app.get('/data/lifelog/weight', (req, res) => res.redirect(307, '/api/health/weight'));

  // Menu logging redirect
  app.post('/data/menu_log', (req, res) => res.redirect(307, '/api/content/menu-log'));

  // TV/Volume control redirects
  app.get('/exe/tv/off', (req, res) => res.redirect(307, '/api/home/tv/power?action=off'));
  app.get('/exe/office_tv/off', (req, res) => res.redirect(307, '/api/home/office-tv/power?action=off'));
  app.get('/exe/vol/up', (req, res) => res.redirect(307, '/api/home/volume/up'));
  app.get('/exe/vol/down', (req, res) => res.redirect(307, '/api/home/volume/down'));
  app.get('/exe/vol/mute', (req, res) => res.redirect(307, '/api/home/volume/mute'));
  app.get('/exe/vol/cycle', (req, res) => res.redirect(307, '/api/home/volume/cycle'));

  // Keyboard configuration redirect (legacy path -> DDD path)
  app.get('/data/keyboard/:keyboard_id?', (req, res) => {
    const { keyboard_id } = req.params;
    const newPath = keyboard_id ? `/api/home/keyboard/${keyboard_id}` : '/api/home/keyboard';
    res.redirect(307, newPath);
  });

  // WebSocket restart redirect
  app.get('/exe/ws/restart', (req, res) => res.redirect(307, '/admin/ws/restart'));
  app.post('/exe/ws/restart', (req, res) => res.redirect(307, '/admin/ws/restart'));

  // WebSocket broadcast redirect
  app.all('/exe/ws', (req, res) => res.redirect(307, '/admin/ws/broadcast'));

  // Cron/Scheduling redirects
  app.get('/cron/status', (req, res) => res.redirect(307, '/api/scheduling/status'));
  app.post('/cron/run/:jobId', (req, res) => res.redirect(307, `/api/scheduling/run/${req.params.jobId}`));
  app.get('/cron/cron10Mins', (req, res) => res.redirect(307, '/api/scheduling/cron10Mins'));
  app.get('/cron/cronHourly', (req, res) => res.redirect(307, '/api/scheduling/cronHourly'));
  app.get('/cron/cronDaily', (req, res) => res.redirect(307, '/api/scheduling/cronDaily'));
  app.get('/cron/cronWeekly', (req, res) => res.redirect(307, '/api/scheduling/cronWeekly'));

  // Media/Image redirects - route to DDD static router
  app.get('/media/img/entropy/:icon', (req, res) => res.redirect(307, `/api/static/entropy/${req.params.icon}`));
  app.get('/media/img/art/*', (req, res) => res.redirect(307, `/api/static/art/${req.params[0]}`));
  app.get('/media/img/users/:id', (req, res) => res.redirect(307, `/api/static/users/${req.params.id}`));
  app.get('/media/img/equipment/:id', (req, res) => res.redirect(307, `/api/static/equipment/${req.params.id}`));
  app.get('/media/img/*', (req, res) => res.redirect(307, `/api/static/img/${req.params[0]}`));

  logger.info('legacy.redirects.mounted', {
    count: 29,
    categories: ['content', 'home', 'health', 'tv', 'websocket', 'cron', 'media']
  });

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
