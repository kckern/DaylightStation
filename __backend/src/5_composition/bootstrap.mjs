import {registerPianoJamCorderHarvester} from '../../../__app_modules/learning/piano/server/composition/jamcorder-harvester.mjs';
import { registerPianoAudioHarvesters } from "../../../__app_modules/learning/piano/server/composition/audio-harvesters.mjs";
import { createHarvestedLifelogAggregator } from '../../../__capabilities/lifelog/server/composition.mjs';
import {contentRequiresCamera} from './policies/contentRequiresCamera.mjs';
import { createLifelogServices as owned_createLifelogServices } from "../../../__capabilities/lifelog/server/composition.mjs";
import { createHomeAutomationAdapters as owned_createHomeAutomationAdapters } from "../../../__capabilities/home-control/server/composition.mjs";
import { createCameraServices as owned_createCameraServices } from "../../../__app_modules/household/camera/server/composition.mjs";
import { createFinanceServices as owned_createFinanceServices } from "../../../__app_modules/money/finance/server/composition.mjs";
import { createFeedServices as owned_createFeedServices } from "../../../__app_modules/media/feed/server/composition.mjs";
import { createAgentRuntimeServices } from '../../../__capabilities/agent-runtime/server/composition.mjs';
import { registerLifeplanGuide } from '../../../__app_modules/personal/life/server/agent-registration.mjs';
import { registerPagedMediaToc } from '../../../__app_modules/media/media/server/agent-registration.mjs';
import { createConciergeServices as createConciergeModule } from '../../../__app_modules/household/concierge/server/composition.mjs';
import {relocatedProviderManifests} from './integrations/providerManifests.mjs';
import {pianoCurriculumEnrichment,configurePianoCurriculum} from '../../../__app_modules/learning/piano/server/composition/plex-curriculum.mjs';

import { createHomebotServices as createOwnedHomebotServices } from '../../../__app_modules/household/homebot/server/composition.mjs';
import { createJournalistServices as createOwnedJournalistServices } from '../../../__app_modules/personal/journalist/server/composition.mjs';
import { createNewsReporterServices as createOwnedNewsReporterServices } from '../../../__app_modules/media/newsreporter/server/composition.mjs';
import { createHealthCoachingContext, registerHealthCoaching } from "../../../__app_modules/wellness/health/server/composition/coaching.mjs";
// __backend/src/5_composition/bootstrap.mjs

import { scopedGateway } from '#apps/common/ports/IAIGateway.mjs';
import path from 'path';

import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Integration registry imports
import { AdapterRegistry } from '#composition/integrations/AdapterRegistry.mjs';
import { IntegrationLoader } from '#composition/integrations/IntegrationLoader.mjs';
import { SystemBotLoader } from '#composition/integrations/SystemBotLoader.mjs';

// EventBus imports
import { WebSocketEventBus } from '#adapters/eventbus/WebSocketEventBus.mjs';
import { HttpClient } from '#system/services/HttpClient.mjs';
import { canRotateOAuthTokens } from '#system/runtime/runtimeEnvironment.mjs';
import { PrewarmHttpStatusClient } from "../../../__capabilities/content-catalog/server/adapters/PrewarmHttpStatusClient.mjs";
import { ReadOnlyConfigAuthStore } from '#adapters/auth/ReadOnlyConfigAuthStore.mjs';
import { GoogleGmailClientFactory } from '#adapters/google/GoogleGmailClientFactory.mjs';
import { InMemoryNotificationStore } from '#adapters/messaging/InMemoryNotificationStore.mjs';





// Content domain imports





























import { YamlMediaProgressMemory } from "../../../__capabilities/playback/server/adapters/persistence/YamlMediaProgressMemory.mjs";




// Content adapter manifests (for category/provider metadata)






















import { QueueService } from "../../../__capabilities/playback/server/application/services/QueueService.mjs";








// Fitness domain imports

















import { VoiceTranscriptionService } from '#adapters/ai/VoiceTranscriptionService.mjs';

import { languageTranscriptionProfile } from '#adapters/ai/transcriptionProfiles/language.mjs';

import { EntropyConfigProjection } from "#adapters/config/ApplicationConfigProjections.mjs";





















// Home automation imports






import { HaSensorDisplayPowerCheck } from "../../../__capabilities/home-control/server/adapters/HaSensorDisplayPowerCheck.mjs";
import { DisplayReadinessPolicy } from '#apps/devices/services/DisplayReadinessPolicy.mjs';
import { createNoOpDisplayPowerCheck } from "../../../__capabilities/home-control/server/application/ports/IDisplayPowerCheck.mjs";




// Playback Hub domain imports




import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';
import { TranscodePrewarmService } from '#apps/devices/services/TranscodePrewarmService.mjs';
import { DispatchIdempotencyService } from '#apps/devices/services/DispatchIdempotencyService.mjs';
import {
  createDeviceLivenessService as createDeviceLivenessServiceFactory,
  getDeviceLivenessService as getDeviceLivenessServiceInstance,
  stopDeviceLivenessService as stopDeviceLivenessServiceInstance,
} from './modules/deviceLiveness.mjs';

// Device registry imports
import { DeviceService } from '#apps/devices/services/DeviceService.mjs';
import { DeviceFactory } from '#apps/devices/services/DeviceFactory.mjs';

import { ConfigDeviceBlueprintFactory } from '#composition/modules/ConfigDeviceBlueprintFactory.mjs';
import { HomeAssistantDeviceAdapter } from '#adapters/devices/HomeAssistantDeviceAdapter.mjs';
import { FullyKioskContentAdapter } from '#adapters/devices/FullyKioskContentAdapter.mjs';
import { FullyKioskVolumeAdapter } from '#adapters/devices/FullyKioskVolumeAdapter.mjs';
import { WebSocketContentAdapter } from '#adapters/devices/WebSocketContentAdapter.mjs';
import { SshOsAdapter } from '#adapters/devices/SshOsAdapter.mjs';
import { AdbAdapter } from '#adapters/devices/AdbAdapter.mjs';
import { ResilientContentAdapter } from '#adapters/devices/ResilientContentAdapter.mjs';
import { ScreenAddressResolver } from '#adapters/devices/ScreenAddressResolver.mjs';

// Camera imports






// Trigger domain + application imports




// Hardware adapter imports
// Note: ThermalPrinterAdapter/Registry are constructed directly in app.mjs; bootstrap no longer imports them.
import { OpenAITTSAdapter } from '#adapters/ai/OpenAITTSAdapter.mjs';
import { MQTTSensorAdapter } from '#adapters/hardware/mqtt-sensor/MQTTSensorAdapter.mjs';
import { MQTTSelectorAdapter } from '#adapters/hardware/mqtt-selector/MQTTSelectorAdapter.mjs';


// Proxy infrastructure imports
import { ProxyService } from '#system/proxy/ProxyService.mjs';
import { PlexProxyAdapter } from '#adapters/proxy/PlexProxyAdapter.mjs';
import { ImmichProxyAdapter } from '#adapters/proxy/ImmichProxyAdapter.mjs';
import { AudiobookshelfProxyAdapter } from '#adapters/proxy/AudiobookshelfProxyAdapter.mjs';
import { FreshRSSProxyAdapter } from '#adapters/proxy/FreshRSSProxyAdapter.mjs';
import { KomgaProxyAdapter } from '#adapters/proxy/KomgaProxyAdapter.mjs';
import { RedditImageProxyAdapter } from '#adapters/proxy/RedditImageProxyAdapter.mjs';

// Feed domain imports









// Finance domain imports









// Cost domain imports
import { CostAnalysisService } from '#domains/cost/index.mjs';
import { CostIngestionService, CostBudgetService, CostReportingService } from '#apps/cost/index.mjs';
import { YamlCostDatastore } from '#adapters/cost/YamlCostDatastore.mjs';




// Nutrition domain imports (YamlFoodLogDatastore still used by createNutribotServices)


// Messaging domain imports
import { ConversationService } from '#apps/messaging/services/ConversationService.mjs';
import { NotificationService } from '#apps/messaging/services/NotificationService.mjs';
import { YamlConversationDatastore } from '#adapters/persistence/yaml/YamlConversationDatastore.mjs';
import { TelegramAdapter } from '#adapters/messaging/TelegramAdapter.mjs';
import { GmailAdapter } from '#adapters/messaging/GmailAdapter.mjs';

// Journalist application imports







// Nutribot application imports











import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import crypto from 'node:crypto';


// Telegram bot adapters (used by journalist, homebot, nutribot router factories)



// Homebot application imports




// Agents application imports
























import { AgentExecutionPolicy }         from "../../../__capabilities/agent-runtime/server/application/framework/AgentExecutionPolicy.mjs";

import { KomgaClient } from "../../../__capabilities/content-catalog/server/adapters/providers/readable/komga/KomgaClient.mjs";


import { AgentTranscriptFileStore, MastraAdapter } from "../../../__capabilities/agent-runtime/server/adapters/index.mjs";

// NewsReporter imports (adapters/renderer constructed here; container receives instances)







// Health domain + application imports











// Entropy application imports (uses config/logging)
import { EntropyService } from '#apps/entropy/services/EntropyService.mjs';
import { YamlEntropyReader } from '#adapters/entropy/YamlEntropyReader.mjs';


// Lifelog application imports


// Static assets router


// Calendar router


// Harvester application imports
import { HarvesterService, HarvesterJobExecutor } from '#apps/harvester/index.mjs';
import { WeightProcessor } from "../../../__app_modules/wellness/health/server/application/health/analytics/WeightProcessor.mjs";

// Harvester adapter imports
import { YamlLifelogDatastore, YamlCurrentDatastore, TodoistHarvester, ClickUpHarvester, GitHubHarvester, LastfmHarvester, RedditHarvester, LetterboxdHarvester, GoodreadsHarvester, FoursquareHarvester, GmailHarvester, GCalHarvester, ShoppingHarvester, BuxferHarvester, WeatherHarvester, StravaHarvester, WithingsHarvester, FitnessSyncerHarvester, YamlAuthDatastore, createInfinityHarvesters } from "#adapters/harvester/index.mjs";

// MIDI recording harvest: vendor (JamCorder) adapters + vendor-neutral use case

// Piano MIDI→MP3 adapters + use case (daily render of media/midi/piano/log into media/audio/piano)






// RSS Parser for Goodreads/Letterboxd harvesters
import RSSParser from 'rss-parser';

// Additional adapters for harvesters
import { createActivityGateway } from "../../../__app_modules/wellness/fitness/server/activity-gateway.mjs";
import { YamlWeatherDatastore } from '#adapters/persistence/yaml/YamlWeatherDatastore.mjs';

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
    // Adapters are at __backend/src/1_adapters, relative to this file (5_composition/bootstrap.mjs)
    const adaptersRoot = path.resolve(__dirname, '../1_adapters');
    adapterRegistryInstance = new AdapterRegistry({ adaptersRoot, relocatedManifests: relocatedProviderManifests });
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

  // Piano curriculum files live in the data volume (content/piano/curriculum).
  configurePianoCurriculum(configService);

  // Create integration loader (singleton)
  if (!integrationLoaderInstance) {
    integrationLoaderInstance = new IntegrationLoader({
      registry: adapterRegistryInstance,
      providerDependencies: { plex: { curriculumEnrichment: pianoCurriculumEnrichment } },
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
 * @param {Function} [config.decorateAdapter] - (capability, adapter, serviceConfig) => adapter; wraps each loaded adapter
 * @returns {Promise<Object>} Adapters keyed by capability
 */
export async function loadHouseholdIntegrations(config) {
  const { householdId, httpClient, logger = console, aiUsageLedger = null, decorateAdapter = null } = config;

  if (!integrationLoaderInstance) {
    throw new Error('Integration system not initialized. Call initializeIntegrations first.');
  }

  const adapters = await integrationLoaderInstance.loadForHousehold(
    householdId,
    { httpClient, logger, aiUsageLedger, ...(decorateAdapter ? { decorateAdapter } : {}) }
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
 * @param {string} [config.listDataPath] - Root data path for ListAdapter (content/lists/)
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
export { createContentRegistry } from './contentRegistry.mjs';

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
export { createFitnessServices } from '../../../__app_modules/wellness/fitness/server/services.mjs';

/**
 * Spoken-answer transcription for language assessment.
 *
 * Same service as the fitness voice memo, different profile, and the
 * difference is the whole point. The fitness profile's cleanup pass is told to
 * fix what it misheard; pointed at a learner saying what a sentence means, it
 * would tidy a wrong answer into a right one and the evidence log would record
 * comprehension that never happened. The language profile repairs nothing, and
 * its Whisper prompt names the language but never the expected sentence — a
 * Whisper prompt biases recognition, so an expected answer in it makes the
 * model hear that answer whatever the child said.
 *
 * @param {Object} config
 * @param {Object} [config.openaiAdapter] - OpenAI adapter from the shared AI gateway
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object|null} Transcription service, or null without an AI gateway
 */
export function createLanguageTranscriptionService({ openaiAdapter, logger = console } = {}) {
  if (!openaiAdapter) return null;
  return new VoiceTranscriptionService({
    openaiAdapter,
    profile: languageTranscriptionProfile,
    logger
  });
}

// =============================================================================
// Media Domain Bootstrap
// =============================================================================

/**
 * Create media domain services
 * @param {Object} config
 * @param {Object} config.configService - ConfigService instance for path resolution
 * @param {string} config.defaultHouseholdId - Default household ID
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Media services
 */
export { createMediaServices } from '../../../__app_modules/media/media/server/composition/runtime.mjs';

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
  return eventBusInstance.broadcast(topic, payload) || 0;
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
// DeviceLivenessService Bootstrap
// =============================================================================
//
// Delegates to ./bootstrap/deviceLiveness.mjs so unit tests can exercise the
// wiring without pulling the full bootstrap module (which eagerly imports
// every adapter in the app).
//

export const createDeviceLivenessService = createDeviceLivenessServiceFactory;
export const getDeviceLivenessService    = getDeviceLivenessServiceInstance;
export const stopDeviceLivenessService   = stopDeviceLivenessServiceInstance;

// =============================================================================
// Finance Domain Bootstrap
// =============================================================================

/**
 * Create feed domain services (FreshRSS reader + headline harvesting)
 * @param {Object} config
 * @param {Object} config.dataService - DataService for YAML I/O
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {string} config.freshrssHost - FreshRSS server URL
 * @param {Object} [config.decisionGateway] - IDecisionGateway for the headline story judge
 * @param {Object} [config.logger]
 * @returns {{ freshRSSAdapter, headlineService, headlineStoryJudge, headlineHarvestJob, feedConfigRepository }}
 */
export function createFeedServices(config) { return owned_createFeedServices(config); }

/**
 * Create finance domain services
 * @param {Object} config
 * @param {Object} config.configService - ConfigService instance for path resolution
 * @param {Object} [config.buxferAdapter] - Buxfer adapter (from composition root)
 * @param {Object} [config.aiGateway] - AI gateway for transaction categorization
 * @param {Object} [config.decisionGateway] - IDecisionGateway for the Jev category judge (optional)
 * @param {Object} [config.httpClient] - HTTP client for payroll sync
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Finance services
 */
export function createFinanceServices(config) { return owned_createFinanceServices(config); }

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
export function createHomeAutomationAdapters(config) { return owned_createHomeAutomationAdapters(config); }

// =============================================================================
// Playback Hub Bootstrap
// =============================================================================

/**
 * Create the playback-hub services (HTTP gateway + YAML config datastore +
 * PlaybackHubContainer + Express router for /api/v1/playback-hub).
 *
 * Reads the hub's `baseUrl` from `services.playback_hub.docker` in
 * `data/system/config/services.yml` and the configurable timeout from
 * `services.playback_hub.request_timeout_sec` (default 2). Persists
 * household-side `playback-hub.yml` at whichever path the household config
 * registry resolves for the `playback-hub` app (grouped
 * `<household>/playback-hub/config.yml`, falling back to the retiring flat
 * `<household>/config/playback-hub.yml` while the data move is pending).
 *
 * Starts the HubStatusBroadcaster as part of `container.start()`. Returns the
 * container alongside the router so the caller can register
 * `container.stop()` on graceful shutdown.
 *
 * @param {Object} config
 * @param {Object} config.configService - ConfigService singleton
 * @param {Object} config.eventBus - WebSocketEventBus singleton
 * @param {Object} [config.logger] - Logger instance
 * @returns {Promise<{ container: PlaybackHubContainer, router: import('express').Router } | null>}
 */
export {createPlaybackHubServices} from '../../../__app_modules/media/media/server/composition/playback-hub.mjs';

// =============================================================================
// Camera Bootstrap
// =============================================================================

/**
 * Create camera application services.
 * Composes the Reolink/HLS/Home Assistant adapters and hands them to CameraService.
 * @param {Object} options
 * @param {Object} options.configService - ConfigService for device/auth lookups
 * @param {string} [options.householdId]
 * @param {Object} [options.haGateway]
 * @param {Object} [options.logger]
 * @returns {{ cameraService: CameraService }}
 */
export function createCameraServices(config) { return owned_createCameraServices(config); }

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
 * @param {ScreenAddressResolver} [config.screenAddressResolver] - Resolves a missing screen_path (fuzzy match, then default)
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
    screenAddressResolver = new ScreenAddressResolver(),
    logger = console
  } = config;

  const blueprintFactory = new ConfigDeviceBlueprintFactory({
    haGateway,
    httpClient,
    wsBus,
    remoteExec,
    daylightHost,
    configService,
    screenAddressResolver,
    factories: {
      deviceControl: (adapterConfig, deps) => new HomeAssistantDeviceAdapter(adapterConfig, deps),
      sshOs: (adapterConfig, deps) => new SshOsAdapter(adapterConfig, deps),
      adb: (adapterConfig, deps) => new AdbAdapter(adapterConfig, deps),
      fullyKiosk: (adapterConfig, deps) => new FullyKioskContentAdapter(adapterConfig, deps),
      fullyKioskVolume: (adapterConfig, deps) => new FullyKioskVolumeAdapter(adapterConfig, deps),
      resilient: (adapterConfig, deps) => new ResilientContentAdapter(adapterConfig, deps),
      websocket: (adapterConfig, deps) => new WebSocketContentAdapter(adapterConfig, deps),
    },
    logger,
  });

  const deviceFactory = new DeviceFactory({
    blueprintFactory,
    logger,
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
 * Create WakeAndLoadService with its domain dependencies
 * @param {Object} config
 * @param {import('#apps/devices/services/DeviceService.mjs').DeviceService} config.deviceService
 * @param {Object} [config.haGateway] - Home Assistant gateway
 * @param {Object} [config.devicesConfig] - Raw devices config (keyed by deviceId)
 * @param {Function} [config.broadcast] - WebSocket broadcast function
 * @param {Object} [config.logger] - Logger instance
 * @returns {{ wakeAndLoadService: WakeAndLoadService }}
 */
export function createWakeAndLoadService(config) {
  const {
    deviceService, haGateway, devicesConfig, broadcast, eventBus,
    prewarmService, sessionControlService, commandHandlerLivenessService, deviceLivenessService,
    logger = console,
  } = config;

  // Build sensor map from device config: deviceId -> state_sensor entity
  const sensorMap = {};
  for (const [deviceId, deviceConfig] of Object.entries(devicesConfig || {})) {
    const displays = deviceConfig.device_control?.displays;
    if (displays) {
      for (const [, displayConfig] of Object.entries(displays)) {
        if (displayConfig.state_sensor) {
          sensorMap[deviceId] = displayConfig.state_sensor;
          break; // Use first display's sensor for the device
        }
      }
    }
  }

  // Adapter: HA sensor check (or no-op if no gateway)
  let powerCheck;
  if (haGateway && Object.keys(sensorMap).length > 0) {
    powerCheck = new HaSensorDisplayPowerCheck({ sensorMap }, { gateway: haGateway, logger });
  } else {
    powerCheck = createNoOpDisplayPowerCheck();
  }

  // Domain policy
  const readinessPolicy = new DisplayReadinessPolicy({ powerCheck, logger });
  // Application service
  const wakeAndLoadService = new WakeAndLoadService({ contentRequiresCamera,
    deviceService,
    readinessPolicy,
    broadcast,
    eventBus,
    prewarmService,
    sessionControlService,
    haGateway: haGateway ?? null,
    commandHandlerLivenessService,
    deviceLivenessService,
    clock: { now: () => Date.now() },
    createDispatchId: crypto.randomUUID,
    scheduler: new NodeApplicationScheduler(),
    logger
  });

  return { wakeAndLoadService };
}

/**
 * Create the DispatchIdempotencyService used by multi-step HTTP dispatches
 * (e.g. POST /api/v1/device/:id/load?mode=adopt). Shared across the device
 * router so retries dedupe regardless of how many router instances exist.
 *
 * @param {Object} [config]
 * @param {number} [config.ttlMs=60000]
 * @param {Object} [config.logger]
 * @returns {{ dispatchIdempotencyService: DispatchIdempotencyService }}
 */
export function createDispatchIdempotencyService(config = {}) {
  const { ttlMs, logger } = config;
  const dispatchIdempotencyService = new DispatchIdempotencyService({
    clock: { now: () => Date.now() },
    ttlMs,
    logger,
  });
  return { dispatchIdempotencyService };
}

/**
 * Create TranscodePrewarmService
 * @param {Object} config
 * @param {Object} config.contentIdResolver - ContentIdResolver for queue resolution
 * @param {Object} config.contentCatalog - Content catalog for playable resolution and playback preparation
 * @param {Object} config.mediaProgressMemory - For QueueService watch-state enrichment
 * @param {string} config.appBaseUrl - Local app URL for MPD fetch (e.g., "http://localhost:3111")
 * @param {Object} [config.logger]
 * @returns {{ prewarmService: TranscodePrewarmService }}
 */
export function createTranscodePrewarmService(config) {
  const { contentIdResolver, contentCatalog, mediaProgressMemory, appBaseUrl, logger = console } = config;

  const queueService = new QueueService({ mediaProgressMemory, random: Math.random });

  // Thin status-only shim over the system HttpClient: prewarm pings care only
  // about the HTTP status; network/timeout failures map to status 0.
  const httpClient = new PrewarmHttpStatusClient({ baseUrl: appBaseUrl, logger });

  const prewarmService = new TranscodePrewarmService({
    contentIdResolver, contentCatalog, queueService, httpClient,
    clock: { now: () => Date.now() },
    createToken: () => crypto.randomUUID().replaceAll('-', '').slice(0, 16),
    scheduler: new NodeApplicationScheduler(),
    logger
  });

  return { prewarmService };
}

// =============================================================================
// Hardware Adapters Bootstrap
// =============================================================================

/**
 * Create TTS adapter
 * @param {Object} config
 * @param {string} config.apiKey - OpenAI API key
 * @param {string} [config.model='tts-1'] - TTS model
 * @param {string} [config.defaultVoice='alloy'] - Default voice
 * @param {Object} config.httpClient - HTTP client for API requests
 * @param {Object} [config.logger] - Logger instance
 * @returns {OpenAITTSAdapter}
 */
export function createTTSAdapterInstance(config) {
  const { logger = console, httpClient, aiUsageLedger = null, ...ttsConfig } = config;
  return new OpenAITTSAdapter(ttsConfig, { httpClient, logger, aiUsageLedger });
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
 *
 * Note: thermal printer adapters are managed by a ThermalPrinterRegistry built
 * directly in app.mjs (supports multiple printers by location) and attached to
 * the returned object as `printerRegistry`. This helper only constructs the
 * other hardware adapters.
 *
 * @param {Object} config
 * @param {Object} [config.tts] - TTS configuration
 * @param {string} [config.tts.apiKey] - OpenAI API key
 * @param {Object} [config.mqtt] - MQTT configuration
 * @param {string} [config.mqtt.host] - MQTT broker host
 * @param {number} [config.mqtt.port] - MQTT broker port
 * @param {Function} [config.onMqttMessage] - MQTT message callback
 * @param {Object} [config.httpClient] - HTTP client for API requests
 * @param {Object} [config.aiUsageLedger] - AI usage ledger for TTS rows
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Hardware adapters (ttsAdapter, mqttAdapter, barcodeAdapter)
 */
export function createHardwareAdapters(config) {
  const { logger = console, httpClient, aiUsageLedger = null } = config;

  // TTS adapter (optional - requires OpenAI API key and httpClient)
  let ttsAdapter = null;
  if (config.tts?.apiKey && httpClient) {
    ttsAdapter = new OpenAITTSAdapter(
      {
        apiKey: config.tts.apiKey,
        model: config.tts.model,
        defaultVoice: config.tts.defaultVoice
      },
      { httpClient, logger, aiUsageLedger }
    );
  }

  // MQTT sensor adapter (optional)
  let mqttAdapter = null;
  if (config.mqtt?.host) {
    mqttAdapter = new MQTTSensorAdapter(
      {
        host: config.mqtt.host,
        port: config.mqtt.port,
        logsPath: config.mqtt.logsPath || null
      },
      { logger, onMessage: config.onMqttMessage }
    );
  }

  // Barcode ingest is no longer wired here. The USB-scanner-over-MQTT path is
  // retired; the barcode scan pipeline is fed by the BLE barcode-relay in app.mjs.
  // MQTTBarcodeAdapter is kept in the tree (dormant) as a generic MQTT→barcode
  // ingress should an MQTT scanner ever return. barcodeAdapter stays null so
  // existing `hardwareAdapters.barcodeAdapter?.…` optional access is a safe no-op.
  const barcodeAdapter = null;

  // MQTT selector adapter (optional) - rider-selector buttons
  let selectorAdapter = null;
  if (config.mqtt?.host && Array.isArray(config.selectors) && config.selectors.length > 0) {
    selectorAdapter = new MQTTSelectorAdapter(
      {
        host: config.mqtt.host,
        port: config.mqtt.port,
      },
      {
        selectors: config.selectors,
        onSelect: config.onSelectorSelect,
        logger,
      }
    );
  }

  return {
    ttsAdapter,
    mqttAdapter,
    barcodeAdapter,
    selectorAdapter,
  };
}

// =============================================================================
// Messaging Domain Bootstrap
// =============================================================================

/**
 * Create messaging domain services
 * @param {Object} config
 * @param {Object} config.dataService - DataService for YAML I/O
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
    dataService,
    telegram,
    gmail,
    transcriptionService,
    httpClient,
    logger = console
  } = config;

  // Conversation store (YAML persistence)
  const conversationStore = new YamlConversationDatastore({
    dataService,
    logger
  });

  // Conversation service
  const conversationService = new ConversationService({
    conversationStore,
    random: Math.random,
  });

  // Notification service
  const notificationService = new NotificationService({
    notificationStore: new InMemoryNotificationStore(),
    logger,
    random: Math.random,
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
      googleAuth: gmail.googleAuth,
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
    gmailAdapter,
  };
}

// =============================================================================
// Journalist Application Bootstrap
// =============================================================================

/**
 * Create journalist application services
 * @param {Object} config
 * @param {Object} config.dataService - Hierarchical YAML persistence capability
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
  return createOwnedJournalistServices(config, {
    createLifelogAggregator: createHarvestedLifelogAggregator,
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
 * @param {Function} config.addSelections - Gratitude batch-selection command
 * @param {Object} config.configService - ConfigService for household lookup
 * @param {Object} [config.conversationStateStore] - State store for conversation flow
 * @param {Function} [config.websocketBroadcast] - WebSocket broadcast function
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Homebot services
 */
export function createHomebotServices(config) { return createOwnedHomebotServices(config); }

// =============================================================================
// Nutribot Application Bootstrap
// =============================================================================

/**
 * Create nutribot application services
 * @param {Object} config
 * @param {Object} config.configService - ConfigService instance for path resolution
 * @param {Object} config.dataService - DataService instance
 * @param {Object} config.telegramAdapter - TelegramAdapter for messaging
 * @param {Object} config.aiGateway - AI gateway for completions
 * @param {Object} [config.upcGateway] - UPC lookup gateway
 * @param {Object} [config.googleImageGateway] - Google Image Search gateway
 * @param {Object} [config.conversationStateStore] - State store for conversation flow
 * @param {Object} [config.reportRenderer] - PNG report renderer; adapted to report delivery here
 * @param {Object} [config.reportDelivery] - Prepared-report delivery capability
 * @param {Object} [config.nutribotConfig] - NutriBot configuration
 * @param {Object} [config.agentOrchestrator] - AgentOrchestrator for delegating to health-coach agent
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Nutribot services
 */


/**
 * One health budget per composition scope (the healthApi.mjs pattern): the
 * SAME contract the Today bar reads — goal range, zone, completeness — built
 * off the shared dataService and stores. Null when a store is missing, and
 * every consumer then falls back to its configured goals.
 */


// =============================================================================
// Health Domain Bootstrap
// =============================================================================

/**
 * Create health domain services
 * @param {Object} config
 * @param {Object} config.dataService - DataService for YAML I/O
 * @param {Object} [config.userResolver] - UserResolver for ID to username mapping
 * @param {Object} [config.configService] - ConfigService for user/household lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Health services
 */


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
    configProjection: new EntropyConfigProjection({ configService }),
    logger
  });

  return {
    entropyReader,
    entropyService
  };
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
export function createLifelogServices(config) { return owned_createLifelogServices(config); }

// =============================================================================
// Static Assets Bootstrap
// =============================================================================

// =============================================================================
// Calendar Domain Bootstrap
// =============================================================================

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
 * @param {Object} [config.messagingGateway] - TelegramAdapter for outbound messaging (health coach)
 * @param {string} [config.conversationId] - Nutribot Telegram chat conversation ID (health coach)
 * @returns {{ orchestrator, workingMemory, scheduler, coachingOrchestrator, healthAnalyticsService }}
 */
export async function createAgentsServices(config) {
  const {
    logger = console,
    agentUsageRecorder = null,
    healthStore,
    healthService,
    fitnessPlayableService,
    sessionService,
    mediaProgressMemory,
    dataService,
    configService,
    aiGateway,
    httpClient,
    messagingGateway = null,
    conversationId = null,
    nutriListStore = null,
    foodLogStore = null,
    nutribotConfig: rawNutribotConfig = null,
    webNutribotAdapter = null,
  } = config;

  const { nutribotConfig, healthBudget, coachToday } = createHealthCoachingContext({ rawNutribotConfig, configService, dataService, healthStore, nutriListStore, logger });

  const { agentConfigProjection, dataPath, maxToolCalls, transcriptStore, memoryFactory, memoryProcessorFactory, workingMemory, agentOrchestrator, scheduler, mediaDir } = createAgentRuntimeServices(config);

  const { sharedHealthAnalyticsService, coachingOrchestrator, mealCoachingTrigger, coachingTimezone, coachingConversationId, coachingUserId, coachingCfg } = registerHealthCoaching({ healthStore, healthService, configService, logger, workingMemory, dataService, mediaProgressMemory, sessionService, foodLogStore, nutriListStore, agentConfigProjection, dataPath, maxToolCalls, transcriptStore, memoryFactory, memoryProcessorFactory, agentOrchestrator, fitnessPlayableService, messagingGateway, conversationId, webNutribotAdapter, healthBudget, coachToday, nutribotConfig, agentUsageRecorder, scheduler });

  registerPagedMediaToc({ aiGateway, dataService, configService, httpClient, logger, workingMemory, agentOrchestrator, KomgaClient });

  registerLifeplanGuide({ config, dataService, logger, mediaDir, dataPath, maxToolCalls, transcriptStore, memoryFactory, memoryProcessorFactory, agentConfigProjection, agentOrchestrator, workingMemory });

  // Register scheduled assignments for all agents
  for (const agent of agentOrchestrator.listInstances()) {
    scheduler.registerAgent(agent, agentOrchestrator);
  }

  logger.info?.('agents.bootstrap.complete', {
    registeredAgents: agentOrchestrator.list().map(a => a.id),
    scheduledJobs: scheduler.list(),
  });

  return {
    orchestrator: agentOrchestrator,
    workingMemory,
    scheduler,
    coachingOrchestrator,
    mealCoachingTrigger,
    coaching: { userId: coachingUserId, conversationId: coachingConversationId, config: coachingCfg, timezone: coachingTimezone },
    healthAnalyticsService: sharedHealthAnalyticsService,
  };
}

// =============================================================================
// Concierge Services Bootstrap
// =============================================================================

/**
 * Create the concierge (OpenAI-compatible /v1) router with all skills wired in.
 *
 * Composes:
 *   - YamlSatelliteRegistry       (satellites + tokens from concierge.yml + Infisical)
 *   - ConciergePolicyEvaluator    (scope-based tool gating)
 *   - Shared agentOrchestrator / MastraAdapter runtime (no duplicate MastraAdapter)
 *   - Shared workingMemory adapter (keyed agentId='concierge', userId='household')
 *   - MediaJudge subagent backed by a dedicated MastraAdapter pinned to a
 *     cheap model (separate concern — different model + maxToolCalls:1 — audit Q10)
 *   - ToolBundles: MemoryBundle, HomeAutomationBundle (when haGateway), MediaBundle
 *     (when contentQuery + haGateway + daylightHostInternal/daylightHost)
 *   - ConciergeAgent registered through agentOrchestrator
 *   - SatelliteRegistry built and returned for app.mjs to pass to satelliteBearerAuth
 *
 * @param {Object} config
 * @param {Object} config.configService         - ConfigService
 * @param {Object} config.dataService           - DataService for working memory (fallback only)
 * @param {Object} config.agentOrchestrator     - Shared AgentOrchestrator from createAgentsServices
 * @param {Object} config.workingMemory         - Shared YamlWorkingMemoryAdapter from createAgentsServices
 * @param {Object} [config.contentQueryService] - ContentQueryService for MediaBundle
 * @param {Object} [config.contentRegistry]     - Optional — used to look up Plex labels for media policy
 * @param {Object} [config.haGateway]           - IHomeAutomationGateway for HA + Media bundles
 * @param {Object} [config.devicesConfig]       - Household devices config (provides daylightHost*)
 * @param {string} config.mediaLogsDir          - Directory for per-request transcript files
 * @param {Object} [config.logger]              - Logger
 * @returns {Promise<{satelliteRegistry, advertisedModels}>}
 */
export async function createConciergeServices(config) {
  return createConciergeModule(config);
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
/**
 * Create NewsReporter services — composition wiring for the newsreporter
 * domain. Constructs the concrete adapters and renderer here and injects
 * INSTANCES into NewsReporterContainer.build (Decision D1: containers never
 * import concrete 1_adapters / 1_rendering classes).
 *
 * The framework default consolidation model is config-resolved here from the
 * system agents config (`agents.yml` → `models.newsreporter`), falling back
 * to the historical 'openai/gpt-4o'. It cannot live in newsreporter.yml —
 * that file is reporter-keyed (every top-level key is a reporter id), so a
 * settings key would surface as a phantom reporter job.
 *
 * @param {Object} config
 * @param {Object} config.configService - ConfigService
 * @param {Object} config.printerRegistry - Printer registry ({ resolve })
 * @param {Object} config.dataService - DataService (report-run history)
 * @param {Object} config.httpClient - HTTP client for source fetching
 * @param {string} [config.model] - Explicit default-model override
 * @param {string|null} [config.mediaDir] - Media dir for agent transcripts
 * @param {Object} [config.logger]
 * @returns {{ service: Object, jobDatastore: Object, executor: Object }}
 */
export function createNewsReporterServices(config) {
  return createOwnedNewsReporterServices(config, {
    createRuntime: ({ model, logger, usageRecorder, mediaDir }) => {
      const transcriptStore = mediaDir ? new AgentTranscriptFileStore({ mediaDir }) : null;
      return new MastraAdapter({ model, logger, usageRecorder, mediaDir,
        executionPolicy: new AgentExecutionPolicy({ logger, transcriptStore }),
      });
    },
  });
}

export function createHarvesterServices(config) {
  const {
    io,
    httpClient,
    configService,
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
  const stravaClient = stravaClientParam || (httpClient ? createActivityGateway({
    httpClient,
    configService,
    logger,
  }) : null);

  // Create or use provided authStore (for OAuth token persistence)
  // Use YamlAuthDatastore when io.userSaveAuth is available, otherwise fallback to stub
  const authStore = authStoreParam || (io?.userSaveAuth
    ? new YamlAuthDatastore({ io, logger })
    : new ReadOnlyConfigAuthStore({ configService, logger }));

  // Refresh tokens rotate, so only refresh where the new token is kept: in the
  // token-writer process, through a store that persists it.
  const canRefreshTokens = () => canRotateOAuthTokens() && authStore?.writable === true;

  // Create or use provided sharedStore (for weather data)
  // Note: YamlWeatherDatastore requires DataService (with .household.write), not UserDataService
  const sharedStore = sharedStoreParam || (dataService ? new YamlWeatherDatastore({
    dataService,
    configService,
    logger,
  }) : null);

  // Create Gmail client factory if not provided (for Shopping harvester)
  const effectiveGmailClientFactory = gmailClientFactory
    || new GoogleGmailClientFactory({ configService }).create;

  // AI gateway (provided by composition root)
  // Only the shopping harvester spends from it.
  const effectiveAiGateway = scopedGateway(aiGateway ?? null, { feature: 'shopping' });

  // Create harvester service
  const harvesterService = new HarvesterService({
    resolveDefaultUserId: () => configService.getHeadOfHousehold?.(),
    logger,
  });

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
  // Resolved config values for harvesters (composition root owns configService)
  // Harvesters receive narrow accessors + resolved values, never the singleton.
  // ==========================================================================
  const harvesterTimezone = configService?.getTimezone?.() || 'America/Los_Angeles';
  const getUserAuth = (service, user) => configService.getUserAuth(service, user);
  const getHouseholdAuth = (service) => configService.getHouseholdAuth(service);
  const getUserHouseholdId = (user) => configService.getUserHouseholdId(user);
  const getHouseholdConfig = (householdId) => configService.getHouseholdConfig(householdId);
  const getUserDir = (user) => configService.getUserDir(user);
  const secret = (key) => configService?.getSecret?.(key);
  // OAuth client credentials are system-scoped; user auth holds refresh tokens.
  // Do not use the legacy flat-secret names here: production stores these in
  // data/system/auth/google.yml.
  const googleClientId = configService.getSystemAuth?.('google', 'client_id') || secret('GOOGLE_CLIENT_ID');
  const googleClientSecret = configService.getSystemAuth?.('google', 'client_secret') || secret('GOOGLE_CLIENT_SECRET');
  const googleRedirectUri = configService.getSystemAuth?.('google', 'redirect_uri') || secret('GOOGLE_REDIRECT_URI');
  const googleRefreshToken = secret('GOOGLE_REFRESH_TOKEN');
  const clickupAdapterConfig = configService?.isReady?.() ? configService.getAdapterConfig('clickup') : null;
  const weatherConfig = configService?.isReady?.()
    ? (configService.get?.('weather') || configService.getAdapterConfig?.('weather'))
    : null;
  const weatherLat = weatherConfig?.lat || secret('WEATHER_LAT');
  const weatherLng = weatherConfig?.lng || secret('WEATHER_LNG');
  const weatherTimezone = weatherConfig?.timezone;
  const mediaDir = configService?.getMediaDir?.();

  // ==========================================================================
  // Productivity Harvesters
  // ==========================================================================

  // Todoist - requires httpClient (API v1, no SDK needed)
  if (httpClient) {
    registerHarvester('todoist', () => new TodoistHarvester({
      httpClient,
      lifelogStore,
      currentStore: effectiveCurrentStore,
      getUserAuth,
      apiKey: secret('TODOIST_KEY'),
      timezone: harvesterTimezone,
      logger,
    }));
  }

  // ClickUp - requires httpClient
  if (httpClient) {
    registerHarvester('clickup', () => new ClickUpHarvester({
      httpClient,
      lifelogStore,
      currentStore: effectiveCurrentStore,
      getUserAuth,
      getHouseholdAuth,
      adapterConfig: clickupAdapterConfig,
      apiKey: secret('CLICKUP_PK'),
      timezone: harvesterTimezone,
      logger,
    }));
  }

  // GitHub - requires httpClient
  if (httpClient) {
    registerHarvester('github', () => new GitHubHarvester({
      httpClient,
      lifelogStore,
      getUserAuth,
      timezone: harvesterTimezone,
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
      getUserAuth,
      lastfmUser: secret('LAST_FM_USER'),
      apiKey: secret('LAST_FM_API_KEY') || secret('LASTFM_API_KEY') || secret('LASTFM_APIKEY'),
      timezone: harvesterTimezone,
      logger,
    }));
  }

  // Reddit - requires httpClient
  if (httpClient) {
    registerHarvester('reddit', () => new RedditHarvester({
      httpClient,
      lifelogStore,
      getUserAuth,
      timezone: harvesterTimezone,
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
      getUserAuth,
      token: secret('FOURSQUARE_TOKEN'),
      timezone: harvesterTimezone,
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
      getUserAuth,
      googleClientId,
      googleClientSecret,
      googleRedirectUri,
      googleRefreshToken,
      logger,
    }));
  }

  // Google Calendar - requires httpClient
  if (httpClient) {
    registerHarvester('gcal', () => new GCalHarvester({
      lifelogStore,
      currentStore: effectiveCurrentStore,
      getUserAuth,
      googleClientId,
      googleClientSecret,
      googleRedirectUri,
      googleRefreshToken,
      timezone: harvesterTimezone,
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
      getUserHouseholdId,
      getHouseholdConfig,
      timezone: harvesterTimezone,
      logger,
    }));
  }

  // Buxfer adapter (provided by composition root)
  const buxferAdapter = preloadedBuxferAdapter ?? null;
  if (buxferAdapter) {
    registerHarvester('buxfer', () => new BuxferHarvester({
      buxferAdapter,
      lifelogStore,
      timezone: harvesterTimezone,
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
      getUserAuth,
      getUserDir,
      clientId: secret('STRAVA_CLIENT_ID'),
      redirectUri: secret('STRAVA_URL'),
      mediaDir,
      timezone: harvesterTimezone,
      fitnessHistoryDir: configService.getHouseholdPath('fitness/log'),
      logger,
      canRefreshTokens,
    }));
  }

  // Withings - requires httpClient
  if (httpClient) {
    registerHarvester('withings', () => new WithingsHarvester({
      httpClient,
      lifelogStore,
      authStore,
      getUserAuth,
      clientId: configService.getSystemAuth?.('withings', 'client_id') || secret('WITHINGS_CLIENT_ID') || secret('WITHINGS_CLIENT'),
      clientSecret: configService.getSystemAuth?.('withings', 'client_secret') || secret('WITHINGS_CLIENT_SECRET') || secret('WITHINGS_SECRET'),
      redirectUri: configService.getSystemAuth?.('withings', 'redirect_uri') || secret('WITHINGS_REDIRECT'),
      weightProcessor: new WeightProcessor({
        lifelogStore,
        timezone: harvesterTimezone,
        logger,
      }),
      timezone: harvesterTimezone,
      logger,
      canRefreshTokens,
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
      canRefreshTokens,
    }));
  }

  // ==========================================================================
  // Other Harvesters
  // ==========================================================================

  // Weather - requires sharedStore for household-level data
  if (sharedStore) {
    registerHarvester('weather', () => new WeatherHarvester({
      sharedStore,
      lat: weatherLat,
      lng: weatherLng,
      weatherTimezone,
      timezone: harvesterTimezone,
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

  // Daily MIDI harvest from the networked piano recorder.
  // The 'jamcorder' key is the harvester's identity, not a name we are free to
  // change: it must match the `jobs.yml` job id and the persisted per-job
  // scheduler state in `system/scheduling/cron-runtime.yml`. Renaming it here
  // would orphan that state and the job would stop running. (The real registry
  // key is JamCorderHarvester.serviceId; this argument is only the log label,
  // and is kept identical to it on purpose.)
  //
  // DECIDED 2026-08-22, not deferred: this name stays `jamcorder` for good.
  // The 2026-08 rename moved the vendor name out of 2_domains/ and
  // 3_applications/ (now `midi`), which was the point. JamCorderHarvester
  // itself lives in 1_adapters/harvester/other/ — a vendor-specific adapter,
  // where a vendor serviceId is CORRECT, not a leftover.
  registerPianoJamCorderHarvester({httpClient,registerHarvester,configService,logger});

  // Piano MIDI→MP3 — daily render of every media/midi/piano/log .mid into media/audio/piano.
  registerPianoAudioHarvesters({ registerHarvester, configService, logger });

  // Create job executor for scheduler integration
  const jobExecutor = new HarvesterJobExecutor({
    harvesterService,
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
    // OAuth token persistence and the refresh policy; shared with code outside
    // the harvesters that refreshes the same tokens (e.g. Strava activity access).
    authStore,
    canRefreshTokens,
  };
}
