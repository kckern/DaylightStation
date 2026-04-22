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
import { UserIdentityService } from './2_domains/messaging/services/UserIdentityService.mjs';
import { TelegramIdentityAdapter } from './1_adapters/messaging/TelegramIdentityAdapter.mjs';
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
  loadSystemBots,
  getMessagingAdapter,
  // Content domain
  createContentRegistry,
  createMediaProgressMemory,
  createApiRouters,
  createFitnessServices,
  createFitnessApiRouter,
  createFeedServices,
  createFinanceServices,
  createFinanceApiRouter,
  createEntropyServices,
  createEntropyApiRouter,
  createHealthServices,
  createHealthApiRouter,
  createHealthDashboardApiRouter,
  createGratitudeServices,
  createGratitudeApiRouter,
  createHomeAutomationAdapters,
  createHomeAutomationApiRouter,
  createDeviceServices,
  createDeviceApiRouter,
  createWakeAndLoadService,
  createDispatchIdempotencyService,
  createTranscodePrewarmService,
  createHardwareAdapters,
  createProxyService,
  createMessagingServices,
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
  createDeviceLivenessService,
  broadcastEvent,
  createHarvesterServices,
  createAgentsApiRouter,
  createCostServices,
  createCostApiRouter,
  createMediaServices
} from './0_system/bootstrap.mjs';

import { bootstrapLifeplan } from './0_system/bootstrap/lifeplan.mjs';

// AI router import
import { createAIRouter } from './4_api/v1/routers/ai.mjs';

// Feed harvester adapter for scheduler integration
import { HeadlineHarvesterAdapter } from './1_adapters/feed/HeadlineHarvesterAdapter.mjs';

// Routing toggle system
import { loadRoutingConfig } from './0_system/routing/index.mjs';

// UPC Gateway for barcode lookups
import { UPCGateway } from '#adapters/nutribot/UPCGateway.mjs';

// Thermal printer registry (multi-printer support)
import { ThermalPrinterAdapter, ThermalPrinterRegistry } from '#adapters/hardware/thermal-printer/index.mjs';

// HTTP middleware
import { createDevProxy, errorHandlerMiddleware } from './0_system/http/middleware/index.mjs';
import { createEventBusRouter } from './4_api/v1/routers/admin/eventbus.mjs';
import { createAdminRouter } from './4_api/v1/routers/admin/index.mjs';
import { createMediaRouter } from './4_api/v1/routers/media.mjs';
import { createLivestreamRouter } from './4_api/v1/routers/livestream.mjs';
import { createCameraRouter } from './4_api/v1/routers/camera.mjs';
import { createPrinterRouter } from './4_api/v1/routers/printer.mjs';

// Homeline call state tracking
import { handleSignalingMessage } from '#apps/homeline/CallStateService.mjs';

// Pose frame logging
import { createPoseLogHandler } from '#apps/fitness/services/PoseLogService.mjs';

// Fitness application services (shared between fitness router and agents router)
import { FitnessPlayableService } from '#apps/fitness/FitnessPlayableService.mjs';
import { FitnessConfigService } from '#apps/fitness/FitnessConfigService.mjs';
import { FitnessProgressClassifier } from '#domains/fitness/services/FitnessProgressClassifier.mjs';

// Scheduling domain + orchestrator
import { SchedulerService } from '#domains/scheduling/services/SchedulerService.mjs';
import { SchedulerOrchestrator } from '#apps/scheduling/SchedulerOrchestrator.mjs';
import { YamlJobDatastore } from '#adapters/scheduling/YamlJobDatastore.mjs';
import { YamlStateDatastore } from '#adapters/scheduling/YamlStateDatastore.mjs';
import { Scheduler } from './0_system/scheduling/Scheduler.mjs';
import { createSchedulingRouter } from './4_api/v1/routers/scheduling.mjs';

// Canvas domain
import { createCanvasRouter } from './4_api/v1/routers/canvas.mjs';

// Screens domain
import { createScreensRouter } from './4_api/v1/routers/screens.mjs';

// Auth system
import { AuthService } from '#apps/auth/AuthService.mjs';
import { networkTrustResolver } from '#api/middleware/networkTrustResolver.mjs';
import { tokenResolver } from '#api/middleware/tokenResolver.mjs';
import { permissionGate } from '#api/middleware/permissionGate.mjs';
import { createAuthRouter } from '#api/v1/routers/auth.mjs';
import { householdResolver } from '#api/middleware/householdResolver.mjs';

// Conversation state persistence
import { YamlConversationStateDatastore } from '#adapters/messaging/YamlConversationStateDatastore.mjs';

// Media jobs (fresh video downloads)
import { MediaJobExecutor } from './3_applications/media/MediaJobExecutor.mjs';
import { MediaDownloadService } from './3_applications/media/services/MediaDownloadService.mjs';
import { createFreshVideoJobHandler } from './3_applications/media/FreshVideoJobHandler.mjs';
import { YtDlpAdapter } from '#adapters/media/YtDlpAdapter.mjs';

// Content composition use case
import { ComposePresentationUseCase } from './3_applications/content/usecases/ComposePresentationUseCase.mjs';

// Barcode scanner pipeline
import { BarcodeGatekeeper } from '#domains/barcode/BarcodeGatekeeper.mjs';
import { autoApprove } from '#domains/barcode/strategies/AutoApproveStrategy.mjs';
import { BarcodeScanService } from './3_applications/barcode/BarcodeScanService.mjs';
import { KNOWN_COMMANDS, resolveCommand } from '#domains/barcode/BarcodeCommandMap.mjs';

// Weekly Review domain
import { WeeklyReviewImmichAdapter } from './1_adapters/weekly-review/WeeklyReviewImmichAdapter.mjs';
import { WeeklyReviewCalendarAdapter } from './1_adapters/weekly-review/WeeklyReviewCalendarAdapter.mjs';
import { WeeklyReviewService } from './3_applications/weekly-review/WeeklyReviewService.mjs';
import { createWeeklyReviewRouter } from './4_api/v1/routers/weekly-review.mjs';

// Harvest domain (data collection)
import { createHarvestRouter } from './4_api/v1/routers/harvest.mjs';

// FileIO utilities for image saving
import { saveImage as saveImageToFile, loadYaml as loadYamlStatic } from './0_system/utils/FileIO.mjs';
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
  // Enable SharedArrayBuffer for TF.js WASM multi-threaded SIMD
  app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    next();
  });
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
  // Auth System
  // ==========================================================================

  const authService = new AuthService({ dataService, configService, logger: rootLogger.child({ module: 'auth' }) });
  const authConfig = dataService.system.read('config/auth') || {};
  const jwtSecret = authConfig?.jwt?.secret || '';
  const jwtConfig = authConfig?.jwt || { issuer: 'daylight-station', expiry: '10y', algorithm: 'HS256' };

  // Auth middleware pipeline — runs on all /api/v1/* requests
  // 1. householdResolver sets req.householdId from Host header
  const domainConfig = dataService.system.read('config/domains') || {};
  app.use('/api/v1', householdResolver({ domainConfig, configService }));

  // 2. networkTrustResolver assigns household roles for LAN requests
  app.use('/api/v1', networkTrustResolver({ householdRoles: authConfig?.household_roles || {} }));

  // 3. tokenResolver parses JWT, merges roles
  app.use('/api/v1', tokenResolver({ jwtSecret, jwtConfig }));

  // 4. permissionGate enforces role-based access (auth endpoints are exempt — they're unrestricted in app_routes)
  app.use('/api/v1', permissionGate({
    roles: authConfig?.roles || {},
    appRoutes: authConfig?.app_routes || {},
    logger: rootLogger.child({ module: 'permissionGate' })
  }));

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
  // Shared AI Gateway (single OpenAI adapter for all consumers)
  // ==========================================================================

  const openaiApiKey = configService.getSecret('OPENAI_API_KEY') || '';

  // Create shared AI adapter (used by all bots, voice transcription, harvesters)
  // Prefer config-driven adapter from integration system, fall back to hardcoded creation
  // Note: .get() returns NoOp adapter if not configured, so check .has() first
  let sharedAiGateway = householdAdapters?.has?.('ai') ? householdAdapters.get('ai') : null;
  if (!sharedAiGateway && openaiApiKey) {
    const { OpenAIAdapter } = await import('#adapters/ai/OpenAIAdapter.mjs');
    sharedAiGateway = new OpenAIAdapter({ apiKey: openaiApiKey }, { httpClient: axios, logger: rootLogger.child({ module: 'shared-ai' }) });
    rootLogger.debug('ai.adapter.fallback', { reason: 'Using hardcoded OpenAI adapter creation' });
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

  // Domain identity service (replaces UserResolver for identity resolution)
  const userIdentityService = new UserIdentityService(
    configService.getIdentityMappings()
  );

  // EventBus (WebSocket)
  const eventBus = await createEventBus({
    httpServer: server,
    path: '/ws',
    logger: rootLogger
  });

  // DeviceLivenessService — caches last-known device-state snapshots and
  // synthesizes `offline` broadcasts when heartbeats stop. Also wires
  // itself into the event bus so new subscribers get a replayed snapshot.
  createDeviceLivenessService({
    eventBus,
    logger: rootLogger.child({ module: 'device-liveness' })
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

    // Homeline video call signaling - relay to all subscribers of this device's topic
    if (message.topic?.startsWith('homeline:')) {
      handleSignalingMessage(message);
      eventBus.broadcast(message.topic, message);
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
  const defaultCanvasPath = mediaBasePath ? `${mediaBasePath}/img/art` : null;
  const canvas = {
    filesystem: {
      basePath: canvasConfig.filesystem?.basePath || defaultCanvasPath
    },
    immich: canvasConfig.immich || null,
    proxyPath: canvasConfig.proxyPath || '/api/v1/canvas/image'
  };

  // watchlistPath removed - lists now in config/lists/ directory (managed by ListAdapter)
  const contentPath = `${dataBasePath}/content`;  // LocalContentAdapter expects content/ subdirectory
  const mediaMemoryPath = `${householdDir}/history/media_memory`;

  // Media progress path - use household-scoped path (SSOT for media progress)
  const mediaProgressPath = configService.getPath('watchState') || `${householdDir}/history/media_memory`;
  const mediaProgressMemory = createMediaProgressMemory({ mediaProgressPath });

  // Progress sync — bidirectional progress sync for remote media servers
  let progressSyncService = null;
  if (audiobookshelfConfig) {
    const { AudiobookshelfClient } = await import('./1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs');
    const { ABSProgressAdapter } = await import('./1_adapters/content/readable/audiobookshelf/ABSProgressAdapter.mjs');
    const { ProgressSyncService } = await import('./3_applications/content/services/ProgressSyncService.mjs');
    const absClient = new AudiobookshelfClient(audiobookshelfConfig, { httpClient: axios });
    const remoteProgressProvider = new ABSProgressAdapter(absClient);
    progressSyncService = new ProgressSyncService({
      remoteProgressProvider,
      mediaProgressMemory,
      logger: rootLogger.child({ module: 'progress-sync' })
    });
  }

  // Singalong/Readalong adapters - point to canonical data directories (no symlinks)
  const singalongConfig = {
    dataPath: path.join(contentPath, 'singalong'),  // hymn, primary
    mediaPath: path.join(mediaBasePath, 'audio', 'singalong')
  };
  const canonicalReadalongDataPath = path.join(contentPath, 'readalong');
  const canonicalReadalongAudioPath = path.join(mediaBasePath, 'audio', 'readalong');
  const canonicalReadalongVideoPath = path.join(mediaBasePath, 'video', 'readalong');
  const readalongConfig = {
    dataPath: existsSync(canonicalReadalongDataPath) ? canonicalReadalongDataPath : contentPath,
    mediaPath: existsSync(canonicalReadalongAudioPath) ? canonicalReadalongAudioPath : path.join(mediaBasePath, 'audio'),
    mediaPathMap: {
      talks: existsSync(canonicalReadalongVideoPath) ? canonicalReadalongVideoPath : path.join(mediaBasePath, 'video')
    }
  };

  // Load content prefix config early — needed by both createContentRegistry and createApiRouters
  const contentPrefixesPath = path.join(dataBasePath, 'household', 'config', 'content-prefixes');
  const contentPrefixes = loadYamlStatic(contentPrefixesPath) || {};
  const prefixAliases = contentPrefixes.aliases || {};
  const storagePaths = contentPrefixes.storagePaths || {};

  const { registry: contentRegistry, savedQueryService } = createContentRegistry({
    mediaBasePath,
    plex: mediaLibConfig,  // Bootstrap key stays 'plex' for now
    immich: immichConfig,  // Gallery source (photos/videos)
    audiobookshelf: audiobookshelfConfig,  // Ebooks/audiobooks
    canvas,  // Canvas art display (filesystem-based)
    dataPath: contentPath,
    listDataPath: dataBasePath,  // ListAdapter needs root data path for household/config/lists/
    mediaMemoryPath,
    nomusicLabels,
    musicOverlayPlaylist,
    singalong: singalongConfig,  // Sing-along content (hymns, primary songs)
    readalong: readalongConfig,  // Follow-along readalong content (scripture, talks, poetry)
    games: {  // Game launcher (RetroArch adapter)
      config: configService.getHouseholdAppConfig(null, 'games'),
      catalogReader: () => dataService.household.read('shared/retroarch/catalog')
    },
    storagePaths                 // Collection → media_memory filename mapping
  }, { httpClient: axios, mediaProgressMemory, app, configService });

  // Create proxy service for content domain (used for media library passthrough)
  const komgaProxyAuth = configService.getHouseholdAuth('komga');
  const komgaProxyHost = configService.resolveServiceUrl('komga');
  const contentProxyService = createProxyService({
    plex: mediaLibConfig,  // Bootstrap key stays 'plex' for now
    immich: immichConfig,  // Photo/video gallery
    audiobookshelf: audiobookshelfConfig,  // Ebooks/audiobooks
    komga: komgaProxyHost ? { host: komgaProxyHost, apiKey: komgaProxyAuth?.token } : null,
    logger: rootLogger.child({ module: 'content-proxy' })
  });

  // Import FileIO functions for content domain (replaces legacy io.mjs)
  // Content routers use household-scoped paths
  const { loadYaml, saveYaml } = await import('./0_system/utils/FileIO.mjs');
  const contentLoadFile = (relativePath) => loadYaml(path.join(householdDir, relativePath));
  const contentSaveFile = (relativePath, data) => saveYaml(path.join(householdDir, relativePath), data);

  // Create compose presentation use case for multi-track content composition
  const composePresentationUseCase = new ComposePresentationUseCase({
    contentSourceRegistry: contentRegistry,
    logger: rootLogger.child({ module: 'compose-presentation' })
  });

  const progressSyncSources = progressSyncService ? new Set(['abs']) : null;

  // Build RetroArch thumbnail proxy config from device file_server + games source config
  const retroarchAppConfig = configService.getHouseholdAppConfig(null, 'games');
  const raFileServer = Object.values(configService.getHouseholdDevices()?.devices || {}).find(d => d.file_server)?.file_server;
  const retroarchProxy = (raFileServer && retroarchAppConfig?.source?.thumbnails_path)
    ? { baseUrl: `http://${raFileServer.host}:${raFileServer.port}`, thumbnailsPath: retroarchAppConfig.source.thumbnails_path }
    : null;

  const { routers: contentRouters, services: contentServices } = createApiRouters({
    registry: contentRegistry,
    mediaProgressMemory,
    progressSyncService,
    progressSyncSources,
    loadFile: contentLoadFile,
    saveFile: contentSaveFile,
    cacheBasePath: mediaBasePath ? `${mediaBasePath}/img/cache` : null,
    dataPath: dataBasePath,
    mediaBasePath,
    proxyService: contentProxyService,
    retroarchProxy,
    composePresentationUseCase,
    configService,
    prefixAliases,
    singalong: singalongConfig,
    savedQueryService,
    eventBus,
    logger: rootLogger.child({ module: 'content' })
  });

  // Health domain
  const healthServices = createHealthServices({
    dataService,
    userDataService,
    configService,
    logger: rootLogger
  });

  // Finance domain
  const financeServices = createFinanceServices({
    configService,
    defaultHouseholdId,
    // Config-driven adapter from integration system (use .has() to avoid NoOp)
    buxferAdapter: householdAdapters?.has?.('finance') ? householdAdapters.get('finance') : null,
    // AI gateway for transaction categorization
    aiGateway: householdAdapters?.has?.('ai') ? householdAdapters.get('ai') : null,
    httpClient: axios,
    logger: rootLogger.child({ module: 'finance' })
  });

  // Feed domain (FreshRSS reader + headline harvesting)
  const freshrssHost = configService.resolveServiceUrl('freshrss');
  if (!freshrssHost) {
    rootLogger.warn('feed.freshrss.disabled', { reason: 'FreshRSS service URL not configured' });
  }
  const feedServices = createFeedServices({
    dataService,
    configService,
    freshrssHost: freshrssHost || null,
    logger: rootLogger.child({ module: 'feed' }),
  });

  // Cost domain
  const costDataRoot = configService.getHouseholdPath('common/cost');
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

  // Lifeplan domain
  const lifeplanResult = bootstrapLifeplan({
    dataPath: path.join(dataBasePath, 'users'),
    aggregator: lifelogServices.lifelogAggregator,
    notificationService: null,
    clock: null,
    logger: rootLogger.child({ module: 'lifeplan' }),
  });

  // Gratitude domain
  const gratitudeServices = createGratitudeServices({
    userDataService,
    logger: rootLogger.child({ module: 'gratitude' })
  });

  // Fitness domain
  const loadFitnessConfig = (hid) => {
    const targetHouseholdId = hid || configService.getDefaultHouseholdId();
    return configService.getHouseholdAppConfig(targetHouseholdId, 'fitness');
  };

  const fitnessServices = createFitnessServices({
    configService,
    mediaRoot: mediaBasePath,
    defaultHouseholdId: householdId,
    // Config-driven HA adapter (use .has() to avoid NoOp)
    haGateway: householdAdapters?.has?.('home_automation') ? householdAdapters.get('home_automation') : null,
    loadFitnessConfig,
    openaiAdapter: sharedAiGateway,
    logger: rootLogger.child({ module: 'fitness' })
  });

  // Media domain
  const mediaServices = createMediaServices({
    configService,
    defaultHouseholdId: householdId,
    logger: rootLogger.child({ module: 'media' })
  });

  // Media command handler (registered separately because mediaServices must be in scope)
  eventBus.onClientMessage((clientId, message) => {
    if (message.topic !== 'media:command') return;

    const { action, contentId, householdId } = message;
    rootLogger.info?.('eventbus.media.command', { clientId, action, contentId });

    (async () => {
      try {
        const mediaQueueService = mediaServices.mediaQueueService;

        if (action === 'play') {
          // Insert after current, advance to it — load once, mutate, save once
          const queue = await mediaQueueService.load(householdId);
          const added = queue.addItems([{ contentId, addedFrom: 'WEBSOCKET' }], 'next');
          const insertedIdx = queue.items.findIndex(i => i.queueId === added[0].queueId);
          if (insertedIdx >= 0) queue.position = insertedIdx;
          await mediaQueueService.replace(queue, householdId);
          eventBus.broadcast('media:queue', queue.toJSON());
        } else if (action === 'add') {
          // Load once → mutate in memory → save once (matches play/queue pattern)
          const queue = await mediaQueueService.load(householdId);
          queue.addItems([{ contentId, addedFrom: 'WEBSOCKET' }], 'end');
          await mediaQueueService.replace(queue, householdId);
          eventBus.broadcast('media:queue', queue.toJSON());
        } else if (action === 'next') {
          // Load once → mutate in memory → save once (matches play/queue pattern)
          const queue = await mediaQueueService.load(householdId);
          queue.addItems([{ contentId, addedFrom: 'WEBSOCKET' }], 'next');
          await mediaQueueService.replace(queue, householdId);
          eventBus.broadcast('media:queue', queue.toJSON());
        } else if (action === 'clear') {
          const queue = await mediaQueueService.clear(householdId);
          eventBus.broadcast('media:queue', queue.toJSON());
        } else if (action === 'queue') {
          // Replace entire queue with item — load once, mutate, save once
          const queue = await mediaQueueService.load(householdId);
          queue.clear();
          queue.addItems([{ contentId, addedFrom: 'WEBSOCKET' }], 'end');
          queue.position = 0;
          await mediaQueueService.replace(queue, householdId);
          eventBus.broadcast('media:queue', queue.toJSON());
        } else {
          rootLogger.warn?.('eventbus.media.unknown-action', { action });
        }
      } catch (err) {
        rootLogger.error?.('eventbus.media.command.error', { action, error: err.message });
      }
    })();
  });

  // Playback state broadcast relay — routes playback_state from any client
  // to playback:{deviceId|clientId} topic for device monitoring (4.2.8)
  eventBus.onClientMessage((clientId, message) => {
    if (message.topic !== 'playback_state') return;
    const broadcastId = message.deviceId || message.clientId;
    if (!broadcastId) return;
    rootLogger.debug?.('eventbus.playback_state.relay', { from: clientId, broadcastId, state: message.state });
    eventBus.broadcast(`playback:${broadcastId}`, message);
  });

  // Pose frame logging — streams raw keypoints to JSONL files
  const poseLogHandler = createPoseLogHandler(configService, rootLogger.child({ module: 'pose-log' }));
  eventBus.onClientMessage(poseLogHandler);
  eventBus.onClientDisconnection(poseLogHandler.onDisconnect);

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
    siblings: contentRouters.siblings,
    queue: contentRouters.queue,
    play: contentRouters.play,
    localContent: contentRouters.localContent,
    // Local media browsing and streaming
    local: contentRouters.local,
    // Stream router for singalong/readalong content
    stream: contentRouters.stream,
  };
  rootLogger.info('content.routers.created', { keys: ['item', 'content', 'proxy', 'list', 'siblings', 'queue', 'play', 'localContent', 'local', 'stream'] });

  // Info router (action-based metadata)
  const { createInfoRouter } = await import('./4_api/v1/routers/info.mjs');
  v1Routers.info = createInfoRouter({
    registry: contentRegistry,
    contentQueryService: contentServices.contentQueryService,
    contentIdResolver: contentServices.contentIdResolver,
    logger: rootLogger.child({ module: 'info-api' })
  });

  // Display router (action-based images)
  const { createDisplayRouter } = await import('./4_api/v1/routers/display.mjs');
  v1Routers.display = createDisplayRouter({
    registry: contentRegistry,
    contentIdResolver: contentServices.contentIdResolver,
    logger: rootLogger.child({ module: 'display-api' })
  });

  // Media queue management
  v1Routers.media = createMediaRouter({
    mediaQueueService: mediaServices.mediaQueueService,
    configService,
    broadcastEvent: (topic, payload) => eventBus.broadcast(topic, payload),
    logger: rootLogger.child({ module: 'media-api' }),
  });

  // Livestream engine
  const { ChannelManager } = await import('./3_applications/livestream/ChannelManager.mjs');
  const programsBasePath = `${configService.getDataDir()}/household/apps/livestream/programs`;
  const channelManager = new ChannelManager({
    mediaBasePath,
    programsBasePath,
    broadcastEvent: (topic, payload) => eventBus.broadcast(topic, payload),
    logger: rootLogger.child({ module: 'livestream' }),
  });

  v1Routers.livestream = createLivestreamRouter({
    channelManager,
    logger: rootLogger.child({ module: 'livestream-api' }),
  });

  // Lazy proxy for webNutribotAdapter — filled after nutribot services are created below
  const webNutribotAdapterProxy = {
    process: (...args) => webNutribotAdapterProxy._delegate?.process?.(...args)
      ?? Promise.reject(new Error('webNutribotAdapter not yet initialized')),
    processCallback: (...args) => webNutribotAdapterProxy._delegate?.processCallback?.(...args)
      ?? Promise.reject(new Error('webNutribotAdapter not yet initialized')),
    _delegate: null,
  };

  // Health domain router
  v1Routers.health = createHealthApiRouter({
    healthServices,
    configService,
    sessionService: fitnessServices.sessionService,
    sessionDatastore: fitnessServices.sessionStore,
    entropyService: entropyServices.entropyService,
    lifePlanRepository: lifeplanResult.container.getLifePlanStore(),
    catalogService: healthServices.catalogService,
    webNutribotAdapter: webNutribotAdapterProxy,
    logger: rootLogger.child({ module: 'health-api' })
  });

  // Health dashboard router (agent-generated dashboards)
  v1Routers['health-dashboard'] = createHealthDashboardApiRouter({
    dataService,
    logger: rootLogger.child({ module: 'health-dashboard-api' })
  });

  // Finance domain router
  v1Routers.finance = createFinanceApiRouter({
    financeServices,
    configService,
    logger: rootLogger.child({ module: 'finance-api' })
  });

  // Feed domain router (FreshRSS reader + headline harvesting + boonscrolling)
  if (feedServices) {
    const { FeedAssemblyService } = await import('./3_applications/feed/services/FeedAssemblyService.mjs');
    const { FeedContentService } = await import('./3_applications/feed/services/FeedContentService.mjs');
    const { WebContentAdapter } = await import('./1_adapters/feed/WebContentAdapter.mjs');
    const { createFeedRouter } = await import('./4_api/v1/routers/feed.mjs');
    const { RedditFeedAdapter } = await import('./1_adapters/feed/sources/RedditFeedAdapter.mjs');
    const { WeatherFeedAdapter } = await import('./1_adapters/feed/sources/WeatherFeedAdapter.mjs');
    const { HealthFeedAdapter } = await import('./1_adapters/feed/sources/HealthFeedAdapter.mjs');
    const { GratitudeFeedAdapter } = await import('./1_adapters/feed/sources/GratitudeFeedAdapter.mjs');
    const { StravaFeedAdapter } = await import('./1_adapters/feed/sources/StravaFeedAdapter.mjs');
    const { TodoistFeedAdapter } = await import('./1_adapters/feed/sources/TodoistFeedAdapter.mjs');
    const { ImmichFeedAdapter } = await import('./1_adapters/feed/sources/ImmichFeedAdapter.mjs');
    const { PlexFeedAdapter } = await import('./1_adapters/feed/sources/PlexFeedAdapter.mjs');
    const { JournalFeedAdapter } = await import('./1_adapters/feed/sources/JournalFeedAdapter.mjs');
    const { YouTubeFeedAdapter } = await import('./1_adapters/feed/sources/YouTubeFeedAdapter.mjs');
    const { YouTubeAdapter } = await import('./1_adapters/content/media/youtube/YouTubeAdapter.mjs');
    const { GoogleNewsFeedAdapter } = await import('./1_adapters/feed/sources/GoogleNewsFeedAdapter.mjs');
    const { KomgaFeedAdapter } = await import('./1_adapters/feed/sources/KomgaFeedAdapter.mjs');
    const { KomgaClient } = await import('./1_adapters/content/readable/komga/KomgaClient.mjs');
    const { ReadalongFeedAdapter } = await import('./1_adapters/feed/sources/ReadalongFeedAdapter.mjs');
    const { GoodreadsFeedAdapter } = await import('./1_adapters/feed/sources/GoodreadsFeedAdapter.mjs');
    const { ABSEbookFeedAdapter } = await import('./1_adapters/feed/sources/ABSEbookFeedAdapter.mjs');

    // Load query configs at bootstrap time (moves fs access out of application layer)
    const { readdirSync, existsSync } = await import('fs');
    const queriesPath = configService.getHouseholdPath('config/lists/queries');
    let queryConfigs = [];
    if (queriesPath) {
      try {
        const files = readdirSync(queriesPath).filter(f => f.endsWith('.yml'));
        queryConfigs = files.map(file => {
          const key = file.replace('.yml', '');
          const data = dataService.household.read(`config/lists/queries/${key}`);
          return data ? { ...data, _filename: file } : null;
        }).filter(Boolean);
      } catch (err) {
        rootLogger.warn('feed.queries.load.error', { error: err.message });
      }
    }

    // Load user-scoped query configs on demand (personal subreddits, Plex, etc.)
    const loadUserQueries = (username) => {
      const dataDir = configService.getDataDir();
      const userQueriesPath = path.join(dataDir, 'users', username, 'config', 'queries');
      try {
        if (!existsSync(userQueriesPath)) return [];
        const files = readdirSync(userQueriesPath).filter(f => f.endsWith('.yml'));
        return files.map(file => {
          const key = file.replace('.yml', '');
          const data = dataService.user.read(`config/queries/${key}`, username);
          return data ? { ...data, _filename: file } : null;
        }).filter(Boolean);
      } catch { return []; }
    };

    // Feed source adapters (extracted from FeedAssemblyService)
    const redditAdapter = new RedditFeedAdapter({
      dataService,
      logger: rootLogger.child({ module: 'reddit-feed' }),
    });
    const weatherAdapter = new WeatherFeedAdapter({
      dataService,
      logger: rootLogger.child({ module: 'weather-feed' }),
    });
    const healthAdapter = new HealthFeedAdapter({
      userDataService,
      logger: rootLogger.child({ module: 'health-feed' }),
    });
    const gratitudeAdapter = new GratitudeFeedAdapter({
      dataService,
      userService,
      logger: rootLogger.child({ module: 'gratitude-feed' }),
    });
    const stravaAdapter = new StravaFeedAdapter({
      userDataService,
      logger: rootLogger.child({ module: 'strava-feed' }),
    });
    const todoistAdapter = new TodoistFeedAdapter({
      userDataService,
      logger: rootLogger.child({ module: 'todoist-feed' }),
    });
    const immichConfig = configService.getAdapterConfig('immich');
    const plexConfig = configService.getAdapterConfig('plex');
    const immichAdapter = contentServices?.contentQueryService ? new ImmichFeedAdapter({
      contentQueryPort: contentServices.contentQueryService,
      contentRegistry: contentRegistry || null,
      webUrl: immichConfig?.webUrl || null,
      logger: rootLogger.child({ module: 'immich-feed' }),
    }) : null;
    const journalAdapter = new JournalFeedAdapter({
      userDataService,
      logger: rootLogger.child({ module: 'journal-feed' }),
    });
    const plexAdapter = new PlexFeedAdapter({
      contentRegistry: contentRegistry || null,
      contentQueryPort: contentServices?.contentQueryService || null,
      webUrl: mediaLibConfig?.webUrl || mediaLibConfig?.host || null,
      plexHost: mediaLibConfig?.host || null,
      plexToken: mediaLibConfig?.token || null,
      logger: rootLogger.child({ module: 'plex-feed' }),
    });
    const googleAuth = dataService.system.read('auth/google');
    const pipedHost = configService.resolveServiceUrl('piped');
    const youtubeContentAdapter = pipedHost ? new YouTubeAdapter({
      host: pipedHost,
      logger: rootLogger.child({ module: 'youtube-adapter' }),
    }) : null;
    const youtubeAdapter = googleAuth?.api_key ? new YouTubeFeedAdapter({
      apiKey: googleAuth.api_key,
      youtubeAdapter: youtubeContentAdapter,
      logger: rootLogger.child({ module: 'youtube-feed' }),
    }) : null;
    const googleNewsAdapter = new GoogleNewsFeedAdapter({
      logger: rootLogger.child({ module: 'googlenews-feed' }),
    });
    const komgaAuth = configService.getHouseholdAuth('komga');
    const komgaHost = configService.resolveServiceUrl('komga');
    const komgaFeedAdapter = komgaAuth?.token && komgaHost ? new KomgaFeedAdapter({
      client: new KomgaClient(
        { host: komgaHost, apiKey: komgaAuth.token },
        { httpClient: axios, logger: rootLogger.child({ module: 'komga-feed-client' }) }
      ),
      apiKey: komgaAuth.token,
      webUrl: configService.resolveServiceWebUrl('komga'),
      dataService,
      logger: rootLogger.child({ module: 'komga-feed' }),
    }) : null;

    const readalongContentAdapter = contentRegistry?.get('readalong') || null;
    const readalongFeedAdapter = readalongContentAdapter ? new ReadalongFeedAdapter({
      readalongAdapter: readalongContentAdapter,
      logger: rootLogger.child({ module: 'readalong-feed' }),
    }) : null;

    const goodreadsFeedAdapter = new GoodreadsFeedAdapter({
      userDataService,
      logger: rootLogger.child({ module: 'goodreads-feed' }),
    });

    const { AudiobookshelfClient } = await import('./1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs');
    const absEbookFeedAdapter = audiobookshelfConfig ? new ABSEbookFeedAdapter({
      absClient: new AudiobookshelfClient(audiobookshelfConfig, { httpClient: axios }),
      token: audiobookshelfConfig.token,
      mediaDir: mediaBasePath,
      webUrl: configService.resolveServiceWebUrl('audiobookshelf'),
      logger: rootLogger.child({ module: 'abs-ebooks-feed' }),
    }) : null;

    // Start daily prefetch timer for abs-ebooks chapter cache
    if (absEbookFeedAdapter) {
      const allQueries = [...queryConfigs, ...loadUserQueries('kckern')];
      absEbookFeedAdapter.startPrefetchTimer(allQueries);
    }

    const { ScrollConfigLoader } = await import('./3_applications/feed/services/ScrollConfigLoader.mjs');
    const { SpacingEnforcer } = await import('./3_applications/feed/services/SpacingEnforcer.mjs');
    const { TierAssemblyService } = await import('./3_applications/feed/services/TierAssemblyService.mjs');
    const { SourceResolver } = await import('./3_applications/feed/services/SourceResolver.mjs');
    const { FeedCacheService } = await import('./3_applications/feed/services/FeedCacheService.mjs');

    const scrollConfigLoader = new ScrollConfigLoader({ dataService });
    const spacingEnforcer = new SpacingEnforcer();
    const feedCacheService = new FeedCacheService({
      dataService,
      cachePath: 'current/feed/_cache',
      logger: rootLogger.child({ module: 'feed-cache' }),
    });

    const webContentAdapter = new WebContentAdapter({
      logger: rootLogger.child({ module: 'web-content' }),
    });
    const feedContentService = new FeedContentService({
      webContentGateway: webContentAdapter,
      logger: rootLogger.child({ module: 'feed-content' }),
    });
    const { YamlSelectionTrackingStore } = await import('./1_adapters/persistence/yaml/YamlSelectionTrackingStore.mjs');
    const selectionTrackingStore = new YamlSelectionTrackingStore({ dataService, logger: rootLogger.child({ module: 'selection-tracking' }) });
    const { YamlDismissedItemsStore } = await import('./1_adapters/persistence/yaml/YamlDismissedItemsStore.mjs');
    const dismissedItemsStore = new YamlDismissedItemsStore({ dataService, logger: rootLogger.child({ module: 'feed-dismissed' }) });

    const { FeedPoolManager } = await import('./3_applications/feed/services/FeedPoolManager.mjs');
    const { FreshRSSSourceAdapter } = await import('./1_adapters/feed/sources/FreshRSSSourceAdapter.mjs');
    const { HeadlineFeedAdapter } = await import('./1_adapters/feed/sources/HeadlineFeedAdapter.mjs');
    const { EntropyFeedAdapter } = await import('./1_adapters/feed/sources/EntropyFeedAdapter.mjs');

    const freshRSSFeedAdapter = new FreshRSSSourceAdapter({
      freshRSSAdapter: feedServices.freshRSSAdapter,
      configService,
      logger: rootLogger.child({ module: 'freshrss-feed' }),
    });
    const headlineFeedAdapter = new HeadlineFeedAdapter({
      headlineService: feedServices.headlineService,
      logger: rootLogger.child({ module: 'headline-feed' }),
    });
    const entropyFeedAdapter = new EntropyFeedAdapter({
      entropyService: entropyServices?.entropyService || null,
      logger: rootLogger.child({ module: 'entropy-feed' }),
    });

    const feedSourceAdapters = [redditAdapter, weatherAdapter, healthAdapter, gratitudeAdapter, stravaAdapter, todoistAdapter, immichAdapter, plexAdapter, journalAdapter, youtubeAdapter, googleNewsAdapter, komgaFeedAdapter, readalongFeedAdapter, goodreadsFeedAdapter, freshRSSFeedAdapter, headlineFeedAdapter, entropyFeedAdapter, absEbookFeedAdapter].filter(Boolean);

    const sourceResolver = new SourceResolver(feedSourceAdapters);

    const { ContentPluginRegistry } = await import('./3_applications/feed/services/ContentPluginRegistry.mjs');
    const { YouTubeContentPlugin } = await import('./1_adapters/feed/plugins/youtube.mjs');
    const contentPluginRegistry = new ContentPluginRegistry([
      new YouTubeContentPlugin({ logger: rootLogger.child({ module: 'youtube-plugin' }) }),
    ]);

    const tierAssemblyService = new TierAssemblyService({
      spacingEnforcer,
      sourceResolver,
      logger: rootLogger.child({ module: 'tier-assembly' }),
    });

    const feedPoolManager = new FeedPoolManager({
      sourceAdapters: feedSourceAdapters,
      feedCacheService,
      queryConfigs,
      loadUserQueries,
      dismissedItemsStore,
      logger: rootLogger.child({ module: 'feed-pool' }),
    });

    const { FeedFilterResolver } = await import('./3_applications/feed/services/FeedFilterResolver.mjs');
    const feedFilterResolver = new FeedFilterResolver({
      sourceTypes: feedSourceAdapters.map(a => a.sourceType),
      queryNames: queryConfigs.map(q => q._filename?.replace('.yml', '')).filter(Boolean),
      aliases: {},
    });

    const feedAssemblyService = new FeedAssemblyService({
      feedPoolManager,
      sourceAdapters: feedSourceAdapters,
      sourceResolver,
      scrollConfigLoader,
      tierAssemblyService,
      feedContentService,
      selectionTrackingStore,
      feedFilterResolver,
      spacingEnforcer,
      contentPluginRegistry,
      logger: rootLogger.child({ module: 'feed-assembly' }),
    });
    v1Routers.feed = createFeedRouter({
      freshRSSAdapter: feedServices.freshRSSAdapter,
      headlineService: feedServices.headlineService,
      feedAssemblyService,
      feedContentService,
      dismissedItemsStore,
      sourceAdapters: feedSourceAdapters,
      contentPluginRegistry,
      configService,
      logger: rootLogger.child({ module: 'feed' }),
    });
  }

  // Cost domain router
  v1Routers.cost = createCostApiRouter({
    costServices,
    logger: rootLogger.child({ module: 'cost-api' })
  });

  // Harvester application services
  // Create shared IO functions for lifelog persistence
  const userSaveFile = (username, service, data) => userDataService.saveLifelogData(username, service, data);
  // Current store needs direct writeUserData (no 'lifelog/' prefix)
  const userSaveFileDirect = (username, path, data) => userDataService.writeUserData(username, path, data);

  // Image saving for Infinity harvester (mirrors legacy io.saveImage behavior)
  // Images are saved to media/img/{folder}/{uid}.jpg with 24-hour caching
  const imgBasePath = configService.getPath('img') || `${mediaBasePath}/img`;
  const saveImage = (url, folder, uid) => saveImageToFile(url, imgBasePath, folder, uid);

  // Household-level file saving for Infinity harvester state
  const householdSaveFile = (relativePath, data) => {
    // Save to household[-{hid}]/state/{path}
    return userDataService.saveHouseholdData(householdId, relativePath, data);
  };

  const harvesterIo = {
    userLoadFile,
    userSaveFile,
    userSaveFileDirect,
    saveImage,
    householdSaveFile,
    userLoadAuth: (username, service) => userDataService.getAuthToken(username, service),
    userSaveAuth: (username, service, data) => userDataService.saveAuthToken(username, service, data),
  };

  const harvesterServices = createHarvesterServices({
    io: harvesterIo,
    httpClient: axios,
    configService,
    userDataService,
    dataService, // Required for YamlWeatherDatastore (sharedStore)
    todoistApi: null, // Will use httpClient directly
    aiGateway: sharedAiGateway, // Shared OpenAI adapter
    // Reuse config-driven buxfer adapter from finance domain (use .has() to avoid NoOp)
    buxferAdapter: householdAdapters?.has?.('finance') ? householdAdapters.get('finance') : null,
    logger: rootLogger.child({ module: 'harvester' })
  });

  // Register headline harvester so scheduler can run feed-headlines job
  try {
    harvesterServices.harvesterService.register(new HeadlineHarvesterAdapter({
      headlineService: feedServices.headlineService,
      logger: rootLogger.child({ module: 'feed-headline-harvester' }),
    }));
  } catch (err) {
    rootLogger.warn?.('feed-headline-harvester.register.failed', { error: err.message });
  }

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

  // Lifeplan domain router
  v1Routers.life = lifeplanResult.router;

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

  // Media library proxy handler (reuses contentProxyService — no separate instance needed)
  let mediaLibProxyHandler = null;

  if (mediaLibConfig?.host && mediaLibConfig?.token) {
    mediaLibProxyHandler = async (req, res) => {
      await contentProxyService.proxy('plex', req, res);
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

  // Hardware adapters (printer registry, TTS, MQTT sensors)
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
  const mqtt = parseUrl(mqttUrl);

  // Build thermal printer registry from adapters.yml (multi-printer support)
  const hardwareLogger = rootLogger.child({ module: 'hardware' });
  const adaptersConfig = configService.getAllAdapterConfigs() || {};
  const printersConfig = adaptersConfig.thermal_printers || {};
  const printerDefaults = adaptersConfig.thermal_printer_defaults || {};

  const printerRegistry = new ThermalPrinterRegistry();
  for (const [name, cfg] of Object.entries(printersConfig)) {
    if (!cfg?.host) {
      hardwareLogger.warn('thermalPrinter.skipNoHost', { name });
      continue;
    }
    const adapter = new ThermalPrinterAdapter(
      {
        host: cfg.host,
        port: cfg.port || 9100,
        timeout: cfg.timeout ?? printerDefaults.timeout ?? 5000,
        encoding: cfg.encoding ?? printerDefaults.encoding ?? 'utf8',
        upsideDown: cfg.upsideDown ?? printerDefaults.upsideDown ?? true,
      },
      { logger: hardwareLogger }
    );
    printerRegistry.register(name, adapter, { isDefault: cfg.default === true });
  }

  const registeredPrinters = printerRegistry.list();
  if (registeredPrinters.length > 0) {
    const summary = registeredPrinters
      .map(p => `${p.name} (${p.host}:${p.port}${p.isDefault ? ', default' : ''})`)
      .join(', ');
    hardwareLogger.info('thermalPrinter.registered', { count: registeredPrinters.length, summary });
  } else {
    hardwareLogger.warn('thermalPrinter.noneConfigured');
  }

  const hardwareAdapters = createHardwareAdapters({
    mqtt: {
      host: mqtt.host || '',
      port: mqtt.port || 1883,
      logsPath: mediaBasePath ? `${mediaBasePath}/logs` : null
    },
    tts: {
      apiKey: ttsApiKey,
      model: 'tts-1',
      defaultVoice: 'alloy'
    },
    barcode: {
      host: mqtt.host,
      port: mqtt.port || 1883,
      topic: (configService.getHouseholdAppConfig(householdId, 'barcode') || {}).topic || 'daylight/scanner/barcode',
      knownActions: (configService.getHouseholdAppConfig(householdId, 'barcode') || {}).actions || ['queue', 'play', 'open'],
      knownCommands: KNOWN_COMMANDS,
    },
    onMqttMessage: (payload) => {
      // Broadcast MQTT sensor messages to WebSocket clients
      broadcastEvent({ topic: 'sensor', ...payload });
    },
    logger: hardwareLogger
  });

  // Attach the printer registry so routers can resolve printers by location
  hardwareAdapters.printerRegistry = printerRegistry;

  // Initialize MQTT sensor adapter if configured and enabled
  if (enableMqtt && hardwareAdapters.mqttAdapter?.isConfigured()) {
    // Load equipment with vibration sensors for MQTT topic mapping
    const fitnessConfig = configService.getHouseholdAppConfig(householdId, 'fitness') || {};
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

  // Initialize barcode scanner MQTT adapter
  let barcodeScanServiceRef = null;
  if (enableMqtt && hardwareAdapters.barcodeAdapter?.isConfigured()) {
    const barcodeConfig = configService.getHouseholdAppConfig(householdId, 'barcode') || {};
    const devicesConfig = configService.getHouseholdDevices(householdId) || {};

    // Build scanner device map (filter to barcode-scanner type)
    const scannerDeviceConfig = {};
    const devices = devicesConfig.devices || {};
    for (const [id, device] of Object.entries(devices)) {
      if (device.type === 'barcode-scanner') {
        scannerDeviceConfig[id] = device;
      }
    }

    // Create gatekeeper with auto-approve (strategies from config in future)
    const gatekeeper = new BarcodeGatekeeper([autoApprove]);

    // Build screen topic → display on_script map for TV wake
    const haGateway = householdAdapters?.has?.('home_automation') ? householdAdapters.get('home_automation') : null;
    const screenDisplayScripts = {};
    for (const [, device] of Object.entries(devices)) {
      const topic = device.content_control?.topic;
      const displays = device.device_control?.displays;
      if (topic && displays) {
        const scripts = Object.values(displays)
          .filter(d => d.on_script)
          .map(d => d.on_script);
        if (scripts.length > 0) screenDisplayScripts[topic] = scripts;
      }
    }

    // Create scan service
    const barcodeLogger = rootLogger.child({ module: 'barcode' });
    const barcodeScanService = new BarcodeScanService({
      gatekeeper,
      deviceConfig: scannerDeviceConfig,
      broadcastEvent: (topic, payload) => broadcastEvent({ topic, ...payload }) || 0,
      pipelineConfig: {
        default_action: barcodeConfig.default_action || 'queue',
        actions: barcodeConfig.actions || ['queue', 'play', 'open'],
      },
      commandResolver: resolveCommand,
      waitForAck: (predicate, timeoutMs) => eventBus.waitForMessage(predicate, timeoutMs),
      onContentApproved: async (targetScreen) => {
        const scripts = screenDisplayScripts[targetScreen];
        if (!scripts || !haGateway) return;
        for (const scriptId of scripts) {
          try {
            await haGateway.callService('script', 'turn_on', { entity_id: scriptId });
            barcodeLogger.info?.('barcode.display.on', { targetScreen, scriptId });
          } catch (err) {
            barcodeLogger.warn?.('barcode.display.onFailed', { targetScreen, scriptId, error: err.message });
          }
        }
      },
      logger: barcodeLogger,
    });

    barcodeScanServiceRef = barcodeScanService;

    // Wire adapter callback
    hardwareAdapters.barcodeAdapter.setScanCallback((payload) => {
      barcodeScanService.handle(payload);
    });

    if (hardwareAdapters.barcodeAdapter.init()) {
      rootLogger.info('barcode.mqtt.initialized', {
        topic: hardwareAdapters.barcodeAdapter.getStatus().topic,
        scanners: Object.keys(scannerDeviceConfig),
      });
    }
  }

  rootLogger.info('hardware.initialized', {
    printers: printerRegistry.list(),
    tts: hardwareAdapters.ttsAdapter?.isConfigured() || false,
    mqtt: hardwareAdapters.mqttAdapter?.isConfigured() || false,
    barcode: hardwareAdapters.barcodeAdapter?.isConfigured() || false
  });

  // Gratitude domain router - gratitude card canvas renderer
  let createGratitudeCardCanvas = null;
  try {
    const { createGratitudeCardRenderer } = await import('#rendering/gratitude/GratitudeCardRenderer.mjs');
    const householdId = configService.getDefaultHouseholdId();
    const renderer = createGratitudeCardRenderer({
      getSelectionsForPrint: async () => {
        return gratitudeServices.gratitudeService.getSelectionsForPrint(
          householdId,
          (userId) => userService.resolveGroupLabel(userId)
        );
      },
      fontDir: configService.getPath('font') || `${mediaBasePath}/fonts`
    });
    createGratitudeCardCanvas = renderer.createCanvas;
  } catch (e) {
    rootLogger.warn?.('gratitude.canvas.import_failed', { error: e.message });
  }

  v1Routers.gratitude = createGratitudeApiRouter({
    gratitudeServices,
    configService,
    broadcastToWebsockets: broadcastEvent,
    createGratitudeCardCanvas,
    printerRegistry: hardwareAdapters.printerRegistry,
    logger: rootLogger.child({ module: 'gratitude-api' })
  });

  // Printer router — thermal printer control, multi-printer via :location? URL segment
  v1Routers.printer = createPrinterRouter({
    printerRegistry: hardwareAdapters.printerRegistry,
    logger: rootLogger.child({ module: 'printer-api' })
  });

  // QR Code renderer and router
  const { createQRCodeRenderer } = await import('#rendering/qrcode/QRCodeRenderer.mjs');
  const { createQRCodeRouter } = await import('./4_api/v1/routers/qrcode.mjs');
  const qrcodeRenderer = createQRCodeRenderer({ mediaPath: mediaBasePath });
  // Resolve default barcode target screen from devices config
  const _qrDevices = (configService.getHouseholdDevices(householdId)?.devices) || {};
  const _qrDefaultScreen = Object.values(_qrDevices)
    .find(d => d.type === 'barcode-scanner')?.target_screen || null;

  v1Routers.qrcode = createQRCodeRouter({
    renderer: qrcodeRenderer,
    contentIdResolver: contentServices.contentIdResolver,
    mediaPath: mediaBasePath,
    defaultLogoPath: `${mediaBasePath}/img/buttons/play.svg`,
    defaultScreen: _qrDefaultScreen,
    logger: rootLogger.child({ module: 'qrcode' }),
  });

  // Catalog PDF router
  const { createCatalogRouter } = await import('./4_api/v1/routers/catalog.mjs');
  v1Routers.catalog = createCatalogRouter({
    port: Number(process.env.PORT || 3111),
    logger: rootLogger.child({ module: 'catalog' }),
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

  // Fitness receipt renderer (canvas-based PNG generation)
  let createFitnessReceiptCanvas = null;
  try {
    const { createFitnessReceiptRenderer } = await import('#rendering/fitness/FitnessReceiptRenderer.mjs');
    const renderer = createFitnessReceiptRenderer({
      getSessionData: async (sessionId) => {
        const session = await fitnessServices.sessionService.getSession(sessionId, householdId, { decodeTimeline: false });
        return session ? session.toJSON() : null;
      },
      resolveDisplayName: (slug) => userService.resolveDisplayName(slug),
      fontDir: configService.getPath('font') || `${mediaBasePath}/fonts`
    });
    createFitnessReceiptCanvas = renderer.createCanvas;
  } catch (e) {
    rootLogger.warn?.('fitness.receipt.import_failed', { error: e.message });
  }

  // Create shared FitnessPlayableService (used by both fitness router and agents router)
  const fitnessConfigService = new FitnessConfigService({
    userDataService,
    configService,
    logger: rootLogger.child({ module: 'fitness-config' })
  });
  const fitnessContentAdapter = contentRegistry?.get(loadFitnessConfig(householdId)?.content_source || 'plex');
  const fitnessPlayableService = new FitnessPlayableService({
    fitnessConfigService,
    contentAdapter: fitnessContentAdapter,
    contentQueryService: contentServices.contentQueryService,
    createProgressClassifier: (cfg) => new FitnessProgressClassifier(cfg),
    logger: rootLogger.child({ module: 'fitness-playable' })
  });

  // Strava webhook enrichment (provider-agnostic webhook, Strava adapter)
  let providerWebhookAdapters = {};
  let stravaEnrichmentService = null;
  try {
    const stravaClientId = configService.getSystemAuth?.('strava', 'client_id');
    if (!stravaClientId) {
      rootLogger.info?.('strava.enrichment.skipped', { reason: 'no strava client_id in system auth' });
    } else {
      const { StravaClientAdapter } = await import('./1_adapters/fitness/StravaClientAdapter.mjs');
      const { StravaWebhookAdapter } = await import('./1_adapters/strava/StravaWebhookAdapter.mjs');
      const { StravaWebhookJobStore } = await import('./1_adapters/strava/StravaWebhookJobStore.mjs');
      const { FitnessActivityEnrichmentService } = await import('./3_applications/fitness/FitnessActivityEnrichmentService.mjs');
      const { StravaReconciliationService } = await import('./3_applications/fitness/StravaReconciliationService.mjs');

      const stravaClient = new StravaClientAdapter({
        httpClient: axios,
        configService,
        logger: rootLogger.child({ module: 'strava-client' }),
      });

      const stravaVerifyToken = configService.getSystemAuth?.('strava', 'verify_token') || '';
      const stravaWebhookAdapter = new StravaWebhookAdapter({
        verifyToken: stravaVerifyToken,
        logger: rootLogger.child({ module: 'strava-webhook' }),
      });

      const jobStore = new StravaWebhookJobStore({
        basePath: configService.getHouseholdPath('common/strava/strava-webhooks'),
        logger: rootLogger.child({ module: 'strava-jobs' }),
      });

      const stravaReconciliationService = new StravaReconciliationService({
        stravaClient,
        configService,
        fitnessHistoryDir: configService.getHouseholdPath('history/fitness'),
        logger: rootLogger.child({ module: 'strava-reconciliation' }),
      });

      stravaEnrichmentService = new FitnessActivityEnrichmentService({
        stravaClient,
        jobStore,
        authStore: {
          loadUserAuth: (provider, username) => configService.getUserAuth?.(provider, username),
        },
        configService,
        fitnessHistoryDir: configService.getHouseholdPath('history/fitness'),
        reconciliationService: stravaReconciliationService,
        logger: rootLogger.child({ module: 'strava-enrichment' }),
      });

      providerWebhookAdapters = { strava: stravaWebhookAdapter };

      // Recover pending jobs on startup
      stravaEnrichmentService.recoverPendingJobs();

      rootLogger.info?.('strava.enrichment.initialized', {
        adapters: Object.keys(providerWebhookAdapters),
      });
    }
  } catch (err) {
    rootLogger.error?.('strava.enrichment.init_failed', { error: err?.message, stack: err?.stack });
  }

  // Health check: warn if Strava creds are configured but no adapters registered
  if (configService.getSystemAuth?.('strava', 'client_id') && Object.keys(providerWebhookAdapters).length === 0) {
    rootLogger.error?.('strava.enrichment.health_check_failed', {
      reason: 'Strava credentials configured but no webhook adapters registered — enrichment is dead',
    });
  }

  // Fitness domain router
  // Note: contentRegistry passed for /show endpoint - playlist thumbnail enrichment is household-specific
  v1Routers.fitness = createFitnessApiRouter({
    fitnessServices,
    userService,
    userDataService,
    configService,
    fitnessConfig: loadFitnessConfig(householdId),
    contentRegistry,
    contentQueryService: contentServices.contentQueryService,
    createReceiptCanvas: createFitnessReceiptCanvas,
    printerRegistry: hardwareAdapters.printerRegistry,
    providerWebhookAdapters,
    enrichmentService: stravaEnrichmentService,
    logger: rootLogger.child({ module: 'fitness-api' })
  });

  // Home automation domain
  const kioskConfig = configService.getAppConfig('kiosk') || {};
  const taskerConfig = configService.getAppConfig('tasker') || {};
  const remoteExecConfig = configService.getAppConfig('remote_exec') || {};
  const homeAutomationAdapters = createHomeAutomationAdapters({
    // Config-driven HA adapter (use .has() to avoid NoOp)
    haGateway: householdAdapters?.has?.('home_automation') ? householdAdapters.get('home_automation') : null,
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
  const { loadYaml: haLoadYaml, saveYaml: haSaveYaml } = await import('./0_system/utils/FileIO.mjs');
  // Reuse householdDir from earlier (line 157)
  const loadFile = (relativePath) => haLoadYaml(path.join(householdDir, relativePath));
  const saveFile = (relativePath, data) => haSaveYaml(path.join(householdDir, relativePath), data);

  const { EventAggregationService } = await import('./3_applications/home/EventAggregationService.mjs');
  const eventAggregationService = new EventAggregationService({
    dataService,
    configService,
    logger: rootLogger.child({ module: 'event-aggregation' }),
  });

  v1Routers.home = createHomeAutomationApiRouter({
    adapters: homeAutomationAdapters,
    loadFile,
    saveFile,
    householdId,
    entropyService: entropyServices.entropyService,
    configService,
    eventAggregationService,
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
    wsBus: eventBus,
    remoteExec: homeAutomationAdapters.remoteExecAdapter,
    daylightHost,
    configService,
    logger: rootLogger.child({ module: 'devices' })
  });

  // Transcode pre-warming for device loads
  const { prewarmService } = createTranscodePrewarmService({
    contentIdResolver: contentServices.contentIdResolver,
    mediaProgressMemory: mediaProgressMemory,
    appBaseUrl: `http://localhost:${appPort}`,
    logger: rootLogger.child({ module: 'prewarm' })
  });

  const { wakeAndLoadService } = createWakeAndLoadService({
    deviceService: deviceServices.deviceService,
    haGateway: homeAutomationAdapters.haGateway,
    devicesConfig: devicesConfig.devices || {},
    broadcast: broadcastEvent,
    eventBus,
    prewarmService,
    logger: rootLogger.child({ module: 'wake-and-load' })
  });

  // Wire barcode → load fallback (TV off case)
  if (barcodeScanServiceRef) {
    // Build screen → deviceId map from devices config
    const screenToDevice = {};
    for (const [id, device] of Object.entries((devicesConfig.devices || {}))) {
      const screenPath = device.screen_path; // e.g. "/screen/living-room"
      if (screenPath) {
        const screenName = screenPath.replace(/^\/screen\//, '');
        screenToDevice[screenName] = id;
      }
    }
    barcodeScanServiceRef.setLoadFallback(async (targetScreen, query) => {
      const deviceId = screenToDevice[targetScreen];
      if (!deviceId) return;
      return wakeAndLoadService.execute(deviceId, query);
    });
  }

  // Shared dispatch-level idempotency cache for multi-step HTTP dispatches
  // (e.g. POST /api/v1/device/:id/load?mode=adopt).
  const { dispatchIdempotencyService } = createDispatchIdempotencyService({
    logger: rootLogger.child({ module: 'dispatch-idempotency' })
  });

  v1Routers.device = createDeviceApiRouter({
    deviceServices,
    wakeAndLoadService,
    dispatchIdempotencyService,
    configService,
    logger: rootLogger.child({ module: 'device-api' })
  });

  // Camera feeds
  const { createCameraServices } = await import('#apps/camera/index.mjs');
  const { cameraService } = createCameraServices({
    householdId,
    haGateway: homeAutomationAdapters.haGateway,
    logger: rootLogger.child({ module: 'camera' }),
  });

  v1Routers.camera = createCameraRouter({
    cameraService,
    broadcastEvent,
    logger: rootLogger.child({ module: 'camera-api' }),
  });

  const { createPrewarmRouter } = await import('./4_api/v1/routers/prewarm.mjs');
  v1Routers.prewarm = createPrewarmRouter({
    prewarmService,
    logger: rootLogger.child({ module: 'prewarm-api' })
  });

  // Messaging domain (provides telegramAdapter for chatbots)
  // System bot config (bot_id, secretToken per platform) from system/bots.yml
  const systemBots = configService.getSystemConfig('bots') || {};
  const gmailConfig = configService.getAppConfig('gmail') || {};

  // TelegramIdentityAdapter — single place for Telegram conversationId construction
  const telegramBotConfigs = {};
  for (const [botName, botConfig] of Object.entries(systemBots)) {
    if (botConfig?.telegram?.bot_id) {
      telegramBotConfigs[botName] = { botId: botConfig.telegram.bot_id };
    }
  }
  const telegramIdentityAdapter = new TelegramIdentityAdapter({
    userIdentityService,
    botConfigs: telegramBotConfigs,
    logger: rootLogger.child({ module: 'telegram-identity' }),
  });

  // NutriBot application config
  const nutribotConfig = configService.getAppConfig('nutribot') || {};

  // Create shared voice transcription service (used by all bot TelegramAdapters)
  // Reuses sharedAiGateway (same OpenAI adapter) for Whisper API transcription
  let voiceTranscriptionService = null;
  if (sharedAiGateway) {
    const { TelegramVoiceTranscriptionService } = await import('#adapters/messaging/TelegramVoiceTranscriptionService.mjs');
    const voiceHttpClient = new HttpClient({ logger: rootLogger.child({ module: 'voice-http' }) });
    voiceTranscriptionService = new TelegramVoiceTranscriptionService(
      { openaiAdapter: sharedAiGateway },
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
  const nxConfig = nutribotConfig.integrations?.nutritionix;
  const upcGateway = new UPCGateway({
    httpClient: upcHttpClient,
    nutritionix: nxConfig?.app_id ? {
      appId: nxConfig.app_id,
      appKey: configService.getSystemAuth('food', 'nutritionix_api_key'),
    } : null,
    logger: rootLogger.child({ module: 'upc-gateway' }),
  });

  // Create conversation state store for nutribot (persists lastReportMessageId for cleanup)
  // Per-user storage: users/{username}/conversations/nutribot/
  const nutribotStateStore = new YamlConversationStateDatastore({
    userDataService,
    botName: 'nutribot',
    userResolver,
    logger: rootLogger.child({ module: 'nutribot-state' })
  });

  // Get nutribot adapter from config-driven SystemBotLoader
  const nutribotTelegramAdapter = getMessagingAdapter(householdId, 'nutribot');

  const nutribotServices = await createNutribotServices({
    configService,
    userDataService,
    telegramAdapter: nutribotTelegramAdapter,
    aiGateway: nutribotAiGateway,
    upcGateway,
    googleImageGateway: null,  // TODO: Add Google Image gateway when available
    conversationStateStore: nutribotStateStore,
    reportRenderer: nutribotReportRenderer,  // Canvas-based PNG report renderer
    nutribotConfig,
    reconciliationReader: healthServices.reconciliationReader,
    healthStore: healthServices.healthStore,
    catalogService: healthServices.catalogService,
    // Lazy proxy: agentOrchestrator is created later in createAgentsApiRouter
    agentOrchestrator: { runAssignment: (...args) => v1Routers.agents?.orchestrator?.runAssignment(...args) },
    logger: rootLogger.child({ module: 'nutribot' })
  });

  const nutribotApiResult = createNutribotApiRouter({
    nutribotServices,
    userResolver,
    userIdentityService,
    telegramIdentityAdapter,
    defaultMember: configService.getHeadOfHousehold(),
    botId: systemBots.nutribot?.telegram?.bot_id || '',
    secretToken: systemBots.nutribot?.telegram?.secret_token || '',
    gateway: nutribotTelegramAdapter,
    logger: rootLogger.child({ module: 'nutribot-api' })
  });
  v1Routers.nutribot = nutribotApiResult.router;
  // Wire real adapter into the proxy now that it's available
  webNutribotAdapterProxy._delegate = nutribotApiResult.webNutribotAdapter;

  // Journalist application
  const journalistConfig = configService.getAppConfig('journalist') || {};

  // Reuse shared AI adapter (loaded from integration system or created above)
  const journalistAiGateway = nutribotAiGateway;

  // Get journalist adapter from config-driven SystemBotLoader
  const journalistTelegramAdapter = getMessagingAdapter(householdId, 'journalist');

  // Create conversation state store for journalist
  // Per-user storage: users/{username}/conversations/journalist/
  const journalistStateStore = new YamlConversationStateDatastore({
    userDataService,
    botName: 'journalist',
    userResolver,
    logger: rootLogger.child({ module: 'journalist-state' })
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
    userIdentityService,
    telegramIdentityAdapter,
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
  // Per-user storage: users/{username}/conversations/homebot/
  const homebotStateStore = new YamlConversationStateDatastore({
    userDataService,
    botName: 'homebot',
    userResolver,
    logger: rootLogger.child({ module: 'homebot-state' })
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
    userIdentityService,
    telegramIdentityAdapter,
    botId: systemBots.homebot?.telegram?.bot_id || '',
    secretToken: systemBots.homebot?.telegram?.secret_token || '',
    gateway: homebotTelegramAdapter,
    logger: rootLogger.child({ module: 'homebot-api' })
  });

  // Agents application router
  v1Routers.agents = await createAgentsApiRouter({
    logger: rootLogger.child({ module: 'agents-api' }),
    healthStore: healthServices.healthStore,
    healthService: healthServices.healthService,
    fitnessPlayableService,
    sessionService: fitnessServices.sessionService,
    mediaProgressMemory,
    dataService,
    configService,
    aiGateway: sharedAiGateway,
    httpClient: axios,
    messagingGateway: nutribotTelegramAdapter,
    // Nutribot chat ID for agent→Telegram delivery
    // extractChatId splits on '_' and takes last segment, so just pass raw chatId
    // TODO: derive chatId from user identity mapping instead of hardcoding
    conversationId: '575596036',
    nutriListStore: healthServices.nutriListStore,
    lifeplanServices: {
      container: lifeplanResult.container,
      services: lifeplanResult.services,
      aggregator: lifelogServices.lifelogAggregator,
    },
  });

  // Register morning debrief as a scheduled task (via agents scheduler)
  const agentsScheduler = v1Routers.agents?.scheduler;
  if (agentsScheduler && journalistServices?.journalistContainer) {
    const debriefCron = journalistConfig.morning_debrief?.schedule || '0 7 * * *';
    const debriefUsername = configService.getHeadOfHousehold?.() || 'kckern';

    agentsScheduler.registerTask('journalist:morning-debrief', debriefCron, async () => {
      const container = journalistServices.journalistContainer;
      const generateMorningDebrief = container.getGenerateMorningDebrief();

      // Resolve conversation ID early so generation can use conversation context
      let conversationIdString;
      try {
        const identity = telegramIdentityAdapter.resolve('journalist', { username: debriefUsername });
        conversationIdString = identity.conversationIdString;
      } catch (err) {
        rootLogger.warn?.('journalist.scheduled_debrief.identity_failed', { error: err?.message });
      }

      const debrief = await generateMorningDebrief.execute({
        username: debriefUsername,
        conversationId: conversationIdString,
      });

      if (!debrief.success) {
        rootLogger.info?.('journalist.scheduled_debrief.skipped', {
          username: debriefUsername,
          reason: debrief.reason,
        });
        return;
      }

      // Send using already-resolved conversation ID
      try {
        const sendMorningDebrief = container.getSendMorningDebrief();
        await sendMorningDebrief.execute({
          conversationId: conversationIdString,
          debrief,
        });
        rootLogger.info?.('journalist.scheduled_debrief.sent', {
          username: debriefUsername,
          date: debrief.date,
        });
      } catch (err) {
        rootLogger.warn?.('journalist.scheduled_debrief.send_failed', {
          username: debriefUsername,
          error: err?.message,
        });
      }
    });
  }

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
  let mediaDownloadService = null;
  if (mediaBasePath) {
    const mediaPath = join(mediaBasePath, 'video', 'news');

    const videoSourceGateway = new YtDlpAdapter({
      logger: rootLogger.child({ module: 'ytdlp' })
    });

    mediaDownloadService = new MediaDownloadService({
      videoSourceGateway,
      mediaPath: mediaBasePath,
      logger: rootLogger.child({ module: 'media-download' })
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
    timezone: 'America/Los_Angeles'
  });

  const schedulerOrchestrator = new SchedulerOrchestrator({
    schedulerService,
    jobStore: schedulingJobStore,
    stateStore: schedulingStateStore,
    harvesterExecutor: harvesterServices.jobExecutor,
    mediaExecutor
  });

  const scheduler = new Scheduler({
    schedulerOrchestrator,
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
    schedulerOrchestrator,
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

  // Auth router
  v1Routers.auth = createAuthRouter({
    authService,
    jwtSecret,
    jwtConfig,
    configService,
    dataService,
    logger: rootLogger.child({ module: 'auth-api' })
  });

  // Admin router - combined content, images, and eventbus management
  v1Routers.admin = createAdminRouter({
    userDataService,
    configService,
    mediaPath: mediaBasePath || imgBasePath, // Use base media path for admin operations
    loadFile,
    mediaDownloadService,
    eventBus,
    logger: rootLogger.child({ module: 'admin-api' })
  });

  // Test infrastructure router (dev/test only)
  const { createTestRouter } = await import('./4_api/v1/routers/test.mjs');
  const {
    enablePlexShutoff,
    disablePlexShutoff,
    getPlexShutoffStatus
  } = await import('#adapters/proxy/PlexProxyAdapter.mjs');

  v1Routers.test = createTestRouter({
    plexShutoffControls: {
      enable: enablePlexShutoff,
      disable: disablePlexShutoff,
      getStatus: getPlexShutoffStatus
    },
    logger: rootLogger.child({ module: 'test-api' })
  });

  // Launch & Sync routers
  const { createLaunchRouter } = await import('./4_api/v1/routers/launch.mjs');
  const { createSyncRouter } = await import('./4_api/v1/routers/sync.mjs');
  const { LaunchService } = await import('#apps/content/services/LaunchService.mjs');
  const { SyncService } = await import('#apps/content/services/SyncService.mjs');
  const { AdbLauncher } = await import('#adapters/devices/AdbLauncher.mjs');

  const adbLauncher = new AdbLauncher({
    configService,
    logger: rootLogger.child({ module: 'adb-launcher' })
  });

  const launchService = new LaunchService({
    contentRegistry: contentRegistry,
    deviceLauncher: adbLauncher,
    configService,
    logger: rootLogger.child({ module: 'launch-service' })
  });

  v1Routers.launch = createLaunchRouter({
    launchService,
    logger: rootLogger.child({ module: 'launch-api' })
  });

  const syncService = new SyncService({
    logger: rootLogger.child({ module: 'sync-service' })
  });

  // Register RetroArch sync source if config exists
  const retroarchConfig = configService.getHouseholdAppConfig(null, 'games');
  const deviceConfigs = configService.getHouseholdDevices()?.devices || {};
  const fileServer = Object.values(deviceConfigs).find(d => d.file_server)?.file_server;
  const xploreBaseUrl = fileServer ? `http://${fileServer.host}:${fileServer.port}` : null;
  if (retroarchConfig?.consoles && xploreBaseUrl) {
    const { RetroArchSyncAdapter } = await import('#adapters/content/retroarch/RetroArchSyncAdapter.mjs');
    const retroarchSyncAdapter = new RetroArchSyncAdapter({
      xploreBaseUrl,
      sourceConfig: retroarchConfig.source || {},
      consoleConfig: retroarchConfig.consoles,
      thumbnailBasePath: configService.getHouseholdPath('shared/retroarch/thumbnails'),
      httpClient: axios,
      readCatalog: () => dataService.household.read('shared/retroarch/catalog'),
      writeCatalog: (data) => dataService.household.write('shared/retroarch/catalog', data),
      downloadThumbnail: async () => {},
      logger: rootLogger.child({ module: 'retroarch-sync' })
    });
    syncService.registerSyncSource('retroarch', retroarchSyncAdapter);
  }

  v1Routers.sync = createSyncRouter({
    syncService,
    logger: rootLogger.child({ module: 'sync-api' })
  });

  // === Weekly Review ===
  if (immichConfig) {
    const { ImmichClient } = await import('#adapters/content/gallery/immich/ImmichClient.mjs');
    const wrImmichClient = new ImmichClient(immichConfig, { httpClient: axios });
    const weeklyReviewImmichAdapter = new WeeklyReviewImmichAdapter(
      { priorityPeople: [], proxyPath: '/api/v1/proxy/immich' },
      { client: wrImmichClient, logger: rootLogger.child({ module: 'weekly-review-immich' }) }
    );

    const weeklyReviewCalendarAdapter = new WeeklyReviewCalendarAdapter(
      { householdId, defaultUser: configService.getHeadOfHousehold?.() || 'kckern' },
      { userDataService, logger: rootLogger.child({ module: 'weekly-review-calendar' }) }
    );

    // Weather history store for weekly review (reads daily snapshots)
    const { YamlWeatherDatastore } = await import('#adapters/persistence/yaml/YamlWeatherDatastore.mjs');
    const wrWeatherStore = new YamlWeatherDatastore({
      dataService,
      configService,
      logger: rootLogger.child({ module: 'weekly-review-weather' }),
    });

    const weeklyReviewService = new WeeklyReviewService(
      { dataPath: dataBasePath, mediaPath: mediaBasePath, householdId },
      {
        immichAdapter: weeklyReviewImmichAdapter,
        calendarData: weeklyReviewCalendarAdapter,
        sessionService: fitnessServices?.sessionService || null,
        weatherStore: wrWeatherStore,
        transcriptionService: sharedAiGateway ? {
          transcribe: async (buffer, opts) => {
            const raw = await sharedAiGateway.transcribe(buffer, {
              filename: 'weekly-review.webm',
              contentType: opts.mimeType,
              prompt: opts.prompt,
            });
            const clean = await sharedAiGateway.chat(
              [
                { role: 'system', content: 'Clean up this family conversation transcript. Fix spelling, grammar, and punctuation. Preserve the natural conversational tone. Do not add or remove content.' },
                { role: 'user', content: raw },
              ],
              { temperature: 0.2, maxTokens: 4000 }
            );
            return { transcriptRaw: raw, transcriptClean: clean };
          },
        } : null,
        logger: rootLogger.child({ module: 'weekly-review' }),
      }
    );

    v1Routers['weekly-review'] = createWeeklyReviewRouter({
      weeklyReviewService,
      logger: rootLogger.child({ module: 'weekly-review-api' }),
    });
  }

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
  app.use('/api/v1/fitness/provider/webhook', devProxy.middleware);

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
      // Serve static assets (JS, CSS, images) — hashed filenames are immutable
      app.use(express.static(frontendPath, {
        setHeaders: (res, filePath) => {
          // index.html must never be cached so location.reload() always gets fresh script tags
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        }
      }));

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
        // SPA route - serve index.html with no-cache so deploys take effect on reload
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
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

  // Graceful shutdown: flush pending progress sync writes
  if (progressSyncService) {
    process.on('SIGTERM', async () => {
      await progressSyncService.flush();
      progressSyncService.dispose();
    });
  }

  return app;
}
