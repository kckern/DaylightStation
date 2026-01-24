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
import { ConfigValidationError, configService, userDataService, userService } from './0_infrastructure/config/index.mjs';

// Logging system
import { getDispatcher } from './0_infrastructure/logging/dispatcher.js';
import { createLogger } from './0_infrastructure/logging/logger.js';
import { ingestFrontendLogs } from './0_infrastructure/logging/ingestion.js';
import { loadLoggingConfig, resolveLoggerLevel } from './0_infrastructure/logging/config.js';

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
  createHomebotServices,
  createHomebotApiRouter,
  createNutribotServices,
  createNutribotApiRouter,
  createLifelogServices,
  createLifelogApiRouter,
  createStaticApiRouter,
  createCalendarApiRouter,
  createEventBus,
  broadcastEvent,
  createHarvesterServices
} from './0_infrastructure/bootstrap.mjs';

// Routing toggle system
import { loadRoutingConfig } from './0_infrastructure/routing/index.mjs';

// HTTP middleware
import { createDevProxy } from './0_infrastructure/http/middleware/index.mjs';
import { createEventBusRouter } from './4_api/routers/admin/eventbus.mjs';

// Scheduling domain
import { SchedulerService } from './1_domains/scheduling/services/SchedulerService.mjs';
import { YamlJobStore } from './2_adapters/scheduling/YamlJobStore.mjs';
import { YamlStateStore } from './2_adapters/scheduling/YamlStateStore.mjs';
import { Scheduler } from './0_infrastructure/scheduling/Scheduler.mjs';
import { createSchedulingRouter } from './4_api/routers/scheduling.mjs';

// Media jobs (YouTube downloads, etc.)
import { MediaJobExecutor } from './3_applications/media/MediaJobExecutor.mjs';
import { createYouTubeJobHandler } from './3_applications/media/YouTubeJobHandler.mjs';

// Harvest domain (data collection)
import { createHarvestRouter } from './4_api/routers/harvest.mjs';

// API versioning
import { createApiV1Router } from './4_api/routers/apiV1.mjs';
import { createItemRouter } from './4_api/routers/item.mjs';

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

  // ==========================================================================
  // Dev Proxy (for webhook debugging without redeploy)
  // ==========================================================================
  // Must be early in middleware chain to intercept requests before handlers
  const devProxy = createDevProxy({ logger });
  app.use('/dev', devProxy.router);  // Toggle at /dev/proxy_toggle
  app.use(devProxy.middleware);      // Intercepts all requests when enabled
  logger.info('devProxy.initialized', { endpoint: '/dev/proxy_toggle' });

  if (!configExists) {
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/ws/')) return next();
      res.status(500).json({ error: 'Application not configured. Ensure system.yml exists.' });
    });
    return app;
  }

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

  // ==========================================================================
  // Routing Toggle System
  // ==========================================================================

  let routingConfig;
  try {
    routingConfig = loadRoutingConfig('./backend/config/routing.yml');
    rootLogger.info('routing.toggle.loaded', { default: routingConfig.default });
  } catch (error) {
    rootLogger.warn('routing.toggle.fallback', { error: error.message });
    routingConfig = { default: 'legacy', routing: {} };
  }

  // ==========================================================================
  // Initialize Services
  // ==========================================================================

  const dataBasePath = configService.getDataDir();
  const mediaBasePath = configService.getMediaDir();
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
  // Get media library credentials (currently Plex, could be Jellyfin, etc.)
  const mediaLibConfig = configService.getServiceCredentials('plex');

  // Get nomusic overlay config from fitness app settings
  const fitnessConfig = configService.getAppConfig('fitness');
  const nomusicLabels = fitnessConfig?.plex?.nomusic_labels || [];
  const musicOverlayPlaylist = fitnessConfig?.plex?.music_overlay_playlist || null;

  const watchlistPath = `${householdDir}/state/lists.yml`;
  const contentPath = `${dataBasePath}/content`;  // LocalContentAdapter expects content/ subdirectory
  const mediaMemoryPath = `${householdDir}/history/media_memory`;
  const contentRegistry = createContentRegistry({
    mediaBasePath,
    plex: mediaLibConfig,  // Bootstrap key stays 'plex' for now
    dataPath: contentPath,
    watchlistPath,
    mediaMemoryPath,
    nomusicLabels,
    musicOverlayPlaylist
  });

  // Watch state path - use history/media_memory under data path (matches legacy structure)
  const watchStatePath = configService.getPath('watchState') || `${dataBasePath}/history/media_memory`;
  const watchStore = createWatchStore({ watchStatePath });

  // Create proxy service for content domain (used for media library passthrough)
  const contentProxyService = mediaLibConfig?.host ? createProxyService({
    plex: mediaLibConfig,  // Bootstrap key stays 'plex' for now
    logger: rootLogger.child({ module: 'content-proxy' })
  }) : null;

  // Import FileIO functions for content domain (replaces legacy io.mjs)
  const { loadYaml, saveYaml } = await import('./0_infrastructure/utils/FileIO.mjs');
  const dataDir = configService.getDataDir();
  const contentLoadFile = (relativePath) => loadYaml(path.join(dataDir, relativePath));
  const contentSaveFile = (relativePath, data) => saveYaml(path.join(dataDir, relativePath), data);

  const contentRouters = createApiRouters({
    registry: contentRegistry,
    watchStore,
    loadFile: contentLoadFile,
    saveFile: contentSaveFile,
    cacheBasePath: mediaBasePath ? `${mediaBasePath}/img/cache` : null,
    dataPath: dataBasePath,
    mediaBasePath,
    proxyService: contentProxyService,
    configService,
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
  // Buxfer credentials are in user auth, app config has account IDs
  const buxferAuth = configService.getUserAuth?.('buxfer') || configService.getHouseholdAuth?.('buxfer');
  const axios = (await import('axios')).default;
  const financeServices = createFinanceServices({
    dataRoot: dataBasePath,
    defaultHouseholdId: householdId,
    buxfer: buxferAuth?.email && buxferAuth?.password ? {
      email: buxferAuth.email,
      password: buxferAuth.password
    } : null,
    httpClient: axios,
    configService,
    logger: rootLogger.child({ module: 'finance' })
  });

  // Entropy domain - use UserDataService for user-specific data (replaces legacy io.mjs)
  const userLoadFile = (username, service) => userDataService.getLifelogData(username, service);
  const userLoadCurrent = (username, service) => userDataService.readUserData(username, `current/${service}`);
  const ArchiveService = (await import('./1_domains/content/services/ArchiveService.mjs')).default;
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
  // Get Home Assistant config from ConfigService
  // Use getServiceConfig for system.home_assistant (host/port) and getHouseholdAuth for token
  const haServiceConfig = configService.getServiceConfig('home_assistant') || {};
  const haAuth = configService.getHouseholdAuth('home_assistant') || {};
  // Build baseUrl from host and port (host may include protocol, e.g., 'http://homeassistant')
  const haBaseUrl = haServiceConfig.host
    ? (haServiceConfig.port ? `${haServiceConfig.host}:${haServiceConfig.port}` : haServiceConfig.host)
    : '';
  const loadFitnessConfig = (hid) => {
    const targetHouseholdId = hid || configService.getDefaultHouseholdId();
    return userDataService.readHouseholdAppData(targetHouseholdId, 'fitness', 'config');
  };

  const fitnessServices = createFitnessServices({
    dataRoot: dataBasePath,
    mediaRoot: mediaBasePath,
    defaultHouseholdId: householdId,
    homeAssistant: {
      baseUrl: haBaseUrl,
      token: haAuth.token || ''
    },
    loadFitnessConfig,
    openaiApiKey: configService.getSecret('OPENAI_API_KEY') || '',
    logger: rootLogger.child({ module: 'fitness' })
  });

  // ==========================================================================
  // Create API v1 Routers
  // ==========================================================================
  // All DDD routers are collected here and mounted under /api/v1
  // Route names can be changed in apiV1.mjs without affecting this file

  // Create unified item router (new item-centric API)
  const itemRouter = createItemRouter({
    registry: contentRegistry,
    loadFile: contentLoadFile,
    configService,
    logger: rootLogger.child({ module: 'item-api' })
  });

  const v1Routers = {
    // New unified item API
    item: itemRouter,
    // Legacy content domain routers (to be deprecated)
    content: contentRouters.content,
    proxy: contentRouters.proxy,
    list: contentRouters.list,
    play: contentRouters.play,
    localContent: contentRouters.localContent,
  };
  rootLogger.info('content.routers.created', { keys: ['item', 'content', 'proxy', 'list', 'play', 'localContent'] });

  // Health domain router
  v1Routers.health = createHealthApiRouter({
    healthServices,
    configService,
    logger: rootLogger.child({ module: 'health-api' })
  });

  // Finance domain router
  v1Routers.finance = createFinanceApiRouter({
    financeServices,
    configService,
    logger: rootLogger.child({ module: 'finance-api' })
  });

  // Legacy redirects for frontend compatibility
  app.get('/data/budget', (req, res) => res.redirect(307, '/api/v1/finance/data'));
  app.get('/data/budget/daytoday', (req, res) => res.redirect(307, '/api/v1/finance/data/daytoday'));

  // Harvester application services
  // Create shared IO functions for lifelog persistence
  const userSaveFile = (username, service, data) => userDataService.saveLifelogData(username, service, data);
  const harvesterIo = { userLoadFile, userSaveFile };

  // Note: nutribotAiGateway is created later; pass null for now
  // (shopping extraction will use httpClient directly if AI gateway unavailable)
  const harvesterServices = createHarvesterServices({
    io: harvesterIo,
    httpClient: axios,
    configService,
    todoistApi: null, // Will use httpClient directly
    aiGateway: null, // AI gateway created later in app initialization
    logger: rootLogger.child({ module: 'harvester' })
  });

  // Create harvest router using HarvesterService
  v1Routers.harvest = createHarvestRouter({
    harvesterService: harvesterServices.harvesterService,
    configService,
    logger: rootLogger.child({ module: 'harvest-api' })
  });

  // Entropy domain router
  v1Routers.entropy = createEntropyApiRouter({
    entropyServices,
    configService,
    logger: rootLogger.child({ module: 'entropy-api' })
  });

  // Lifelog domain router
  v1Routers.lifelog = createLifelogApiRouter({
    lifelogServices,
    userDataService,
    configService,
    logger: rootLogger.child({ module: 'lifelog-api' })
  });

  // Static assets router
  const imgBasePath = configService.getPath('img') || `${mediaBasePath}/img`;
  v1Routers.static = createStaticApiRouter({
    imgBasePath,
    dataBasePath,
    logger: rootLogger.child({ module: 'static-api' })
  });

  // Media library proxy service (for thumbnail transcoding, etc.)
  let mediaLibProxyHandler = null;

  if (mediaLibConfig?.host && mediaLibConfig?.token) {
    const mediaLibProxyService = createProxyService({
      plex: mediaLibConfig,  // Bootstrap key stays 'plex' for now
      logger: rootLogger.child({ module: 'media-proxy' })
    });
    mediaLibProxyHandler = async (req, res) => {
      await mediaLibProxyService.proxy('plex', req, res);
    };
  } else {
    rootLogger.warn('mediaLibProxy.disabled', { reason: 'Missing host or token' });
  }

  // Calendar domain router
  v1Routers.calendar = createCalendarApiRouter({
    userDataService,
    configService,
    logger: rootLogger.child({ module: 'calendar-api' })
  });

  // Hardware adapters (printer, TTS, MQTT sensors)
  // Use getServiceConfig for system.* configs (printer, mqtt are in system.yml, not apps/)
  const printerConfig = configService.getServiceConfig('printer') || {};
  const mqttConfig = configService.getServiceConfig('mqtt') || {};
  const ttsApiKey = configService.getSecret('OPENAI_API_KEY') || '';

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

  // Gratitude domain router - prayer card canvas renderer
  let createPrayerCardCanvas = null;
  try {
    const { createPrayerCardRenderer } = await import('./0_infrastructure/rendering/PrayerCardRenderer.mjs');
    const householdId = configService.getDefaultHouseholdId();
    const renderer = createPrayerCardRenderer({
      getSelectionsForPrint: async () => {
        return gratitudeServices.gratitudeService.getSelectionsForPrint(
          householdId,
          (userId) => userService.resolveDisplayName(userId)
        );
      },
      fontDir: configService.getPath('font') || `${mediaBasePath}/fonts`
    });
    createPrayerCardCanvas = renderer.createCanvas;
  } catch (e) {
    rootLogger.warn?.('gratitude.canvas.import_failed', { error: e.message });
  }

  v1Routers.gratitude = createGratitudeApiRouter({
    gratitudeServices,
    configService,
    broadcastToWebsockets: broadcastEvent,
    createPrayerCardCanvas,
    printerAdapter: hardwareAdapters.printerAdapter,
    logger: rootLogger.child({ module: 'gratitude-api' })
  });

  // Fitness domain router
  // Note: contentRegistry passed for /show endpoint - fitness assumes plex source
  v1Routers.fitness = createFitnessApiRouter({
    fitnessServices,
    userService,
    userDataService,
    configService,
    contentRegistry,
    logger: rootLogger.child({ module: 'fitness-api' })
  });

  // Home automation domain
  const kioskConfig = configService.getAppConfig('kiosk') || {};
  const taskerConfig = configService.getAppConfig('tasker') || {};
  const remoteExecConfig = configService.getAppConfig('remote_exec') || {};
  const homeAutomationAdapters = createHomeAutomationAdapters({
    homeAssistant: {
      baseUrl: haBaseUrl,
      token: haAuth.token || ''
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

  // Import FileIO functions for state persistence (replaces legacy io.mjs)
  const { loadYaml: haLoadYaml, saveYaml: haSaveYaml } = await import('./0_infrastructure/utils/FileIO.mjs');
  // Reuse householdDir from earlier (line 157)
  const loadFile = (relativePath) => haLoadYaml(path.join(householdDir, relativePath));
  const saveFile = (relativePath, data) => haSaveYaml(path.join(householdDir, relativePath), data);

  v1Routers.home = createHomeAutomationApiRouter({
    adapters: homeAutomationAdapters,
    loadFile,
    saveFile,
    householdId,
    entropyService: entropyServices.entropyService,
    configService,
    logger: rootLogger.child({ module: 'home-automation-api' })
  });

  // Messaging domain (provides telegramAdapter for chatbots)
  // Bot tokens come from secrets.yml, config from chatbots.yml
  const chatbotsConfig = configService.getAppConfig('chatbots') || {};
  const gmailConfig = configService.getAppConfig('gmail') || {};

  // Get bot tokens from secrets (TELEGRAM_NUTRIBOT_TOKEN, etc.)
  const nutribotToken = configService.getSecret('TELEGRAM_NUTRIBOT_TOKEN') || '';
  const journalistToken = configService.getSecret('TELEGRAM_JOURNALIST_BOT_TOKEN') || '';
  const homebotToken = configService.getSecret('TELEGRAM_HOMEBOT_TOKEN') || '';

  // NutriBot application config
  const nutribotConfig = configService.getAppConfig('nutribot') || {};
  const openaiApiKey = configService.getSecret('OPENAI_API_KEY') || '';

  // Create shared AI adapter (used by all bots)
  let sharedAiGateway = null;
  if (openaiApiKey) {
    const { OpenAIAdapter } = await import('./2_adapters/ai/OpenAIAdapter.mjs');
    sharedAiGateway = new OpenAIAdapter({ apiKey: openaiApiKey }, { logger: rootLogger.child({ module: 'shared-ai' }) });
  }

  // Create shared voice transcription service (used by all bot TelegramAdapters)
  let voiceTranscriptionService = null;
  if (sharedAiGateway) {
    const { TelegramVoiceTranscriptionService } = await import('./2_adapters/messaging/TelegramVoiceTranscriptionService.mjs');
    voiceTranscriptionService = new TelegramVoiceTranscriptionService({
      openaiAdapter: sharedAiGateway,
      httpClient: axios,
      logger: rootLogger.child({ module: 'voice-transcription' })
    });
  }

  // Alias for backward compatibility
  const nutribotAiGateway = sharedAiGateway;

  const messagingServices = createMessagingServices({
    userDataService,
    telegram: {
      token: nutribotToken  // Default adapter uses nutribot token
    },
    gmail: gmailConfig.credentials ? {
      credentials: gmailConfig.credentials,
      token: gmailConfig.token
    } : null,
    transcriptionService: voiceTranscriptionService,  // Voice message transcription
    httpClient: axios,  // Required for TelegramAdapter API calls
    logger: rootLogger.child({ module: 'messaging' })
  });

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

  v1Routers.nutribot = createNutribotApiRouter({
    nutribotServices,
    botId: chatbotsConfig.bots?.nutribot?.telegram_bot_id || '',
    secretToken: chatbotsConfig.bots?.nutribot?.secretToken || '',
    gateway: messagingServices.telegramAdapter,
    logger: rootLogger.child({ module: 'nutribot-api' })
  });

  // Journalist application
  const journalistConfig = configService.getAppConfig('journalist') || {};

  // Create AI adapter for journalist (reuse pattern from nutribot, or share adapter)
  let journalistAiGateway = nutribotAiGateway;  // Reuse the same adapter
  if (!journalistAiGateway && openaiApiKey) {
    const { OpenAIAdapter } = await import('./2_adapters/ai/OpenAIAdapter.mjs');
    journalistAiGateway = new OpenAIAdapter({ apiKey: openaiApiKey }, { logger: rootLogger.child({ module: 'journalist-ai' }) });
  }

  // Create dedicated TelegramAdapter for journalist with its own token
  const { TelegramAdapter } = await import('./2_adapters/messaging/TelegramAdapter.mjs');
  const journalistTelegramAdapter = journalistToken
    ? new TelegramAdapter({
        token: journalistToken,
        httpClient: axios,
        transcriptionService: voiceTranscriptionService,
        logger: rootLogger.child({ module: 'journalist-telegram' })
      })
    : null;

  const journalistServices = createJournalistServices({
    userDataService,
    configService,
    telegramAdapter: journalistTelegramAdapter || messagingServices.telegramAdapter,
    aiGateway: journalistAiGateway,
    userResolver: null,  // TODO: Add UserResolver when available
    conversationStateStore: null,  // Uses in-memory by default
    quizRepository: null,  // TODO: Add quiz repository when available
    logger: rootLogger.child({ module: 'journalist' })
  });

  v1Routers.journalist = createJournalistApiRouter({
    journalistServices,
    configService,
    botId: chatbotsConfig.bots?.journalist?.telegram_bot_id || '',
    secretToken: chatbotsConfig.bots?.journalist?.secretToken || '',
    gateway: journalistTelegramAdapter,
    logger: rootLogger.child({ module: 'journalist-api' })
  });

  // HomeBot application
  const homebotConfig = configService.getAppConfig('homebot') || {};

  // Reuse AI gateway from nutribot/journalist
  let homebotAiGateway = nutribotAiGateway || journalistAiGateway;
  if (!homebotAiGateway && openaiApiKey) {
    const { OpenAIAdapter } = await import('./2_adapters/ai/OpenAIAdapter.mjs');
    homebotAiGateway = new OpenAIAdapter({ apiKey: openaiApiKey }, { logger: rootLogger.child({ module: 'homebot-ai' }) });
  }

  // Create dedicated TelegramAdapter for homebot with its own token
  const homebotTelegramAdapter = homebotToken
    ? new TelegramAdapter({
        token: homebotToken,
        httpClient: axios,
        transcriptionService: voiceTranscriptionService,
        logger: rootLogger.child({ module: 'homebot-telegram' })
      })
    : null;

  const homebotServices = createHomebotServices({
    telegramAdapter: homebotTelegramAdapter || messagingServices.telegramAdapter,
    aiGateway: homebotAiGateway,
    gratitudeStore: gratitudeServices.gratitudeStore,
    configService,
    conversationStateStore: null,  // Uses in-memory by default
    websocketBroadcast: broadcastEvent,
    logger: rootLogger.child({ module: 'homebot' })
  });

  v1Routers.homebot = createHomebotApiRouter({
    homebotServices,
    botId: chatbotsConfig.bots?.homebot?.telegram_bot_id || '',
    secretToken: chatbotsConfig.bots?.homebot?.secretToken || '',
    gateway: homebotTelegramAdapter,
    logger: rootLogger.child({ module: 'homebot-api' })
  });

  // Scheduling domain - DDD replacement for legacy /cron
  const schedulingJobStore = new YamlJobStore({
    dataDir,
    logger: rootLogger.child({ module: 'scheduling-jobs' })
  });

  const schedulingStateStore = new YamlStateStore({
    dataDir,
    logger: rootLogger.child({ module: 'scheduling-state' })
  });

  // Legacy module paths (for jobs without executors: fitsync, archive-rotation, media-memory-validator)
  // These paths are relative to _legacy/routers/ and resolve to _legacy/lib/
  // TODO: Migrate remaining 3 legacy jobs, then remove this
  const legacyModuleBasePath = join(__dirname, '..', '_legacy', 'routers');

  // Media job executor (YouTube downloads, etc.)
  const mediaExecutor = new MediaJobExecutor({
    logger: rootLogger.child({ module: 'media-executor' })
  });

  // Register YouTube download handler
  const mediaPath = process.env.path?.media
    ? join(process.env.path.media, 'video', 'news')
    : join(__dirname, '..', 'media', 'video', 'news');

  mediaExecutor.register('youtube', createYouTubeJobHandler({
    loadFile,
    mediaPath,
    logger: rootLogger.child({ module: 'youtube' })
  }));

  const schedulerService = new SchedulerService({
    jobStore: schedulingJobStore,
    stateStore: schedulingStateStore,
    timezone: 'America/Los_Angeles',
    moduleBasePath: legacyModuleBasePath,
    harvesterExecutor: harvesterServices.jobExecutor,
    mediaExecutor,
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

  v1Routers.scheduling = createSchedulingRouter({
    schedulerService,
    scheduler,
    logger: rootLogger.child({ module: 'scheduling-api' })
  });

  // ==========================================================================
  // Mount API v1 Router
  // ==========================================================================
  // All DDD routers are now accessible under /api/v1/*
  // Route names can be changed in apiV1.mjs without affecting frontend paths

  const apiV1Router = createApiV1Router({
    routers: v1Routers,
    plexProxyHandler: mediaLibProxyHandler,  // Key stays 'plexProxyHandler' for API compat
    logger: rootLogger.child({ module: 'api-v1' })
  });

  // Mount at root since index.js already strips /api/v1 prefix before routing here
  app.use('/', apiV1Router);
  rootLogger.info('apiV1.mounted', {
    path: '/ (receives requests after /api/v1 prefix stripped by index.js)',
    routerCount: Object.keys(v1Routers).length,
    routers: Object.keys(v1Routers)
  });

  // ==========================================================================
  // Frontend Static Files (Production Only)
  // ==========================================================================

  // GUARDRAIL: Only serve static dist in production (Docker).
  // Dev server should NEVER serve dist - Vite handles frontend in development.
  if (isDocker) {
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
        if (req.path.startsWith('/ws')) return next();
        res.status(502).json({ error: 'Frontend not available', detail: 'Frontend dist not found. Build frontend or check deployment.' });
      });
    }
  } else {
    rootLogger.info('frontend.dev_mode', { message: 'Static serving disabled - use Vite dev server for frontend' });
  }

  return app;
}
