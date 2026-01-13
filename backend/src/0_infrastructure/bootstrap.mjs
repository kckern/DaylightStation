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
import { legacyMediaLogMiddleware } from '../4_api/middleware/legacyCompat.mjs';
import { createLegacyLocalContentShim } from '../4_api/middleware/legacyLocalContentShim.mjs';
import { createLegacyPlayShim } from '../4_api/middleware/legacyPlayShim.mjs';
import { createLegacyListShim } from '../4_api/middleware/legacyListShim.mjs';

// Fitness domain imports
import { SessionService } from '../1_domains/fitness/services/SessionService.mjs';
import { YamlSessionStore } from '../2_adapters/persistence/yaml/YamlSessionStore.mjs';
import { AmbientLedAdapter } from '../2_adapters/fitness/AmbientLedAdapter.mjs';
import { VoiceMemoTranscriptionService } from '../2_adapters/fitness/VoiceMemoTranscriptionService.mjs';
import { OpenAIAdapter } from '../2_adapters/ai/OpenAIAdapter.mjs';
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
import { YamlFoodLogStore } from '../2_adapters/persistence/yaml/YamlFoodLogStore.mjs';
import { YamlNutriListStore } from '../2_adapters/persistence/yaml/YamlNutriListStore.mjs';
import { YamlNutriCoachStore } from '../2_adapters/persistence/yaml/YamlNutriCoachStore.mjs';
import { createNutribotRouter } from '../4_api/routers/nutribot.mjs';

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
      mediaBasePath: config.mediaBasePath
    }));
  }

  // Register Plex adapter if configured
  if (config.plex?.host) {
    registry.register(new PlexAdapter({
      host: config.plex.host,
      token: config.plex.token
    }));
  }

  // Register local content adapter (optional)
  if (config.dataPath && config.mediaBasePath) {
    registry.register(new LocalContentAdapter({
      dataPath: config.dataPath,
      mediaPath: config.mediaBasePath
    }));
  }

  // Register folder adapter (optional, requires registry reference)
  if (config.watchlistPath) {
    registry.register(new FolderAdapter({
      watchlistPath: config.watchlistPath,
      registry
    }));
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
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Router configuration
 */
export function createApiRouters(config) {
  const { registry, watchStore, loadFile, saveFile, cacheBasePath, logger = console } = config;

  return {
    content: createContentRouter(registry, watchStore, { loadFile, saveFile, cacheBasePath, logger }),
    proxy: createProxyRouter({ registry }),
    localContent: createLocalContentRouter({ registry }),
    play: createPlayRouter({ registry, watchStore, logger }),
    list: createListRouter({ registry }),
    legacyShims: {
      play: createLegacyPlayShim(),
      list: createLegacyListShim(),
      localContent: createLegacyLocalContentShim(),
      mediaLog: legacyMediaLogMiddleware(watchStore)
    }
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
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createFitnessApiRouter(config) {
  const {
    fitnessServices,
    userService,
    userDataService,
    configService,
    logger = console
  } = config;

  return createFitnessRouter({
    sessionService: fitnessServices.sessionService,
    zoneLedController: fitnessServices.ambientLedController,
    transcriptionService: fitnessServices.transcriptionService,
    userService,
    userDataService,
    configService,
    logger
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
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Finance services
 */
export function createFinanceServices(config) {
  const {
    dataRoot,
    defaultHouseholdId = 'default',
    buxfer,
    aiGateway,
    logger = console
  } = config;

  // Finance store (YAML persistence)
  const financeStore = new YamlFinanceStore({
    dataRoot,
    defaultHouseholdId
  });

  // Buxfer adapter (optional - requires credentials)
  let buxferAdapter = null;
  if (buxfer?.email && buxfer?.password) {
    buxferAdapter = new BuxferAdapter(
      { email: buxfer.email, password: buxfer.password },
      { logger }
    );
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
      buxferAdapter,
      financeStore,
      compilationService,
      categorizationService,
      logger
    });
  }

  return {
    financeStore,
    buxferAdapter,
    compilationService,
    categorizationService,
    harvestService
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
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHomeAutomationApiRouter(config) {
  const {
    adapters,
    loadFile,
    saveFile,
    householdId,
    logger = console
  } = config;

  return createHomeAutomationRouter({
    tvAdapter: adapters.tvAdapter,
    kioskAdapter: adapters.kioskAdapter,
    taskerAdapter: adapters.taskerAdapter,
    remoteExecAdapter: adapters.remoteExecAdapter,
    loadFile,
    saveFile,
    householdId,
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
 * @param {Object} [config.secretToken] - Telegram webhook secret token
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createJournalistApiRouter(config) {
  const {
    journalistServices,
    configService,
    secretToken,
    logger = console
  } = config;

  return createJournalistRouter({
    container: journalistServices.journalistContainer,
    inputRouter: journalistServices.journalistInputRouter,
    configService,
    secretToken,
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
    nutribotConfig = {},
    logger = console
  } = config;

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
 * @param {string} [config.botId] - Telegram bot ID
 * @param {Object} [config.gateway] - TelegramGateway for callback acknowledgements
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createNutribotApiRouter(config) {
  const {
    nutribotServices,
    botId,
    gateway,
    logger = console
  } = config;

  return createNutribotRouter(nutribotServices.nutribotContainer, {
    botId,
    gateway,
    logger
  });
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

  return {
    healthStore,
    healthService
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
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createLifelogApiRouter(config) {
  const {
    lifelogServices,
    configService,
    logger = console
  } = config;

  return createLifelogRouter({
    lifelogAggregator: lifelogServices.lifelogAggregator,
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
