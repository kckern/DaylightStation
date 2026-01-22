/**
 * DDD App Factory
 *
 * Creates and configures an Express app with all DDD domain services and routers.
 * This is extracted from server.mjs to support the backend toggle system.
 *
 * @module backend/src/app
 */

import express from 'express';
import cors from 'cors';
import { existsSync } from 'fs';
import path, { join } from 'path';

// Infrastructure imports
import { loadAllConfig, logConfigSummary } from '../_legacy/lib/config/loader.mjs';
import { ConfigValidationError, configService } from '../_legacy/lib/config/index.mjs';
import { userDataService } from '../_legacy/lib/config/UserDataService.mjs';
import { userService } from '../_legacy/lib/config/UserService.mjs';

// Logging system
import { getDispatcher } from './0_infrastructure/logging/dispatcher.js';
import { createLogger } from './0_infrastructure/logging/logger.js';
import { ingestFrontendLogs } from './0_infrastructure/logging/ingestion.js';
import { loadLoggingConfig, resolveLoggerLevel } from '../_legacy/lib/logging/config.js';

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

// Scheduling domain
import { SchedulerService } from './1_domains/scheduling/services/SchedulerService.mjs';
import { YamlJobStore } from './2_adapters/scheduling/YamlJobStore.mjs';
import { YamlStateStore } from './2_adapters/scheduling/YamlStateStore.mjs';
import { Scheduler } from './0_infrastructure/scheduling/Scheduler.mjs';
import { createSchedulingRouter } from './4_api/routers/scheduling.mjs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

/**
 * Create and configure the Express app with all DDD domain services and routers
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.server - HTTP server instance (for WebSocket attachment)
 * @param {Object} options.logger - Root logger instance
 * @param {Object} options.configPaths - Resolved config paths { configDir, dataDir }
 * @param {boolean} options.configExists - Whether config files exist
 * @param {boolean} [options.enableScheduler=true] - Whether to start the scheduler (false for toggle mode)
 * @param {boolean} [options.enableMqtt=true] - Whether to enable MQTT (false for toggle mode - legacy handles it)
 * @returns {Promise<express.Application>} Configured Express app
 */
export async function createApp({ server, logger, configPaths, configExists, enableScheduler = true, enableMqtt = true }) {
  const isDocker = existsSync('/.dockerenv');

  // ==========================================================================
  // Express App Setup
  // ==========================================================================

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
      res.status(500).json({ error: 'Application not configured. Ensure system.yml exists.' });
    });
    return app;
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
  let loggingConfig = loadLoggingConfig();
  const dispatcher = getDispatcher();
  dispatcher.setLevel(resolveLoggerLevel('backend', loggingConfig));
  dispatcher.componentLevels = loggingConfig.loggers || {};

  let rootLogger = createLogger({
    source: 'backend',
    app: 'api',
    context: { env: process.env.NODE_ENV }
  });

  logConfigSummary(configResult, rootLogger);

  // ==========================================================================
  // Routing Toggle System
  // ==========================================================================

  const shimMetrics = new ShimMetrics();
  let routingConfig;
  try {
    routingConfig = loadRoutingConfig('./backend/config/routing.yml', allShims);
    rootLogger.info('routing.toggle.loaded', { default: routingConfig.default });
  } catch (error) {
    rootLogger.warn('routing.toggle.fallback', { error: error.message });
    routingConfig = { default: 'legacy', routing: {} };
  }

  // Admin routers
  app.use('/admin/shims', createShimsRouter({ metrics: shimMetrics }));

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
    logger: rootLogger
  });

  // Register message handlers for incoming client messages
  // These handlers rebroadcast messages to subscribed clients
  eventBus.onClientMessage((clientId, message) => {
    // Fitness controller messages - rebroadcast to all fitness subscribers
    if (message.source === 'fitness' || message.source === 'fitness-simulator') {
      eventBus.broadcast('fitness', message);
      rootLogger.debug?.('eventbus.fitness.broadcast', { source: message.source });
      return;
    }

    // Piano MIDI messages
    if (message.source === 'piano' && message.topic === 'midi') {
      if (!message.type || !message.timestamp) {
        rootLogger.warn?.('eventbus.midi.invalid', { clientId });
        return;
      }
      eventBus.broadcast('midi', {
        source: message.source,
        type: message.type,
        timestamp: message.timestamp,
        sessionId: message.sessionId,
        data: message.data
      });
      return;
    }

    // Frontend logging messages - ingest to backend log system
    if (message.source === 'playback-logger' || message.topic === 'logging') {
      const clientMeta = eventBus.getClientMeta(clientId);
      ingestFrontendLogs(message, {
        ip: clientMeta?.ip,
        userAgent: clientMeta?.userAgent
      });
      return;
    }
  });

  // EventBus admin router (requires eventBus to be created first)
  app.use('/admin/ws', createEventBusRouter({ eventBus, logger: rootLogger }));

  // Content domain
  // Get Plex auth from ConfigService (same source as legacy)
  const plexAuth = configService.getHouseholdAuth('plex') || {};
  const plexConfig = process.env.media?.plex ? {
    host: plexAuth.server_url || process.env.media.plex.host,
    token: plexAuth.token || process.env.media.plex.token
  } : null;

  const watchlistPath = `${householdDir}/state/lists.yml`;
  const contentPath = `${dataBasePath}/content`;  // LocalContentAdapter expects content/ subdirectory
  const mediaMemoryPath = `${householdDir}/history/media_memory`;
  const contentRegistry = createContentRegistry({
    mediaBasePath,
    plex: plexConfig,
    dataPath: contentPath,
    watchlistPath,
    mediaMemoryPath
  });

  // Watch state path - use history/media_memory under data path (matches legacy structure)
  const watchStatePath = process.env.path?.watchState || process.env.WATCH_STATE_PATH || `${dataBasePath}/history/media_memory`;
  const watchStore = createWatchStore({ watchStatePath });

  // Import IO functions for content domain
  const { loadFile: contentLoadFile, saveFile: contentSaveFile } = await import('../_legacy/lib/io.mjs');

  const contentRouters = createApiRouters({
    registry: contentRegistry,
    watchStore,
    loadFile: contentLoadFile,
    saveFile: contentSaveFile,
    cacheBasePath: mediaBasePath ? `${mediaBasePath}/img/cache` : null,
    dataPath: dataBasePath,
    mediaBasePath,
    logger: rootLogger.child({ module: 'content' })
  });

  // Health domain
  const healthServices = createHealthServices({
    userDataService,
    configService,
    dataRoot: dataBasePath,
    logger: rootLogger
  });

  // Finance domain
  const financeServices = createFinanceServices({
    dataRoot: dataBasePath,
    defaultHouseholdId: householdId,
    buxfer: process.env.finance?.buxfer ? {
      email: process.env.finance.buxfer.email,
      password: process.env.finance.buxfer.password
    } : null,
    logger: rootLogger.child({ module: 'finance' })
  });

  // Entropy domain
  const { userLoadFile, userLoadCurrent } = await import('../_legacy/lib/io.mjs');
  const ArchiveService = (await import('../_legacy/lib/ArchiveService.mjs')).default;
  const entropyServices = createEntropyServices({
    io: { userLoadFile, userLoadCurrent },
    archiveService: ArchiveService,
    configService,
    logger: rootLogger.child({ module: 'entropy' })
  });

  // Lifelog domain
  const lifelogServices = createLifelogServices({
    userLoadFile,
    logger: rootLogger.child({ module: 'lifelog' })
  });

  // Gratitude domain
  const gratitudeServices = createGratitudeServices({
    userDataService,
    logger: rootLogger.child({ module: 'gratitude' })
  });

  // Fitness domain
  // Get Home Assistant config: host from system config, token from household auth file
  const homeAssistantConfigEnv = process.env.home_assistant || {};
  const homeAssistantAuth = configService.getHouseholdAuth('homeassistant') || {};
  const loadFitnessConfig = (hid) => {
    const targetHouseholdId = hid || configService.getDefaultHouseholdId();
    return userDataService.readHouseholdAppData(targetHouseholdId, 'fitness', 'config');
  };

  const fitnessServices = createFitnessServices({
    dataRoot: dataBasePath,
    mediaRoot: mediaBasePath,
    defaultHouseholdId: householdId,
    homeAssistant: {
      baseUrl: homeAssistantConfigEnv.base_url || homeAssistantConfigEnv.host || '',
      token: homeAssistantAuth.token || homeAssistantConfigEnv.token || ''
    },
    loadFitnessConfig,
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    logger: rootLogger.child({ module: 'fitness' })
  });

  // ==========================================================================
  // Mount API Routers
  // ==========================================================================

  // Health check endpoints (no /api/ prefix - accessed via /api/v1/ping after router strips prefix)
  app.get('/ping', (_, res) => res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() }));
  app.get('/status', (_, res) => res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  }));

  // Content domain routers
  app.use('/content', contentRouters.content);
  app.use('/proxy', contentRouters.proxy);
  app.use('/list', contentRouters.list);
  app.use('/play', contentRouters.play);
  app.use('/local-content', contentRouters.localContent);
  // NOTE: POST /media/log is handled by legacy backend (_legacy/routers/media.mjs)
  // Frontend calls /media/log (not /api/v1/media/log), so it routes to legacy.
  // When cutover is ready, migrate frontend to call /api/v1/play/log instead.
  rootLogger.info('content.mounted', { paths: ['/content', '/proxy', '/list', '/play', '/local-content'] });

  // Health domain router
  app.use('/health', createHealthApiRouter({
    healthServices,
    configService,
    logger: rootLogger.child({ module: 'health-api' })
  }));
  rootLogger.info('health.mounted', { path: '/health' });

  // Finance domain router
  app.use('/finance', createFinanceApiRouter({
    financeServices,
    configService,
    logger: rootLogger.child({ module: 'finance-api' })
  }));
  rootLogger.info('finance.mounted', { path: '/finance', buxferConfigured: !!financeServices.buxferAdapter });

  // Legacy redirects for frontend compatibility
  app.get('/data/budget', (req, res) => res.redirect(307, '/finance/data'));
  app.get('/data/budget/daytoday', (req, res) => res.redirect(307, '/finance/data/daytoday'));

  // Entropy domain router - import legacy function for parity
  const { getEntropyReport: legacyGetEntropyReport } = await import('../_legacy/lib/entropy.mjs');
  app.use('/entropy', createEntropyApiRouter({
    entropyServices,
    configService,
    legacyGetEntropyReport,
    logger: rootLogger.child({ module: 'entropy-api' })
  }));
  rootLogger.info('entropy.mounted', { path: '/entropy' });

  // Lifelog domain router
  app.use('/lifelog', createLifelogApiRouter({
    lifelogServices,
    configService,
    logger: rootLogger.child({ module: 'lifelog-api' })
  }));
  rootLogger.info('lifelog.mounted', { path: '/lifelog' });

  // Static assets router
  const imgBasePath = process.env.path?.img || `${mediaBasePath}/img`;
  app.use('/static', createStaticApiRouter({
    imgBasePath,
    dataBasePath,
    logger: rootLogger.child({ module: 'static-api' })
  }));
  rootLogger.info('static.mounted', { path: '/static' });

  // Calendar domain router
  app.use('/calendar', createCalendarApiRouter({
    userDataService,
    configService,
    logger: rootLogger.child({ module: 'calendar-api' })
  }));
  rootLogger.info('calendar.mounted', { path: '/calendar' });

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
      broadcastEvent({ topic: 'sensor', ...payload });
    },
    logger: rootLogger.child({ module: 'hardware' })
  });

  // Initialize MQTT sensor adapter if configured and enabled
  if (enableMqtt && hardwareAdapters.mqttAdapter?.isConfigured()) {
    // Load equipment with vibration sensors for MQTT topic mapping
    const fitnessConfig = userDataService.readHouseholdAppData(householdId, 'fitness', 'config') || {};
    const equipment = fitnessConfig.equipment || [];
    if (hardwareAdapters.mqttAdapter.init(equipment)) {
      rootLogger.info('mqtt.initialized', {
        sensorCount: hardwareAdapters.mqttAdapter.getStatus().sensorCount,
        topics: hardwareAdapters.mqttAdapter.getStatus().topics
      });
    }
  } else if (!enableMqtt) {
    rootLogger.info('mqtt.disabled', { reason: 'toggle mode - legacy handles MQTT' });
  } else if (mqttConfig.host) {
    rootLogger.warn?.('mqtt.disabled', { reason: 'MQTT configured but adapter not initialized' });
  }

  rootLogger.info('hardware.initialized', {
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
    rootLogger.warn?.('gratitude.canvas.import_failed', { error: e.message });
  }

  app.use('/gratitude', createGratitudeApiRouter({
    gratitudeServices,
    configService,
    broadcastToWebsockets: broadcastEvent,
    createPrayerCardCanvas,
    printerAdapter: hardwareAdapters.printerAdapter,
    logger: rootLogger.child({ module: 'gratitude-api' })
  }));
  rootLogger.info('gratitude.mounted', { path: '/gratitude' });

  // Fitness domain router
  app.use('/fitness', createFitnessApiRouter({
    fitnessServices,
    userService,
    userDataService,
    configService,
    logger: rootLogger.child({ module: 'fitness-api' })
  }));
  rootLogger.info('fitness.mounted', { path: '/fitness' });

  // Home automation domain
  const kioskConfig = process.env.kiosk || {};
  const taskerConfig = process.env.tasker || {};
  const remoteExecConfig = process.env.remote_exec || process.env.remoteExec || {};
  const homeAutomationAdapters = createHomeAutomationAdapters({
    homeAssistant: {
      baseUrl: homeAssistantConfigEnv.base_url || homeAssistantConfigEnv.host || '',
      token: homeAssistantAuth.token || homeAssistantConfigEnv.token || ''
    },
    kiosk: {
      host: kioskConfig.host || '',
      port: kioskConfig.port || 5000,
      password: kioskConfig.password || '',
      daylightHost: kioskConfig.daylightHost || `http://localhost:${process.env.PORT || 3111}`
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
    logger: rootLogger.child({ module: 'home-automation' })
  });

  // Import IO functions for state persistence
  const { loadFile, saveFile } = await import('../_legacy/lib/io.mjs');

  app.use('/home', createHomeAutomationApiRouter({
    adapters: homeAutomationAdapters,
    loadFile,
    saveFile,
    householdId,
    logger: rootLogger.child({ module: 'home-automation-api' })
  }));
  rootLogger.info('homeAutomation.mounted', { path: '/home' });

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
    logger: rootLogger.child({ module: 'messaging' })
  });

  // NutriBot application
  const nutribotConfig = process.env.nutribot || {};
  const openaiApiKey = process.env.OPENAI_API_KEY || process.env.openai?.api_key || '';

  // Create AI adapter for nutribot (optional)
  let nutribotAiGateway = null;
  if (openaiApiKey) {
    const { OpenAIAdapter } = await import('./2_adapters/ai/OpenAIAdapter.mjs');
    nutribotAiGateway = new OpenAIAdapter({ apiKey: openaiApiKey }, { logger: rootLogger.child({ module: 'nutribot-ai' }) });
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
    logger: rootLogger.child({ module: 'nutribot' })
  });

  app.use('/nutribot', createNutribotApiRouter({
    nutribotServices,
    botId: nutribotConfig.telegram?.botId || telegramConfig.botId || '',
    gateway: messagingServices.telegramAdapter,
    logger: rootLogger.child({ module: 'nutribot-api' })
  }));
  rootLogger.info('nutribot.mounted', { path: '/nutribot', telegramConfigured: !!messagingServices.telegramAdapter });

  // Journalist application
  const journalistConfig = process.env.journalist || {};

  // Create AI adapter for journalist (reuse pattern from nutribot, or share adapter)
  let journalistAiGateway = nutribotAiGateway;  // Reuse the same adapter
  if (!journalistAiGateway && openaiApiKey) {
    const { OpenAIAdapter } = await import('./2_adapters/ai/OpenAIAdapter.mjs');
    journalistAiGateway = new OpenAIAdapter({ apiKey: openaiApiKey }, { logger: rootLogger.child({ module: 'journalist-ai' }) });
  }

  const journalistServices = createJournalistServices({
    userDataService,
    configService,
    telegramAdapter: messagingServices.telegramAdapter,
    aiGateway: journalistAiGateway,
    userResolver: null,  // TODO: Add UserResolver when available
    conversationStateStore: null,  // Uses in-memory by default
    quizRepository: null,  // TODO: Add quiz repository when available
    logger: rootLogger.child({ module: 'journalist' })
  });

  app.use('/journalist', createJournalistApiRouter({
    journalistServices,
    configService,
    secretToken: journalistConfig.telegram?.secretToken || telegramConfig.secretToken || '',
    logger: rootLogger.child({ module: 'journalist-api' })
  }));
  rootLogger.info('journalist.mounted', { path: '/journalist', telegramConfigured: !!messagingServices.telegramAdapter });

  // Scheduling domain - DDD replacement for legacy /cron
  const schedulingJobStore = new YamlJobStore({
    loadFile,
    logger: rootLogger.child({ module: 'scheduling-jobs' })
  });

  const schedulingStateStore = new YamlStateStore({
    loadFile,
    saveFile,
    logger: rootLogger.child({ module: 'scheduling-state' })
  });

  // Module paths in jobs.yml are relative to legacy cron router location
  const legacyCronRouterDir = join(__dirname, '..', '_legacy', 'routers');

  const schedulerService = new SchedulerService({
    jobStore: schedulingJobStore,
    stateStore: schedulingStateStore,
    timezone: 'America/Los_Angeles',
    moduleBasePath: legacyCronRouterDir,
    logger: rootLogger.child({ module: 'scheduler-service' })
  });

  const scheduler = new Scheduler({
    schedulerService,
    intervalMs: 5000,
    logger: rootLogger.child({ module: 'scheduler' })
  });

  // Start scheduler (only if enableScheduler is true)
  if (enableScheduler) {
    scheduler.start();
  } else {
    rootLogger.info('scheduler.disabled', { reason: 'Disabled by configuration' });
  }

  app.use('/scheduling', createSchedulingRouter({
    schedulerService,
    scheduler,
    logger: rootLogger.child({ module: 'scheduling-api' })
  }));
  rootLogger.info('scheduling.mounted', { path: '/scheduling', schedulerEnabled: enableScheduler && scheduler.enabled });

  // ==========================================================================
  // Frontend Static Files
  // ==========================================================================

  const frontendPath = join(__dirname, '..', '..', 'frontend', 'dist');
  const frontendExists = existsSync(frontendPath);

  if (frontendExists) {
    app.use(express.static(frontendPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/ws')) return next();
      res.sendFile(join(frontendPath, 'index.html'));
    });
  } else {
    rootLogger.warn('frontend.not_found', { path: frontendPath });
    app.use('/', (req, res, next) => {
      // Skip WebSocket paths - let them through to handlers
      if (req.path.startsWith('/ws')) return next();
      res.status(502).json({ error: 'Frontend not available', detail: 'Frontend dist not found. Build frontend or check deployment.' });
    });
  }

  return app;
}
