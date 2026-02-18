// backend/src/0_system/bootstrap.mjs

import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Integration registry imports
import { AdapterRegistry } from './registries/AdapterRegistry.mjs';
import { IntegrationLoader } from './registries/IntegrationLoader.mjs';
import { SystemBotLoader } from './registries/SystemBotLoader.mjs';

// EventBus imports
import { WebSocketEventBus } from './eventbus/WebSocketEventBus.mjs';

// Content domain imports
import { ContentSourceRegistry } from '#domains/content/services/ContentSourceRegistry.mjs';
import { FileAdapter } from '#adapters/content/media/files/FileAdapter.mjs';
import { PlexAdapter } from '#adapters/content/media/plex/PlexAdapter.mjs';
import { MediaKeyResolver } from '#domains/media/MediaKeyResolver.mjs';
import { LocalContentAdapter } from '#adapters/content/local-content/LocalContentAdapter.mjs';
import { ListAdapter } from '#adapters/content/list/ListAdapter.mjs';
import { ImmichAdapter } from '#adapters/content/gallery/immich/ImmichAdapter.mjs';
import { AudiobookshelfAdapter } from '#adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs';
import { SingalongAdapter } from '#adapters/content/singalong/SingalongAdapter.mjs';
import { ReadalongAdapter } from '#adapters/content/readalong/ReadalongAdapter.mjs';
import { AppRegistryAdapter } from '#adapters/content/app-registry/AppRegistryAdapter.mjs';
import { KomgaAdapter } from '#adapters/content/readable/komga/KomgaAdapter.mjs';
import { QueryAdapter } from '#adapters/content/query/QueryAdapter.mjs';
import { FreshVideoAdapter } from '#adapters/content/freshvideo/FreshVideoAdapter.mjs';
import { SavedQueryService } from '#apps/content/SavedQueryService.mjs';
import { FilesystemCanvasAdapter, ImmichCanvasAdapter } from '#adapters/content/canvas/index.mjs';
import { ImmichClient } from '#adapters/content/gallery/immich/ImmichClient.mjs';
import { YamlMediaProgressMemory } from '#adapters/persistence/yaml/YamlMediaProgressMemory.mjs';

// Content adapter manifests (for category/provider metadata)
import mediaManifest from '#adapters/content/media/files/manifest.mjs';
import plexManifest from '#adapters/content/media/plex/manifest.mjs';
import immichManifest from '#adapters/content/gallery/immich/manifest.mjs';
import listManifest from '#adapters/content/list/manifest.mjs';
import singalongManifest from '#adapters/content/singalong/manifest.mjs';
import readalongManifest from '#adapters/content/readalong/manifest.mjs';
import appRegistryManifest from '#adapters/content/app-registry/manifest.mjs';
import komgaManifest from '#adapters/content/readable/komga/manifest.mjs';
import queryManifest from '#adapters/content/query/manifest.mjs';
import freshvideoManifest from '#adapters/content/freshvideo/manifest.mjs';
import { createContentRouter } from '#api/v1/routers/content.mjs';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';
import { ContentQueryAliasResolver } from '#apps/content/services/ContentQueryAliasResolver.mjs';
import { ContentIdResolver } from '#apps/content/ContentIdResolver.mjs';
import { createProxyRouter } from '#api/v1/routers/proxy.mjs';
import { createLocalContentRouter } from '#api/v1/routers/localContent.mjs';
import { createPlayRouter } from '#api/v1/routers/play.mjs';
import { createListRouter } from '#api/v1/routers/list.mjs';
import { createQueueRouter } from '#api/v1/routers/queue.mjs';
import { QueueService } from '#domains/content/services/QueueService.mjs';
import { createSiblingsRouter } from '#api/v1/routers/siblings.mjs';
import { SiblingsService } from '#apps/content/services/SiblingsService.mjs';
import { PlayResponseService } from '#apps/content/services/PlayResponseService.mjs';
import { createStreamRouter } from '#api/v1/routers/stream.mjs';
import { createLocalRouter } from '#api/v1/routers/local.mjs';
import { createQueriesRouter } from '#api/v1/routers/queries.mjs';

// Fitness domain imports
import { SessionService } from '#apps/fitness/services/SessionService.mjs';
import { FitnessProgressClassifier } from '#domains/fitness/index.mjs';
import { YamlSessionDatastore } from '#adapters/persistence/yaml/YamlSessionDatastore.mjs';
import { AmbientLedAdapter } from '#adapters/fitness/AmbientLedAdapter.mjs';
import { VoiceMemoTranscriptionService } from '#adapters/fitness/VoiceMemoTranscriptionService.mjs';
import { FitnessConfigService } from '#apps/fitness/FitnessConfigService.mjs';
import { FitnessPlayableService } from '#apps/fitness/FitnessPlayableService.mjs';
import { ScreenshotService } from '#apps/fitness/services/ScreenshotService.mjs';
import { createFitnessRouter } from '#api/v1/routers/fitness.mjs';

// Home automation imports
import { TVControlAdapter } from '#adapters/home-automation/tv/TVControlAdapter.mjs';
import { KioskAdapter } from '#adapters/home-automation/kiosk/KioskAdapter.mjs';
import { TaskerAdapter } from '#adapters/home-automation/tasker/TaskerAdapter.mjs';
import { RemoteExecAdapter } from '#adapters/home-automation/remote-exec/RemoteExecAdapter.mjs';
import { createHomeAutomationRouter } from '#api/v1/routers/homeAutomation.mjs';

// Device registry imports
import { DeviceService } from '#apps/devices/services/DeviceService.mjs';
import { DeviceFactory } from '#apps/devices/services/DeviceFactory.mjs';
import { createDeviceRouter } from '#api/v1/routers/device.mjs';

// Hardware adapter imports
import { ThermalPrinterAdapter } from '#adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs';
import { TTSAdapter } from '#adapters/hardware/tts/TTSAdapter.mjs';
import { MQTTSensorAdapter } from '#adapters/hardware/mqtt-sensor/MQTTSensorAdapter.mjs';

// Proxy infrastructure imports
import { ProxyService } from './proxy/ProxyService.mjs';
import { PlexProxyAdapter } from '#adapters/proxy/PlexProxyAdapter.mjs';
import { ImmichProxyAdapter } from '#adapters/proxy/ImmichProxyAdapter.mjs';
import { AudiobookshelfProxyAdapter } from '#adapters/proxy/AudiobookshelfProxyAdapter.mjs';
import { FreshRSSProxyAdapter } from '#adapters/proxy/FreshRSSProxyAdapter.mjs';
import { KomgaProxyAdapter } from '#adapters/proxy/KomgaProxyAdapter.mjs';
import { RedditImageProxyAdapter } from '#adapters/proxy/RedditImageProxyAdapter.mjs';

// Feed domain imports
import { FreshRSSFeedAdapter } from '#adapters/feed/FreshRSSFeedAdapter.mjs';
import { RssHeadlineHarvester } from '#adapters/feed/RssHeadlineHarvester.mjs';
import { WebContentAdapter } from '#adapters/feed/WebContentAdapter.mjs';
import { YamlHeadlineCacheStore } from '#adapters/persistence/yaml/YamlHeadlineCacheStore.mjs';
import { HeadlineService } from '#apps/feed/services/HeadlineService.mjs';

// Finance domain imports
import { YamlFinanceDatastore } from '#adapters/persistence/yaml/YamlFinanceDatastore.mjs';
import { BudgetCompilationService } from '#apps/finance/BudgetCompilationService.mjs';
import { FinanceHarvestService } from '#apps/finance/FinanceHarvestService.mjs';
import { TransactionCategorizationService } from '#apps/finance/TransactionCategorizationService.mjs';
import { PayrollSyncService } from '#apps/finance/PayrollSyncService.mjs';
import { createFinanceRouter } from '#api/v1/routers/finance.mjs';

// Cost domain imports
import { CostAnalysisService } from '#domains/cost/index.mjs';
import { CostIngestionService, CostBudgetService, CostReportingService } from '#apps/cost/index.mjs';
import { YamlCostDatastore } from '#adapters/cost/YamlCostDatastore.mjs';
import createCostRouter from '#api/v1/routers/cost.mjs';

// Gratitude domain imports
import { GratitudeService } from '#domains/gratitude/services/GratitudeService.mjs';
import { YamlGratitudeDatastore } from '#adapters/persistence/yaml/YamlGratitudeDatastore.mjs';
import { GratitudeHouseholdService } from '#apps/gratitude/services/GratitudeHouseholdService.mjs';
import { createGratitudeRouter } from '#api/v1/routers/gratitude.mjs';

// Nutrition domain imports (YamlFoodLogDatastore still used by createNutribotServices)
import { YamlFoodLogDatastore } from '#adapters/persistence/yaml/YamlFoodLogDatastore.mjs';

// Messaging domain imports
import { ConversationService } from '#domains/messaging/services/ConversationService.mjs';
import { NotificationService } from '#domains/messaging/services/NotificationService.mjs';
import { YamlConversationDatastore } from '#adapters/persistence/yaml/YamlConversationDatastore.mjs';
import { TelegramAdapter } from '#adapters/messaging/TelegramAdapter.mjs';
import { GmailAdapter } from '#adapters/messaging/GmailAdapter.mjs';

// Journalist application imports
import { JournalistContainer } from '#apps/journalist/JournalistContainer.mjs';
import { YamlJournalEntryRepository } from '#adapters/persistence/yaml/YamlJournalEntryRepository.mjs';
import { YamlMessageQueueRepository } from '#adapters/persistence/yaml/YamlMessageQueueRepository.mjs';
import { DebriefRepository, LoggingAIGateway } from '#adapters/journalist/index.mjs';
import { JournalistInputRouter } from '#adapters/journalist/JournalistInputRouter.mjs';
import { createJournalistRouter } from '#api/v1/routers/journalist.mjs';

// Nutribot application imports
import { NutribotContainer } from '#apps/nutribot/NutribotContainer.mjs';
import { NutriBotConfig } from '#apps/nutribot/config/NutriBotConfig.mjs';
import { dataService } from '#system/config/index.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { YamlNutriCoachDatastore } from '#adapters/persistence/yaml/YamlNutriCoachDatastore.mjs';
import { NutribotInputRouter } from '#adapters/nutribot/index.mjs';
import { createNutribotRouter } from '#api/v1/routers/nutribot.mjs';

// Telegram bot adapters (used by journalist, homebot, nutribot router factories)
import { TelegramWebhookParser } from '#adapters/telegram/TelegramWebhookParser.mjs';
import { createBotWebhookHandler } from '#adapters/telegram/createBotWebhookHandler.mjs';

// Homebot application imports
import { HomeBotContainer } from '#apps/homebot/HomeBotContainer.mjs';
import { ConfigHouseholdAdapter, HomeBotInputRouter } from '#adapters/homebot/index.mjs';
import { createHomebotRouter } from '#api/v1/routers/homebot.mjs';

// Agents application imports
import { AgentOrchestrator, EchoAgent, Scheduler } from '#apps/agents/index.mjs';
import { HealthCoachAgent } from '#apps/agents/health-coach/index.mjs';
import { PagedMediaTocAgent } from '#apps/agents/paged-media-toc/index.mjs';
import { KomgaClient } from '#adapters/content/readable/komga/KomgaClient.mjs';
import { KomgaPagedMediaAdapter } from '#adapters/komga/KomgaPagedMediaAdapter.mjs';
import { YamlTocCacheDatastore } from '#adapters/persistence/yaml/YamlTocCacheDatastore.mjs';
import { MastraAdapter, YamlWorkingMemoryAdapter } from '#adapters/agents/index.mjs';
import { createAgentsRouter } from '#api/v1/routers/agents.mjs';

// Health domain + application imports
import { AggregateHealthUseCase } from '#apps/health/AggregateHealthUseCase.mjs';
import { YamlHealthDatastore } from '#adapters/persistence/yaml/YamlHealthDatastore.mjs';
import { createHealthRouter } from '#api/v1/routers/health.mjs';
import { createHealthDashboardRouter } from '#api/v1/routers/health-dashboard.mjs';

// Entropy application imports (uses config/logging)
import { EntropyService } from '#apps/entropy/services/EntropyService.mjs';
import { YamlEntropyReader } from '#adapters/entropy/YamlEntropyReader.mjs';
import { createEntropyRouter } from '#api/v1/routers/entropy.mjs';

// Lifelog application imports
import { LifelogAggregator } from '#apps/lifelog/LifelogAggregator.mjs';
import { createLifelogRouter } from '#api/v1/routers/lifelog.mjs';

// Static assets router
import { createStaticRouter } from '#api/v1/routers/static.mjs';

// Calendar router
import { createCalendarRouter } from '#api/v1/routers/calendar.mjs';

// Harvester application imports
import { HarvesterService, HarvesterJobExecutor } from '#apps/harvester/index.mjs';

// Harvester adapter imports
import {
  YamlLifelogDatastore,
  YamlCurrentDatastore,
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
  WithingsHarvester,
  FitnessSyncerHarvester,
  YamlAuthDatastore,
  createInfinityHarvesters
} from '#adapters/harvester/index.mjs';

// RSS Parser for Goodreads/Letterboxd harvesters
import RSSParser from 'rss-parser';

// FileIO utilities for image saving
import { saveImage as saveImageToFile, loadYamlSafe, listYamlFiles, saveYaml, deleteYaml, ensureDir, writeBinary } from './utils/FileIO.mjs';

// Additional adapters for harvesters
import { StravaClientAdapter } from '#adapters/fitness/StravaClientAdapter.mjs';
import { YamlWeatherDatastore } from '#adapters/persistence/yaml/YamlWeatherDatastore.mjs';
import { google } from 'googleapis';

// =============================================================================
// Integration Registry Bootstrap
// =============================================================================

/**
 * Singleton instances for config-driven integration loading
 */
let adapterRegistryInstance = null;
let integrationLoaderInstance = null;
let systemBotLoaderInstance = null;

/**
 * Initialize the integration system (AdapterRegistry + IntegrationLoader)
 *
 * This discovers all available adapter manifests at startup and creates
 * an IntegrationLoader for config-driven adapter instantiation.
 *
 * @param {Object} config
 * @param {Object} config.configService - ConfigService for integration config
 * @param {Object} [config.logger] - Logger instance
 * @returns {Promise<{registry: AdapterRegistry, loader: IntegrationLoader}>}
 */
export async function initializeIntegrations(config) {
  const { configService, logger = console } = config;

  // Create and discover adapters (singleton)
  if (!adapterRegistryInstance) {
    // Adapters are at backend/src/1_adapters, relative to this file (0_system/bootstrap.mjs)
    const adaptersRoot = path.resolve(__dirname, '../1_adapters');
    adapterRegistryInstance = new AdapterRegistry({ adaptersRoot });
    await adapterRegistryInstance.discover();

    const capabilities = adapterRegistryInstance.getAllCapabilities();
    logger.info?.('integrations.registry.discovered', {
      capabilities,
      providerCounts: capabilities.map(cap => ({
        capability: cap,
        providers: adapterRegistryInstance.getProviders(cap)
      }))
    });
  }

  // Create integration loader (singleton)
  if (!integrationLoaderInstance) {
    integrationLoaderInstance = new IntegrationLoader({
      registry: adapterRegistryInstance,
      configService,
      logger
    });
  }

  // Create system bot loader (singleton)
  if (!systemBotLoaderInstance) {
    systemBotLoaderInstance = new SystemBotLoader({
      configService,
      logger,
      adapterFactories: {
        telegram: (deps) => new TelegramAdapter(deps)
      }
    });
    logger.info?.('integrations.systemBotLoader.created');
  }

  return {
    registry: adapterRegistryInstance,
    loader: integrationLoaderInstance,
    botLoader: systemBotLoaderInstance
  };
}

/**
 * Load integrations for a household
 *
 * This loads all configured adapters for a household based on their
 * integrations.yml file. Returns adapters keyed by capability.
 *
 * @param {Object} config
 * @param {string} [config.householdId] - Household ID (defaults to default)
 * @param {Object} [config.httpClient] - HTTP client for adapter use
 * @param {Object} [config.logger] - Logger instance
 * @returns {Promise<Object>} Adapters keyed by capability
 */
export async function loadHouseholdIntegrations(config) {
  const { householdId, httpClient, logger = console } = config;

  if (!integrationLoaderInstance) {
    throw new Error('Integration system not initialized. Call initializeIntegrations first.');
  }

  const adapters = await integrationLoaderInstance.loadForHousehold(
    householdId,
    { httpClient }
  );

  logger.info?.('integrations.household.loaded', {
    householdId,
    capabilities: Object.keys(adapters)
  });

  return adapters;
}

/**
 * Load system-level bots from system config.
 *
 * This loads all bots defined in system/bots.yml and creates adapters
 * with tokens from system/auth/{platform}.yml.
 *
 * @param {Object} deps - Shared dependencies for bot adapters
 * @param {Object} deps.httpClient - HTTP client for API calls
 * @param {Object} [deps.transcriptionService] - Optional transcription service for voice
 * @returns {number} Number of bots loaded
 */
export function loadSystemBots(deps = {}) {
  if (!systemBotLoaderInstance) {
    // Integration system not available - return 0 to allow fallback to hardcoded adapters
    return 0;
  }

  return systemBotLoaderInstance.loadBots(deps);
}

/**
 * Get the messaging adapter for a household and app.
 *
 * Uses the household's configured messaging platform for the specified app
 * to return the appropriate bot adapter.
 *
 * @param {string} householdId - Household identifier
 * @param {string} appName - App name (nutribot, journalist, homebot, etc.)
 * @returns {Object|null} Messaging adapter or null if not configured
 */
export function getMessagingAdapter(householdId, appName) {
  if (!systemBotLoaderInstance) {
    // Integration system not available - return null to allow fallback to hardcoded adapters
    return null;
  }

  return systemBotLoaderInstance.getBotForHousehold(householdId, appName);
}

// =============================================================================
// Content Domain Bootstrap
// =============================================================================

/**
 * Create and configure the content registry
 * @param {Object} config
 * @param {string} [config.mediaBasePath] - Base path for media files
 * @param {Object} [config.plex] - Plex configuration
 * @param {string} [config.plex.host] - Plex server URL
 * @param {string} [config.plex.token] - Plex auth token
 * @param {string} [config.dataPath] - Path to data files (for LocalContentAdapter)
 * @param {string} [config.listDataPath] - Root data path for ListAdapter (household/config/lists/)
 * @param {string} [config.watchlistPath] - Path to watchlist YAML (for ListAdapter)
 * @param {Object} [config.canvas] - Canvas (displayable art) configuration
 * @param {Object} [config.canvas.filesystem] - Filesystem canvas config
 * @param {string} [config.canvas.filesystem.basePath] - Base path for art images
 * @param {Object} [config.canvas.immich] - Immich canvas config (reuses immich host/apiKey)
 * @param {string} [config.canvas.immich.library] - Immich library/album to use for art
 * @param {Object} [config.singalong] - Singalong adapter configuration (hymns, primary songs)
 * @param {string} [config.singalong.dataPath] - Path to singalong content data files
 * @param {string} [config.singalong.mediaPath] - Path to singalong content media files
 * @param {Object} [config.readalong] - Readalong adapter configuration (scripture, talks, poetry)
 * @param {string} [config.readalong.dataPath] - Path to readalong content data files
 * @param {string} [config.readalong.mediaPath] - Path to readalong content media files
 * @param {Object} deps - Dependencies
 * @param {Object} [deps.httpClient] - HTTP client for making requests
 * @param {Object} [deps.mediaProgressMemory] - Media progress memory for progress persistence
 * @param {MediaKeyResolver} [deps.mediaKeyResolver] - Media key resolver for normalizing keys
 * @param {Object} [deps.app] - Express app instance for setting canvasBasePath
 * @returns {ContentSourceRegistry}
 */
export function createContentRegistry(config, deps = {}) {
  const { httpClient, mediaProgressMemory, mediaKeyResolver, app } = deps;
  const registry = new ContentSourceRegistry();

  // Register media adapter (also handles local media browsing/roots)
  if (config.mediaBasePath) {
    registry.register(
      new FileAdapter({
        mediaBasePath: config.mediaBasePath,
        mediaProgressMemory,
        dataPath: config.dataPath || null,
        householdId: config.householdId || null,
        cacheBasePath: config.cacheBasePath || (config.dataPath ? path.join(config.dataPath, 'system/cache') : null),
        configService: deps.configService || null
      }),
      { category: mediaManifest.capability, provider: mediaManifest.provider }
    );
  }

  // Register Plex adapter if configured
  if (config.plex?.host && httpClient) {
    registry.register(
      new PlexAdapter({
        host: config.plex.host,
        token: config.plex.token,
        mediaProgressMemory,  // Inject MediaProgressMemory for watch state persistence
        mediaKeyResolver      // Inject MediaKeyResolver for normalizing media keys
      }, { httpClient }),
      { category: plexManifest.capability, provider: plexManifest.provider }
    );
  }

  // Register local content adapter (optional)
  // Note: LocalContentAdapter has no manifest - uses 'local' category
  if (config.dataPath && config.mediaBasePath) {
    registry.register(
      new LocalContentAdapter({
        dataPath: config.dataPath,
        mediaPath: config.mediaBasePath,
        mediaProgressMemory,
        householdId: config.householdId || null,
        householdsBasePath: config.householdsBasePath || null,
        contentRegistry: registry
      }),
      { category: 'local', provider: 'local-content' }
    );
  }

  // Register ListAdapter for menus/programs/watchlists as content sources
  // Handles watchlist: prefix (and menu:, program:, query:)
  // Uses listDataPath (root data path) for household/config/lists/*, not dataPath (content/)
  const listDataPath = config.listDataPath || config.dataPath;
  if (listDataPath) {
    const listAdapter = new ListAdapter({
      dataPath: listDataPath,
      householdId: config.householdId || null,
      registry,
      mediaProgressMemory,
      configService: deps.configService || null,
      nomusicLabels: config.nomusicLabels || [],
      musicOverlayPlaylist: config.musicOverlayPlaylist || null
    });
    registry.register(listAdapter, {
      category: listManifest.capability,
      provider: listManifest.provider
    });

    // Register 'watchlist' alias so registry.get('watchlist') returns ListAdapter
    registry.adapters.set('watchlist', listAdapter);
  }

  // Register QueryAdapter for saved queries (query:dailynews, etc.)
  // Reads query YAML files from household/config/lists/queries/
  let savedQueryService = null;
  if (listDataPath) {
    const queriesDir = path.join(listDataPath, 'household', 'config', 'lists', 'queries');
    savedQueryService = new SavedQueryService({
      readQuery: (name) => loadYamlSafe(path.join(queriesDir, name)),
      listQueries: () => listYamlFiles(queriesDir),
      writeQuery: (name, data) => saveYaml(path.join(queriesDir, name), data),
      deleteQuery: (name) => deleteYaml(path.join(queriesDir, name)),
    });
    const fileAdapter = registry.get('files');
    registry.register(
      new QueryAdapter({ savedQueryService, fileAdapter, mediaProgressMemory }),
      { category: queryManifest.capability, provider: queryManifest.provider }
    );
  }

  // Register FreshVideoAdapter for freshvideo: prefix (teded, kidnuz, etc.)
  // Uses FileAdapter for file listing and mediaProgressMemory for watch state
  if (config.mediaBasePath) {
    const fileAdapter = registry.get('files');
    if (fileAdapter) {
      registry.register(
        new FreshVideoAdapter({ fileAdapter, mediaProgressMemory }),
        { category: freshvideoManifest.capability, provider: freshvideoManifest.provider }
      );
    }
  }

  // Register Immich adapter if configured
  if (config.immich?.host && config.immich?.apiKey && httpClient) {
    registry.register(
      new ImmichAdapter({
        host: config.immich.host,
        apiKey: config.immich.apiKey,
        slideDuration: config.immich.slideDuration || 10
      }, { httpClient }),
      { category: immichManifest.capability, provider: immichManifest.provider }
    );
  }

  // Register Audiobookshelf adapter if configured
  if (config.audiobookshelf?.host && config.audiobookshelf?.token && httpClient) {
    registry.register(new AudiobookshelfAdapter({
      host: config.audiobookshelf.host,
      token: config.audiobookshelf.token
    }, { httpClient }));
  }

  // Register Komga adapter for comic/manga reading if configured
  if (config.komga?.host && config.komga?.apiKey && httpClient) {
    registry.register(
      new KomgaAdapter({
        host: config.komga.host,
        apiKey: config.komga.apiKey,
        proxyPath: config.komga.proxyPath
      }, { httpClient }),
      { category: komgaManifest.capability, provider: komgaManifest.provider }
    );
  }

  // Register canvas-filesystem adapter if configured
  const canvasBasePath = config.canvas?.filesystem?.basePath;
  if (canvasBasePath) {
    registry.register(new FilesystemCanvasAdapter({
      basePath: canvasBasePath,
      proxyPath: config.canvas?.proxyPath || '/api/v1/canvas/image'
    }));
    // Make basePath available to canvas image proxy endpoint
    if (app) {
      app.set('canvasBasePath', canvasBasePath);
    }
  }

  // Register canvas-immich adapter if immich is configured and canvas.immich.library is set
  if (config.immich?.host && config.immich?.apiKey && config.canvas?.immich?.library && httpClient) {
    const immichClient = new ImmichClient({
      host: config.immich.host,
      apiKey: config.immich.apiKey
    }, { httpClient });

    registry.register(new ImmichCanvasAdapter({
      library: config.canvas.immich.library,
      proxyPath: config.canvas?.immich?.proxyPath || '/api/v1/proxy/immich-canvas'
    }, { client: immichClient }));
  }

  // Register SingalongAdapter for participatory sing-along content (hymns, primary songs)
  if (config.singalong?.dataPath && config.singalong?.mediaPath) {
    registry.register(
      new SingalongAdapter({
        dataPath: config.singalong.dataPath,
        mediaPath: config.singalong.mediaPath,
        mediaProgressMemory,
        storagePaths: config.storagePaths
      }),
      { category: singalongManifest.capability, provider: singalongManifest.provider }
    );
  }

  // Register ReadalongAdapter for follow-along readalong content (scripture, talks, poetry)
  if (config.readalong?.dataPath && config.readalong?.mediaPath) {
    registry.register(
      new ReadalongAdapter({
        dataPath: config.readalong.dataPath,
        mediaPath: config.readalong.mediaPath,
        mediaPathMap: config.readalong.mediaPathMap || null,
        mediaProgressMemory,
        storagePaths: config.storagePaths
      }),
      { category: readalongManifest.capability, provider: readalongManifest.provider }
    );
  }

  // Register AppRegistryAdapter for native app content IDs (app:webcam, app:gratitude, etc.)
  // App definitions mirror the frontend registry (label + param only, no component imports).
  const appDefs = {
    webcam:            { label: 'Webcam' },
    gratitude:         { label: 'Gratitude & Hope' },
    wrapup:            { label: 'Wrap Up' },
    office_off:        { label: 'Office Off' },
    keycode:           { label: 'Key Test' },
    'family-selector': { label: 'Family Selector', param: { name: 'winner', options: 'household' } },
    glympse:           { label: 'Glympse', param: { name: 'id' } },
    websocket:         { label: 'WebSocket', param: { name: 'path' } },
  };
  registry.register(
    new AppRegistryAdapter({ apps: appDefs }),
    { category: appRegistryManifest.capability, provider: appRegistryManifest.provider }
  );

  return { registry, savedQueryService };
}

/**
 * Create media progress memory
 * @param {Object} config
 * @param {string} config.mediaProgressPath - Path for media progress files
 * @param {MediaKeyResolver} [config.mediaKeyResolver] - Media key resolver for normalizing keys
 * @returns {YamlMediaProgressMemory}
 */
export function createMediaProgressMemory(config) {
  return new YamlMediaProgressMemory({
    basePath: config.mediaProgressPath,
    mediaKeyResolver: config.mediaKeyResolver
  });
}

/**
 * Create API routers for the content domain
 * @param {Object} config
 * @param {ContentSourceRegistry} config.registry - Content source registry
 * @param {YamlMediaProgressMemory} config.mediaProgressMemory - Media progress memory
 * @param {Function} [config.loadFile] - Function to load YAML files
 * @param {Function} [config.saveFile] - Function to save YAML files
 * @param {string} [config.cacheBasePath] - Base path for image cache
 * @param {string} [config.dataPath] - Base data path for local content
 * @param {import('./proxy/ProxyService.mjs').ProxyService} [config.proxyService] - Proxy service for external services
 * @param {import('#apps/content/usecases/ComposePresentationUseCase.mjs').ComposePresentationUseCase} [config.composePresentationUseCase] - Use case for composing presentations
 * @param {Object<string, string>} [config.prefixAliases] - Prefix aliases (e.g., { hymn: 'singalong:hymn' })
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Router configuration
 */
export function createApiRouters(config) {
  const { registry, mediaProgressMemory, progressSyncService, progressSyncSources, loadFile, saveFile, cacheBasePath, dataPath, mediaBasePath, proxyService, composePresentationUseCase, configService, prefixAliases = {}, savedQueryService = null, logger = console } = config;

  // Register prefix aliases (e.g., hymn → singalong:hymn) from config
  // This enables the content API to resolve aliased prefixes via registry.resolveFromPrefix()
  if (Object.keys(prefixAliases).length > 0) {
    registry.registerPrefixAliases(prefixAliases);
    logger.debug?.('bootstrap.prefixAliases.registered', { prefixes: Object.keys(prefixAliases) });
  }

  // Scan list directories for bare name resolution (Layer 4a).
  // Priority: menu > program > watchlist (later iterations overwrite).
  const bareNameMap = {};
  const listAdapterForScan = registry.get('list');
  if (listAdapterForScan?._getAllListNames) {
    for (const [prefix, listType] of [['watchlist', 'watchlists'], ['program', 'programs'], ['menu', 'menus']]) {
      for (const name of listAdapterForScan._getAllListNames(listType)) {
        bareNameMap[name] = prefix;
      }
    }
  }

  // Create ContentIdResolver for unified content ID resolution.
  // Prefix aliases (hymn, scripture, etc.) are already registered in the registry
  // via registerPrefixAliases() above — ContentIdResolver Layer 2 resolves them.
  // systemAliases is reserved for future aliases not backed by registry prefixes.
  const contentIdResolver = new ContentIdResolver(registry, {
    systemAliases: {
      // Simple source renames (legacy names → canonical adapter names).
      // Note: "media" is handled by FileAdapter's prefix list (Layer 2).
      // "local" was removed from FileAdapter's prefix list since local:X should
      // resolve to ListAdapter (watchlist) via this alias (Layer 3), not FileAdapter.
      local: 'watchlist:',
      singing: 'singalong:',
      narrated: 'readalong:',
      list: 'menu:',
    },
    householdAliases: {},
    bareNameMap,
  });

  // Create ContentQueryAliasResolver for semantic query prefixes (music:, photos:, etc.)
  const aliasResolver = new ContentQueryAliasResolver({ registry, configService });

  // Create ContentQueryService for unified query interface
  const contentQueryService = new ContentQueryService({ registry, mediaProgressMemory, prefixAliases, logger, aliasResolver });

  // Create SiblingsService for sibling resolution
  const siblingsService = new SiblingsService({ registry, logger });

  // Create PlayResponseService for play response building and watch state reconciliation
  const playResponseService = new PlayResponseService({ mediaProgressMemory, progressSyncService, progressSyncSources });

  // Get FileAdapter from registry for local router (handles local media browsing)
  const localMediaAdapter = registry.get('files');

  return {
    routers: {
      content: createContentRouter(registry, mediaProgressMemory, { loadFile, saveFile, cacheBasePath, composePresentationUseCase, contentQueryService, logger, aliasResolver }),
      proxy: createProxyRouter({ registry, proxyService, mediaBasePath, dataPath, logger }),
      localContent: createLocalContentRouter({ registry, dataPath, mediaBasePath, mediaProgressMemory }),
      play: createPlayRouter({ registry, mediaProgressMemory, playResponseService, contentQueryService, contentIdResolver, progressSyncService, progressSyncSources, logger }),
      list: createListRouter({ registry, loadFile, configService, contentQueryService, contentIdResolver, menuMemoryPath: configService.getHouseholdPath('history/menu_memory') }),
      siblings: createSiblingsRouter({ siblingsService, contentIdResolver, logger }),
      queue: createQueueRouter({ contentIdResolver, queueService: new QueueService({ mediaProgressMemory }), logger }),
      local: createLocalRouter({ localMediaAdapter, mediaBasePath, cacheBasePath: cacheBasePath || path.join(dataPath, 'system/cache'), logger }),
      stream: createStreamRouter({
        singalongMediaPath: path.join(mediaBasePath, 'audio', 'singalong'),
        readalongAudioPath: path.join(mediaBasePath, 'audio', 'readalong'),
        readalongVideoPath: path.join(mediaBasePath, 'video', 'readalong'),
        logger
      }),
      ...(savedQueryService ? { queries: createQueriesRouter({ savedQueryService }) } : {}),
    },
    // Expose services for other routers that need them
    services: {
      contentQueryService,
      contentIdResolver,
      savedQueryService,
    }
  };
}

// =============================================================================
// Fitness Domain Bootstrap
// =============================================================================

/**
 * Create fitness domain services
 * @param {Object} config
 * @param {Object} config.configService - ConfigService instance for path resolution
 * @param {string} config.mediaRoot - Base media directory
 * @param {string} config.defaultHouseholdId - Default household ID
 * @param {Object} [config.haGateway] - Home Assistant adapter (from composition root)
 * @param {Function} config.loadFitnessConfig - Function to load fitness config for household
 * @param {Object} [config.openaiAdapter] - OpenAI adapter for voice memo transcription (from shared AI gateway)
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Fitness services
 */
export function createFitnessServices(config) {
  const {
    configService,
    mediaRoot,
    defaultHouseholdId,
    haGateway: preloadedHaGateway,
    loadFitnessConfig,
    openaiAdapter,
    logger = console
  } = config;

  // Session store and service
  const sessionStore = new YamlSessionDatastore({
    configService,
    mediaRoot
  });

  const sessionService = new SessionService({
    sessionStore,
    defaultHouseholdId
  });

  // Home automation gateway (provided by composition root)
  const haGateway = preloadedHaGateway ?? null;
  let ambientLedController = null;

  // Ambient LED controller (uses home automation gateway)
  if (haGateway) {
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

  // Voice memo transcription (optional - requires AI gateway)
  let transcriptionService = null;
  if (openaiAdapter) {
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
 * @param {Object} [config.fitnessConfig] - Fitness app config (for content_source)
 * @param {Object} [config.contentRegistry] - Content source registry (for show endpoint)
 * @param {Object} [config.contentQueryService] - ContentQueryService for watch state enrichment
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createFitnessApiRouter(config) {
  const {
    fitnessServices,
    userService,
    userDataService,
    configService,
    fitnessConfig,
    contentRegistry,
    contentQueryService,
    createReceiptCanvas,
    printerAdapter,
    logger = console
  } = config;

  // Create FitnessConfigService for normalized config access, playlist enrichment, and member names
  const fitnessConfigService = new FitnessConfigService({
    userDataService,
    configService,
    logger
  });

  // Resolve fitness content adapter from config (defaults to plex)
  const fitnessContentSource = fitnessConfig?.content_source || 'plex';
  const fitnessContentAdapter = contentRegistry?.get(fitnessContentSource);

  // Create FitnessPlayableService for show/playable orchestration
  const fitnessPlayableService = new FitnessPlayableService({
    fitnessConfigService,
    contentAdapter: fitnessContentAdapter,
    contentQueryService,
    createProgressClassifier: (cfg) => new FitnessProgressClassifier(cfg),
    logger
  });

  // Create ScreenshotService for session screenshot handling
  const screenshotService = new ScreenshotService({
    sessionService: fitnessServices.sessionService,
    fileIO: { ensureDir, writeBinary },
    logger
  });

  return createFitnessRouter({
    sessionService: fitnessServices.sessionService,
    zoneLedController: fitnessServices.ambientLedController,
    transcriptionService: fitnessServices.transcriptionService,
    screenshotService,
    fitnessConfigService,
    fitnessPlayableService,
    fitnessContentAdapter,
    userService,
    configService,
    contentRegistry,  // Still needed for playlist thumbnail enrichment
    createReceiptCanvas,
    printerAdapter,
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
 * Create feed domain services (FreshRSS reader + headline harvesting)
 * @param {Object} config
 * @param {Object} config.dataService - DataService for YAML I/O
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {string} config.freshrssHost - FreshRSS server URL
 * @param {Object} [config.logger]
 * @returns {{ freshRSSAdapter, headlineService, feedRouter, headlineHarvestJob }}
 */
export function createFeedServices(config) {
  const { dataService, configService, freshrssHost, logger = console } = config;

  const freshRSSAdapter = new FreshRSSFeedAdapter({
    freshrssHost,
    dataService,
    logger,
  });

  const rssParser = new RSSParser({
    customFields: {
      item: [
        ['media:content', 'media:content', { keepArray: true }],
        ['media:thumbnail', 'media:thumbnail'],
      ]
    }
  });
  const harvester = new RssHeadlineHarvester({ rssParser, logger });

  const headlineStore = new YamlHeadlineCacheStore({ dataService, logger });

  const webContentGateway = new WebContentAdapter({ logger });

  const headlineService = new HeadlineService({
    headlineStore,
    harvester,
    dataService,
    config: {
      configPath: 'config/feed',
      defaults: { retentionHours: 48, maxPerSource: 10, dedupeWordCount: 8 },
    },
    webContentGateway,
    logger,
  });

  // Harvest job for manual or scheduled triggering
  const headlineHarvestJob = async () => {
    const username = configService.getHeadOfHousehold();
    return headlineService.harvestAll(username);
  };

  // Note: feedRouter is created in app.mjs after FeedAssemblyService is wired
  return { freshRSSAdapter, headlineService, headlineHarvestJob };
}

/**
 * Create finance domain services
 * @param {Object} config
 * @param {Object} config.configService - ConfigService instance for path resolution
 * @param {Object} [config.buxferAdapter] - Buxfer adapter (from composition root)
 * @param {Object} [config.aiGateway] - AI gateway for transaction categorization
 * @param {Object} [config.httpClient] - HTTP client for payroll sync
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Finance services
 */
export function createFinanceServices(config) {
  const {
    configService,
    buxferAdapter: preloadedBuxferAdapter,
    aiGateway,
    httpClient,
    defaultHouseholdId,
    logger = console
  } = config;

  // Finance store (YAML persistence)
  const financeStore = new YamlFinanceDatastore({
    configService
  });

  // Buxfer adapter (provided by composition root)
  const buxferAdapter = preloadedBuxferAdapter ?? null;

  // Budget compilation service
  const compilationService = new BudgetCompilationService({
    financeStore,
    logger
  });

  // Transaction categorization service (optional - requires AI gateway AND buxfer adapter)
  let categorizationService = null;
  if (aiGateway && buxferAdapter) {
    const categorizationConfig = financeStore.getCategorizationConfig(defaultHouseholdId);
    if (categorizationConfig) {
      categorizationService = new TransactionCategorizationService({
        aiGateway,
        transactionSource: buxferAdapter,
        financeStore,
        logger
      });
      logger.info?.('finance.categorization.enabled', { validTags: categorizationConfig.validTags?.length || 0 });
    } else {
      logger.warn?.('finance.categorization.skipped', { reason: 'no_config', householdId: defaultHouseholdId });
    }
  } else {
    logger.warn?.('finance.categorization.skipped', { reason: aiGateway ? 'no_buxfer_adapter' : 'no_ai_gateway' });
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
      transactionGateway: buxferAdapter,
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
// Cost Domain Bootstrap
// =============================================================================

/**
 * Create cost domain services
 *
 * @param {Object} config
 * @param {string} config.dataRoot - Base directory for cost data storage (required)
 * @param {Object} [config.budgetRepository] - Budget repository (for budget evaluation)
 * @param {Object} [config.alertGateway] - Alert gateway for budget notifications
 * @param {Object} [config.sources] - Array of ICostSource adapters
 * @param {Object} [config.logger] - Logger instance
 * @returns {{ costDatastore: YamlCostDatastore, analysisService: CostAnalysisService, ingestionService: CostIngestionService, budgetService: CostBudgetService, reportingService: CostReportingService }}
 *
 * @example
 * const { reportingService, budgetService } = createCostServices({
 *   dataRoot: '/data/household/cost',
 *   logger
 * });
 */
export function createCostServices(config) {
  const {
    dataRoot,
    budgetRepository,
    alertGateway,
    sources = [],
    logger = console
  } = config;

  // Cost datastore (YAML persistence)
  const costDatastore = new YamlCostDatastore({ dataRoot });

  // Domain service (stateless)
  const analysisService = new CostAnalysisService();

  // Budget service (optional - requires budget repository)
  let budgetService = null;
  if (budgetRepository) {
    budgetService = new CostBudgetService({
      budgetRepository,
      costRepository: costDatastore,
      alertGateway,
      analysisService,
      logger
    });
  }

  // Ingestion service
  const ingestionService = new CostIngestionService({
    costRepository: costDatastore,
    budgetService,
    sources,
    logger
  });

  // Reporting service
  const reportingService = new CostReportingService({
    costRepository: costDatastore,
    budgetService,
    analysisService,
    logger
  });

  return {
    costDatastore,
    analysisService,
    ingestionService,
    budgetService,
    reportingService
  };
}

/**
 * Create cost API router
 *
 * @param {Object} config
 * @param {Object} config.costServices - Services from createCostServices
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createCostApiRouter(config) {
  const {
    costServices,
    logger = console
  } = config;

  return createCostRouter({
    reportingService: costServices.reportingService,
    budgetService: costServices.budgetService,
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

  // Register Komga adapter if configured
  if (config.komga?.host) {
    proxyService.register(new KomgaProxyAdapter(
      { host: config.komga.host, apiKey: config.komga.apiKey },
      { logger }
    ));
  }

  // Register Reddit image proxy (no config needed — proxies public CDNs)
  proxyService.register(new RedditImageProxyAdapter({ logger }));

  return proxyService;
}

// =============================================================================
// Home Automation Bootstrap
// =============================================================================

/**
 * Create home automation adapters
 * @param {Object} config
 * @param {Object} [config.haGateway] - Home Assistant adapter (from composition root)
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
  const { logger = console, haGateway: preloadedHaGateway } = config;

  // Home Assistant gateway (provided by composition root)
  const haGateway = preloadedHaGateway ?? null;
  let tvAdapter = null;

  // TV control adapter (uses HA gateway)
  if (haGateway) {
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
// Device Registry Bootstrap
// =============================================================================

/**
 * Create device registry services
 * @param {Object} config
 * @param {Object} config.devicesConfig - Device configurations keyed by device ID
 * @param {Object} config.haGateway - Home Assistant gateway (for device_control)
 * @param {Object} [config.httpClient] - HTTP client for Fully Kiosk API
 * @param {Object} [config.wsBus] - WebSocket broadcast service
 * @param {Object} [config.remoteExec] - Remote execution service (for SSH)
 * @param {string} [config.daylightHost] - Base URL for content loading
 * @param {Object} [config.configService] - ConfigService for auth lookups
 * @param {Object} [config.logger] - Logger instance
 * @returns {Promise<Object>} Device services { deviceService, deviceFactory }
 */
export async function createDeviceServices(config) {
  const {
    devicesConfig,
    haGateway,
    httpClient,
    wsBus,
    remoteExec,
    daylightHost,
    configService,
    logger = console
  } = config;

  // Create device factory with all capability adapters
  const deviceFactory = new DeviceFactory({
    haGateway,
    httpClient,
    wsBus,
    remoteExec,
    daylightHost,
    configService,
    logger
  });

  // Create device service
  const deviceService = new DeviceService(
    {},
    { deviceFactory, logger }
  );

  // Initialize devices from config
  await deviceService.initialize(devicesConfig);

  logger.info?.('devices.bootstrap.complete', {
    deviceCount: deviceService.listDevices().length
  });

  return {
    deviceService,
    deviceFactory
  };
}

/**
 * Create device API router
 * @param {Object} config
 * @param {Object} config.deviceServices - Services from createDeviceServices
 * @param {import('#system/config/index.mjs').ConfigService} [config.configService] - Config service for device configuration
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createDeviceApiRouter(config) {
  const {
    deviceServices,
    configService,
    logger = console
  } = config;

  return createDeviceRouter({
    deviceService: deviceServices.deviceService,
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
 * @param {Object} config.httpClient - HTTP client for API requests
 * @param {Object} [config.logger] - Logger instance
 * @returns {TTSAdapter}
 */
export function createTTSAdapterInstance(config) {
  const { logger = console, httpClient, ...ttsConfig } = config;
  return new TTSAdapter(ttsConfig, { httpClient, logger });
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
 * @param {Object} [config.httpClient] - HTTP client for API requests
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Hardware adapters
 */
export function createHardwareAdapters(config) {
  const { logger = console, httpClient } = config;

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

  // TTS adapter (optional - requires OpenAI API key and httpClient)
  let ttsAdapter = null;
  if (config.tts?.apiKey && httpClient) {
    ttsAdapter = new TTSAdapter(
      {
        apiKey: config.tts.apiKey,
        model: config.tts.model,
        defaultVoice: config.tts.defaultVoice
      },
      { httpClient, logger }
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

// =============================================================================
// Gratitude Domain Bootstrap
// =============================================================================

/**
 * Create gratitude domain services
 * @param {Object} config
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Gratitude services
 */
export function createGratitudeServices(config) {
  const { logger = console } = config;

  // Gratitude store (YAML persistence)
  const gratitudeStore = new YamlGratitudeDatastore({
    dataService,
    logger
  });

  // Gratitude service
  const gratitudeService = new GratitudeService({
    store: gratitudeStore
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
 * @param {Function} [config.createGratitudeCardCanvas] - Function to generate gratitude card canvas
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createGratitudeApiRouter(config) {
  const {
    gratitudeServices,
    configService,
    broadcastToWebsockets,
    printerAdapter,
    createGratitudeCardCanvas,
    logger = console
  } = config;

  // Application service for household-related helpers
  const gratitudeHouseholdService = new GratitudeHouseholdService({
    configService,
    gratitudeService: gratitudeServices.gratitudeService
  });

  return createGratitudeRouter({
    gratitudeService: gratitudeServices.gratitudeService,
    configService,
    gratitudeHouseholdService,
    broadcastToWebsockets,
    printerAdapter,
    createGratitudeCardCanvas,
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
  const conversationStore = new YamlConversationDatastore({
    userDataService,
    logger
  });

  // Conversation service
  const conversationService = new ConversationService({
    conversationStore
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
    dataService,
    userResolver,
    configService,
    logger
  });

  // Message queue repository (YAML persistence)
  const messageQueueRepository = new YamlMessageQueueRepository({
    dataService: userDataService,
    userResolver,
    logger
  });

  // Get journalist config from config service
  const journalistConfig = {
    username: configService?.getHeadOfHousehold?.() || 'kckern',
    dataDir: configService?.getDataDir?.() || './data',
    getUserTimezone: (userId) => configService?.getHouseholdTimezone?.(configService?.getUserHouseholdId?.(userId)) || 'America/Los_Angeles'
  };

  // Debrief repository (YAML persistence)
  const debriefRepository = new DebriefRepository({
    dataPath: `${journalistConfig.dataDir}/users/${journalistConfig.username}/lifelog/journalist`,
    logger
  });

  // Create journalist container with all dependencies
  const journalistContainer = new JournalistContainer(journalistConfig, {
    messagingGateway: telegramAdapter,
    aiGateway,
    journalEntryRepository,
    messageQueueRepository,
    conversationStateStore,
    quizRepository,
    userResolver,
    userDataService,
    debriefRepository,
    loggingAIGatewayFactory: (deps) => new LoggingAIGateway({
      ...deps,
      saveFile: (relativePath, data) => {
        // Save relative to user's lifelog directory
        // relativePath is "journalist/last_gpt.yml", we need "lifelog/journalist/last_gpt.yml"
        const dataPath = `lifelog/${relativePath}`;
        userDataService.writeUserData?.(deps.username, dataPath, data);
      }
    }),
    logger
  });

  return {
    journalEntryRepository,
    messageQueueRepository,
    journalistContainer
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
    userIdentityService,
    telegramIdentityAdapter,
    botId,
    secretToken,
    gateway,
    logger = console
  } = config;

  // Create webhook parser and input router
  const webhookParser = botId ? new TelegramWebhookParser({ botId, logger }) : null;
  const inputRouter = new JournalistInputRouter(journalistServices.journalistContainer, { userResolver, userIdentityService, logger });

  // Build webhook handler (adapter layer concern, not API layer)
  const webhookHandler = (webhookParser && inputRouter)
    ? createBotWebhookHandler({
        botName: 'journalist',
        botId,
        parser: webhookParser,
        inputRouter,
        gateway,
        logger,
      })
    : null;

  return createJournalistRouter(journalistServices.journalistContainer, {
    webhookHandler,
    telegramIdentityAdapter,
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
 * @param {Object} config.gratitudeService - GratitudeService instance
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
    gratitudeService,
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
    gratitudeService,
    conversationStateStore,
    householdRepository,
    websocketBroadcast,
    logger
  });

  return {
    homebotContainer,
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
    userIdentityService,
    telegramIdentityAdapter,
    botId,
    secretToken,
    gateway,
    createTelegramWebhookHandler,
    middleware,
    logger = console
  } = config;

  // Create webhook parser and input router
  const webhookParser = botId ? new TelegramWebhookParser({ botId, logger }) : null;
  const inputRouter = new HomeBotInputRouter(homebotServices.homebotContainer, { userResolver, userIdentityService, logger });

  // Build webhook handler (adapter layer concern, not API layer)
  const webhookHandler = (webhookParser && inputRouter)
    ? createBotWebhookHandler({
        botName: 'homebot',
        botId,
        parser: webhookParser,
        inputRouter,
        gateway,
        logger,
      })
    : null;

  return createHomebotRouter(homebotServices.homebotContainer, {
    webhookHandler,
    telegramIdentityAdapter,
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
 * @param {Object} config.configService - ConfigService instance for path resolution
 * @param {Object} config.userDataService - UserDataService instance
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
export async function createNutribotServices(config) {
  const {
    configService,
    userDataService,
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
  const foodLogStore = new YamlFoodLogDatastore({
    configService,
    logger
  });

  // Nutrient list store (YAML persistence)
  const nutriListStore = new YamlNutriListDatastore({
    userDataService,
    logger
  });

  // Coaching store (YAML persistence)
  const nutriCoachStore = new YamlNutriCoachDatastore({
    configService,
    logger
  });

  // Barcode image generator (for UPC photo status)
  const { BarcodeImageAdapter } = await import('#adapters/nutribot/BarcodeImageAdapter.mjs');
  const barcodeGenerator = new BarcodeImageAdapter({ logger });

  // Build food icon list from available icon files on disk
  const foodIconDir = configService.getPath('icons') + '/food';
  let foodIconsString = 'apple banana bread cheese chicken default';
  try {
    const { readdirSync } = await import('fs');
    const iconFiles = readdirSync(foodIconDir)
      .filter(f => f.endsWith('.png'))
      .map(f => f.replace('.png', ''))
      .sort();
    if (iconFiles.length > 0) {
      foodIconsString = iconFiles.join(' ');
      logger.info?.('nutribot.icons.loaded', { count: iconFiles.length, dir: foodIconDir });
    }
  } catch (e) {
    logger.warn?.('nutribot.icons.readFailed', { dir: foodIconDir, error: e.message });
  }

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
    barcodeGenerator,
    foodIconsString,
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
    userIdentityService,
    telegramIdentityAdapter,
    botId,
    secretToken,
    gateway,
    logger = console
  } = config;

  // Create webhook parser and input router
  const webhookParser = botId ? new TelegramWebhookParser({ botId, logger }) : null;
  const inputRouter = new NutribotInputRouter(nutribotServices.nutribotContainer, {
    userResolver,
    userIdentityService,
    config: nutribotServices.nutribotContainer.getConfig?.(),
    logger,
  });

  // Build webhook handler (adapter layer concern, not API layer)
  const webhookHandler = (webhookParser && inputRouter)
    ? createBotWebhookHandler({
        botName: 'nutribot',
        botId,
        parser: webhookParser,
        inputRouter,
        gateway,
        logger,
      })
    : null;

  return createNutribotRouter(nutribotServices.nutribotContainer, {
    webhookHandler,
    telegramIdentityAdapter,
    defaultMember: config.defaultMember,
    botId,
    secretToken,
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
    dataService,
    userDataService,
    userResolver,
    configService,
    logger = console
  } = config;

  // Health store (YAML persistence)
  // YamlHealthDatastore uses dataService.user.read() API
  const healthStore = new YamlHealthDatastore({
    dataService,
    userResolver,
    configService,
    logger
  });

  // Health aggregation use case (application layer)
  const healthService = new AggregateHealthUseCase({
    healthStore
  });

  // NutriList store for nutrilist endpoints (optional, requires userDataService)
  let nutriListStore = null;
  if (userDataService) {
    nutriListStore = new YamlNutriListDatastore({
      userDataService,
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

/**
 * Create health dashboard API router
 * @param {Object} config
 * @param {Object} config.dataService - DataService for YAML persistence
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHealthDashboardApiRouter(config) {
  const {
    dataService,
    logger = console
  } = config;

  return createHealthDashboardRouter({
    dataService,
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
// Agents Application Bootstrap
// =============================================================================

/**
 * Create agents API router
 * @param {Object} config
 * @param {Object} [config.logger] - Logger instance
 * @param {Object} [config.healthStore] - YamlHealthDatastore for health data persistence
 * @param {Object} [config.healthService] - AggregateHealthUseCase for health aggregation
 * @param {Object} [config.fitnessPlayableService] - FitnessPlayableService for episode browsing
 * @param {Object} [config.sessionService] - SessionService for fitness session history
 * @param {Object} [config.mediaProgressMemory] - YamlMediaProgressMemory for watch history
 * @param {Object} [config.dataService] - DataService for user data read/write
 * @param {Object} [config.configService] - ConfigService for household/user config
 * @returns {express.Router}
 */
export function createAgentsApiRouter(config) {
  const {
    logger = console,
    healthStore,
    healthService,
    fitnessPlayableService,
    sessionService,
    mediaProgressMemory,
    dataService,
    configService,
    aiGateway,
    httpClient,
  } = config;

  // Mastra reads API keys from process.env — bridge from ConfigService
  if (configService) {
    const openaiKey = configService.getSecret('OPENAI_API_KEY');
    if (openaiKey && !process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = openaiKey;
    }
  }

  // Create Mastra adapter (IAgentRuntime implementation)
  const agentRuntime = new MastraAdapter({ logger });

  // Create working memory adapter for agent state persistence
  const workingMemory = new YamlWorkingMemoryAdapter({ dataService, logger });

  // Create orchestrator
  const agentOrchestrator = new AgentOrchestrator({ agentRuntime, logger });

  // Create scheduler for cron-triggered assignments
  const scheduler = new Scheduler({ logger });

  // Register available agents
  agentOrchestrator.register(EchoAgent);

  // Register health coach agent (requires health services)
  if (healthStore && healthService) {
    agentOrchestrator.register(HealthCoachAgent, {
      workingMemory,
      healthStore,
      healthService,
      fitnessPlayableService,
      sessionService,
      mediaProgressMemory,
      dataService,
      configService,
    });
  }

  // Register paged-media-toc agent (requires AI gateway + paged media server access)
  if (aiGateway && dataService && configService) {
    const komgaAuth = configService.getHouseholdAuth('komga');
    const komgaHost = configService.resolveServiceUrl('komga');
    if (komgaHost && komgaAuth?.token) {
      const komgaClient = new KomgaClient(
        { host: komgaHost, apiKey: komgaAuth.token },
        { httpClient, logger }
      );
      const pagedMediaGateway = new KomgaPagedMediaAdapter({
        client: komgaClient,
        apiKey: komgaAuth.token,
        logger,
      });
      const tocCacheDatastore = new YamlTocCacheDatastore({ dataService, configService });
      agentOrchestrator.register(PagedMediaTocAgent, {
        workingMemory,
        aiGateway,
        pagedMediaGateway,
        tocCacheDatastore,
      });
    }
  }

  // Register scheduled assignments for all agents
  for (const agent of agentOrchestrator.listInstances()) {
    scheduler.registerAgent(agent, agentOrchestrator);
  }

  logger.info?.('agents.bootstrap.complete', {
    registeredAgents: agentOrchestrator.list().map(a => a.id),
    scheduledJobs: scheduler.list(),
  });

  return createAgentsRouter({ agentOrchestrator, workingMemory, scheduler, logger });
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
 * @param {Object} [config.dataService] - DataService for hierarchical data access (weather datastore)
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Harvester services { harvesterService, jobExecutor, lifelogStore }
 */
export function createHarvesterServices(config) {
  const {
    io,
    httpClient,
    configService,
    userDataService,
    dataService,
    todoistApi,
    stravaClient: stravaClientParam,
    authStore: authStoreParam,
    currentStore,
    aiGateway,
    rssParser,
    sharedStore: sharedStoreParam,
    gmailClientFactory,
    buxferAdapter: preloadedBuxferAdapter,
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
  const lifelogStore = new YamlLifelogDatastore({ io, logger });

  // Create current store for state tracking (used by Todoist, ClickUp, Gmail, GCal)
  // Uses provided currentStore or creates one from io
  const effectiveCurrentStore = currentStore || new YamlCurrentDatastore({ io, logger });

  // Create or use provided stravaClient
  const stravaClient = stravaClientParam || (httpClient ? new StravaClientAdapter({
    httpClient,
    configService,
    logger,
  }) : null);

  // Create or use provided authStore (for OAuth token persistence)
  // Use YamlAuthDatastore when io.userSaveAuth is available, otherwise fallback to stub
  const authStore = authStoreParam || (io?.userSaveAuth ? new YamlAuthDatastore({ io, logger }) : {
    async load(username, provider) {
      return configService?.getUserAuth?.(provider, username) || null;
    },
    async save(username, provider, tokenData) {
      // Auth store save is a no-op when userSaveAuth is not available
      logger.warn?.('authStore.save.noop', { username, provider, reason: 'userSaveAuth not available' });
    },
  });

  // Create or use provided sharedStore (for weather data)
  // Note: YamlWeatherDatastore requires DataService (with .household.write), not UserDataService
  const sharedStore = sharedStoreParam || (dataService ? new YamlWeatherDatastore({
    dataService,
    configService,
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

  // AI gateway (provided by composition root)
  const effectiveAiGateway = aiGateway ?? null;

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
      currentStore: effectiveCurrentStore,
      configService,
      logger,
    }));
  }

  // ClickUp - requires httpClient
  if (httpClient) {
    registerHarvester('clickup', () => new ClickUpHarvester({
      httpClient,
      lifelogStore,
      currentStore: effectiveCurrentStore,
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

  // Create shared RSS parser for feed-based harvesters with custom field support
  const rssParserInstance = rssParser || new RSSParser({
    customFields: {
      item: [
        ['letterboxd:watchedDate', 'letterboxd:watchedDate'],
        ['letterboxd:filmTitle', 'letterboxd:filmTitle'],
        ['letterboxd:filmYear', 'letterboxd:filmYear'],
        ['letterboxd:memberRating', 'letterboxd:memberRating'],
        ['letterboxd:rewatch', 'letterboxd:rewatch'],
        ['letterboxd:memberLike', 'letterboxd:memberLike'],
        ['tmdb:movieId', 'tmdb:movieId'],
        ['gr:book_id', 'gr:book_id'],
        ['gr:author_name', 'gr:author_name'],
        ['gr:user_rating', 'gr:user_rating'],
        ['gr:user_read_at', 'gr:user_read_at'],
        ['gr:user_shelves', 'gr:user_shelves']
      ]
    }
  });

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
      currentStore: effectiveCurrentStore,
      configService,
      logger,
    }));
  }

  // Google Calendar - requires httpClient
  if (httpClient) {
    registerHarvester('gcal', () => new GCalHarvester({
      httpClient,
      lifelogStore,
      currentStore: effectiveCurrentStore,
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

  // Buxfer adapter (provided by composition root)
  const buxferAdapter = preloadedBuxferAdapter ?? null;
  if (buxferAdapter) {
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
      fitnessHistoryDir: configService.getHouseholdPath('history/fitness'),
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

  // FitnessSyncer - requires httpClient and authStore
  if (httpClient && authStore) {
    registerHarvester('fitsync', () => new FitnessSyncerHarvester({
      httpClient,
      lifelogStore,
      authStore,
      configService,
      timezone: configService?.getTimezone?.() || 'America/New_York',
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

  // Infinity - dynamic table harvesters (requires httpClient)
  if (httpClient) {
    try {
      const infinityHarvesters = createInfinityHarvesters({
        httpClient,
        configService,
        io,
        logger,
      });
      for (const harvester of infinityHarvesters) {
        harvesterService.register(harvester);
        logger.debug?.('harvester.bootstrap.registered', { serviceId: harvester.serviceId });
      }
    } catch (error) {
      logger.warn?.('harvester.bootstrap.infinity.skipped', { reason: error.message });
    }
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
