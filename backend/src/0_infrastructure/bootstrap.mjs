// backend/src/0_infrastructure/bootstrap.mjs

// EventBus imports
import { WebSocketEventBus } from './eventbus/WebSocketEventBus.mjs';

// Content domain imports
import { ContentSourceRegistry } from '../1_domains/content/services/ContentSourceRegistry.mjs';
import { FilesystemAdapter } from '../2_adapters/content/media/filesystem/FilesystemAdapter.mjs';
import { PlexAdapter } from '../2_adapters/content/media/plex/PlexAdapter.mjs';
import { LocalContentAdapter } from '../2_adapters/content/local-content/LocalContentAdapter.mjs';
import { FolderAdapter } from '../2_adapters/content/folder/FolderAdapter.mjs';
import { YamlWatchStateStore } from '../2_adapters/persistence/yaml/YamlWatchStateStore.mjs';
import { createContentRouter } from '../4_api/routers/content.mjs';
import { createProxyRouter } from '../4_api/routers/proxy.mjs';
import { createLocalContentRouter } from '../4_api/routers/localContent.mjs';
import { createPlayRouter } from '../4_api/routers/play.mjs';
import { createListRouter } from '../4_api/routers/list.mjs';

// Fitness domain imports
import { SessionService } from '../1_domains/fitness/services/SessionService.mjs';
import { YamlSessionStore } from '../2_adapters/persistence/yaml/YamlSessionStore.mjs';
import { AmbientLedAdapter } from '../2_adapters/fitness/AmbientLedAdapter.mjs';
import { VoiceMemoTranscriptionService } from '../2_adapters/fitness/VoiceMemoTranscriptionService.mjs';
import { OpenAIAdapter } from '../2_adapters/ai/OpenAIAdapter.mjs';
import { FitnessSyncerAdapter } from '../2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs';
import { createFitnessRouter } from '../4_api/routers/fitness.mjs';

// Home automation imports
import { HomeAssistantAdapter } from '../2_adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs';
import { TVControlAdapter } from '../2_adapters/home-automation/tv/TVControlAdapter.mjs';
import { KioskAdapter } from '../2_adapters/home-automation/kiosk/KioskAdapter.mjs';
import { TaskerAdapter } from '../2_adapters/home-automation/tasker/TaskerAdapter.mjs';
import { RemoteExecAdapter } from '../2_adapters/home-automation/remote-exec/RemoteExecAdapter.mjs';
import { createHomeAutomationRouter } from '../4_api/routers/homeAutomation.mjs';

// Hardware adapter imports
import { ThermalPrinterAdapter } from '../2_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs';
import { TTSAdapter } from '../2_adapters/hardware/tts/TTSAdapter.mjs';
import { MQTTSensorAdapter } from '../2_adapters/hardware/mqtt-sensor/MQTTSensorAdapter.mjs';
import { createPrinterRouter } from '../4_api/routers/printer.mjs';
import { createTTSRouter } from '../4_api/routers/tts.mjs';

// Proxy infrastructure imports
import { ProxyService } from './proxy/ProxyService.mjs';
import { PlexProxyAdapter } from '../2_adapters/proxy/PlexProxyAdapter.mjs';
import { ImmichProxyAdapter } from '../2_adapters/proxy/ImmichProxyAdapter.mjs';
import { AudiobookshelfProxyAdapter } from '../2_adapters/proxy/AudiobookshelfProxyAdapter.mjs';
import { FreshRSSProxyAdapter } from '../2_adapters/proxy/FreshRSSProxyAdapter.mjs';
import { createExternalProxyRouter } from '../4_api/routers/externalProxy.mjs';

// Finance domain imports
import { YamlFinanceStore } from '../2_adapters/persistence/yaml/YamlFinanceStore.mjs';
import { BuxferAdapter } from '../2_adapters/finance/BuxferAdapter.mjs';
import { BudgetCompilationService } from '../3_applications/finance/BudgetCompilationService.mjs';
import { FinanceHarvestService } from '../3_applications/finance/FinanceHarvestService.mjs';
import { TransactionCategorizationService } from '../3_applications/finance/TransactionCategorizationService.mjs';
import { PayrollSyncService } from '../3_applications/finance/PayrollSyncService.mjs';
import { createFinanceRouter } from '../4_api/routers/finance.mjs';

// Gratitude domain imports
import { GratitudeService } from '../1_domains/gratitude/services/GratitudeService.mjs';
import { YamlGratitudeStore } from '../2_adapters/persistence/yaml/YamlGratitudeStore.mjs';
import { createGratitudeRouter } from '../4_api/routers/gratitude.mjs';

// Messaging domain imports
import { ConversationService } from '../1_domains/messaging/services/ConversationService.mjs';
import { NotificationService } from '../1_domains/messaging/services/NotificationService.mjs';
import { YamlConversationStore } from '../2_adapters/persistence/yaml/YamlConversationStore.mjs';
import { TelegramAdapter } from '../2_adapters/messaging/TelegramAdapter.mjs';
import { GmailAdapter } from '../2_adapters/messaging/GmailAdapter.mjs';
import { createMessagingRouter } from '../4_api/routers/messaging.mjs';

// Journalist application imports
import { JournalistContainer } from '../3_applications/journalist/JournalistContainer.mjs';
import { JournalistInputRouter } from '../2_adapters/journalist/JournalistInputRouter.mjs';
import { YamlJournalEntryRepository } from '../2_adapters/persistence/yaml/YamlJournalEntryRepository.mjs';
import { YamlMessageQueueRepository } from '../2_adapters/persistence/yaml/YamlMessageQueueRepository.mjs';
import { createJournalistRouter } from '../4_api/routers/journalist.mjs';

// Nutribot application imports
import { NutribotContainer } from '../3_applications/nutribot/NutribotContainer.mjs';
import { NutriBotConfig } from '../3_applications/nutribot/config/NutriBotConfig.mjs';
import { YamlFoodLogStore } from '../2_adapters/persistence/yaml/YamlFoodLogStore.mjs';
import { YamlNutriListStore } from '../2_adapters/persistence/yaml/YamlNutriListStore.mjs';
import { YamlNutriCoachStore } from '../2_adapters/persistence/yaml/YamlNutriCoachStore.mjs';
import { createNutribotRouter } from '../4_api/routers/nutribot.mjs';

// Nutribot DDD adapters
import { YamlNutriLogStore } from '../2_adapters/persistence/yaml/YamlNutriLogStore.mjs';
import { TelegramMessagingAdapter } from '../2_adapters/telegram/TelegramMessagingAdapter.mjs';
import { TelegramWebhookParser } from '../2_adapters/telegram/TelegramWebhookParser.mjs';
import { OpenAIFoodParserAdapter } from '../2_adapters/ai/OpenAIFoodParserAdapter.mjs';
import { NutritionixAdapter } from '../2_adapters/nutrition/NutritionixAdapter.mjs';

// Homebot application imports
import { HomeBotContainer } from '../3_applications/homebot/HomeBotContainer.mjs';
import { HomeBotInputRouter, ConfigHouseholdAdapter } from '../2_adapters/homebot/index.mjs';
import { createHomebotRouter } from '../4_api/routers/homebot.mjs';

// Health domain imports
import { HealthAggregationService } from '../1_domains/health/services/HealthAggregationService.mjs';
import { YamlHealthStore } from '../2_adapters/persistence/yaml/YamlHealthStore.mjs';
import { createHealthRouter } from '../4_api/routers/health.mjs';

// Entropy domain imports
import { EntropyService } from '../1_domains/entropy/services/EntropyService.mjs';
import { YamlEntropyReader } from '../2_adapters/entropy/YamlEntropyReader.mjs';
import { createEntropyRouter } from '../4_api/routers/entropy.mjs';

// Lifelog domain imports
import { LifelogAggregator } from '../1_domains/lifelog/services/LifelogAggregator.mjs';
import { createLifelogRouter } from '../4_api/routers/lifelog.mjs';

// Static assets router
import { createStaticRouter } from '../4_api/routers/static.mjs';

// Calendar router
import { createCalendarRouter } from '../4_api/routers/calendar.mjs';

// Harvester application imports
import { HarvesterService, HarvesterJobExecutor } from '../3_applications/harvester/index.mjs';

// Harvester adapter imports
import {
  YamlLifelogStore,
  TodoistHarvester,
  ClickUpHarvester,
  GitHubHarvester,
  LastfmHarvester,
  RedditHarvester,
  LetterboxdHarvester,
  GoodreadsHarvester,
  FoursquareHarvester,
  GmailHarvester,
  GCalHarvester,
  ShoppingHarvester,
  BuxferHarvester,
  WeatherHarvester,
  StravaHarvester,
  WithingsHarvester
} from '../2_adapters/harvester/index.mjs';

// RSS Parser for Goodreads/Letterboxd harvesters
import RSSParser from 'rss-parser';

// Additional adapters for harvesters
import { StravaClientAdapter } from '../2_adapters/fitness/StravaClientAdapter.mjs';
import { YamlWeatherStore } from '../2_adapters/persistence/yaml/YamlWeatherStore.mjs';
import { google } from 'googleapis';

/**
 * Create and configure the content registry
 * @param {Object} config
 * @param {string} [config.mediaBasePath] - Base path for media files
 * @param {Object} [config.plex] - Plex configuration
 * @param {string} [config.plex.host] - Plex server URL
 * @param {string} [config.plex.token] - Plex auth token
 * @param {string} [config.dataPath] - Path to data files (for LocalContentAdapter)
 * @param {string} [config.watchlistPath] - Path to watchlist YAML (for FolderAdapter)
 * @returns {ContentSourceRegistry}
 */
export function createContentRegistry(config) {
  const registry = new ContentSourceRegistry();

  // Register filesystem adapter
  if (config.mediaBasePath) {
    registry.register(new FilesystemAdapter({
      mediaBasePath: config.mediaBasePath,
      historyPath: config.mediaMemoryPath ? `${config.mediaMemoryPath}/media` : null
    }));
  }

  // Register Plex adapter if configured
  if (config.plex?.host) {
    registry.register(new PlexAdapter({
      host: config.plex.host,
      token: config.plex.token,
      historyPath: config.mediaMemoryPath ? `${config.mediaMemoryPath}/plex` : null
    }));
  }

  // Register local content adapter (optional)
  if (config.dataPath && config.mediaBasePath) {
    registry.register(new LocalContentAdapter({
      dataPath: config.dataPath,
      mediaPath: config.mediaBasePath,
      historyPath: config.mediaMemoryPath || null,
      householdId: config.householdId || null,
      householdsBasePath: config.householdsBasePath || null
    }));
  }

  // Register folder adapter (optional, requires registry reference)
  if (config.watchlistPath) {
    const folderAdapter = new FolderAdapter({
      watchlistPath: config.watchlistPath,
      historyPath: config.mediaMemoryPath || null,
      registry,
      nomusicLabels: config.nomusicLabels || [],
      musicOverlayPlaylist: config.musicOverlayPlaylist || null
    });
    registry.register(folderAdapter);

    // Also register as 'local' for legacy frontend compatibility
    // Legacy endpoints use /data/list/{key} which maps to /list/local/{key}
    registry.adapters.set('local', folderAdapter);
  }

  return registry;
}

/**
 * Create watch state store
 * @param {Object} config
 * @param {string} config.watchStatePath - Path for watch state files
 * @returns {YamlWatchStateStore}
 */
export function createWatchStore(config) {
  return new YamlWatchStateStore({
    basePath: config.watchStatePath
  });
}

/**
 * Create API routers for the content domain
 * @param {Object} config
 * @param {ContentSourceRegistry} config.registry - Content source registry
 * @param {YamlWatchStateStore} config.watchStore - Watch state store
 * @param {Function} [config.loadFile] - Function to load YAML files
 * @param {Function} [config.saveFile] - Function to save YAML files
 * @param {string} [config.cacheBasePath] - Base path for image cache
 * @param {string} [config.dataPath] - Base data path for local content
 * @param {import('./proxy/ProxyService.mjs').ProxyService} [config.proxyService] - Proxy service for external services
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Router configuration
 */
export function createApiRouters(config) {
  const { registry, watchStore, loadFile, saveFile, cacheBasePath, dataPath, mediaBasePath, proxyService, configService, logger = console } = config;

  return {
    content: createContentRouter(registry, watchStore, { loadFile, saveFile, cacheBasePath, logger }),
    proxy: createProxyRouter({ registry, proxyService, mediaBasePath, logger }),
    localContent: createLocalContentRouter({ registry, dataPath, mediaBasePath }),
    play: createPlayRouter({ registry, watchStore, logger }),
    list: createListRouter({ registry, loadFile, configService }),
  };
}

// =============================================================================
// Fitness Domain Bootstrap
// =============================================================================

/**
 * Create fitness domain services
 * @param {Object} config
 * @param {string} config.dataRoot - Base data directory
 * @param {string} config.mediaRoot - Base media directory
 * @param {string} config.defaultHouseholdId - Default household ID
 * @param {Object} config.homeAssistant - Home Assistant configuration
 * @param {string} config.homeAssistant.baseUrl - HA base URL
 * @param {string} config.homeAssistant.token - HA long-lived token
 * @param {Function} config.loadFitnessConfig - Function to load fitness config for household
 * @param {string} [config.openaiApiKey] - OpenAI API key for voice memo transcription
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Fitness services
 */
export function createFitnessServices(config) {
  const {
    dataRoot,
    mediaRoot,
    defaultHouseholdId,
    homeAssistant,
    loadFitnessConfig,
    openaiApiKey,
    logger = console
  } = config;

  // Session store and service
  const sessionStore = new YamlSessionStore({
    dataRoot,
    mediaRoot
  });

  const sessionService = new SessionService({
    sessionStore,
    defaultHouseholdId
  });

  // Home automation gateway (optional - requires baseUrl and token)
  let haGateway = null;
  let ambientLedController = null;

  if (homeAssistant?.baseUrl && homeAssistant?.token) {
    haGateway = new HomeAssistantAdapter(
      {
        baseUrl: homeAssistant.baseUrl,
        token: homeAssistant.token
      },
      { logger }
    );

    // Ambient LED controller (uses home automation gateway)
    ambientLedController = new AmbientLedAdapter({
      gateway: haGateway,
      loadFitnessConfig,
      logger
    });
  } else {
    logger.warn?.('fitness.homeassistant.disabled', {
      reason: 'Missing baseUrl or token configuration'
    });
  }

  // Voice memo transcription (optional - requires OpenAI API key)
  let transcriptionService = null;
  if (openaiApiKey) {
    const openaiAdapter = new OpenAIAdapter(
      { apiKey: openaiApiKey },
      { logger }
    );
    transcriptionService = new VoiceMemoTranscriptionService({
      openaiAdapter,
      logger
    });
  }

  return {
    sessionStore,
    sessionService,
    ambientLedController,
    transcriptionService,
    haGateway // Expose for other uses
  };
}

/**
 * Create fitness API router
 * @param {Object} config
 * @param {Object} config.fitnessServices - Services from createFitnessServices
 * @param {Object} config.userService - UserService for config hydration
 * @param {Object} config.userDataService - UserDataService for household data
 * @param {Object} config.configService - ConfigService
 * @param {Object} [config.contentRegistry] - Content source registry (for show endpoint)
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createFitnessApiRouter(config) {
  const {
    fitnessServices,
    userService,
    userDataService,
    configService,
    contentRegistry,
    logger = console
  } = config;

  return createFitnessRouter({
    sessionService: fitnessServices.sessionService,
    zoneLedController: fitnessServices.ambientLedController,
    transcriptionService: fitnessServices.transcriptionService,
    userService,
    userDataService,
    configService,
    contentRegistry,
    logger
  });
}

/**
 * Create FitnessSyncer adapter for OAuth token management and activity harvesting
 *
 * The adapter expects an authStore with get/set methods for a single service.
 * Create a scoped auth store wrapper if using the multi-service YamlAuthStore.
 *
 * @param {Object} config
 * @param {Object} config.httpClient - HTTP client with get/post methods (e.g., axios)
 * @param {Object} config.authStore - Auth store with get(service)/set(service, data) interface
 * @param {string} [config.clientId] - OAuth client ID (can also be in authStore)
 * @param {string} [config.clientSecret] - OAuth client secret (can also be in authStore)
 * @param {number} [config.cooldownMinutes=5] - Base cooldown in minutes for circuit breaker
 * @param {Object} [config.logger] - Logger instance
 * @returns {FitnessSyncerAdapter}
 */
export function createFitnessSyncerAdapter(config) {
  const {
    httpClient,
    authStore,
    clientId,
    clientSecret,
    cooldownMinutes = 5,
    logger = console
  } = config;

  return new FitnessSyncerAdapter({
    httpClient,
    authStore,
    logger,
    clientId,
    clientSecret,
    cooldownMinutes
  });
}

// =============================================================================
// EventBus Bootstrap
// =============================================================================

/**
 * Singleton EventBus instance
 * @type {WebSocketEventBus|null}
 */
let eventBusInstance = null;

/**
 * Create and start the EventBus
 * @param {Object} config
 * @param {Object} config.httpServer - HTTP server to attach WebSocket to
 * @param {string} [config.path='/ws'] - WebSocket path
 * @param {Object} [config.logger] - Logger instance
 * @returns {Promise<WebSocketEventBus>}
 */
export async function createEventBus(config) {
  const { httpServer, path = '/ws', logger = console } = config;

  if (eventBusInstance) {
    logger.warn?.('eventbus.already_created', { message: 'EventBus already exists, returning existing instance' });
    return eventBusInstance;
  }

  eventBusInstance = new WebSocketEventBus({ path, logger });
  await eventBusInstance.start(httpServer);

  return eventBusInstance;
}

/**
 * Get the EventBus singleton instance
 * @returns {WebSocketEventBus|null}
 */
export function getEventBus() {
  return eventBusInstance;
}

/**
 * Broadcast a message via the EventBus
 * Convenience function for backward compatibility with broadcastToWebsockets
 * @param {Object} payload - Message payload (must include topic)
 */
export function broadcastEvent(payload) {
  if (!eventBusInstance) {
    console.warn('[EventBus] Not initialized, cannot broadcast');
    return;
  }

  const topic = payload.topic || 'legacy';
  eventBusInstance.broadcast(topic, payload);
}

/**
 * Restart the EventBus
 * @returns {Promise<void>}
 */
export async function restartEventBus() {
  if (!eventBusInstance) {
    console.warn('[EventBus] Not initialized, cannot restart');
    return;
  }

  await eventBusInstance.restart();
}

// =============================================================================
// Finance Domain Bootstrap
// =============================================================================

/**
 * Create finance domain services
 * @param {Object} config
 * @param {string} config.dataRoot - Base data directory
 * @param {string} [config.defaultHouseholdId='default'] - Default household ID
 * @param {Object} [config.buxfer] - Buxfer configuration
 * @param {string} [config.buxfer.email] - Buxfer email
 * @param {string} [config.buxfer.password] - Buxfer password
 * @param {Object} [config.aiGateway] - AI gateway for transaction categorization
 * @param {Object} [config.httpClient] - HTTP client for payroll sync
 * @param {Object} [config.configService] - ConfigService for payroll credentials
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Finance services
 */
export function createFinanceServices(config) {
  const {
    dataRoot,
    defaultHouseholdId = 'default',
    buxfer,
    aiGateway,
    httpClient,
    configService,
    logger = console
  } = config;

  // Finance store (YAML persistence)
  const financeStore = new YamlFinanceStore({
    dataRoot,
    defaultHouseholdId
  });

  // Buxfer adapter (optional - requires credentials and httpClient)
  let buxferAdapter = null;
  if (buxfer?.email && buxfer?.password && httpClient) {
    buxferAdapter = new BuxferAdapter({
      httpClient,
      getCredentials: () => ({ email: buxfer.email, password: buxfer.password }),
      logger
    });
  }

  // Budget compilation service
  const compilationService = new BudgetCompilationService({
    financeStore,
    logger
  });

  // Transaction categorization service (optional - requires AI gateway)
  let categorizationService = null;
  if (aiGateway) {
    const categorizationConfig = financeStore.getCategorizationConfig(defaultHouseholdId);
    if (categorizationConfig) {
      categorizationService = new TransactionCategorizationService({
        aiGateway,
        validTags: categorizationConfig.validTags || [],
        systemPrompt: categorizationConfig.chat?.[0]?.content || '',
        logger
      });
    }
  }

  // Finance harvest service (optional - requires Buxfer adapter)
  let harvestService = null;
  if (buxferAdapter) {
    harvestService = new FinanceHarvestService({
      transactionSource: buxferAdapter,
      financeStore,
      compilationService,
      categorizationService,
      logger
    });
  }

  // Payroll sync service (optional - requires httpClient and configService)
  let payrollService = null;
  if (httpClient && configService) {
    payrollService = new PayrollSyncService({
      httpClient,
      buxferAdapter,
      financeStore,
      configService,
      logger
    });
  }

  return {
    financeStore,
    buxferAdapter,
    compilationService,
    categorizationService,
    harvestService,
    payrollService
  };
}

/**
 * Create finance API router
 * @param {Object} config
 * @param {Object} config.financeServices - Services from createFinanceServices
 * @param {Object} config.configService - ConfigService for household lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createFinanceApiRouter(config) {
  const {
    financeServices,
    configService,
    logger = console
  } = config;

  return createFinanceRouter({
    buxferAdapter: financeServices.buxferAdapter,
    financeStore: financeServices.financeStore,
    harvestService: financeServices.harvestService,
    compilationService: financeServices.compilationService,
    categorizationService: financeServices.categorizationService,
    payrollService: financeServices.payrollService,
    configService,
    logger
  });
}

// =============================================================================
// Proxy Infrastructure Bootstrap
// =============================================================================

/**
 * Create proxy service with all adapters
 * @param {Object} config
 * @param {Object} [config.plex] - Plex configuration
 * @param {string} [config.plex.host] - Plex server URL
 * @param {string} [config.plex.token] - Plex auth token
 * @param {Object} [config.immich] - Immich configuration
 * @param {string} [config.immich.host] - Immich server URL
 * @param {string} [config.immich.apiKey] - Immich API key
 * @param {Object} [config.audiobookshelf] - Audiobookshelf configuration
 * @param {string} [config.audiobookshelf.host] - Audiobookshelf server URL
 * @param {string} [config.audiobookshelf.token] - Audiobookshelf API token
 * @param {Object} [config.freshrss] - FreshRSS configuration
 * @param {string} [config.freshrss.host] - FreshRSS server URL
 * @param {string} [config.freshrss.username] - FreshRSS username
 * @param {string} [config.freshrss.password] - FreshRSS password
 * @param {string} [config.freshrss.apiKey] - FreshRSS API key
 * @param {Object} [config.logger] - Logger instance
 * @returns {ProxyService}
 */
export function createProxyService(config) {
  const { logger = console } = config;
  const proxyService = new ProxyService({ logger });

  // Register Plex adapter if configured
  if (config.plex?.host) {
    proxyService.register(new PlexProxyAdapter(
      { host: config.plex.host, token: config.plex.token },
      { logger }
    ));
  }

  // Register Immich adapter if configured
  if (config.immich?.host) {
    proxyService.register(new ImmichProxyAdapter(
      { host: config.immich.host, apiKey: config.immich.apiKey },
      { logger }
    ));
  }

  // Register Audiobookshelf adapter if configured
  if (config.audiobookshelf?.host) {
    proxyService.register(new AudiobookshelfProxyAdapter(
      { host: config.audiobookshelf.host, token: config.audiobookshelf.token },
      { logger }
    ));
  }

  // Register FreshRSS adapter if configured
  if (config.freshrss?.host) {
    proxyService.register(new FreshRSSProxyAdapter(
      {
        host: config.freshrss.host,
        username: config.freshrss.username,
        password: config.freshrss.password,
        apiKey: config.freshrss.apiKey
      },
      { logger }
    ));
  }

  return proxyService;
}

/**
 * Create external proxy API router
 * @param {Object} config
 * @param {ProxyService} config.proxyService - ProxyService instance
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createExternalProxyApiRouter(config) {
  return createExternalProxyRouter(config);
}

// =============================================================================
// Home Automation Bootstrap
// =============================================================================

/**
 * Create home automation adapters
 * @param {Object} config
 * @param {Object} config.homeAssistant - Home Assistant config
 * @param {string} config.homeAssistant.baseUrl - HA base URL
 * @param {string} config.homeAssistant.token - HA long-lived token
 * @param {Object} [config.kiosk] - Kiosk config
 * @param {string} [config.kiosk.host] - Kiosk device host
 * @param {number} [config.kiosk.port] - Kiosk port
 * @param {string} [config.kiosk.password] - Kiosk password
 * @param {string} [config.kiosk.daylightHost] - Daylight host for kiosk
 * @param {Object} [config.tasker] - Tasker config
 * @param {string} [config.tasker.host] - Tasker device host
 * @param {number} [config.tasker.port] - Tasker port
 * @param {Object} [config.remoteExec] - Remote exec config
 * @param {string} [config.remoteExec.host] - SSH host
 * @param {string} [config.remoteExec.user] - SSH user
 * @param {number} [config.remoteExec.port] - SSH port
 * @param {string} [config.remoteExec.privateKey] - Path to SSH private key
 * @param {string} [config.remoteExec.knownHostsPath] - Path to known_hosts
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Home automation adapters
 */
export function createHomeAutomationAdapters(config) {
  const { logger = console } = config;

  // Home Assistant gateway (optional - requires baseUrl and token)
  let haGateway = null;
  let tvAdapter = null;

  if (config.homeAssistant?.baseUrl && config.homeAssistant?.token) {
    haGateway = new HomeAssistantAdapter(
      {
        baseUrl: config.homeAssistant.baseUrl,
        token: config.homeAssistant.token
      },
      { logger }
    );

    // TV control adapter (uses HA gateway)
    tvAdapter = new TVControlAdapter(
      { gateway: haGateway },
      { logger }
    );
  } else {
    logger.warn?.('homeAutomation.homeassistant.disabled', {
      reason: 'Missing baseUrl or token configuration'
    });
  }

  // Kiosk adapter (optional)
  let kioskAdapter = null;
  if (config.kiosk?.host) {
    kioskAdapter = new KioskAdapter(
      {
        host: config.kiosk.host,
        port: config.kiosk.port,
        password: config.kiosk.password,
        daylightHost: config.kiosk.daylightHost
      },
      { logger }
    );
  }

  // Tasker adapter (optional)
  let taskerAdapter = null;
  if (config.tasker?.host) {
    taskerAdapter = new TaskerAdapter(
      {
        host: config.tasker.host,
        port: config.tasker.port
      },
      { logger }
    );
  }

  // Remote exec adapter (optional)
  let remoteExecAdapter = null;
  if (config.remoteExec?.host) {
    remoteExecAdapter = new RemoteExecAdapter(
      {
        host: config.remoteExec.host,
        user: config.remoteExec.user,
        port: config.remoteExec.port,
        privateKey: config.remoteExec.privateKey,
        knownHostsPath: config.remoteExec.knownHostsPath
      },
      { logger }
    );
  }

  return {
    haGateway,
    tvAdapter,
    kioskAdapter,
    taskerAdapter,
    remoteExecAdapter
  };
}

/**
 * Create home automation API router
 * @param {Object} config
 * @param {Object} config.adapters - Adapters from createHomeAutomationAdapters
 * @param {Function} [config.loadFile] - Function to load state files
 * @param {Function} [config.saveFile] - Function to save state files
 * @param {string} [config.householdId] - Household ID
 * @param {Object} [config.entropyService] - Entropy service for data freshness
 * @param {Object} [config.configService] - Config service for user lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHomeAutomationApiRouter(config) {
  const {
    adapters,
    loadFile,
    saveFile,
    householdId,
    entropyService,
    configService,
    logger = console
  } = config;

  return createHomeAutomationRouter({
    haGateway: adapters.haGateway,
    tvAdapter: adapters.tvAdapter,
    kioskAdapter: adapters.kioskAdapter,
    taskerAdapter: adapters.taskerAdapter,
    remoteExecAdapter: adapters.remoteExecAdapter,
    loadFile,
    saveFile,
    householdId,
    entropyService,
    configService,
    logger
  });
}

// =============================================================================
// Hardware Adapters Bootstrap
// =============================================================================

/**
 * Create thermal printer adapter
 * @param {Object} config
 * @param {string} config.host - Printer IP address
 * @param {number} [config.port=9100] - Printer port
 * @param {number} [config.timeout=5000] - Connection timeout
 * @param {boolean} [config.upsideDown=true] - Upside-down mode
 * @param {Object} [config.logger] - Logger instance
 * @returns {ThermalPrinterAdapter}
 */
export function createThermalPrinterAdapter(config) {
  const { logger = console, ...printerConfig } = config;
  return new ThermalPrinterAdapter(printerConfig, { logger });
}

/**
 * Create TTS adapter
 * @param {Object} config
 * @param {string} config.apiKey - OpenAI API key
 * @param {string} [config.model='tts-1'] - TTS model
 * @param {string} [config.defaultVoice='alloy'] - Default voice
 * @param {Object} [config.logger] - Logger instance
 * @returns {TTSAdapter}
 */
export function createTTSAdapterInstance(config) {
  const { logger = console, ...ttsConfig } = config;
  return new TTSAdapter(ttsConfig, { logger });
}

/**
 * Create MQTT sensor adapter
 * @param {Object} config
 * @param {string} config.host - MQTT broker host
 * @param {number} [config.port=1883] - MQTT broker port
 * @param {Function} [config.onMessage] - Message callback
 * @param {Object} [config.logger] - Logger instance
 * @returns {MQTTSensorAdapter}
 */
export function createMQTTSensorAdapterInstance(config) {
  const { logger = console, onMessage, ...mqttConfig } = config;
  return new MQTTSensorAdapter(mqttConfig, { logger, onMessage });
}

/**
 * Create hardware adapters
 * @param {Object} config
 * @param {Object} [config.printer] - Printer configuration
 * @param {string} [config.printer.host] - Printer IP address
 * @param {number} [config.printer.port] - Printer port
 * @param {Object} [config.tts] - TTS configuration
 * @param {string} [config.tts.apiKey] - OpenAI API key
 * @param {Object} [config.mqtt] - MQTT configuration
 * @param {string} [config.mqtt.host] - MQTT broker host
 * @param {number} [config.mqtt.port] - MQTT broker port
 * @param {Function} [config.onMqttMessage] - MQTT message callback
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Hardware adapters
 */
export function createHardwareAdapters(config) {
  const { logger = console } = config;

  // Thermal printer adapter (optional)
  let printerAdapter = null;
  if (config.printer?.host) {
    printerAdapter = new ThermalPrinterAdapter(
      {
        host: config.printer.host,
        port: config.printer.port,
        timeout: config.printer.timeout,
        upsideDown: config.printer.upsideDown
      },
      { logger }
    );
  }

  // TTS adapter (optional - requires OpenAI API key)
  let ttsAdapter = null;
  if (config.tts?.apiKey) {
    ttsAdapter = new TTSAdapter(
      {
        apiKey: config.tts.apiKey,
        model: config.tts.model,
        defaultVoice: config.tts.defaultVoice
      },
      { logger }
    );
  }

  // MQTT sensor adapter (optional)
  let mqttAdapter = null;
  if (config.mqtt?.host) {
    mqttAdapter = new MQTTSensorAdapter(
      {
        host: config.mqtt.host,
        port: config.mqtt.port
      },
      { logger, onMessage: config.onMqttMessage }
    );
  }

  return {
    printerAdapter,
    ttsAdapter,
    mqttAdapter
  };
}

/**
 * Create printer API router
 * @param {Object} config
 * @param {ThermalPrinterAdapter} config.printerAdapter
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createPrinterApiRouter(config) {
  return createPrinterRouter(config);
}

/**
 * Create TTS API router
 * @param {Object} config
 * @param {TTSAdapter} config.ttsAdapter
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createTTSApiRouter(config) {
  return createTTSRouter(config);
}

// =============================================================================
// Gratitude Domain Bootstrap
// =============================================================================

/**
 * Create gratitude domain services
 * @param {Object} config
 * @param {Object} config.userDataService - UserDataService for YAML I/O
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Gratitude services
 */
export function createGratitudeServices(config) {
  const { userDataService, logger = console } = config;

  // Gratitude store (YAML persistence)
  const gratitudeStore = new YamlGratitudeStore({
    userDataService,
    logger
  });

  // Gratitude service
  const gratitudeService = new GratitudeService({
    store: gratitudeStore,
    logger
  });

  return {
    gratitudeStore,
    gratitudeService
  };
}

/**
 * Create gratitude API router
 * @param {Object} config
 * @param {Object} config.gratitudeServices - Services from createGratitudeServices
 * @param {Object} config.configService - ConfigService for household lookup
 * @param {Function} config.broadcastToWebsockets - WebSocket broadcast function
 * @param {Object} [config.printerAdapter] - ThermalPrinterAdapter for card printing
 * @param {Function} [config.createPrayerCardCanvas] - Function to generate prayer card canvas
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createGratitudeApiRouter(config) {
  const {
    gratitudeServices,
    configService,
    broadcastToWebsockets,
    printerAdapter,
    createPrayerCardCanvas,
    logger = console
  } = config;

  return createGratitudeRouter({
    gratitudeService: gratitudeServices.gratitudeService,
    configService,
    broadcastToWebsockets,
    printerAdapter,
    createPrayerCardCanvas,
    logger
  });
}

// =============================================================================
// Messaging Domain Bootstrap
// =============================================================================

/**
 * Create messaging domain services
 * @param {Object} config
 * @param {Object} config.userDataService - UserDataService for YAML I/O
 * @param {Object} [config.telegram] - Telegram configuration
 * @param {string} [config.telegram.token] - Telegram bot token
 * @param {Object} [config.gmail] - Gmail configuration
 * @param {Object} [config.gmail.credentials] - Google OAuth credentials
 * @param {Object} [config.gmail.token] - Google OAuth token
 * @param {Object} [config.transcriptionService] - Transcription service for voice messages
 * @param {Object} [config.httpClient] - HTTP client for API requests
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Messaging services
 */
export function createMessagingServices(config) {
  const {
    userDataService,
    telegram,
    gmail,
    transcriptionService,
    httpClient,
    logger = console
  } = config;

  // Conversation store (YAML persistence)
  const conversationStore = new YamlConversationStore({
    userDataService,
    logger
  });

  // Conversation service
  const conversationService = new ConversationService({
    conversationStore,
    logger
  });

  // Notification service
  const notificationService = new NotificationService({
    logger
  });

  // Telegram adapter (optional - requires token)
  let telegramAdapter = null;
  if (telegram?.token) {
    telegramAdapter = new TelegramAdapter({
      token: telegram.token,
      httpClient,
      transcriptionService,
      logger
    });

    // Register as notification channel
    notificationService.registerChannel('telegram', telegramAdapter);
  }

  // Gmail adapter (optional - requires credentials)
  let gmailAdapter = null;
  if (gmail?.credentials) {
    gmailAdapter = new GmailAdapter({
      credentials: gmail.credentials,
      token: gmail.token,
      logger
    });

    // Register as notification channel
    notificationService.registerChannel('email', gmailAdapter);
  }

  return {
    conversationStore,
    conversationService,
    notificationService,
    telegramAdapter,
    gmailAdapter
  };
}

/**
 * Create messaging API router
 * @param {Object} config
 * @param {Object} config.messagingServices - Services from createMessagingServices
 * @param {Object} config.configService - ConfigService for household lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createMessagingApiRouter(config) {
  const {
    messagingServices,
    configService,
    logger = console
  } = config;

  return createMessagingRouter({
    conversationService: messagingServices.conversationService,
    notificationService: messagingServices.notificationService,
    telegramAdapter: messagingServices.telegramAdapter,
    gmailAdapter: messagingServices.gmailAdapter,
    configService,
    logger
  });
}

// =============================================================================
// Journalist Application Bootstrap
// =============================================================================

/**
 * Create journalist application services
 * @param {Object} config
 * @param {Object} config.userDataService - UserDataService for YAML I/O
 * @param {Object} config.configService - ConfigService for user/household lookup
 * @param {Object} config.telegramAdapter - TelegramAdapter for messaging
 * @param {Object} config.aiGateway - AI gateway for completions
 * @param {Object} [config.userResolver] - UserResolver for telegram ID mapping
 * @param {Object} [config.conversationStateStore] - State store for conversation flow
 * @param {Object} [config.quizRepository] - Quiz data repository
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Journalist services
 */
export function createJournalistServices(config) {
  const {
    userDataService,
    configService,
    telegramAdapter,
    aiGateway,
    userResolver,
    conversationStateStore,
    quizRepository,
    logger = console
  } = config;

  // Journal entry repository (YAML persistence)
  const journalEntryRepository = new YamlJournalEntryRepository({
    userDataService,
    userResolver,
    configService,
    logger
  });

  // Message queue repository (YAML persistence)
  const messageQueueRepository = new YamlMessageQueueRepository({
    userDataService,
    userResolver,
    logger
  });

  // Get journalist config from environment or config service
  const journalistConfig = {
    username: configService?.getDefaultUsername?.() || process.env.DEFAULT_USERNAME || 'kckern',
    getUserTimezone: (userId) => configService?.getUserTimezone?.(userId) || 'America/Los_Angeles'
  };

  // Create journalist container with all dependencies
  const journalistContainer = new JournalistContainer(journalistConfig, {
    messagingGateway: telegramAdapter,
    aiGateway,
    journalEntryRepository,
    messageQueueRepository,
    conversationStateStore,
    quizRepository,
    userResolver,
    logger
  });

  // Create input router for webhook handling
  const journalistInputRouter = new JournalistInputRouter({
    container: journalistContainer,
    logger
  });

  return {
    journalEntryRepository,
    messageQueueRepository,
    journalistContainer,
    journalistInputRouter
  };
}

/**
 * Create journalist API router
 * @param {Object} config
 * @param {Object} config.journalistServices - Services from createJournalistServices
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.userResolver] - UserResolver for platform ID mapping
 * @param {Object} [config.secretToken] - Telegram webhook secret token
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createJournalistApiRouter(config) {
  const {
    journalistServices,
    configService,
    userResolver,
    botId,
    secretToken,
    gateway,
    logger = console
  } = config;

  return createJournalistRouter(journalistServices.journalistContainer, {
    userResolver,
    botId,
    secretToken,
    gateway,
    configService,
    logger
  });
}

// =============================================================================
// Homebot Application Bootstrap
// =============================================================================

/**
 * Create homebot application services
 * @param {Object} config
 * @param {Object} config.telegramAdapter - TelegramAdapter for messaging
 * @param {Object} config.aiGateway - AI gateway for completions
 * @param {Object} config.gratitudeStore - YamlGratitudeStore instance
 * @param {Object} config.configService - ConfigService for household lookup
 * @param {Object} [config.conversationStateStore] - State store for conversation flow
 * @param {Function} [config.websocketBroadcast] - WebSocket broadcast function
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Homebot services
 */
export function createHomebotServices(config) {
  const {
    telegramAdapter,
    aiGateway,
    gratitudeStore,
    configService,
    conversationStateStore,
    websocketBroadcast,
    logger = console
  } = config;

  // Household repository adapter
  const householdRepository = new ConfigHouseholdAdapter({
    configService,
    logger
  });

  // Create homebot container with all dependencies
  const homebotContainer = new HomeBotContainer({
    messagingGateway: telegramAdapter,
    aiGateway,
    gratitudeStore,
    conversationStateStore,
    householdRepository,
    websocketBroadcast,
    logger
  });

  // Create input router for webhook handling
  const homebotInputRouter = new HomeBotInputRouter({
    container: homebotContainer,
    logger
  });

  return {
    homebotContainer,
    homebotInputRouter,
    householdRepository
  };
}

/**
 * Create homebot API router
 * @param {Object} config
 * @param {Object} config.homebotServices - Services from createHomebotServices
 * @param {Object} [config.userResolver] - UserResolver for platform ID mapping
 * @param {string} [config.botId] - Telegram bot ID
 * @param {string} [config.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [config.gateway] - TelegramAdapter for callback acknowledgements
 * @param {Function} [config.createTelegramWebhookHandler] - Webhook handler factory
 * @param {Object} [config.middleware] - Middleware functions
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHomebotApiRouter(config) {
  const {
    homebotServices,
    userResolver,
    botId,
    secretToken,
    gateway,
    createTelegramWebhookHandler,
    middleware,
    logger = console
  } = config;

  return createHomebotRouter(homebotServices.homebotContainer, {
    userResolver,
    botId,
    secretToken,
    gateway,
    createTelegramWebhookHandler,
    middleware,
    logger
  });
}

// =============================================================================
// Nutribot Application Bootstrap
// =============================================================================

/**
 * Create nutribot application services
 * @param {Object} config
 * @param {string} config.dataRoot - Base data directory
 * @param {Object} config.telegramAdapter - TelegramAdapter for messaging
 * @param {Object} config.aiGateway - AI gateway for completions
 * @param {Object} [config.upcGateway] - UPC lookup gateway
 * @param {Object} [config.googleImageGateway] - Google Image Search gateway
 * @param {Object} [config.conversationStateStore] - State store for conversation flow
 * @param {Object} [config.reportRenderer] - Report renderer
 * @param {Object} [config.nutribotConfig] - NutriBot configuration
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Nutribot services
 */
export function createNutribotServices(config) {
  const {
    dataRoot,
    telegramAdapter,
    aiGateway,
    upcGateway,
    googleImageGateway,
    conversationStateStore,
    reportRenderer,
    nutribotConfig: rawNutribotConfig = {},
    logger = console
  } = config;

  // Ensure nutribotConfig has required methods (getUserGoals, getUserTimezone)
  // If it's a plain object from configService, wrap with default method implementations
  const defaultGoals = { calories: 2000, calories_min: 1600, calories_max: 2000, protein: 150, carbs: 200, fat: 65, fiber: 30, sodium: 2300 };
  const nutribotConfig = {
    ...rawNutribotConfig,
    getUserGoals: rawNutribotConfig?.getUserGoals?.bind(rawNutribotConfig) || (() => defaultGoals),
    getUserTimezone: rawNutribotConfig?.getUserTimezone?.bind(rawNutribotConfig) || (() => 'America/Los_Angeles'),
    getDefaultTimezone: rawNutribotConfig?.getDefaultTimezone?.bind(rawNutribotConfig) || (() => 'America/Los_Angeles'),
    getThresholds: rawNutribotConfig?.getThresholds?.bind(rawNutribotConfig) || (() => ({ daily: 2000 })),
  };

  // Food log store (YAML persistence)
  const foodLogStore = new YamlFoodLogStore({
    dataRoot,
    logger
  });

  // Nutrient list store (YAML persistence)
  const nutriListStore = new YamlNutriListStore({
    dataRoot,
    logger
  });

  // Coaching store (YAML persistence)
  const nutriCoachStore = new YamlNutriCoachStore({
    dataRoot,
    logger
  });

  // Create nutribot container with all dependencies
  // Note: Identity resolution (conversation ID -> username) is handled by
  // UserResolver in the adapter layer (NutribotInputRouter), not here.
  const nutribotContainer = new NutribotContainer(nutribotConfig, {
    messagingGateway: telegramAdapter,
    aiGateway,
    upcGateway,
    googleImageGateway,
    foodLogStore,
    nutriListStore,
    nutriCoachStore,
    conversationStateStore,
    reportRenderer,
    logger
  });

  return {
    foodLogStore,
    nutriListStore,
    nutriCoachStore,
    nutribotContainer
  };
}

/**
 * Create nutribot API router
 * @param {Object} config
 * @param {Object} config.nutribotServices - Services from createNutribotServices
 * @param {Object} [config.userResolver] - UserResolver for platform ID mapping
 * @param {string} [config.botId] - Telegram bot ID
 * @param {string} [config.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [config.gateway] - TelegramGateway for callback acknowledgements
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createNutribotApiRouter(config) {
  const {
    nutribotServices,
    userResolver,
    botId,
    secretToken,
    gateway,
    logger = console
  } = config;

  return createNutribotRouter(nutribotServices.nutribotContainer, {
    userResolver,
    botId,
    secretToken,
    gateway,
    logger
  });
}

/**
 * Create nutribot services with DDD architecture
 * @param {Object} config
 * @param {Object} config.userDataService
 * @param {Object} config.telegram - { token, botId }
 * @param {Object} config.openai - { apiKey }
 * @param {Object} config.nutritionix - { appId, appKey }
 * @param {Object} [config.logger]
 * @returns {Object}
 */
export function createNutribotDDDServices(config) {
  const { userDataService, telegram, openai, nutritionix, logger = console } = config;

  // Persistence adapters
  const nutriLogStore = new YamlNutriLogStore({ userDataService, logger });
  const nutriListStore = new YamlNutriListStore({ userDataService, logger });

  // External service adapters
  const messagingGateway = telegram?.token
    ? new TelegramMessagingAdapter({ token: telegram.token, logger })
    : null;

  const webhookParser = telegram?.botId
    ? new TelegramWebhookParser({ botId: telegram.botId, logger })
    : null;

  const foodParser = openai?.apiKey
    ? new OpenAIFoodParserAdapter({ apiKey: openai.apiKey, logger })
    : null;

  const nutritionLookup = nutritionix?.appId
    ? new NutritionixAdapter({
        appId: nutritionix.appId,
        appKey: nutritionix.appKey,
        logger
      })
    : null;

  return {
    nutriLogStore,
    nutriListStore,
    messagingGateway,
    webhookParser,
    foodParser,
    nutritionLookup
  };
}

// =============================================================================
// Health Domain Bootstrap
// =============================================================================

/**
 * Create health domain services
 * @param {Object} config
 * @param {Object} config.userDataService - UserDataService for YAML I/O
 * @param {Object} [config.userResolver] - UserResolver for ID to username mapping
 * @param {Object} [config.configService] - ConfigService for user/household lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Health services
 */
export function createHealthServices(config) {
  const {
    userDataService,
    userResolver,
    configService,
    dataRoot,
    logger = console
  } = config;

  // Health store (YAML persistence)
  const healthStore = new YamlHealthStore({
    userDataService,
    userResolver,
    configService,
    logger
  });

  // Health aggregation service
  const healthService = new HealthAggregationService({
    healthStore,
    logger
  });

  // NutriList store for nutrilist endpoints (optional, requires dataRoot)
  let nutriListStore = null;
  if (dataRoot) {
    nutriListStore = new YamlNutriListStore({
      dataRoot,
      logger
    });
  }

  return {
    healthStore,
    healthService,
    nutriListStore
  };
}

/**
 * Create health API router
 * @param {Object} config
 * @param {Object} config.healthServices - Services from createHealthServices
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHealthApiRouter(config) {
  const {
    healthServices,
    configService,
    logger = console
  } = config;

  return createHealthRouter({
    healthService: healthServices.healthService,
    healthStore: healthServices.healthStore,
    nutriListStore: healthServices.nutriListStore,
    configService,
    logger
  });
}

// =============================================================================
// Entropy Domain Bootstrap
// =============================================================================

/**
 * Create entropy domain services
 * @param {Object} config
 * @param {Object} config.io - IO functions { userLoadFile, userLoadCurrent }
 * @param {Object} [config.archiveService] - ArchiveService for fast path
 * @param {Object} config.configService - ConfigService for entropy config
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Entropy services
 */
export function createEntropyServices(config) {
  const {
    io,
    archiveService,
    configService,
    logger = console
  } = config;

  // Entropy reader (YAML-based)
  const entropyReader = new YamlEntropyReader({
    io,
    archiveService,
    logger
  });

  // Entropy service
  const entropyService = new EntropyService({
    entropyReader,
    configService,
    logger
  });

  return {
    entropyReader,
    entropyService
  };
}

/**
 * Create entropy API router
 * @param {Object} config
 * @param {Object} config.entropyServices - Services from createEntropyServices
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createEntropyApiRouter(config) {
  const {
    entropyServices,
    configService,
    logger = console
  } = config;

  return createEntropyRouter({
    entropyService: entropyServices.entropyService,
    configService,
    logger
  });
}

// =============================================================================
// Lifelog Domain Bootstrap
// =============================================================================

/**
 * Create lifelog domain services
 * @param {Object} config
 * @param {Function} config.userLoadFile - Function to load user files
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Lifelog services
 */
export function createLifelogServices(config) {
  const { userLoadFile, logger = console } = config;

  const lifelogAggregator = new LifelogAggregator({
    userLoadFile,
    logger
  });

  return {
    lifelogAggregator
  };
}

/**
 * Create lifelog API router
 * @param {Object} config
 * @param {Object} config.lifelogServices - Services from createLifelogServices
 * @param {Object} config.userDataService - UserDataService for reading user files
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createLifelogApiRouter(config) {
  const {
    lifelogServices,
    userDataService,
    configService,
    logger = console
  } = config;

  return createLifelogRouter({
    aggregator: lifelogServices.lifelogAggregator,
    userDataService,
    configService,
    logger
  });
}

// =============================================================================
// Static Assets Bootstrap
// =============================================================================

/**
 * Create static assets API router
 * @param {Object} config
 * @param {string} config.imgBasePath - Base path for images
 * @param {string} config.dataBasePath - Base path for data files
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createStaticApiRouter(config) {
  return createStaticRouter(config);
}

// =============================================================================
// Calendar Domain Bootstrap
// =============================================================================

/**
 * Create calendar API router
 * @param {Object} config
 * @param {Object} config.userDataService - UserDataService for reading shared data
 * @param {Object} config.configService - ConfigService for household lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createCalendarApiRouter(config) {
  return createCalendarRouter(config);
}

// =============================================================================
// Harvester Services Bootstrap
// =============================================================================

/**
 * Create harvester services for scheduled data collection
 *
 * This factory creates the HarvesterService with all available harvester adapters
 * registered. Harvesters are conditionally registered based on available dependencies.
 *
 * @param {Object} config
 * @param {Object} config.io - IO functions { userLoadFile, userSaveFile }
 * @param {Object} config.httpClient - HTTP client for API requests (e.g., axios)
 * @param {Object} config.configService - ConfigService for credentials and user lookup
 * @param {Object} [config.todoistApi] - Todoist API client factory or instance
 * @param {Object} [config.stravaClient] - Strava API client { refreshToken, getActivities, getActivityStreams }
 * @param {Object} [config.authStore] - Auth store for OAuth tokens
 * @param {Object} [config.currentStore] - Store for current state data
 * @param {Object} [config.aiGateway] - AI gateway for AI-powered harvesters
 * @param {Object} [config.rssParser] - RSS parser instance (defaults to new RSSParser)
 * @param {Object} [config.sharedStore] - Store for shared household data (weather)
 * @param {Function} [config.gmailClientFactory] - Factory to create Gmail client: (username) => gmailClient
 * @param {string} [config.dataRoot] - Base data directory (for creating default stores)
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Harvester services { harvesterService, jobExecutor, lifelogStore }
 */
export function createHarvesterServices(config) {
  const {
    io,
    httpClient,
    configService,
    todoistApi,
    stravaClient: stravaClientParam,
    authStore: authStoreParam,
    currentStore,
    aiGateway,
    rssParser,
    sharedStore: sharedStoreParam,
    gmailClientFactory,
    dataRoot,
    logger = console
  } = config;

  // Validate required dependencies
  if (!io?.userLoadFile || !io?.userSaveFile) {
    throw new Error('createHarvesterServices requires io.userLoadFile and io.userSaveFile');
  }
  if (!configService) {
    throw new Error('createHarvesterServices requires configService');
  }

  // Create lifelog store (shared by all harvesters)
  const lifelogStore = new YamlLifelogStore({ io, logger });

  // Create or use provided stravaClient
  const stravaClient = stravaClientParam || (httpClient ? new StravaClientAdapter({
    httpClient,
    configService,
    logger,
  }) : null);

  // Create or use provided authStore (for OAuth token persistence)
  const authStore = authStoreParam || {
    async load(username, provider) {
      return configService?.getUserAuth?.(provider, username) || null;
    },
    async save(username, provider, tokenData) {
      // Auth store save is optional - tokens are typically managed by configService
      logger.debug?.('authStore.save', { username, provider });
    },
  };

  // Create or use provided sharedStore (for weather data)
  const sharedStore = sharedStoreParam || (dataRoot ? new YamlWeatherStore({
    dataRoot,
    householdId: configService?.getDefaultHouseholdId?.() || 'default',
    logger,
  }) : null);

  // Create Gmail client factory if not provided (for Shopping harvester)
  const effectiveGmailClientFactory = gmailClientFactory || (async (username) => {
    const GOOGLE_CLIENT_ID = configService.getSecret('GOOGLE_CLIENT_ID');
    const GOOGLE_CLIENT_SECRET = configService.getSecret('GOOGLE_CLIENT_SECRET');
    const GOOGLE_REDIRECT_URI = configService.getSecret('GOOGLE_REDIRECT_URI');
    const auth = configService?.getUserAuth?.('google', username) || {};
    const refreshToken = auth.refresh_token || configService.getSecret('GOOGLE_REFRESH_TOKEN');

    if (!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI && refreshToken)) {
      throw new Error('Google OAuth credentials not configured');
    }

    const oAuth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );
    oAuth2Client.setCredentials({ refresh_token: refreshToken });

    return google.gmail({ version: 'v1', auth: oAuth2Client });
  });

  // Create AI gateway if not provided (for Shopping harvester)
  const effectiveAiGateway = aiGateway || (() => {
    const openaiKey = configService.getSecret('OPENAI_API_KEY');
    if (!openaiKey) return null;
    return new OpenAIAdapter({ apiKey: openaiKey }, { logger });
  })();

  // Create harvester service
  const harvesterService = new HarvesterService({ configService, logger });

  // Helper to safely register a harvester
  const registerHarvester = (name, factory) => {
    try {
      const harvester = factory();
      if (harvester) {
        harvesterService.register(harvester);
        logger.debug?.('harvester.bootstrap.registered', { serviceId: name });
      }
    } catch (error) {
      logger.warn?.('harvester.bootstrap.skipped', {
        serviceId: name,
        reason: error.message,
      });
    }
  };

  // ==========================================================================
  // Productivity Harvesters
  // ==========================================================================

  // Todoist - requires todoistApi or httpClient
  if (todoistApi || httpClient) {
    registerHarvester('todoist', () => new TodoistHarvester({
      todoistApi,
      httpClient,
      lifelogStore,
      currentStore,
      configService,
      logger,
    }));
  }

  // ClickUp - requires httpClient
  if (httpClient) {
    registerHarvester('clickup', () => new ClickUpHarvester({
      httpClient,
      lifelogStore,
      configService,
      logger,
    }));
  }

  // GitHub - requires httpClient
  if (httpClient) {
    registerHarvester('github', () => new GitHubHarvester({
      httpClient,
      lifelogStore,
      configService,
      logger,
    }));
  }

  // ==========================================================================
  // Social Harvesters
  // ==========================================================================

  // Last.fm - requires httpClient
  if (httpClient) {
    registerHarvester('lastfm', () => new LastfmHarvester({
      httpClient,
      lifelogStore,
      configService,
      logger,
    }));
  }

  // Reddit - requires httpClient
  if (httpClient) {
    registerHarvester('reddit', () => new RedditHarvester({
      httpClient,
      lifelogStore,
      configService,
      logger,
    }));
  }

  // Create shared RSS parser for feed-based harvesters
  const rssParserInstance = rssParser || new RSSParser();

  // Letterboxd - uses RSS feed
  registerHarvester('letterboxd', () => new LetterboxdHarvester({
    rssParser: rssParserInstance,
    lifelogStore,
    configService,
    logger,
  }));

  // Goodreads - uses RSS feed
  registerHarvester('goodreads', () => new GoodreadsHarvester({
    rssParser: rssParserInstance,
    lifelogStore,
    configService,
    logger,
  }));

  // Foursquare - requires httpClient
  if (httpClient) {
    registerHarvester('foursquare', () => new FoursquareHarvester({
      httpClient,
      lifelogStore,
      configService,
      logger,
    }));
  }

  // ==========================================================================
  // Communication Harvesters
  // ==========================================================================

  // Gmail - requires httpClient
  if (httpClient) {
    registerHarvester('gmail', () => new GmailHarvester({
      httpClient,
      lifelogStore,
      configService,
      logger,
    }));
  }

  // Google Calendar - requires httpClient
  if (httpClient) {
    registerHarvester('gcal', () => new GCalHarvester({
      httpClient,
      lifelogStore,
      configService,
      logger,
    }));
  }

  // ==========================================================================
  // Finance Harvesters
  // ==========================================================================

  // Shopping - requires gmailClientFactory and aiGateway
  if (effectiveGmailClientFactory && effectiveAiGateway) {
    registerHarvester('shopping', () => new ShoppingHarvester({
      gmailClientFactory: effectiveGmailClientFactory,
      aiGateway: effectiveAiGateway,
      lifelogStore,
      configService,
      logger,
    }));
  }

  // Buxfer - requires httpClient for API calls
  if (httpClient) {
    const buxferAdapter = new BuxferAdapter({
      httpClient,
      getCredentials: () => configService?.getUserAuth?.('buxfer'),
      logger,
    });
    registerHarvester('buxfer', () => new BuxferHarvester({
      buxferAdapter,
      lifelogStore,
      configService,
      logger,
    }));
  }

  // ==========================================================================
  // Fitness Harvesters
  // ==========================================================================

  // Strava - requires stravaClient
  if (stravaClient) {
    registerHarvester('strava', () => new StravaHarvester({
      stravaClient,
      lifelogStore,
      authStore,
      configService,
      logger,
    }));
  }

  // Withings - requires httpClient
  if (httpClient) {
    registerHarvester('withings', () => new WithingsHarvester({
      httpClient,
      lifelogStore,
      authStore,
      configService,
      logger,
    }));
  }

  // ==========================================================================
  // Other Harvesters
  // ==========================================================================

  // Weather - requires sharedStore for household-level data
  if (sharedStore) {
    registerHarvester('weather', () => new WeatherHarvester({
      sharedStore,
      configService,
      logger,
    }));
  }

  // Create job executor for scheduler integration
  const jobExecutor = new HarvesterJobExecutor({
    harvesterService,
    configService,
    logger,
  });

  // Log summary
  const registeredHarvesters = harvesterService.listHarvesters();
  logger.info?.('harvester.bootstrap.complete', {
    count: registeredHarvesters.length,
    serviceIds: registeredHarvesters.map(h => h.serviceId),
  });

  return {
    harvesterService,
    jobExecutor,
    lifelogStore,
  };
}
