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
import axios from 'axios';
import { existsSync } from 'fs';
import path, { join } from 'path';

// Infrastructure imports
import { ConfigValidationError, configService, dataService, userDataService, userService } from './0_system/config/index.mjs';
import { UserResolver } from './0_system/users/UserResolver.mjs';
import { HttpClient } from './0_system/services/HttpClient.mjs';

// Logging system
import { getDispatcher } from './0_system/logging/dispatcher.mjs';
import { createLogger } from './0_system/logging/logger.mjs';
import { ingestFrontendLogs } from './0_system/logging/ingestion.mjs';
import { loadLoggingConfig, resolveLoggerLevel } from './0_system/logging/config.mjs';

// Bootstrap functions
import {
  // Integration system (config-driven adapter loading)
  initializeIntegrations,
  loadHouseholdIntegrations,
  getHouseholdAdapters,
  hasCapability,
  loadSystemBots,
  getMessagingAdapter,
  // Content domain
  createContentRegistry,
  createMediaProgressMemory,
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
  createDeviceServices,
  createDeviceApiRouter,
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
  createHarvesterServices,
  createAgentsApiRouter,
  createCostServices,
  createCostApiRouter
} from './0_system/bootstrap.mjs';

// AI router import
import { createAIRouter } from './4_api/v1/routers/ai.mjs';

// Routing toggle system
import { loadRoutingConfig } from './0_system/routing/index.mjs';

// UPC Gateway for barcode lookups
import { UPCGateway } from '#adapters/nutribot/UPCGateway.mjs';

// HTTP middleware
import { createDevProxy, errorHandlerMiddleware } from './0_system/http/middleware/index.mjs';
import { createEventBusRouter } from './4_api/v1/routers/admin/eventbus.mjs';
import { createAdminRouter } from './4_api/v1/routers/admin/index.mjs';

// Scheduling domain
import { SchedulerService } from '#domains/scheduling/services/SchedulerService.mjs';
import { YamlJobDatastore } from '#adapters/scheduling/YamlJobDatastore.mjs';
import { YamlStateDatastore } from '#adapters/scheduling/YamlStateDatastore.mjs';
import { Scheduler } from './0_system/scheduling/Scheduler.mjs';
import { createSchedulingRouter } from './4_api/v1/routers/scheduling.mjs';

// Canvas domain
import { createCanvasRouter } from './4_api/v1/routers/canvas.mjs';

// Screens domain
import { createScreensRouter } from './4_api/v1/routers/screens.mjs';

// Conversation state persistence
import { YamlConversationStateDatastore } from '#adapters/messaging/YamlConversationStateDatastore.mjs';

// Media jobs (fresh video downloads)
import { MediaJobExecutor } from './3_applications/media/MediaJobExecutor.mjs';
import { createFreshVideoJobHandler } from './3_applications/media/FreshVideoJobHandler.mjs';
import { YtDlpAdapter } from '#adapters/media/YtDlpAdapter.mjs';

// Content composition use case
import { ComposePresentationUseCase } from './3_applications/content/usecases/ComposePresentationUseCase.mjs';

// Harvest domain (data collection)
import { createHarvestRouter } from './4_api/v1/routers/harvest.mjs';

// FileIO utilities for image saving
import { saveImage as saveImageToFile } from './0_system/utils/FileIO.mjs';
// API versioning
import { createApiRouter } from './4_api/v1/routers/api.mjs';
import { createConfigRouter } from './4_api/v1/routers/config.mjs';
import { createItemRouter } from './4_api/v1/routers/item.mjs';

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
  // Initialize Integration System (Config-Driven Adapter Loading)
  // ==========================================================================

  // Discover available adapters and prepare for config-driven loading
  // This replaces hardcoded adapter imports with manifest-based discovery
  let integrationSystem = null;
  let householdAdapters = null;
  const defaultHouseholdId = configService.getDefaultHouseholdId() || 'default';

  try {
    integrationSystem = await initializeIntegrations({
      configService,
      logger: rootLogger.child({ module: 'integrations' })
    });

    // Load adapters for the default household
    householdAdapters = await loadHouseholdIntegrations({
      householdId: defaultHouseholdId,
      httpClient: axios,
      logger: rootLogger.child({ module: 'integrations' })
    });

    rootLogger.info('integrations.loaded', {
      householdId: defaultHouseholdId,
      capabilities: householdAdapters?.providers ?
        ['media', 'ai', 'home_automation', 'messaging', 'finance'].filter(c => householdAdapters.has(c)) :
        []
    });
  } catch (err) {
    // Integration system is optional - fall back to hardcoded adapters
    rootLogger.warn('integrations.fallback', {
      reason: err.message,
      message: 'Falling back to hardcoded adapter initialization'
    });
  }

  // ==========================================================================
  // Initialize Services
  // ==========================================================================

  const dataBasePath = configService.getDataDir();
  const mediaBasePath = configService.getMediaDir();
  const householdId = configService.getDefaultHouseholdId() || 'default';
  const householdDir = userDataService.getHouseholdDir(householdId);

  // DevProxy for forwarding webhooks to local dev machine
  const devHost = configService.get('LOCAL_DEV_HOST') || configService.getSecret('LOCAL_DEV_HOST');
  const dataDir = configService.getDataDir();
  const devProxy = createDevProxy({ logger: rootLogger, dataDir, devHost });

  // UserResolver for platform identity -> system username mapping
  const userResolver = new UserResolver(configService, {
    logger: rootLogger.child({ module: 'user-resolver' })
  });

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
  // Get Immich gallery credentials (household auth uses 'token', adapter expects 'apiKey')
  const immichHost = configService.resolveServiceUrl('immich');
  const immichAuth = configService.getHouseholdAuth('immich');
  const immichConfig = immichHost && immichAuth?.token ? { host: immichHost, apiKey: immichAuth.token } : null;

  // Get Audiobookshelf credentials (ebooks/audiobooks)
  const audiobookshelfHost = configService.resolveServiceUrl('audiobookshelf');
  const audiobookshelfAuth = configService.getHouseholdAuth('audiobookshelf');
  const audiobookshelfConfig = audiobookshelfHost && audiobookshelfAuth?.token
    ? { host: audiobookshelfHost, token: audiobookshelfAuth.token }
    : null;

  // Get nomusic overlay config from fitness app settings
  const fitnessConfig = configService.getAppConfig('fitness');
  const nomusicLabels = fitnessConfig?.plex?.nomusic_labels || [];
  const musicOverlayPlaylist = fitnessConfig?.plex?.music_overlay_playlist || null;

  // Canvas art display config - filesystem path for art images
  const canvasConfig = configService.getAppConfig('canvas') || {};
  // Default to Dropbox path if not configured
  const defaultCanvasPath = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media/img/art';
  const canvas = {
    filesystem: {
      basePath: canvasConfig.filesystem?.basePath || defaultCanvasPath
    },
    immich: canvasConfig.immich || null,
    proxyPath: canvasConfig.proxyPath || '/api/v1/canvas/image'
  };

  const watchlistPath = `${householdDir}/state/lists.yml`;
  const contentPath = `${dataBasePath}/content`;  // LocalContentAdapter expects content/ subdirectory
  const mediaMemoryPath = `${householdDir}/history/media_memory`;

  // Media progress path - use household-scoped path (SSOT for media progress)
  const mediaProgressPath = configService.getPath('watchState') || `${householdDir}/history/media_memory`;
  const mediaProgressMemory = createMediaProgressMemory({ mediaProgressPath });

  // Singing/Narrated adapters - use content subdirectories
  const singingConfig = {
    dataPath: path.join(contentPath, 'singing'),
    mediaPath: path.join(mediaBasePath, 'singing')
  };
  const narratedConfig = {
    dataPath: path.join(contentPath, 'narrated'),
    mediaPath: path.join(mediaBasePath, 'narrated')
  };

  const contentRegistry = createContentRegistry({
    mediaBasePath,
    plex: mediaLibConfig,  // Bootstrap key stays 'plex' for now
    immich: immichConfig,  // Gallery source (photos/videos)
    audiobookshelf: audiobookshelfConfig,  // Ebooks/audiobooks
    canvas,  // Canvas art display (filesystem-based)
    dataPath: contentPath,
    listDataPath: dataBasePath,  // ListAdapter needs root data path for household/config/lists/
    watchlistPath,
    mediaMemoryPath,
    nomusicLabels,
    musicOverlayPlaylist,
    singing: singingConfig,  // Sing-along content (hymns, primary songs)
    narrated: narratedConfig   // Follow-along narrated content (scripture, talks, poetry)
  }, { httpClient: axios, mediaProgressMemory, app });

  // Create proxy service for content domain (used for media library passthrough)
  const contentProxyService = createProxyService({
    plex: mediaLibConfig,  // Bootstrap key stays 'plex' for now
    immich: immichConfig,  // Photo/video gallery
    audiobookshelf: audiobookshelfConfig,  // Ebooks/audiobooks
    logger: rootLogger.child({ module: 'content-proxy' })
  });

  // Import FileIO functions for content domain (replaces legacy io.mjs)
  // Content routers use household-scoped paths
  const { loadYaml, saveYaml } = await import('./0_system/utils/FileIO.mjs');
  const contentLoadFile = (relativePath) => loadYaml(path.join(householdDir, relativePath));
  const contentSaveFile = (relativePath, data) => saveYaml(path.join(householdDir, relativePath), data);

  // Load legacy prefix mapping for ContentQueryService (e.g., hymn:123 -> singing:hymn/123)
  const contentPrefixesPath = path.join(dataBasePath, 'config', 'content-prefixes');
  const contentPrefixes = loadYaml(contentPrefixesPath) || {};
  const legacyPrefixMap = contentPrefixes.legacy || {};

  // Create compose presentation use case for multi-track content composition
  const composePresentationUseCase = new ComposePresentationUseCase({
    contentSourceRegistry: contentRegistry,
    logger: rootLogger.child({ module: 'compose-presentation' })
  });

  const { routers: contentRouters, services: contentServices } = createApiRouters({
    registry: contentRegistry,
    mediaProgressMemory,
    loadFile: contentLoadFile,
    saveFile: contentSaveFile,
    cacheBasePath: mediaBasePath ? `${mediaBasePath}/img/cache` : null,
    dataPath: dataBasePath,
    mediaBasePath,
    proxyService: contentProxyService,
    composePresentationUseCase,
    configService,
    legacyPrefixMap,
    logger: rootLogger.child({ module: 'content' })
  });

  // Health domain
  const healthServices = createHealthServices({
    userDataService,
    configService,
    logger: rootLogger
  });

  // Finance domain
  // Prefer config-driven buxfer adapter, fall back to legacy auth lookup
  const buxferAuth = configService.getUserAuth?.('buxfer') || configService.getHouseholdAuth?.('buxfer');
  const financeServices = createFinanceServices({
    configService,
    defaultHouseholdId,
    // Prefer config-driven adapter from integration system (use .has() to avoid NoOp)
    buxferAdapter: householdAdapters?.has?.('finance') ? householdAdapters.get('finance') : null,
    // AI gateway for transaction categorization
    aiGateway: householdAdapters?.has?.('ai') ? householdAdapters.get('ai') : null,
    // Legacy fallback
    buxfer: buxferAuth?.email && buxferAuth?.password ? {
      email: buxferAuth.email,
      password: buxferAuth.password
    } : null,
    httpClient: axios,
    logger: rootLogger.child({ module: 'finance' })
  });

  // Cost domain
  const costDataRoot = configService.getHouseholdPath('apps/cost');
  const costServices = createCostServices({
    dataRoot: costDataRoot,
    // budgetRepository not yet implemented - will be added when YamlBudgetDatastore is created
    logger: rootLogger.child({ module: 'cost' })
  });

  // Entropy domain - use UserDataService for user-specific data (replaces legacy io.mjs)
  const userLoadFile = (username, service) => userDataService.getLifelogData(username, service);
  const userLoadCurrent = (username, service) => userDataService.readUserData(username, `current/${service}`);
  const ArchiveService = (await import('./3_applications/content/services/ArchiveService.mjs')).default;
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
  // Use resolveServiceUrl for services.yml (environment-aware) and getHouseholdAuth for token
  const haBaseUrl = configService.resolveServiceUrl('homeassistant') || '';
  const haAuth = configService.getHouseholdAuth('homeassistant') || {};
  const loadFitnessConfig = (hid) => {
    const targetHouseholdId = hid || configService.getDefaultHouseholdId();
    return userDataService.readHouseholdAppData(targetHouseholdId, 'fitness', 'config');
  };

  const fitnessServices = createFitnessServices({
    configService,
    mediaRoot: mediaBasePath,
    defaultHouseholdId: householdId,
    // Prefer config-driven HA adapter, fall back to config-based creation (use .has() to avoid NoOp)
    haGateway: householdAdapters?.has?.('home_automation') ? householdAdapters.get('home_automation') : null,
    homeAssistant: {
      baseUrl: haBaseUrl,
      token: haAuth.token || ''
    },
    loadFitnessConfig,
    openaiApiKey: configService.getSecret('OPENAI_API_KEY') || '',
    httpClient: axios,
    logger: rootLogger.child({ module: 'fitness' })
  });

  // ==========================================================================
  // Create API v1 Routers
  // ==========================================================================
  // All DDD routers are collected here and mounted under /api/v1
  // Route names can be changed in api.mjs without affecting this file

  // Create unified item router (new item-centric API)
  // Resolve menu memory path from configService (bootstrap resolves config values)
  const menuMemoryPath = configService.getHouseholdPath('history/menu_memory');
  const itemRouter = createItemRouter({
    registry: contentRegistry,
    contentQueryService: contentServices.contentQueryService,
    menuMemoryPath,
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
    // Local media browsing and streaming
    local: contentRouters.local,
    // Stream router for singing/narrated content
    stream: contentRouters.stream,
  };
  rootLogger.info('content.routers.created', { keys: ['item', 'content', 'proxy', 'list', 'play', 'localContent', 'local', 'stream'] });

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

  // Cost domain router
  v1Routers.cost = createCostApiRouter({
    costServices,
    logger: rootLogger.child({ module: 'cost-api' })
  });

  // Harvester application services
  // Create shared IO functions for lifelog persistence
  const userSaveFile = (username, service, data) => userDataService.saveLifelogData(username, service, data);

  // Image saving for Infinity harvester (mirrors legacy io.saveImage behavior)
  // Images are saved to media/img/{folder}/{uid}.jpg with 24-hour caching
  const imgBasePath = configService.getPath('img') || `${mediaBasePath}/img`;
  const saveImage = (url, folder, uid) => saveImageToFile(url, imgBasePath, folder, uid);

  // Household-level file saving for Infinity harvester state
  const householdSaveFile = (relativePath, data) => {
    // Save to household[-{hid}]/state/{path}
    return userDataService.saveHouseholdData(householdId, relativePath, data);
  };

  const harvesterIo = { userLoadFile, userSaveFile, saveImage, householdSaveFile };

  // Note: nutribotAiGateway is created later; pass null for now
  // (shopping extraction will use httpClient directly if AI gateway unavailable)
  const harvesterServices = createHarvesterServices({
    io: harvesterIo,
    httpClient: axios,
    configService,
    userDataService,
    dataService, // Required for YamlWeatherDatastore (sharedStore)
    todoistApi: null, // Will use httpClient directly
    aiGateway: null, // AI gateway created later in app initialization
    // Reuse config-driven buxfer adapter from finance domain (use .has() to avoid NoOp)
    buxferAdapter: householdAdapters?.has?.('finance') ? householdAdapters.get('finance') : null,
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
  v1Routers.static = createStaticApiRouter({
    imgBasePath,
    dataBasePath,
    logger: rootLogger.child({ module: 'static-api' })
  });

  // Config router - serves configuration to frontend
  v1Routers.config = createConfigRouter({
    dataPath: dataBasePath,
    logger: rootLogger.child({ module: 'config-api' })
  });

  // DevProxy control routes (toggle proxy on/off)
  v1Routers.dev = devProxy.router;

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
  const printerAdapterConfig = configService.getAdapterConfig('thermal_printer') || {};
  const printerUrl = configService.resolveServiceUrl('thermal_printer');
  const mqttUrl = configService.resolveServiceUrl('mqtt');
  const ttsApiKey = configService.getSecret('OPENAI_API_KEY') || '';

  // Parse URLs to extract host/port for adapters that need them
  const parseUrl = (url) => {
    if (!url) return { host: null, port: null };
    try {
      const parsed = new URL(url);
      return { host: parsed.hostname, port: parsed.port ? parseInt(parsed.port, 10) : null };
    } catch { return { host: null, port: null }; }
  };
  const printer = parseUrl(printerUrl);
  const mqtt = parseUrl(mqttUrl);

  const hardwareAdapters = createHardwareAdapters({
    printer: {
      host: printerAdapterConfig.host || printer.host || '',
      port: printerAdapterConfig.port || printer.port || 9100,
      timeout: printerAdapterConfig.timeout || 5000,
      upsideDown: printerAdapterConfig.upsideDown !== false
    },
    mqtt: {
      host: mqtt.host || '',
      port: mqtt.port || 1883
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
    rootLogger.info('mqtt.disabled', { reason: 'disabled for this environment' });
  } else if (mqtt.host) {
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
    const { createPrayerCardRenderer } = await import('#adapters/gratitude/rendering/PrayerCardRenderer.mjs');
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

  // Nutribot report renderer (canvas-based PNG generation)
  let nutribotReportRenderer = null;
  try {
    const { NutriReportRenderer } = await import('#adapters/nutribot/rendering/NutriReportRenderer.mjs');
    nutribotReportRenderer = new NutriReportRenderer({
      logger: rootLogger.child({ module: 'nutribot-renderer' }),
      fontDir: configService.getPath('font'),
      iconDir: configService.getPath('icons') + '/food',
    });
    rootLogger.info?.('nutribot.renderer.initialized');
  } catch (e) {
    rootLogger.warn?.('nutribot.renderer.import_failed', { error: e.message });
  }

  // Fitness domain router
  // Note: contentRegistry passed for /show endpoint - fitness assumes plex source
  v1Routers.fitness = createFitnessApiRouter({
    fitnessServices,
    userService,
    userDataService,
    configService,
    contentRegistry,
    contentQueryService: contentServices.contentQueryService,
    logger: rootLogger.child({ module: 'fitness-api' })
  });

  // Home automation domain
  const kioskConfig = configService.getAppConfig('kiosk') || {};
  const taskerConfig = configService.getAppConfig('tasker') || {};
  const remoteExecConfig = configService.getAppConfig('remote_exec') || {};
  const homeAutomationAdapters = createHomeAutomationAdapters({
    // Prefer config-driven HA adapter, fall back to config-based creation (use .has() to avoid NoOp)
    haGateway: householdAdapters?.has?.('home_automation') ? householdAdapters.get('home_automation') : null,
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
    httpClient: axios,
    logger: rootLogger.child({ module: 'home-automation' })
  });

  // Import FileIO functions for state persistence (replaces legacy io.mjs)
  const { loadYaml: haLoadYaml, saveYaml: haSaveYaml } = await import('./0_system/utils/FileIO.mjs');
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

  // Device registry domain
  const devicesConfig = configService.getHouseholdDevices(householdId);
  // daylight_host is the callback URL for this app - derive from app port or device config
  const appPort = configService.getAppPort();
  const daylightHost = devicesConfig.daylightHost || `http://localhost:${appPort}`;
  const deviceServices = await createDeviceServices({
    devicesConfig: devicesConfig.devices || {},
    haGateway: homeAutomationAdapters.haGateway,
    httpClient: axios,
    wsBus: null, // Will be set after EventBus is created
    remoteExec: homeAutomationAdapters.remoteExecAdapter,
    daylightHost,
    configService,
    logger: rootLogger.child({ module: 'devices' })
  });

  v1Routers.device = createDeviceApiRouter({
    deviceServices,
    configService,
    logger: rootLogger.child({ module: 'device-api' })
  });

  // Messaging domain (provides telegramAdapter for chatbots)
  // System bot config (bot_id, secretToken per platform) from system/bots.yml
  const systemBots = configService.getSystemConfig('bots') || {};
  const gmailConfig = configService.getAppConfig('gmail') || {};

  // NutriBot application config
  const nutribotConfig = configService.getAppConfig('nutribot') || {};
  const openaiApiKey = configService.getSecret('OPENAI_API_KEY') || '';

  // Create shared AI adapter (used by all bots)
  // Prefer config-driven adapter from integration system, fall back to hardcoded creation
  // Note: .get() returns NoOp adapter if not configured, so check .has() first
  let sharedAiGateway = householdAdapters?.has?.('ai') ? householdAdapters.get('ai') : null;
  if (!sharedAiGateway && openaiApiKey) {
    const { OpenAIAdapter } = await import('#adapters/ai/OpenAIAdapter.mjs');
    sharedAiGateway = new OpenAIAdapter({ apiKey: openaiApiKey }, { httpClient: axios, logger: rootLogger.child({ module: 'shared-ai' }) });
    rootLogger.debug('ai.adapter.fallback', { reason: 'Using hardcoded OpenAI adapter creation' });
  }

  // Create shared voice transcription service (used by all bot TelegramAdapters)
  // ALWAYS use OpenAI for transcription (requires Whisper API support)
  let voiceTranscriptionService = null;
  if (openaiApiKey) {
    const { OpenAIAdapter } = await import('#adapters/ai/OpenAIAdapter.mjs');
    const openaiForTranscription = new OpenAIAdapter(
      { apiKey: openaiApiKey },
      { httpClient: axios, logger: rootLogger.child({ module: 'openai-transcription' }) }
    );
    const { TelegramVoiceTranscriptionService } = await import('#adapters/messaging/TelegramVoiceTranscriptionService.mjs');
    const voiceHttpClient = new HttpClient({ logger: rootLogger.child({ module: 'voice-http' }) });
    voiceTranscriptionService = new TelegramVoiceTranscriptionService(
      { openaiAdapter: openaiForTranscription },
      { httpClient: voiceHttpClient, logger: rootLogger.child({ module: 'voice-transcription' }) }
    );
  }

  // Load system-level bots from config (system/bots.yml + system/auth/telegram.yml)
  // This creates bot adapters that can be looked up by household messaging platform
  try {
    const botsLoaded = loadSystemBots({
      httpClient: axios,
      transcriptionService: voiceTranscriptionService
    });
    rootLogger.info('system.bots.loaded', { count: botsLoaded });
  } catch (err) {
    rootLogger.warn('system.bots.error', {
      reason: err.message,
      message: 'System bots not loaded - messaging services may not work'
    });
  }

  // Alias for backward compatibility
  const nutribotAiGateway = sharedAiGateway;

  const messagingServices = createMessagingServices({
    userDataService,
    telegram: {
      token: configService.getSystemAuth('telegram', 'nutribot') || ''  // Default adapter uses nutribot token
    },
    gmail: gmailConfig.credentials ? {
      credentials: gmailConfig.credentials,
      token: gmailConfig.token
    } : null,
    transcriptionService: voiceTranscriptionService,  // Voice message transcription
    httpClient: axios,  // Required for TelegramAdapter API calls
    logger: rootLogger.child({ module: 'messaging' })
  });

  const upcHttpClient = new HttpClient({ logger: rootLogger.child({ module: 'upc-http' }) });
  const upcGateway = new UPCGateway({
    httpClient: upcHttpClient,
    logger: rootLogger.child({ module: 'upc-gateway' }),
  });

  // Create conversation state store for nutribot (persists lastReportMessageId for cleanup)
  const nutribotStateStore = new YamlConversationStateDatastore({
    basePath: configService.getHouseholdPath('apps/nutribot/conversations')
  });

  // Get nutribot adapter from config-driven SystemBotLoader
  const nutribotTelegramAdapter = getMessagingAdapter(householdId, 'nutribot');

  const nutribotServices = createNutribotServices({
    configService,
    userDataService,
    telegramAdapter: nutribotTelegramAdapter,
    aiGateway: nutribotAiGateway,
    upcGateway,
    googleImageGateway: null,  // TODO: Add Google Image gateway when available
    conversationStateStore: nutribotStateStore,
    reportRenderer: nutribotReportRenderer,  // Canvas-based PNG report renderer
    nutribotConfig,
    logger: rootLogger.child({ module: 'nutribot' })
  });

  v1Routers.nutribot = createNutribotApiRouter({
    nutribotServices,
    userResolver,
    botId: systemBots.nutribot?.telegram?.bot_id || '',
    secretToken: systemBots.nutribot?.telegram?.secret_token || '',
    gateway: nutribotTelegramAdapter,
    logger: rootLogger.child({ module: 'nutribot-api' })
  });

  // Journalist application
  const journalistConfig = configService.getAppConfig('journalist') || {};

  // Reuse shared AI adapter (loaded from integration system or created above)
  const journalistAiGateway = nutribotAiGateway;

  // Get journalist adapter from config-driven SystemBotLoader
  const journalistTelegramAdapter = getMessagingAdapter(householdId, 'journalist');

  // Create conversation state store for journalist
  const journalistStateStore = new YamlConversationStateDatastore({
    basePath: configService.getHouseholdPath('apps/journalist/conversations')
  });

  const journalistServices = createJournalistServices({
    userDataService,
    configService,
    telegramAdapter: journalistTelegramAdapter,
    aiGateway: journalistAiGateway,
    userResolver,
    conversationStateStore: journalistStateStore,
    quizRepository: null,  // TODO: Add quiz repository when available
    logger: rootLogger.child({ module: 'journalist' })
  });

  v1Routers.journalist = createJournalistApiRouter({
    journalistServices,
    configService,
    userResolver,
    botId: systemBots.journalist?.telegram?.bot_id || '',
    secretToken: systemBots.journalist?.telegram?.secret_token || '',
    gateway: journalistTelegramAdapter,
    logger: rootLogger.child({ module: 'journalist-api' })
  });

  // HomeBot application
  const homebotConfig = configService.getAppConfig('homebot') || {};

  // Reuse shared AI adapter (loaded from integration system or created above)
  const homebotAiGateway = nutribotAiGateway || journalistAiGateway;

  // Get homebot adapter from config-driven SystemBotLoader
  const homebotTelegramAdapter = getMessagingAdapter(householdId, 'homebot');

  // Create conversation state store for homebot
  const homebotStateStore = new YamlConversationStateDatastore({
    basePath: configService.getHouseholdPath('apps/homebot/conversations')
  });

  const homebotServices = createHomebotServices({
    telegramAdapter: homebotTelegramAdapter,
    aiGateway: homebotAiGateway,
    gratitudeService: gratitudeServices.gratitudeService,
    configService,
    conversationStateStore: homebotStateStore,
    websocketBroadcast: broadcastEvent,
    logger: rootLogger.child({ module: 'homebot' })
  });

  v1Routers.homebot = createHomebotApiRouter({
    homebotServices,
    userResolver,
    botId: systemBots.homebot?.telegram?.bot_id || '',
    secretToken: systemBots.homebot?.telegram?.secret_token || '',
    gateway: homebotTelegramAdapter,
    logger: rootLogger.child({ module: 'homebot-api' })
  });

  // Agents application router
  v1Routers.agents = createAgentsApiRouter({
    logger: rootLogger.child({ module: 'agents-api' })
  });

  // AI API router - provides direct AI endpoints (/api/ai/*)
  // Create adapters for OpenAI and Anthropic
  const anthropicApiKey = configService.getSecret('ANTHROPIC_API_KEY') || '';

  // Reuse shared AI adapter for OpenAI (loaded from integration system)
  const aiOpenaiAdapter = sharedAiGateway;

  // Anthropic adapter - could be loaded from integration system if configured
  // For now, create directly if API key is available
  let aiAnthropicAdapter = null;
  if (anthropicApiKey) {
    const { AnthropicAdapter } = await import('#adapters/ai/AnthropicAdapter.mjs');
    aiAnthropicAdapter = new AnthropicAdapter(
      { apiKey: anthropicApiKey },
      { httpClient: axios, logger: rootLogger.child({ module: 'ai-anthropic' }) }
    );
  }

  v1Routers.ai = createAIRouter({
    openaiAdapter: aiOpenaiAdapter,
    anthropicAdapter: aiAnthropicAdapter,
    logger: rootLogger.child({ module: 'ai-api' })
  });

  // Scheduling domain - DDD replacement for legacy /cron
  const schedulingJobStore = new YamlJobDatastore({
    dataService,
    logger: rootLogger.child({ module: 'scheduling-jobs' })
  });

  const schedulingStateStore = new YamlStateDatastore({
    dataService,
    logger: rootLogger.child({ module: 'scheduling-state' })
  });


  // Media job executor (YouTube downloads, etc.)
  const mediaExecutor = new MediaJobExecutor({
    logger: rootLogger.child({ module: 'media-executor' })
  });

  // Register fresh video download handler (only if mediaBasePath is configured)
  if (mediaBasePath) {
    const mediaPath = join(mediaBasePath, 'video', 'news');

    const videoSourceGateway = new YtDlpAdapter({
      logger: rootLogger.child({ module: 'ytdlp' })
    });

    mediaExecutor.register('freshvideo', createFreshVideoJobHandler({
      videoSourceGateway,
      loadFile,
      mediaPath,
      logger: rootLogger.child({ module: 'freshvideo' })
    }));
  } else {
    rootLogger.warn?.('freshvideo.disabled', {
      reason: 'mediaBasePath not configured - video downloads disabled'
    });
  }

  const schedulerService = new SchedulerService({
    jobStore: schedulingJobStore,
    stateStore: schedulingStateStore,
    timezone: 'America/Los_Angeles',
    harvesterExecutor: harvesterServices.jobExecutor,
    mediaExecutor
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

  // Canvas router for art display
  v1Routers.canvas = createCanvasRouter({
    canvasService: null  // Uses req.app.get('canvasBasePath') instead
  });

  // Screens router for screen configurations
  v1Routers.screens = createScreensRouter({
    dataPath: dataBasePath,
    logger: rootLogger.child({ module: 'screens-api' })
  });

  // Admin router - combined content, images, and eventbus management
  v1Routers.admin = createAdminRouter({
    userDataService,
    configService,
    mediaPath: mediaBasePath || imgBasePath, // Use base media path for admin operations
    loadFile,
    eventBus,
    logger: rootLogger.child({ module: 'admin-api' })
  });

  // Test infrastructure router (dev/test only)
  const { createTestRouter } = await import('./4_api/v1/routers/test.mjs');
  v1Routers.test = createTestRouter({
    logger: rootLogger.child({ module: 'test-api' })
  });

  // ==========================================================================
  // Mount API v1 Router
  // ==========================================================================
  // All DDD routers are now accessible under /api/v1/*
  // Route names can be changed in api.mjs without affecting frontend paths

  // Resolve safe config for /status endpoint (bootstrap resolves config values)
  const safeConfig = configService.getSafeConfig();

  const apiRouter = createApiRouter({
    safeConfig,
    routers: v1Routers,
    plexProxyHandler: mediaLibProxyHandler,  // Key stays 'plexProxyHandler' for API compat
    logger: rootLogger.child({ module: 'api-v1' })
  });

  // DevProxy middleware - only intercepts webhook routes
  app.use('/api/v1/nutribot/webhook', devProxy.middleware);
  app.use('/api/v1/journalist/webhook', devProxy.middleware);
  app.use('/api/v1/homebot/webhook', devProxy.middleware);

  // ==========================================================================
  // Frontend Static Files (Production Only) - MUST be before API router
  // ==========================================================================

  // GUARDRAIL: Only serve static dist in production (Docker).
  // Dev server should NEVER serve dist - Vite handles frontend in development.
  // Static files are served BEFORE API router so frontend paths like /fitness
  // get the React app, not the API JSON response.
  if (isDocker) {
    const frontendPath = join(__dirname, '..', '..', 'frontend', 'dist');
    const frontendExists = existsSync(frontendPath);

    if (frontendExists) {
      // Serve static assets (JS, CSS, images)
      app.use(express.static(frontendPath));

      // For SPA routes, serve index.html (but NOT for API or WebSocket paths)
      // This catch-all must be BEFORE the API router
      app.use((req, res, next) => {
        // Skip API paths (they go to the API router below)
        if (req.path.startsWith('/api/v1') || req.path.startsWith('/ws')) {
          return next();
        }
        // Skip paths with file extensions (already handled by express.static)
        if (req.path.includes('.')) {
          return next();
        }
        // SPA route - serve index.html
        res.sendFile(join(frontendPath, 'index.html'));
      });
      rootLogger.info('frontend.static.mounted', { path: frontendPath });
    } else {
      rootLogger.warn('frontend.not_found', { path: frontendPath });
    }
  } else {
    rootLogger.info('frontend.dev_mode', { message: 'Static serving disabled - use Vite dev server for frontend' });
  }

  // ==========================================================================
  // Mount API v1 Router (after static files in Docker)
  // ==========================================================================
  // API routes are only reached if:
  // - In dev mode (no static serving)
  // - Or the request wasn't caught by static serving above (API/WS paths)

  app.use('/api/v1', apiRouter);
  rootLogger.info('api.mounted', {
    path: '/api/v1',
    routerCount: Object.keys(v1Routers).length,
    routers: Object.keys(v1Routers)
  });

  // Error handler middleware - must be last
  app.use(errorHandlerMiddleware());

  return app;
}
