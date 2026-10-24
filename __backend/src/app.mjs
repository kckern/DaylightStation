import {createPianoBoardGameDayRuntime} from '../../__app_modules/learning/piano/server/composition/board-game-day.mjs';
import {createInstalledPrintableSheets} from '#composition/modules/printableSheets.mjs';
import {createInstalledWeeklyMeasures} from '#composition/modules/weeklyMeasures.mjs';
import { createArtContentRuntime } from '../../__app_modules/media/art/server/composition/installed-runtime.mjs';
import { createArtAdminService } from '../../__app_modules/media/art/server/composition/admin-runtime.mjs';
import { createCanvasImageUseCase } from '../../__app_modules/media/art/server/composition/canvas-runtime.mjs';
import { createArtScreenPresets } from '../../__app_modules/media/art/server/composition/screen-presets.mjs';
import { createSchoolLearnerDirectory } from '../../__app_modules/learning/school/server/composition/learner-directory.mjs';
import { getScreenOverrideService } from '#composition/modules/screenOverride.mjs';
import { configureLifelogArchive } from "../../__app_modules/personal/lifelog/server/composition/archive.mjs";
import { createLifelogWeightService } from "../../__app_modules/wellness/health/server/composition/lifelog-weight.mjs";
import { registerFeedHeadlineHarvester } from "../../__app_modules/media/feed/server/composition/harvester.mjs";
import { installAutomotiveRelay } from "../../__app_modules/household/auto/server/composition/ingress.mjs";
import {createEconomyEarningsRuntime,startEconomyPayouts,startWeekClose} from "../../__app_modules/money/economy/server/composition/earnings.mjs";
import {studyDayFor,isInWindow} from "../../__app_modules/learning/school/server/study-calendar.mjs";
import {createChessRuntime} from "../../__app_modules/games/chess/server/composition/runtime.mjs";
import {createEmulatorRuntime} from "../../__app_modules/games/emulator/server/composition/runtime.mjs";
import { createHomeEvents } from "../../__app_modules/household/home/server/composition/events.mjs";
import { startHomeAmbient } from "../../__app_modules/household/home/server/composition/ambient.mjs";
import { registerCameraJobs } from "../../__app_modules/household/camera/server/composition/jobs.mjs";
import { installWeeklyReview } from "../../__app_modules/personal/weekly-review/server/composition.mjs";
import { installLivestream } from "../../__app_modules/media/livestream/server/composition.mjs";
import { installFeedApi } from "../../__app_modules/media/feed/server/composition/http-runtime.mjs";
import { createNutribotReportRenderer } from "../../__app_modules/wellness/nutribot/server/composition/report-renderer.mjs";
import { createPartyGamesCatalogRuntime, createPartyGamesSessionRuntime, createPartyGamesHttpRuntime } from "../../__app_modules/games/party-games/server/composition/installed-runtime.mjs";
import { registerLifeplanMaintenance } from "../../__app_modules/personal/life/server/maintenance.mjs";
import {createMediaPlayLedger} from "../../__app_modules/media/media/server/composition/play-ledger.mjs";
import {createMediaJobsRuntime} from "../../__app_modules/media/media/server/composition/jobs-runtime.mjs";
import {createMediaMemoryValidator} from "../../__app_modules/media/media/server/composition/memory-validation.mjs";
import { createMediaApiRuntime } from "../../__app_modules/media/media/server/composition/api-runtime.mjs";
import { createHomelineLease } from "../../__app_modules/household/homeline/server/composition.mjs";
import { createAmbientScheduler } from "../../__app_modules/household/screens/server/ambient-runtime.mjs";
import { createNutribotDestinationResolver } from "../../__app_modules/wellness/nutribot/server/composition/destinations.mjs";
import { createHealthMentionsApi, createHealthScanRuntime, createHealthNutritionLookup, startHealthScaleObservation, registerHealthMaintenance } from "../../__app_modules/wellness/health/server/composition/app-runtime.mjs";
import { createHealthServices } from "../../__app_modules/wellness/health/server/composition/runtime.mjs";
import { createNutribotServices } from "../../__app_modules/wellness/nutribot/server/composition/runtime.mjs";
import { YamlUserProfileDatastore } from '#adapters/persistence/yaml/YamlUserProfileDatastore.mjs';
import { EventBusEventInputSource } from '#adapters/scan/EventBusEventInputSource.mjs';
import { createSchoolReadingRuntime, registerSchoolReadingAction } from "../../__app_modules/learning/school/server/reading-runtime.mjs";
import { createFitnessIdentityRuntime } from "../../__app_modules/wellness/fitness/server/identity-runtime.mjs";
import { registerFitnessPoseRuntime } from "../../__app_modules/wellness/fitness/server/pose-runtime.mjs";
import { registerSchoolAssessmentIngress } from "../../__app_modules/learning/school/server/assessment-ingress.mjs";
import { createBooksApiRouter } from "../../__capabilities/book-catalog/server/composition/booksApi.mjs";
import { createLanguageTranscriptionService } from "#composition/bootstrap.mjs";
import { YamlUserVideoProgressStore as SchoolUserVideoProgressStore } from "../../__app_modules/learning/piano/server/adapters/YamlUserVideoProgressStore.mjs";
import { createFitnessServices } from "#composition/bootstrap.mjs";
import { createSchoolLearningRuntime } from "../../__app_modules/learning/school/server/learning-runtime.mjs";
import { createSchoolCatalogRuntime } from "../../__app_modules/learning/school/server/catalog-runtime.mjs";
import { createSchoolLanguageRuntime } from "../../__app_modules/learning/school/server/language-runtime.mjs";
import { createSchoolLessonHookRuntime } from "../../__app_modules/learning/school/server/lesson-hook-runtime.mjs";
import { createSchoolLifecycleRuntime } from "../../__app_modules/learning/school/server/lifecycle-runtime.mjs";
import { createFitnessServicesRuntime } from "../../__app_modules/wellness/fitness/server/services-runtime.mjs";
import { createFitnessReceiptRuntime } from "../../__app_modules/wellness/fitness/server/receipt-runtime.mjs";
import { createFitnessApiRuntime } from "../../__app_modules/wellness/fitness/server/api-runtime.mjs";
import {createPianoModule} from "../../__app_modules/learning/piano/server/composition.mjs";
/**
 * DDD App Factory
 *
 * Creates and configures an Express app with all DDD domain services and routers.
 * This is extracted from server.mjs to support the backend toggle system.
 *
 * @module __backend/src/app
 */

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import crypto from 'node:crypto';
import path, { join } from 'path';


import { PianoConfigProjection } from "../../__app_modules/learning/piano/server/adapters/PianoConfigProjection.mjs";
import { publicResourceUrl } from '#api/v1/presenters/publicResourceRefs.mjs';

// Infrastructure imports
import { configService } from "./0_system/config/index.mjs";
import { dataService, userService } from '#composition/runtimePersistence.mjs';
import { ConfigUserResolver as UserResolver } from '#adapters/identity/ConfigUserResolver.mjs';
import { UserIdentityService } from "./2_domains/messaging/services/UserIdentityService.mjs";
import { TelegramIdentityAdapter } from "./1_adapters/messaging/TelegramIdentityAdapter.mjs";
import { HttpClient } from "./0_system/services/HttpClient.mjs";
import { PlexSessionAdapter } from "../../__capabilities/playback/server/adapters/plex/PlexSessionAdapter.mjs";
import { PlaybackSessionRegistry } from "../../__capabilities/playback/server/public.mjs";
import { ReportPlaybackSession } from "../../__capabilities/playback/server/public.mjs";
import { createPlexSurfaceIdentityResolver } from '#composition/modules/plexSurfaceIdentity.mjs';
import { createSpotDevicePolicy } from '#composition/modules/spotDevicePolicy.mjs';
import { createConfiguredLibbyRuntime } from "../../__capabilities/content-catalog/server/composition/libby.mjs";

// Logging system
import { getDispatcher } from "./0_system/logging/dispatcher.mjs";
import { createLogger } from "./0_system/logging/logger.mjs";
import { ingestFrontendLogs } from '#adapters/logging/FrontendLogIngestion.mjs';
import { registerClientIngress } from '#composition/modules/clientIngress.mjs';
import { loadLoggingConfig, resolveLoggerLevel } from "./0_system/logging/config.mjs";

// Bootstrap functions
import { initializeIntegrations, loadHouseholdIntegrations, loadSystemBots, getMessagingAdapter, createContentRegistry, createMediaProgressMemory, createFeedServices, createFinanceServices, createEntropyServices, createHomeAutomationAdapters, createPlaybackHubServices, createDeviceServices, createWakeAndLoadService, createDispatchIdempotencyService, createTranscodePrewarmService, createHardwareAdapters, createProxyService, createMessagingServices, createJournalistServices, createHomebotServices, createLifelogServices, createEventBus, createDeviceLivenessService, broadcastEvent, createHarvesterServices, createNewsReporterServices, createAgentsServices, createConciergeServices, createCostServices, createMediaServices } from "#composition/bootstrap.mjs";

import { bootstrapLifeplan } from "../../__app_modules/personal/life/server/composition.mjs";
import { bootstrapNotifications } from '#composition/modules/notifications.mjs';
import { createPlaybackStallDetector } from '#composition/modules/playbackStall.mjs';
import { createHubFleetBridge } from "../../__app_modules/media/media/server/composition/hubFleetBridge.mjs";
import { createPlexHubSessions } from "../../__app_modules/media/media/server/composition/plexHubSessions.mjs";
import { createArcadeGameSessionTracking } from "../../__app_modules/games/arcade/server/composition/arcadeGameSessions.mjs";
import { createArcadeGameSessionsRouter } from "../../__app_modules/games/arcade/server/api/arcadeGameSessions.mjs";
import { createApiRouters } from "./5_composition/modules/contentApi.mjs";
import { createFitnessPlayableModule } from "../../__app_modules/wellness/fitness/server/composition-fitness-api.mjs";
import { createBooksModule } from "../../__capabilities/book-catalog/server/composition/booksApi.mjs";
import { createFinanceApiRouter } from "../../__app_modules/money/finance/server/composition/financeApi.mjs";
import { createCostApiRouter } from '#composition/modules/costApi.mjs';
import { createHomeAutomationApiRouter, createHomeDashboardApiRouter } from "../../__app_modules/household/home/server/composition/homeApi.mjs";
import { createDeviceApiRouter } from '#composition/modules/deviceApi.mjs';
import { createDeviceStartStatusService } from '#composition/modules/deviceStartStatus.mjs';
import { createTriggerApiRouter } from "../../__capabilities/device-dispatch/server/composition/triggerApi.mjs";
import { declaredEntryActions } from "../../__app_modules/learning/school/server/domain-reachability.mjs";
import { reportUnreachableSchoolPrograms } from "../../__app_modules/learning/school/server/composition-school-reachability.mjs";
import { createLearnerActions } from "../../__capabilities/device-dispatch/server/application/learnerActions.mjs";
import { createScanDispatch, errText } from '#composition/modules/scanDispatch.mjs';





import { emit } from '#apps/scan/ScanDispatcher.mjs';
import { createGratitudeServices, createGratitudeApiRouter } from "../../__app_modules/personal/gratitude/server/public.mjs";
import { createEconomyApi } from "../../__app_modules/money/economy/server/composition/economyApi.mjs";
import { createJournalistApiRouter } from "../../__app_modules/personal/journalist/server/api-runtime.mjs";
import { createHomebotApiRouter } from "../../__app_modules/household/homebot/server/api-runtime.mjs";
import { createNutribotApiRouter } from "../../__app_modules/wellness/nutribot/server/composition/nutribotApi.mjs";
import { createHealthApiRouter, createHealthDashboardApiRouter } from "../../__app_modules/wellness/health/server/composition/healthApi.mjs";
import { createEntropyApiRouter } from '#composition/modules/entropyApi.mjs';
import { createLifelogApiRouter } from "../../__capabilities/lifelog/server/composition/lifelogApi.mjs";
import { createStaticApiRouter } from '#composition/modules/staticApi.mjs';
import { createVendorApiRouter } from '#composition/modules/vendorApi.mjs';
import { equipmentImageMap } from "../../__app_modules/wellness/fitness/server/application-equipment-images.mjs";
import { createCalendarApiRouter } from "../../__app_modules/personal/calendar/server/composition/calendarApi.mjs";
import { createScreenPresenceService } from '#composition/modules/screenPresence.mjs';
import { createPianoScreenPowerSync } from '../../__app_modules/learning/piano/server/composition/screen-power-sync.mjs';
import { createPianoMidiWake } from "../../__app_modules/learning/piano/server/composition/midi-wake.mjs";
import { createPianoBridgeSupervisor, PIANO_BRIDGE_SUPERVISOR_LOG_MODULE } from "../../__app_modules/learning/piano/server/composition/bridge-supervisor.mjs";
import { createStateGatesModule } from '#composition/modules/stateGates.mjs';
import { KioskFrictionTracker } from '#apps/devices/services/KioskFrictionTracker.mjs';

// AI router import
import { createAIRouter } from "./4_api/v1/routers/ai.mjs";
import { withStateGatesAuthenticationConfiguration } from '#apps/auth/defaultAuthenticationConfiguration.mjs';

// Health mentions router (CoachChat autocomplete)


// Native-wire agent HTTP mounter
import { mountAgentHttp } from "../../__capabilities/agent-runtime/server/api/mountAgentHttp.mjs";
import { satelliteBearerAuth } from "../../__capabilities/agent-runtime/server/api/middlewares/satelliteBearerAuth.mjs";

// Agent memory CRUD router (mounted once at /api/v1/agents)
import { createAgentMemoryRouter } from "../../__capabilities/agent-runtime/server/api/createAgentMemoryRouter.mjs";
// Agent listing + assignments router (Phase 3 T5)
import { createAgentMetaRouter } from "../../__capabilities/agent-runtime/server/api/createAgentMetaRouter.mjs";

// Feed harvester adapter for scheduler integration

// UPC Gateway for barcode lookups


import { ConfigQueryService } from '#apps/config/ConfigQueryService.mjs';
import { ConfigApiYamlSource } from '#adapters/config/ConfigApiYamlSource.mjs';

// Thermal printer registry (multi-printer support)
import { ThermalPrinterAdapter, ThermalPrinterRegistry } from '#adapters/hardware/thermal-printer/index.mjs';
import { LaserPrinterAdapter } from '#adapters/hardware/laser-printer/index.mjs';

// Command-handler liveness (Task 8: gates WS-first warm-switch in WakeAndLoadService)
import { CommandHandlerLivenessService } from '#apps/devices/services/CommandHandlerLivenessService.mjs';
import { SessionControlService } from '#apps/devices/services/SessionControlService.mjs';
import { WakeScreenForBroadcast } from '#apps/devices/services/WakeScreenForBroadcast.mjs';
import { EventBusDeviceTransportGateway } from '#adapters/devices/EventBusDeviceTransportGateway.mjs';

// HTTP middleware
import { errorHandlerMiddleware, requestLoggerMiddleware, aiOriginMiddleware, withRequestContext } from "./0_system/http/middleware/index.mjs";
import { runWithOrigin } from "./0_system/runtime/aiContext.mjs";
import { scopedGateway } from '#apps/common/ports/IAIGateway.mjs';
import { createDevProxy } from '#api/v1/middleware/createDevProxy.mjs';
import { DevRequestForwarder } from '#adapters/http/DevRequestForwarder.mjs';
import { createEventBusRouter } from "./4_api/v1/routers/admin/eventbus.mjs";
import { createAdminRouter } from "./4_api/v1/routers/admin/index.mjs";
import { createOAuthRouter } from "./4_api/v1/routers/admin/oauth.mjs";
// Admin app-services (constructed HERE at the composition root and injected into
// the admin router; keeps 4_api/**/admin/* free of #apps imports).
import { HouseholdAdminService } from '#apps/admin/HouseholdAdminService.mjs';
import { YamlConfigFileService } from '#apps/admin/YamlConfigFileService.mjs';
import { AppsConfigService } from '#apps/admin/AppsConfigService.mjs';
import { SchedulerAdminService } from '#apps/admin/SchedulerAdminService.mjs';
import { IntegrationsQueryService } from '#apps/admin/IntegrationsQueryService.mjs';

import { AdminImageService } from '#apps/admin/AdminImageService.mjs';
import { AdminNotificationOperations } from '#apps/admin/AdminNotificationOperations.mjs';
import { DeviceRemoteAdministrationService } from '#apps/admin/DeviceRemoteAdministrationService.mjs';
import { ListManagementService } from "../../__capabilities/content-catalog/server/application/services/ListManagementService.mjs";
import { HouseholdContextService } from '#apps/common/context/HouseholdContextService.mjs';
import { YamlListDatastore } from "../../__capabilities/content-catalog/server/adapters/persistence/YamlListDatastore.mjs";
import { ListConfigCodec } from "../../__capabilities/content-catalog/server/adapters/providers/list/ListConfigCodec.mjs";

import { AdminImageFileStore } from '#adapters/admin/AdminImageFileStore.mjs';
import { FetchAdminImageSource } from '#adapters/admin/FetchAdminImageSource.mjs';
import { FullyKioskRemoteAdministrationAdapter } from '#adapters/devices/FullyKioskRemoteAdministrationAdapter.mjs';
import { CameraEvents, LessonPositionReporter } from "#apps/events/RealtimePublications.mjs";

import { createCameraRouter } from "../../__app_modules/household/camera/server/api/camera.mjs";
import { createPrinterRouter } from "./4_api/v1/routers/printer.mjs";

// Homeline call state tracking
import { setCallLeaseAuthority } from "../../__app_modules/household/homeline/server/call-state.mjs";

import { createHomelineRouter } from "../../__app_modules/household/homeline/server/api.mjs";

import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { NodeAsyncScheduler } from '#adapters/scheduling/NodeAsyncScheduler.mjs';
import { SchedulerTimestampCodec } from '#adapters/scheduling/SchedulerTimestampCodec.mjs';

import { PrinterControlService } from '#apps/printer/PrinterControlService.mjs';
import { readPrintOutcome } from '#domains/core/utils/printOutcome.mjs';



// Pose frame logging


// Fitness application services (shared between fitness router and agents router)





import { createFoodScaleRelay } from "../../__app_modules/wellness/health/server/scale-relay.mjs";
import { createOmrRelay } from '#apps/hardware/omrRelay.mjs';
import { createOmrReaderLiveness } from '#adapters/hardware/omrReaderLiveness.mjs';
import { createPressureMatRelay } from '#apps/hardware/pressureMatRelay.mjs';
import { PressureMatOperations } from '#apps/hardware/PressureMatOperations.mjs';
import { PressureMatAdapter } from '#adapters/hardware/pressure-mat/index.mjs';
import { createPressureMatRouter } from '#api/v1/routers/pressureMat.mjs';
import { createAutomotiveApi } from "../../__app_modules/household/auto/server/composition/automotiveApi.mjs";







import { normalizeScaleNutribotConfig } from "../../__app_modules/wellness/health/server/scale-config.mjs";
import { createBarcodeRelay } from '#apps/hardware/barcodeRelay.mjs';
import { createRelayWatchdog } from '#apps/hardware/relayWatchdog.mjs';
import {
  BarcodeFirmwareGateway,
  FoodScaleFirmwareGateway,
  OmrFirmwareGateway,
  RelayWatchdogFirmwareGateway,
} from '#adapters/hardware/firmware/EventBusFirmwareRelayGateways.mjs';


import { YamlMenuMemoryRepository } from '#adapters/persistence/yaml/YamlMenuMemoryRepository.mjs';





// Workout persistence (Build authors, Run performs) + the corpus index it validates against

import { YamlExerciseLibraryRepository } from "../../__capabilities/exercise-catalog/server/adapters/index.mjs";


// Scheduling domain + orchestrator
import { SchedulerService } from '#domains/scheduling/services/SchedulerService.mjs';
import { SchedulerOrchestrator } from '#apps/scheduling/SchedulerOrchestrator.mjs';
import { ScreenContentTracker } from '#apps/devices/services/ScreenContentTracker.mjs';


import { normalizeWindows } from "../../__app_modules/household/screens/server/windows.mjs";
import { loadArtmodeConfig } from "../../__app_modules/media/art/server/adapters/artmodeConfig.mjs";
import { YamlJobDatastore } from '#adapters/scheduling/YamlJobDatastore.mjs';
import { YamlStateDatastore } from '#adapters/scheduling/YamlStateDatastore.mjs';
import { CompositeJobDatastore } from '#adapters/scheduling/CompositeJobDatastore.mjs';
import { createApplicationScheduledJobs } from '#composition/modules/applicationScheduledJobs.mjs';
import { Scheduler } from "./0_system/scheduling/Scheduler.mjs";
import { createSchedulingRouter } from "./4_api/v1/routers/scheduling.mjs";

// NewsReporter domain — scheduled, LLM-generated reports
import { createNewsReporterRouter } from "../../__app_modules/media/newsreporter/server/api.mjs";

// Canvas domain
import { createCanvasRouter } from '../../__app_modules/media/art/server/api/canvas.mjs';



// Screens domain
import { createScreensRouter } from "./4_api/v1/routers/screens.mjs";
import { ScreensQueryService } from "../../__capabilities/screen-host/server/application/ScreensQueryService.mjs";
import { FilesystemScreensRepository } from "../../__capabilities/screen-host/server/adapters/persistence/FilesystemScreensRepository.mjs";


import { ScreenAddressResolver } from '#adapters/devices/ScreenAddressResolver.mjs';



// Auth system
import { AuthService } from '#apps/auth/AuthService.mjs';
import { AuthPublicContextService } from '#apps/auth/AuthPublicContextService.mjs';
import { ContentAccessService } from "../../__capabilities/content-catalog/server/application/ContentAccessService.mjs";
import { DataServiceAuthAccountRepository } from '#adapters/auth/DataServiceAuthAccountRepository.mjs';
import { NodeAuthenticationPrimitives } from '#adapters/auth/NodeAuthenticationPrimitives.mjs';
import { networkTrustResolver } from '#api/middleware/networkTrustResolver.mjs';
import { tokenResolver } from '#api/middleware/tokenResolver.mjs';
import { permissionGate } from '#api/middleware/permissionGate.mjs';
import { createAuthRouter } from '#api/v1/routers/auth.mjs';
import { householdResolver } from '#api/middleware/householdResolver.mjs';
import { deviceResolver } from '#api/middleware/deviceResolver.mjs';

// Conversation state persistence
import { YamlConversationStateDatastore } from '#adapters/messaging/YamlConversationStateDatastore.mjs';

// Media jobs (fresh video downloads)



// Content composition use case
import { ComposePresentationUseCase } from "../../__capabilities/playback/server/application/usecases/ComposePresentationUseCase.mjs";

// Barcode scanner pipeline — ingress now routes through the unified trigger
// pipeline (TriggerDispatchService); BarcodeScanService is retired from the
// boot path here (kept in-tree for Plan 4 to delete) and no longer constructed.
import { KNOWN_COMMANDS, resolveCommand } from '#domains/barcode/BarcodeCommandMap.mjs';
import { ContentDispatcher } from "../../__capabilities/device-dispatch/server/application/ContentDispatcher.mjs";

// Weekly Review domain





// Harvest domain (data collection)
import { createHarvestRouter } from "./4_api/v1/routers/harvest.mjs";

// FileIO utilities for image saving
// API versioning
import { createApiRouter } from "./4_api/v1/routers/api.mjs";

import { createFeedbackRouter } from "./4_api/v1/routers/feedback.mjs";

import { createPresentationRouter } from "./4_api/v1/routers/presentation.mjs";


import { YamlPresentationCatalog } from "./1_adapters/persistence/yaml/presentation/YamlPresentationCatalog.mjs";

import { createWikipediaRouter } from "./4_api/v1/routers/wikipedia.mjs";








import { projectHeadToHead, rivalryOpponentId } from "../../__app_modules/learning/piano/server/game-rivalry.mjs";
import { createPianoGamesModule } from "../../__app_modules/learning/piano/server/composition/pianoGames.mjs";
import { WikipediaAdapter } from "./1_adapters/reference/WikipediaAdapter.mjs";
import { WikipediaService } from '#apps/reference/WikipediaService.mjs';

import { buzzersToSelectors, makeBuzzerSelectHandler } from "../../__app_modules/games/party-games/server/application/effects/partyGamesBuzzerInput.mjs";





























/**
 * How long a shelf opened by tapping a face at the panel stays open. Long
 * enough for a child to type an ISBN, find the page they are on and save it;
 * short enough that a grant left behind on a hallway screen is worth nothing
 * by the time anyone else finds it. The printed-code door keeps the default
 * eight hours — it is paid for by paper the agenda printed and a twelve-use
 * cap (see `OpenBookShelfAtPanel`).
 */
const PANEL_BOOK_GRANT_TTL_MS = 20 * 60_000;


















import { shortId } from '#system/utils/id.mjs';
import { PresenceStore } from "./1_adapters/devices/PresenceStore.mjs";
import { ROLE_SEVERITY } from "../../__app_modules/learning/school/server/domain-access-gate.mjs";





















import { createContentFilterRuntime } from "../../__app_modules/media/media/server/composition/content-filter.mjs";
import { FeedbackService } from "./3_applications/common/feedback/FeedbackService.mjs";
import { NotificationConfigService } from "./3_applications/notification/NotificationConfigService.mjs";
import { YamlNotificationConfigRepository } from '#adapters/notification/YamlNotificationConfigRepository.mjs';

import { createConfigRouter } from "./4_api/v1/routers/config.mjs";
import { createItemRouter } from "./4_api/v1/routers/item.mjs";





import { BuildMetadataSource } from '#adapters/runtime/BuildMetadataSource.mjs';
import { ReadalongRuntimePaths } from "../../__capabilities/playback/server/adapters/ReadalongRuntimePaths.mjs";
import { ContentPrefixConfigSource } from "../../__capabilities/content-catalog/server/adapters/ContentPrefixConfigSource.mjs";

import { HarvesterImageStore } from '#adapters/harvester/HarvesterImageStore.mjs';

import { FilesystemAssetProbe } from '#adapters/runtime/FilesystemAssetProbe.mjs';

import { HouseholdYamlDocumentStore } from '#adapters/persistence/yaml/HouseholdYamlDocumentStore.mjs';
import { FilesystemYamlDirectoryCatalog } from '#adapters/persistence/files/FilesystemYamlDirectoryCatalog.mjs';












import { ContentExpression } from "../../__capabilities/content-catalog/server/domain/ContentExpression.mjs";


import { YamlDayLogDatastore } from '#adapters/persistence/yaml/YamlDayLogDatastore.mjs';
import { YamlConfigFileStore } from '#adapters/persistence/yaml/YamlConfigFileStore.mjs';
import { YamlAdminConfigStore } from '#adapters/persistence/yaml/YamlAdminConfigStore.mjs';

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
  const assetProbe = new FilesystemAssetProbe();
  const isDocker = assetProbe.exists('/.dockerenv');
  // Transitional legacy consumers still expect this narrow persistence object.
  // Its concrete adapter remains owned by the composition root.
  const userDataService = dataService.user;

  // ==========================================================================
  // Express App Setup
  // ==========================================================================

  const app = express();

  // Trust the reverse proxy in front of us, so `req.ip` is the CLIENT's address
  // rather than the docker peer's. Never set before, which is part of why every
  // client looked like `172.18.0.53` on 2026-08-16.
  //
  // Scoped, not `true`. Blanket trust makes `req.ip` whatever the caller writes
  // in X-Forwarded-For — forgeable by anyone who can reach the port. With this
  // preset Express walks the chain from the right and stops at the first address
  // that is NOT loopback/link-local/private, which is the real client whenever
  // the proxy appends rather than replaces.
  //
  // NOTE: networkTrustResolver grants roles by address, and it deliberately
  // reads the socket peer rather than req.ip so this line cannot move a trust
  // boundary. See the comment there.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  // Enable SharedArrayBuffer for TF.js WASM multi-threaded SIMD
  app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    next();
  });
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  // AI usage origin (`http:METHOD /path`) for every ledger row a request
  // causes. After the body parsers on purpose: they finish on a stream event
  // outside any context opened before them.
  app.use(aiOriginMiddleware());

  // Skip WebSocket paths from Express middleware
  app.use((req, res, next) => {
    if (req.path.startsWith('/ws')) {
      return next('route');
    }
    next();
  });

  // Build metadata: Docker bakes /build.txt (local build time + GitHub commit
  // URL) at image-build time. In dev there is no baked file, so report the
  // working tree's HEAD instead.
  app.get('/build.txt', (req, res) => {
    res.type('text/plain');
    const metadata = new BuildMetadataSource({ checkoutDirectory: __dirname }).read();
    return metadata.kind === 'file' ? res.sendFile(metadata.path) : res.send(metadata.value);
  });

  if (!configExists) {
    // Express 5: '/{*splat}' (optional named wildcard) replaces the bare '*' catch-all
    app.get('/{*splat}', (req, res, next) => {
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
  // Auth System
  // ==========================================================================

  const authService = new AuthService({
    accounts: new DataServiceAuthAccountRepository({ dataService, configService }),
    authentication: new NodeAuthenticationPrimitives(),
    logger: rootLogger.child({ module: 'auth' }),
  });
  const authConfig = withStateGatesAuthenticationConfiguration(dataService.system.read('config/auth') || {});
  const jwtSecret = authConfig?.jwt?.secret || '';
  const jwtConfig = authConfig?.jwt || { issuer: 'daylight-station', expiry: '10y', algorithm: 'HS256' };

  // 0. Request logging, ahead of the auth pipeline on purpose: a request the
  // permission gate rejects is still a request, and a 403 storm is a signal we
  // would rather see than not. Until now nothing logged HTTP traffic globally
  // — the one router that mounted this middleware hooked res.json, which both
  // hot paths of the 2026-08-16 storm (a redirect and a pipe) bypass entirely.
  // Successful responses are budgeted; failures always go out. Never bodies.
  app.use('/api/v1', requestLoggerMiddleware());

  // Auth middleware pipeline — runs on all /api/v1/* requests
  // 0b. deviceResolver stamps req.deviceId / req.deviceIdSource. Mounted beside
  //     householdResolver because it answers the sibling question: that one says
  //     WHICH HOUSEHOLD, this one says WHICH MACHINE. The request logger above
  //     reads both at res 'finish', which is after this has run.
  app.use('/api/v1', deviceResolver());

  // 1. householdResolver sets req.householdId from Host header
  const domainConfig = dataService.system.read('config/domains') || {};
  const householdContext = new HouseholdContextService({
    defaultHouseholdId: () => configService.getDefaultHouseholdId(),
    householdExists: (id) => configService.householdExists(id),
    getHousehold: (id) => ({
      id,
      users: configService.getHouseholdUsers(id),
      timezone: configService.getHouseholdTimezone(id),
    }),
    getTimezone: (id) => configService.getHouseholdTimezone(id),
  });
  app.use('/api/v1', householdResolver({ domainConfig, householdContext }));

  // 2. networkTrustResolver assigns household roles for LAN requests
  app.use('/api/v1', networkTrustResolver({ householdRoles: authConfig?.household_roles || {} }));

  // 3. tokenResolver parses JWT, merges roles
  const { DataServiceAuthSessionStore } = await import('#adapters/auth/DataServiceAuthSessionStore.mjs');
  const authSessionStore = new DataServiceAuthSessionStore({
    dataService, logger: rootLogger.child({ module: 'auth-sessions' }),
  });
  app.use('/api/v1', tokenResolver({ jwtSecret, jwtConfig, sessionStore: authSessionStore }));

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

  // Durable per-call AI spend trail (tokens, model, cost) — the log store only
  // keeps 7 days, so every AI adapter also appends to a monthly file here.
  const { createAiUsageLedger } = await import('#adapters/ai/AiUsageLedger.mjs');
  const aiUsageLedger = createAiUsageLedger({
    dir: path.join(configService.getDataDir(), 'system', 'history', 'ai-usage'),
    // Per-writer files: the data tree is Dropbox-synced, and prod + a dev
    // machine appending to one file is the backend.log conflict loop again.
    source: process.env.DAYLIGHT_ENV || 'docker',
    logger: rootLogger.child({ module: 'ai-usage-ledger' }),
  });
  // Agent (Mastra) turns price themselves and append to the same ledger; every
  // MastraAdapter the composition builds receives this as `usageRecorder`.
  const { createAgentUsageRecorder } = await import('#composition/agentUsageRecorder.mjs');
  const agentUsageRecorder = createAgentUsageRecorder({
    ledger: aiUsageLedger,
    logger: rootLogger.child({ module: 'agent-usage' }),
  });

  // Structured wire layer: every AI adapter is wrapped once where it is built,
  // so all consumers (and every scoped view) get it without knowing. Inert
  // unless integrations.yml sets ai[].wire.mode. See ai-structured-wire-layer.md.
  const { StructuredWireLayer } = await import('#adapters/ai/StructuredWireLayer.mjs');
  const { readAiWireConfig } = await import('#composition/aiWireConfig.mjs');
  const aiWire = readAiWireConfig(configService.getIntegrationsConfig?.(defaultHouseholdId));
  const aiWireLogger = rootLogger.child({ module: 'ai-wire' });
  const wrapAiWire = (adapter) => (adapter ? new StructuredWireLayer(adapter, { ...aiWire, logger: aiWireLogger }) : adapter);
  rootLogger.info('ai.wire.config', aiWire);

  try {
    integrationSystem = await initializeIntegrations({
      configService,
      logger: rootLogger.child({ module: 'integrations' })
    });

    // Load adapters for the default household
    householdAdapters = await loadHouseholdIntegrations({
      householdId: defaultHouseholdId,
      httpClient: axios,
      logger: rootLogger.child({ module: 'integrations' }),
      aiUsageLedger,
      decorateAdapter: (capability, adapter) => (capability === 'ai' ? wrapAiWire(adapter) : adapter)
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
    sharedAiGateway = wrapAiWire(new OpenAIAdapter({ apiKey: openaiApiKey }, { httpClient: axios, logger: rootLogger.child({ module: 'shared-ai' }), aiUsageLedger }));
    rootLogger.debug('ai.adapter.fallback', { reason: 'Using hardcoded OpenAI adapter creation' });
  }

  // Typed-decision model (IDecisionGateway, TypeSafe Jev). Config-driven when
  // integrations.yml declares `decision`; otherwise system/auth/jev.yml.
  let decisionGateway = householdAdapters?.has?.('decision') ? householdAdapters.get('decision') : null;
  const jevApiKey = configService.getSystemAuth?.('jev', 'api_key');
  if (!decisionGateway && jevApiKey) {
    const { JevAdapter } = await import('#adapters/ai/JevAdapter.mjs');
    decisionGateway = new JevAdapter({ apiKey: jevApiKey }, { httpClient: axios, logger: rootLogger.child({ module: 'jev' }), aiUsageLedger });
  }
  rootLogger.info('decision.gateway', { configured: !!decisionGateway });

  // ==========================================================================
  // Initialize Services
  // ==========================================================================

  const dataBasePath = configService.getDataDir();
  const mediaBasePath = configService.getMediaDir();
  const householdId = configService.getDefaultHouseholdId() || 'default';
  const householdDir = dataService.household.resolveDir('', householdId);

  // DevProxy for forwarding webhooks to local dev machine
  const devHost = configService.get('LOCAL_DEV_HOST') || configService.getSecret('LOCAL_DEV_HOST');
  const dataDir = configService.getDataDir();
  const devProxy = createDevProxy({
    logger: rootLogger,
    forwarder: new DevRequestForwarder({ dataDir, devHost, logger: rootLogger.child({ module: 'dev-proxy' }) }),
  });

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

  // DoNow's household-level composition module isn't constructed until well
  // after this point (it needs `wakeAndLoadService`/home-automation/playback-
  // hub seams that don't exist yet) — but the WS message handler just below,
  // which taps `ingestFrontendLogs` for `FitnessPresenceTracker` (Task 7's
  // documented one-line hook), is registered here and only ever RUNS at
  // request time, long after boot completes. Declared here, assigned once
  // `createDonow` resolves further down — the closure below reads the
  // current value at call time, never a snapshot from registration time.
  let donowModule = null;
  let callLeaseService = null;

  // The one production client-ingress path (subscription/message authorizers,
  // the inline message router, the BT + kiosk-launch relays, and the playback-
  // state relay) — shared with the acceptance fixture via
  // __backend/src/5_composition/modules/clientIngress.mjs so fixture success
  // proves production. See ClientIngressService for the routing policy.
  registerClientIngress({
    eventBus,
    getCallLeaseService: () => callLeaseService,
    frontendLogIngestion: { ingest: ingestFrontendLogs },
    getFitnessPresence: () => donowModule?.presence?.fitness,
    logger: rootLogger,
  });

  // DeviceLivenessService — caches last-known device-state snapshots and
  // synthesizes `offline` broadcasts when heartbeats stop. Also wires
  // itself into the event bus so new subscribers get a replayed snapshot.
  const devicePresenceGateway = new EventBusDeviceTransportGateway({ eventBus });
  const { livenessService: deviceLivenessService } = createDeviceLivenessService({
    eventBus,
    presenceGateway: devicePresenceGateway,
    logger: rootLogger.child({ module: 'device-liveness' })
  });

  // DeviceStartStatusService — folds WakeAndLoad's homeline:<id> step stream
  // into one start status per screen on device-start:<id>, replayed to new
  // subscribers, so every house view sees start progress / last failure.
  const { startStatusService: deviceStartStatusService } = createDeviceStartStatusService({
    eventBus,
    logger: rootLogger.child({ module: 'device-start-status' }),
  });

  // HubFleetBridge — translates playback-hub:status lane snapshots into
  // device-state:speaker-<lane> broadcasts so Bluetooth speaker lanes appear
  // live in the /media Devices (fleet) view. After liveness so the cache is
  // already subscribed to device-state:*.
  createHubFleetBridge({
    eventBus,
    logger: rootLogger.child({ module: 'hub-fleet-bridge' })
  });

  // SessionControlService — HTTP→WS command bridge for remote transport /
  // queue / config control of screen devices (Fleet "Remote" in /media).
  // Without this every /device/:id/session/* endpoint 501s.
  const sessionControlService = new SessionControlService({
    transportGateway: devicePresenceGateway,
    livenessService: deviceLivenessService,
    logger: rootLogger.child({ module: 'session-control' })
  });

  // Food-scale relay — ingests the ESP32 BLE-scale bridge's weight/button
  // stream (source: 'food-scale-relay') and re-broadcasts on the `food-scale`
  // topic; a decoupled subscriber persists settled measurements + button
  // presses to history/hardware/food-scale/. See _extensions/food-scale-relay.
  // Relay history roots are resolved HERE, in the composition root, and handed
  // down absolute. The relays used to each carry their own
  // `household/<domain>/log` literal and join it onto dataDir, which put
  // storage layout in the application layer. `persistence.dir` (a
  // data-relative override in the domain's config file) is honoured the same
  // way it always was — the resolution just happens at the wiring seam now.
  const relayHistoryRoot = (cfg, domainPath) => {
    const override = cfg?.persistence?.dir;
    return override
      ? path.join(dataDir, ...String(override).replace(/^\/+/, '').split('/'))
      : configService.getHouseholdPath(domainPath, householdId);
  };
  // D5: relays never touch fs. Each gets an append-only day-log store rooted
  // where its history lives — five private read-modify-write copies replaced
  // by one adapter.
  const relayDayLog = (cfg, domainPath, eventPrefix) => new YamlDayLogDatastore({
    root: relayHistoryRoot(cfg, domainPath),
    timezone: configService.getHouseholdTimezone?.(householdId),
    eventPrefix,
    logger: rootLogger.child({ module: eventPrefix }),
  });

  const scalesConfig = configService.getHouseholdAppConfig(householdId, 'scales')
    || configService.reloadHouseholdAppConfig?.(householdId, 'scales')
    || {};
  createFoodScaleRelay({
    relayGateway: new FoodScaleFirmwareGateway({
      eventBus,
      config: scalesConfig,
      timezone: configService.getHouseholdTimezone?.(householdId),
    }),
    dayLog: relayDayLog(scalesConfig, 'nutrition/log', 'food_scale'),
    logger: rootLogger.child({ module: 'food-scale-relay' }),
  });

  // Pressure-mat relay — ingests the TrampleTek Blue's analog voltage,
  // derived occupancy, and press/release events. Voltage is deliberately kept
  // as voltage: the textile response is nonlinear and is not a calibrated
  // scale. See _extensions/pressure-mat-relay.
  const pressureMatConfig = configService.getHouseholdAppConfig(householdId, 'pressure-mats')
    || configService.reloadHouseholdAppConfig?.(householdId, 'pressure-mats')
    || {};
  const pressureMatAdapter = new PressureMatAdapter({
    eventBus,
    config: pressureMatConfig,
    logger: rootLogger.child({ module: 'pressure-mat-relay' }),
  }).start();
  createPressureMatRelay({
    pressureMatGateway: pressureMatAdapter,
    dayLog: relayDayLog(pressureMatConfig, 'hardware/pressure-mats/log', 'pressure_mat'),
    timezone: configService.getHouseholdTimezone?.(householdId),
    logger: rootLogger.child({ module: 'pressure-mat-relay' }),
  });

  // OMR relay — ingests the ESP32 bubble-sheet relay's decoded card records
  // (source: 'omr-relay') off a Chatsworth OMR-1100 and re-broadcasts on the
  // `omr` topic; a decoupled subscriber persists completed reads to
  // history/omr/<reader-id>/. The relay reports WHICH POSITIONS WERE MARKED and
  // nothing more — scoring is the consuming app's job, since the mapping from
  // columns to answers is form-specific. See _extensions/omr-relay.
  const omrReadersConfig = configService.getHouseholdAppConfig(householdId, 'omr-readers')
    || configService.reloadHouseholdAppConfig?.(householdId, 'omr-readers')
    || {};
  createOmrRelay({
    relayGateway: new OmrFirmwareGateway({
      eventBus,
      config: omrReadersConfig,
      timezone: configService.getHouseholdTimezone?.(householdId),
    }),
    dayLog: relayDayLog(omrReadersConfig, 'hardware/omr/log', 'omr'),
    logger: rootLogger.child({ module: 'omr-relay' }),
  });

  // OMR reader liveness — a DIFFERENT failure mode than relayWatchdog's
  // silence check: on 2026-08-25 a reader flapped, and on some reconnects
  // the backend held a live socket for it that never subscribed to its own
  // topic. The reader believed it was online; a scan produced no backend
  // event at all. relayWatchdog can't catch this (a connected-but-mute
  // socket looks identical to a quiet one); this is a short-grace-period
  // check on the connect->subscribe handshake instead, so it fires within
  // seconds rather than hours and never pages for ordinary term-time quiet.
  const omrReaderLiveness = createOmrReaderLiveness({
    eventBus,
    logger: rootLogger.child({ module: 'omr-reader-liveness' }),
  });
  const omrReaderLivenessTimer = setInterval(() => omrReaderLiveness.check(), 2000);
  omrReaderLivenessTimer.unref?.();

  // Quiz-sheet decoder — the form-specific consumer of those scans. Subscribes
  // to the same topic and double-processes each card: the relay keeps the raw
  // byte-faithful manifest, this writes the meaningful version (7-digit test ID
  // + answers for 50 questions) to household/apps/quizzes/<reader-id>/.
  await registerSchoolAssessmentIngress({ omrReadersConfig, dataDir, configService, householdId, EventBusEventInputSource, eventBus, relayHistoryRoot, rootLogger });

  // Automotive relay — ingests the in-car Freematics device's trip/snapshot
  // stream (source: 'obd-relay') whenever the car is on home WiFi and
  // re-broadcasts on the `automotive` topic; a decoupled persister writes
  // trips + snapshots to history/automotive/. See _extensions/obd-relay.
  const vehiclesRelayConfig = configService.getHouseholdAppConfig(householdId, 'vehicles')
    || configService.reloadHouseholdAppConfig?.(householdId, 'vehicles')
    || {};
  installAutomotiveRelay({ eventBus, vehiclesRelayConfig, configService, householdId, relayHistoryRoot, relayDayLog, rootLogger });

  // Content barcode input (now produced by the shared food-scale/content-barcode
  // ESP32, source: 'barcode-relay') is wired
  // later, once the trigger pipeline's triggerDispatchService exists, so BLE
  // scans flow through the same queue/play/open → TV-wake path the retired USB
  // scanner used. See the "Barcode ingress" block + the relay wiring next to
  // createTriggerApiRouter() below. (_extensions/content-barcode-relay)

  // Fingerprint unlock service — binds the unlock broker to the live bus so
  // `fitness.unlock.request` broadcasts reach the garage client and inbound
  // `fitness.unlock.result` replies settle the pending request (Task 2.3).
  // Task 2.4's HTTP endpoint imports requestUnlock from this module.
  const { fingerprintProfileWriter } = await createFitnessIdentityRuntime({ eventBus, YamlUserProfileDatastore, configService });

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

  // watchlistPath removed - lists now in content/lists/ directory (managed by ListAdapter)
  const contentPath = `${dataBasePath}/content`;  // LocalContentAdapter expects content/ subdirectory
  const mediaMemoryPath = `${householdDir}/media/memory`;

  // Media progress path - use household-scoped path (SSOT for media progress)
  const mediaProgressPath = configService.getPath('watchState') || `${householdDir}/media/memory`;
  const mediaProgressMemory = createMediaProgressMemory({ mediaProgressPath });

  // Progress sync — bidirectional progress sync for remote media servers
  let progressSyncService = null;
  if (audiobookshelfConfig) {
    const { AudiobookshelfClient } = await import("../../__capabilities/content-catalog/server/adapters/providers/readable/audiobookshelf/AudiobookshelfClient.mjs");
    const { ABSProgressAdapter } = await import("../../__capabilities/playback/server/adapters/audiobookshelf/ABSProgressAdapter.mjs");
    const { ProgressWriteRuntime } = await import("#system/scheduling/ProgressWriteRuntime.mjs");
    const { ProgressSyncService } = await import("../../__capabilities/playback/server/application/services/ProgressSyncService.mjs");
    const absClient = new AudiobookshelfClient(audiobookshelfConfig, { httpClient: axios });
    const remoteProgressProvider = new ABSProgressAdapter(absClient);
    progressSyncService = new ProgressSyncService({
      remoteProgressProvider,
      mediaProgressMemory,
      progressWriteRuntime: new ProgressWriteRuntime(),
      clock: { now: () => new Date(), epoch: () => Date.now() },
      logger: rootLogger.child({ module: 'progress-sync' })
    });
  }

  // Singalong/Readalong adapters - point to canonical data directories (no symlinks)
  const singalongConfig = {
    dataPath: path.join(contentPath, 'singalong'),  // hymn, primary
    mediaPath: path.join(mediaBasePath, 'audio', 'singalong')
  };
  const readalongConfig = new ReadalongRuntimePaths({ contentPath, mediaPath: mediaBasePath }).read();

  // Load content prefix config early — needed by both createContentRegistry and createApiRouters
  // Colocated under media/ (task-13 — media owns content addressing; was config/content-prefixes)
  const contentPrefixesPath = configService.getHouseholdPath('media/content-prefixes');
  const contentPrefixes = new ContentPrefixConfigSource({ filePath: contentPrefixesPath }).read();
  const prefixAliases = contentPrefixes.aliases || {};
  const storagePaths = contentPrefixes.storagePaths || {};

  const { config: libbyConfig, runtime: libbyRuntime } = createConfiguredLibbyRuntime({
    configService,
    householdId,
    dataPath: dataBasePath,
    logger: rootLogger.child({ module: 'libby' }),
  });

  const { registry: contentRegistry, savedQueryService, sequenceStore } = createContentRegistry({
    mediaBasePath,
    plex: mediaLibConfig,  // Bootstrap key stays 'plex' for now
    immich: immichConfig,  // Gallery source (photos/videos)
    audiobookshelf: audiobookshelfConfig,  // Ebooks/audiobooks
    canvas,  // Canvas art display (filesystem-based)
    dataPath: contentPath,
    listDataPath: dataBasePath,  // ListAdapter needs root data path for content/lists/
    mediaMemoryPath,
    nomusicLabels,
    musicOverlayPlaylist,
    singalong: singalongConfig,  // Sing-along content (hymns, primary songs)
    readalong: readalongConfig,  // Follow-along readalong content (scripture, talks, poetry)
    games: {  // Game launcher (RetroArch adapter)
      config: configService.getHouseholdAppConfig(null, 'games'),
      catalogReader: () => dataService.household.read('gaming/retroarch/catalog')
    },
    storagePaths,                // Collection → media_memory filename mapping
    libby: libbyConfig,
  }, {
    httpClient: axios,
    mediaProgressMemory,
    app,
    configService,
    logger: rootLogger,
    libbyClient: libbyRuntime?.client,
    libbyLeaseService: libbyRuntime?.leases,
  });

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
  const contentDocuments = new HouseholdYamlDocumentStore({ householdDirectory: householdDir });
  const contentLoadFile = contentDocuments.load;
  const contentSaveFile = contentDocuments.save;

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

  // Household economy — per-user wallets, earn/deposit, metered spend sessions.
  // Built here (before the content routers) because the play /log route needs
  // `economyService` to fire the piano lesson-complete earn-hook (Task 8). The
  // router itself is mounted below where the other v1Routers are assembled.
  const economyApi = createEconomyApi({
    configService,
    // The same setting the weekly measures read; the earnings preview takes
    // its study calendar from here, so passes and the preview share "today".
    timezone: configService.getHouseholdTimezone?.(householdId) || 'UTC',
    // Writes that move coins publish `economy.coins-changed`; School forwards
    // it to the Portal's bank strip.
    eventBus,
    logger: rootLogger.child({ module: 'economy-api' })
  });

  // Present each media surface to Plex as a real client: a live session while
  // someone is actually watching, visible on the Plex dashboard and to anything
  // reading /status/sessions (Tautulli). Verified 2026-09-16 — a session needs
  // only ratingKey/key/state/time/duration plus identity; NO play queue.
  //
  // Strictly ONE-WAY. Nothing Plex reports is read back, so it can never
  // overwrite a school or piano completion.
  const plexSessionLogger = rootLogger.child({ module: 'plex-session' });
  const reportPlaybackSession = mediaLibConfig?.host
    ? new ReportPlaybackSession({
      sessionRegistry: new PlaybackSessionRegistry(),
      sessionGateway: new PlexSessionAdapter(
        { host: mediaLibConfig.host, token: mediaLibConfig.token },
        { httpClient: new HttpClient({ logger: plexSessionLogger }), logger: plexSessionLogger },
      ),
      // Surface -> Plex identity. Extracted to its own module because this
      // logic is worth testing: as an inline closure it returned null for every
      // non-fleet caller, so a fitness video played in a browser reported
      // progress every 10s and appeared nowhere in Plex.
      identityFor: createPlexSurfaceIdentityResolver({
        configService,
        householdId,
        logger: plexSessionLogger,
      }),
      logger: plexSessionLogger,
    })
    : null;

  const {playLedger,loadOriginHints}=await createMediaPlayLedger({configService,householdId,rootLogger});

  const { routers: contentRouters, services: contentServices } = createApiRouters({
    registry: contentRegistry,
    sequenceStore,
    menuMemoryRepository: new YamlMenuMemoryRepository({
      filePath: configService.getHouseholdPath('history/menu_memory', householdId),
    }),
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
    economyService: economyApi.economyService,
    reportPlaybackSession,
    playLedger,
    isKnownSpotDevice: createSpotDevicePolicy({ configService, householdId, logger: rootLogger.child({ module: 'content' }) }),
    libbyStreamService: libbyRuntime?.streamService,
    libbyCoverService: libbyRuntime?.coverService,
    logger: rootLogger.child({ module: 'content' })
  });

  // Keep live Plex sessions alive, and end the ones whose surface went quiet.
  //
  // Client pings alone are not dependable enough: measured `play/log` cadence
  // is a median of 3.7s but reaches 21.5s, past what Plex tolerates, so a
  // session driven only by pings can lapse mid-play. And a surface that
  // crashes never sends a stop, which would leave Plex showing a child
  // watching something forever — the reaper is what prevents that.
  if (reportPlaybackSession) {
    const plexSessionTimer = setInterval(() => {
      const now = Date.now();
      Promise.resolve()
        // Reap first, then ping — pinging a session one tick before ending it
        // would tell Plex it is alive and immediately contradict that.
        .then(() => reportPlaybackSession.sweep({ now, ttlMs: 60_000 }))
        .then(() => reportPlaybackSession.keepAlive())
        .catch((error) => plexSessionLogger.warn?.('plex.session.tick_failed', { error: error.message }));
    }, 10_000);
    plexSessionTimer.unref?.();
  }

  // The playback-hub is headless — no Player, so no `play/log` heartbeat ever
  // arrives and music on the speakers reached no dashboard. It publishes lane
  // status every ~3s instead, which this turns into sessions. Wired here
  // because neither context may import the other.
  createPlexHubSessions({
    eventBus,
    reportPlaybackSession,
    logger: plexSessionLogger,
  });

  // Health domain
  const healthServices = createHealthServices({
    dataService,
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
    aiGateway: householdAdapters?.has?.('ai') ? scopedGateway(householdAdapters.get('ai'), { app: 'finance' }) : null,
    // Typed-decision model: Jev category judge (shadow unless the finance config promotes it)
    decisionGateway: scopedGateway(decisionGateway, { app: 'finance' }),
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
    decisionGateway: scopedGateway(decisionGateway, { app: 'feed' }),
    logger: rootLogger.child({ module: 'feed' }),
  });

  // Cost domain
  const costDataRoot = configService.getHouseholdPath('cost');
  const costServices = createCostServices({
    dataRoot: costDataRoot,
    // budgetRepository not yet implemented - will be added when YamlBudgetDatastore is created
    logger: rootLogger.child({ module: 'cost' })
  });

  // Entropy domain - use DataService for user-specific data (replaces legacy io.mjs)
  const userLoadFile = (username, service) => dataService.user.read(`lifelog/${service}`, username);
  const userLoadCurrent = (username, service) => dataService.user.read(`current/${service}`, username);
  const { ArchiveService, loadArchiveConfig } = await configureLifelogArchive({ dataService, configService, rootLogger });
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

  // Notification stack (app/websocket + telegram + HA push channels).
  // The default telegram adapter is constructed later in createMessagingServices,
  // so it's late-bound here and assigned after that call.
  const notificationTelegram = { adapter: null };
  // Absolute base URL for Telegram inline deep-link buttons (e.g. the ceremony
  // "Begin" action). No dedicated ConfigService getter exists, so read it from the
  // system app config; an unset value ⇒ text-only nudges (no button).
  const notificationPublicBaseUrl = configService.getAppConfig('system')?.public_url ?? null;
  const notificationStack = bootstrapNotifications({
    eventBus,
    telegramAdapter: () => notificationTelegram.adapter,
    publicBaseUrl: notificationPublicBaseUrl,
    resolveChatId: (username) =>
      userService.getProfile(username)?.identities?.telegram?.user_id
        ?? configService.resolvePlatformId('telegram', username),
    haGateway: householdAdapters?.has?.('home_automation') ? householdAdapters.get('home_automation') : null,
    // HA mobile push requires a per-user notify service name in the profile:
    // identities.homeassistant.notify_service (e.g. 'mobile_app_kc_phone')
    resolveNotifyService: (username) =>
      userService.getProfile(username)?.identities?.homeassistant?.notify_service ?? null,
    // System-category alerts are about the house, not about a person, so they
    // arrive with no `metadata.username` — and every channel resolves its
    // destination from that field. household.yml already names the head of
    // household for exactly this "default user for single-user operations" case.
    resolveDefaultRecipient: () => configService.getHeadOfHousehold(),
    configService,
    dataPath: dataBasePath,
    clock: null,
    logger: rootLogger.child({ module: 'notifications' }),
  });
  // Admin-facing config CRUD for household notification governance
  // (quiet hours, cooldowns). Kept separate from the runtime notificationStack.
  const notificationConfigService = new NotificationConfigService({
    repository: new YamlNotificationConfigRepository({
      configService,
      configFiles: new YamlConfigFileStore({ logger: rootLogger.child({ module: 'config-files' }) }),
    }),
    logger: rootLogger.child({ module: 'notifications', submodule: 'config' }),
  });

  // Lifeplan domain
  const lifeplanResult = bootstrapLifeplan({
    dataPath: path.join(dataBasePath, 'users'),
    aggregator: lifelogServices.lifelogAggregator,
    notificationService: notificationStack.notificationService,
    userService,
    // Household roster for the /life user switcher. getHouseholdUsers may return
    // plain usernames or richer { username } objects — normalize to usernames.
    listHouseholdUsers: () => (
      (configService.getHouseholdUsers(configService.getDefaultHouseholdId()) || [])
        .map((u) => (typeof u === 'string' ? u : (u?.username || u?.userId || u?.name)))
        .filter(Boolean)
    ),
    defaultUsername: configService.getHeadOfHousehold() || 'default',
    timezone: configService.getHouseholdTimezone(),
    // Typed-decision model for the coach's life-event suggestions (shadow by default).
    // agents config → lifeplan_guide.life_event_signals: { mode: shadow|decide|off, min_confidence }
    decisionGateway: scopedGateway(decisionGateway, { app: 'lifeplan' }),
    lifeEventSignals: configService.getAppConfig?.('agents')?.lifeplan_guide?.life_event_signals || {},
    clock: null,
    logger: rootLogger.child({ module: 'lifeplan' }),
  });

  // Gratitude domain
  const gratitudeServices = createGratitudeServices({
    dataService,
    logger: rootLogger.child({ module: 'gratitude' })
  });

  // Fitness domain
  const { loadFitnessConfig, fitnessServices } = await createFitnessServicesRuntime({ configService, createFitnessServices, mediaBasePath, householdId, get householdAdapters() { return householdAdapters; }, scopedGateway, get sharedAiGateway() { return sharedAiGateway; }, rootLogger });

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

  // Pose frame logging — streams raw keypoints to JSONL files
  await registerFitnessPoseRuntime({ configService, rootLogger, eventBus });

  // ==========================================================================
  // Create API v1 Routers
  // ==========================================================================
  // All DDD routers are collected here and mounted under /api/v1
  // Route names can be changed in api.mjs without affecting this file

  // Create unified item router (new item-centric API)
  // Resolve menu memory path from configService (bootstrap resolves config values)
  const menuMemoryPath = configService.getHouseholdPath('media/menu-memory');
  const itemRouter = createItemRouter({
    registry: contentRegistry,
    contentQueryService: contentServices.contentQueryService,
    menuMemoryPath,
    logger: rootLogger.child({ module: 'item-api' })
  });

  const v1Routers = {
    'pressure-mats': createPressureMatRouter({
      pressureMatOperations: new PressureMatOperations({ pressureMats: pressureMatAdapter }),
      logger: rootLogger.child({ module: 'pressure-mat-api' }),
    }),
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
  // Fixed service-principal objects are intentionally private to composition.
  // Authenticated ingress compares object identity, so neither an HTTP body
  // nor a generic event-bus message can impersonate these publishers.
  const schoolStateGatesPrincipal = Object.freeze({ service: 'school-state-gates-producer' });
  const fitnessStateGatesPrincipal = Object.freeze({ service: 'fitness-state-gates-producer' });
  // Threaded to KioskFrictionTracker in a later task — see kiosk-friction-detection Task 3.
  const kioskFrictionStateGatesPrincipal = Object.freeze({ service: 'kiosk-friction-tracker' });
  const stateGatesProducerScheduler = Object.freeze({
    schedule(delayMs, task) {
      const timer = setTimeout(task, delayMs);
      timer.unref?.();
      return () => clearTimeout(timer);
    },
  });
  const stateGatesModule = await createStateGatesModule({
    configService,
    eventBus,
    householdId,
    clock: { now: () => Date.now() },
    roleIds: Object.keys(authConfig.roles ?? {}),
    producerPrincipals: {
      school: schoolStateGatesPrincipal,
      fitness: fitnessStateGatesPrincipal,
      'kiosk-friction-tracker': kioskFrictionStateGatesPrincipal,
    },
    logger: rootLogger,
  });
  v1Routers.stateGates = stateGatesModule.stateGatesRouter;
  v1Routers.entitlements = stateGatesModule.entitlementsRouter;
  rootLogger.info('content.routers.created', { keys: ['item', 'content', 'proxy', 'list', 'siblings', 'queue', 'play', 'localContent', 'local', 'stream'] });

  // Info router (action-based metadata)
  const { createInfoRouter } = await import("../../__capabilities/content-catalog/server/api/info.mjs");
  // Both metadata and display routes need the same application service.  Passing
  // only the old constructor inputs to info left contentAccessService undefined
  // and made Plex enrichment fail before it could fetch metadata.
  const contentAccessService = new ContentAccessService({
    contentIdResolver: contentServices.contentIdResolver,
    contentCatalog: contentServices.contentCatalog,
  });
  v1Routers.info = createInfoRouter({
    contentAccessService,
    logger: rootLogger.child({ module: 'info-api' })
  });

  // Display router (action-based images)
  const { createDisplayRouter } = await import("../../__capabilities/content-catalog/server/api/display.mjs");
  v1Routers.display = createDisplayRouter({
    contentAccessService,
    logger: rootLogger.child({ module: 'display-api' })
  });

  const { householdMediaMemory, mediaHouse } = await createMediaApiRuntime({
    configService, mediaProgressMemory, contentServices, deviceLivenessService, playLedger, rootLogger, v1Routers, mediaServices, eventBus, loadOriginHints, contentRegistry, notificationStack, contentProxyService
  });

  // Livestream engine — concrete adapters composed here, injected as factories
  await installLivestream({ configService, rootLogger, eventBus, mediaBasePath, v1Routers });
  // Lazy proxy for webNutribotAdapter — filled after nutribot services are created below
  const { createWebNutribotProxy } = await import("../../__app_modules/wellness/nutribot/server/composition/webNutribotProxy.mjs");
  const webNutribotAdapterProxy = createWebNutribotProxy();

  let nutritionCleanup = null;
  let nutritionReceiptPublisher = null;
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
    cleanupProvider: () => nutritionCleanup,
    artworkProvider: () => nutritionCleanup?.artwork ?? null,
    receiptPublisherProvider: () => nutritionReceiptPublisher,
    aiUsageLedger,
    logger: rootLogger.child({ module: 'health-api' })
  });

  // Health dashboard router (agent-generated dashboards)
  v1Routers['health-dashboard'] = createHealthDashboardApiRouter({
    dataService,
    logger: rootLogger.child({ module: 'health-dashboard-api' })
  });

  // Health mentions router — powers CoachChat @-mention autocomplete dropdowns.
  // Mounted BEFORE the health router so /health/mentions/* is matched first.
  // Analytics is composed later with the agent services. Keep one semantic
  // mention service and late-bind only that optional capability; replacing the
  // router used to duplicate the same stale dependency bag twice.
  let healthAnalyticsService = null;
  v1Routers.healthMentions = createHealthMentionsApi({ healthServices, getHealthAnalyticsService: () => healthAnalyticsService });

  // Finance domain router
  v1Routers.finance = createFinanceApiRouter({
    financeServices,
    configService,
    logger: rootLogger.child({ module: 'finance-api' })
  });

  // Feed domain router (FreshRSS reader + headline harvesting + boonscrolling)
  if (feedServices) {  await installFeedApi({ configService, dataService, userService, rootLogger, userLoadFile, gratitudeServices, userLoadCurrent, contentServices, contentRegistry, mediaLibConfig, audiobookshelfConfig, mediaBasePath, feedServices, entropyServices, v1Routers });
}

  // Cost domain router
  v1Routers.cost = createCostApiRouter({
    costServices,
    logger: rootLogger.child({ module: 'cost-api' })
  });

  // Harvester application services
  // Create shared IO functions for lifelog persistence
  const userSaveFile = (username, service, data) => dataService.user.write(`lifelog/${service}`, data, username);
  // Current store needs a direct user write (no 'lifelog/' prefix)
  const userSaveFileDirect = (username, path, data) => dataService.user.write(path, data, username);

  // Image saving for Infinity harvester (mirrors legacy io.saveImage behavior)
  // Images are saved to media/img/{folder}/{uid}.jpg with 24-hour caching
  const imgBasePath = configService.getPath('img') || `${mediaBasePath}/img`;
  const saveImage = new HarvesterImageStore({ imageDirectory: imgBasePath }).save;

  // Household-level file saving for Infinity harvester state
  const householdSaveFile = (relativePath, data) => {
    // Save to household[-{hid}]/{path}
    return dataService.household.write(relativePath, data, householdId);
  };

  const harvesterIo = {
    userLoadFile,
    userSaveFile,
    userSaveFileDirect,
    saveImage,
    householdSaveFile,
    userLoadAuth: (username, service) => dataService.user.read(`auth/${service}`, username),
    userSaveAuth: (username, service, data) => dataService.user.write(`auth/${service}`, data, username),
  };

  const harvesterServices = createHarvesterServices({
    io: harvesterIo,
    httpClient: axios,
    configService,
    dataService, // Required for YamlWeatherDatastore (sharedStore)
    todoistApi: null, // Will use httpClient directly
    aiGateway: scopedGateway(sharedAiGateway, { app: 'harvester' }), // Shared OpenAI adapter
    // Reuse config-driven buxfer adapter from finance domain (use .has() to avoid NoOp)
    buxferAdapter: householdAdapters?.has?.('finance') ? householdAdapters.get('finance') : null,
    logger: rootLogger.child({ module: 'harvester' })
  });

  // Register headline harvester so scheduler can run feed-headlines job
  registerFeedHeadlineHarvester({ harvesterServices, feedServices, rootLogger });

  // Harvester health: every harvest result feeds the monitor, which pushes the
  // head of household when a source keeps failing, goes stale, or comes back.
  const { HarvesterHealthMonitor } = await import("./3_applications/harvester/HarvesterHealthMonitor.mjs");
  const { YamlHarvesterHealthStore } = await import("./1_adapters/harvester/YamlHarvesterHealthStore.mjs");
  const harvesterHealthLogger = rootLogger.child({ module: 'harvester-health' });
  const harvesterHealth = new HarvesterHealthMonitor({
    store: new YamlHarvesterHealthStore({ path: configService.getHouseholdPath('harvester-health') }),
    sendPush: async ({ title, message, data }) => {
      // Resolved per push so a later household reload is picked up.
      const haGateway = householdAdapters?.has?.('home_automation') ? householdAdapters.get('home_automation') : null;
      const recipient = configService.getHeadOfHousehold?.();
      const notifyService = recipient
        ? userService.getProfile(recipient)?.identities?.homeassistant?.notify_service
        : null;
      if (!haGateway || !notifyService) {
        harvesterHealthLogger.warn?.('harvester.health.no_push_target', { recipient: recipient || null });
        return;
      }
      await haGateway.callService('notify', notifyService, { title, message, data });
    },
    // Same zone the harvesters themselves use (bootstrap harvesterTimezone).
    timezone: configService.getTimezone?.() || null,
    failureThreshold: 3, // keep ≤ the harvesters' circuit-breaker maxFailures
    staleAfterDays: { withings: 7 },
    skip: ['strava'], // StravaSyncHealth already pushes for Strava
    logger: harvesterHealthLogger,
  });
  // Record (and push) only in the copy that owns the data; elsewhere GET /harvest
  // still reads the shared state.
  const { canRotateOAuthTokens } = await import("#system/runtime/runtimeEnvironment.mjs");
  harvesterHealth.watch(harvesterServices.harvesterService, { enabled: canRotateOAuthTokens() });

  // Create harvest router using HarvesterService
  const { DefaultPrincipalResolver } = await import("./3_applications/common/context/DefaultPrincipalResolver.mjs");
  const { NodePromiseDeadline } = await import("./1_adapters/scheduling/NodePromiseDeadline.mjs");
  v1Routers.harvest = createHarvestRouter({
    harvesterService: harvesterServices.harvesterService,
    principalResolver: new DefaultPrincipalResolver({
      headOfHousehold: () => configService.getHeadOfHousehold?.(),
      defaultUsername: () => configService.getDefaultUsername?.(),
      fallback: 'default',
    }),
    requestIds: { next: crypto.randomUUID },
    deadline: new NodePromiseDeadline(),
    timeoutPolicy: () => 120_000,
    healthReport: () => harvesterHealth.report(),
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
    weightService: createLifelogWeightService({ dataService, configService }),
    lifelogServices,
    dataService,
    configService,
    logger: rootLogger.child({ module: 'lifelog-api' })
  });

  // Lifeplan domain router
  v1Routers.life = lifeplanResult.router;

  // Static assets router. Equipment pictures are found by equipment id; the
  // fitness config may name a file instead, for equipment whose picture does
  // not share its id's spelling.
  v1Routers.static = createStaticApiRouter({
    imgBasePath,
    dataBasePath,
    equipmentImages: equipmentImageMap(configService.getHouseholdAppConfig(null, 'fitness')),
    logger: rootLogger.child({ module: 'static-api' })
  });

  const { artAdapter, artRouter } = await createArtContentRuntime({ configService, immichConfig, axios, imgBasePath, rootLogger, contentRegistry });
  v1Routers.art = artRouter;

  // App-wide voice-feedback capture + inbox. Background-transcribes via the shared
  // OpenAI gateway (null-safe: items still save when transcription isn't configured).
  // The notification service is what finally gives the inbox a reader: until now
  // arrival triggered nothing but a log line, so a recorded complaint sat in a
  // YAML file until somebody thought to go looking.
  const { FilesystemFeedbackRepository } = await import("./1_adapters/feedback/FilesystemFeedbackRepository.mjs");
  v1Routers.feedback = createFeedbackRouter({
    feedbackService: new FeedbackService({
      feedbackRepository: new FilesystemFeedbackRepository({
        itemsRoot: configService.getHouseholdPath('feedback'),
        mediaDir: mediaBasePath,
      }),
      transcriptionService: scopedGateway(sharedAiGateway, { app: 'feedback', feature: 'transcription' }),
      notificationService: notificationStack?.notificationService || null,
      resourcePresenter: publicResourceUrl,
      logger: rootLogger.child({ module: 'feedback' }),
    }),
    logger: rootLogger.child({ module: 'feedback-api' }),
  });

  const { gamingDefinitionStore, gamingManifestStore, partyGamesCatalog, partyGamesProfile, partyGamesPrinter } = createPartyGamesCatalogRuntime({ contentPath, rootLogger });

  const { gamingModule, gamingAssetCatalog } = createPartyGamesSessionRuntime({ gamingDefinitionStore, gamingManifestStore, partyGamesCatalog, partyGamesProfile, sharedAiGateway, partyGamesPrinter, rootLogger, mediaBasePath });

  const presentationCatalog = new YamlPresentationCatalog({
    catalogsDir: join(mediaBasePath, 'games/_common/catalog'),
    assetRoot: join(mediaBasePath, 'games/_common'),
  });
  const { gamingRouter } = createPartyGamesHttpRuntime({ gamingModule, gamingAssetCatalog, mediaBasePath, contentPath, rootLogger });

  v1Routers.gaming = gamingRouter;
  const { GetPublicPresentationCatalog } = await import("./3_applications/presentation/GetPublicPresentationCatalog.mjs");
  v1Routers.presentation = createPresentationRouter({
    catalog: presentationCatalog,
    getPublicCatalog: new GetPublicPresentationCatalog({ catalog: presentationCatalog }),
    logger: rootLogger.child({ module: 'presentation-api' }),
  });

  const chessRuntime = createChessRuntime({configService,dataService,rootLogger,server});
  const pianoBoardGameDayService = createPianoBoardGameDayRuntime({configService,householdId,rootLogger});
  // The native Chess router retains its compatibility endpoints, but their
  // dialogue and rivalry work is delegated to the shared board-game services
  // created immediately below. The closures are invoked only after startup,
  // when `pianoGamesModule` has been assigned.
  let pianoGamesModule;
  const sharedChessCommentary = {
    react: ({ userId, gameId, ply, level, playerColor, game, dialogue }) => (
      pianoGamesModule.container.dialogue('chess', {
        userId, sessionId: gameId, ply, level, playerSide: playerColor,
        transcript: game, dialogue,
      })
    ),
  };
  const sharedChessRivalry = {
    recordArchive: (record) => pianoGamesModule.container.recordRivalry('chess', record),
    // The record against this opponent, counting the game just finished even
    // if its archive write has not reached rivalry memory yet.
    headToHead: async (userId, record) => {
      const opponentId = rivalryOpponentId(record, 'chess');
      if (!userId || !opponentId) return null;
      const rival = await pianoGamesModule.container.rivalry('chess', userId, opponentId);
      return projectHeadToHead(rival, {
        gameId: record?.game_id, completed: record?.completed, result: record?.result, opponent: record?.opponent,
      });
    },
  };
  const pianoChessRouter = chessRuntime.createRouter({pianoBoardGameDayService,sharedChessCommentary,sharedChessRivalry});

  pianoGamesModule = createPianoGamesModule({
    dataService,
    configService,
    logger: rootLogger.child({ module: 'piano-games' }),
    nativeRouters: { chess: pianoChessRouter },
    boardGameDayService: pianoBoardGameDayService,
    aiGateway: scopedGateway(sharedAiGateway, { app: 'piano-games' }),
  });
  server?.once?.('close', () => pianoGamesModule.container.dispose());
  v1Routers['piano-games'] = pianoGamesModule.router;

  // Self-hosted Wikipedia (kiwix-backed, plain-text) proxy. URL from services.yml;
  // router is skipped entirely when no wikipedia service is declared.
  const wikipediaUrl = configService.resolveServiceUrl('wikipedia');
  if (wikipediaUrl) {
    const encyclopedia = new WikipediaAdapter({
      baseUrl: wikipediaUrl,
      logger: rootLogger.child({ module: 'wikipedia' }),
    });
    v1Routers.wikipedia = createWikipediaRouter({
      wikipediaService: new WikipediaService({ encyclopedia }),
      logger: rootLogger.child({ module: 'wikipedia-api' }),
    });
  }

  // School router (banks/sessions + materials framework) is constructed below
  // after the shared content adapters have been registered.

  // Content-filter cascade (EDL + profile + override) for the Player's
  // useContentFilter hook. Curated policy from data/household/content-filter/,
  // machine-fetched EDLs from media/content-filter/.
  v1Routers['content-filter'] = await createContentFilterRuntime({configService,rootLogger});

  v1Routers.emulator = createEmulatorRuntime({configService,rootLogger,eventBus});

  // Eink router — renders panels for hardware e-paper displays (Seeed reTerminal).
  const { createEinkModule } = await import("../../__app_modules/household/screens/server/display-runtime.mjs");
  v1Routers.eink = await createEinkModule({ configService, householdId, dataService, mediaBasePath, rootLogger });

  // Config router - serves configuration to frontend
  const configApiYamlSource = new ConfigApiYamlSource({
    contentPrefixesPath: path.join(configService.getHouseholdPath(''), 'media', 'content-prefixes'),
    playerConfigPath: path.join(configService.getHouseholdPath(''), 'player', 'config'),
  });
  v1Routers.config = createConfigRouter({
    configQueryService: new ConfigQueryService({
      loadContentPrefixes: configApiYamlSource.loadContentPrefixes,
      loadPlayerConfig: configApiYamlSource.loadPlayerConfig,
      logger: rootLogger.child({ module: 'config-query' }),
    }),
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
    dataService,
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
        codepage: cfg.codepage ?? printerDefaults.codepage ?? 'cp858',
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

  // Party Games buzzers ride the same MQTT selector adapter as fitness selectors.
  const handlePartyGamesBuzz = makeBuzzerSelectHandler(broadcastEvent, gamingModule.observability);

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
    // NOTE: the USB-scanner-over-MQTT barcode ingest is retired. The barcode scan
    // pipeline is now fed by the BLE barcode-relay (see the "Barcode scan pipeline"
    // block later in this file), so no MQTT barcode adapter config is passed here.
    onMqttMessage: (payload) => {
      // Broadcast MQTT sensor messages to WebSocket clients
      broadcastEvent({ topic: 'sensor', ...payload });
    },
    selectors: [
      ...((configService.getHouseholdAppConfig(householdId, 'fitness') || {}).selectors || []),
      ...buzzersToSelectors((configService.getHouseholdAppConfig(householdId, 'party-games') || {}).buzzers),
    ],
    onSelectorSelect: (selection) => {
      if (selection?.equipmentId === 'party-games') {
        handlePartyGamesBuzz(selection);
        return;
      }
      // selection: { selectorId, equipmentId, userId, action }
      broadcastEvent({ topic: 'rider_select', ...selection });
    },
    aiUsageLedger,
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

  // Initialize MQTT selector adapter if configured and enabled
  if (enableMqtt && hardwareAdapters.selectorAdapter?.isConfigured()) {
    if (hardwareAdapters.selectorAdapter.init()) {
      rootLogger.info('selector.mqtt.initialized', {
        topics: hardwareAdapters.selectorAdapter.getStatus().topics,
      });
    }
  }

  // Barcode ingress (gatekeeper → queue/play/open → TV-wake) now routes through
  // the unified trigger pipeline (TriggerDispatchService, wired below once it
  // exists) rather than the retired BarcodeScanService. This block still owns
  // every barcode-modality derivation (scanner device map, screen→display
  // scripts, screen→device map) and builds the ContentDispatcher those
  // derivations feed; the BLE relay itself is wired further down, after
  // createTriggerApiRouter() hands back a live triggerDispatchService.
  // Known screens, so a content device without a screen_path fuzzy-matches one
  // (office-tv → /screen/office) before falling back to living-room. One
  // resolver serves the barcode screen→device map below and the device
  // builder, so a scan and a load agree on which device owns which screen.
  let deviceScreens = [];
  try {
    const { entries } = await new FilesystemScreensRepository({ householdDir, logger: rootLogger })
      .listScreenDocuments();
    deviceScreens = entries
      .filter(({ document }) => document)
      .map(({ id, document }) => ({ id: document.screen || id, route: document.route }));
  } catch (err) {
    rootLogger.warn('devices.screens.list_failed', { error: err?.message });
  }
  const screenAddressResolver = new ScreenAddressResolver({ screens: deviceScreens });

  let barcodeContentDispatcher = null;
  let barcodeScreenBroadcast = null;
  let barcodeLogger = null;
  let barcodeKnownScanners = [];
  let barcodePersistDir = null;
  // Every name a legacy positional code can carry in its FIRST segment. Hoisted
  // out of the block below so the scan-dispatch wiring can check it against the
  // prefix registry — `ScanCode` imports nothing and cannot read config, so
  // composition is the first place both lists exist at once.
  let barcodeScreenNames = [];
  {
    const barcodeConfig = configService.getHouseholdAppConfig(householdId, 'barcode') || {};
    const barcodeDevicesConfig = configService.getHouseholdDevices(householdId) || {};

    // Scanner device map (barcode-scanner type — now the BLE relay device).
    const scannerDeviceConfig = {};
    const barcodeDevices = barcodeDevicesConfig.devices || {};
    for (const [id, device] of Object.entries(barcodeDevices)) {
      if (device.type === 'barcode-scanner') scannerDeviceConfig[id] = device;
    }

    // Screen topic → display on_script map, for TV wake on approved content.
    const haGateway = householdAdapters?.has?.('home_automation') ? householdAdapters.get('home_automation') : null;
    const screenDisplayScripts = {};
    for (const [, device] of Object.entries(barcodeDevices)) {
      const topic = device.content_control?.topic;
      const displays = device.device_control?.displays;
      if (topic && displays) {
        const scripts = Object.values(displays)
          .filter(d => d.on_script)
          .map(d => d.on_script);
        if (scripts.length > 0) screenDisplayScripts[topic] = scripts;
      }
    }

    // Screen → deviceId map (was built later, near wakeAndLoadService, for
    // BarcodeScanService.setLoadFallback; now built here so ContentDispatcher's
    // loadFallback can close over it directly). Reuses the same device config
    // source (getHouseholdDevices) the scanner map above reads from.
    // A declared screen_path claims its screen first; a content device without
    // one takes its fuzzy-matched screen only if nobody declared it. The
    // living-room default never claims a screen here.
    const screenToDevice = {};
    for (const [id, device] of Object.entries(barcodeDevices)) {
      const screenPath = device.screen_path; // e.g. "/screen/living-room"
      if (screenPath) {
        const screenName = screenPath.replace(/^\/screen\//, '');
        screenToDevice[screenName] = id;
      }
    }
    for (const [id, device] of Object.entries(barcodeDevices)) {
      if (device.screen_path || !device.content_control) continue;
      const matched = screenAddressResolver.match({ id, location: device.location });
      if (matched && !screenToDevice[matched.name]) screenToDevice[matched.name] = id;
    }

    barcodeLogger = rootLogger.child({ module: 'barcode' });

    barcodeScreenBroadcast = (targetScreen, payload) => broadcastEvent({ topic: targetScreen, ...payload, source: 'barcode', targetScreen });

    // NOTE: `wakeAndLoadService` is declared later in this same function
    // (createApp) via createWakeAndLoadService(); this closure only reads it
    // when invoked (on an ack-timeout fallback), by which point it is
    // assigned. Mirrors the deferred-binding pattern the old
    // BarcodeScanService.setLoadFallback() wiring used.
    barcodeContentDispatcher = new ContentDispatcher({
      screenBroadcast: barcodeScreenBroadcast,
      waitForAck: (predicate, timeoutMs) => eventBus.waitForMessage(predicate, timeoutMs),
      loadFallback: async (targetScreen, query) => {
        const deviceId = screenToDevice[targetScreen];
        if (!deviceId) return;
        return wakeAndLoadService.execute(deviceId, query);
      },
      onContentApproved: async (targetScreen) => {
        const scripts = screenDisplayScripts[targetScreen];
        if (!scripts || !haGateway) return;
        for (const scriptId of scripts) {
          try {
            await haGateway.callService('script', 'turn_on', { entity_id: scriptId });
            barcodeLogger.info?.('trigger.ingress.barcode.display.on', { targetScreen, scriptId });
          } catch (err) {
            barcodeLogger.warn?.('trigger.ingress.barcode.display.failed', { targetScreen, scriptId, error: err.message });
          }
        }
      },
      logger: barcodeLogger,
    });

    barcodeKnownScanners = Object.keys(scannerDeviceConfig);
    barcodePersistDir = barcodeConfig.persistence?.dir;
    // Both sources a `<screen>:<source>:<id>` code can name: the screen-path
    // slug and the content-control broadcast topic.
    barcodeScreenNames = [...new Set([
      ...Object.keys(screenToDevice),
      ...Object.keys(screenDisplayScripts),
      ...Object.values(barcodeDevices).map((d) => d.content_control?.topic).filter(Boolean),
    ])];

    rootLogger.info('barcode.dispatcher.ready', {
      scanners: barcodeKnownScanners,
      actions: barcodeConfig.actions || ['queue', 'play', 'open'],
    });
  }

  rootLogger.info('hardware.initialized', {
    printers: printerRegistry.list(),
    tts: hardwareAdapters.ttsAdapter?.isConfigured() || false,
    mqtt: hardwareAdapters.mqttAdapter?.isConfigured() || false,
    barcode: !!barcodeContentDispatcher // unified-trigger-pipeline-fed (USB/MQTT ingest retired)
  });

  // Gratitude domain router - gratitude card canvas renderer
  let createGratitudeCardCanvas = null;
  try {
    const { createGratitudeCardRenderer } = await import("../../__app_modules/personal/gratitude/server/rendering.mjs");
    const { GratitudePrintPresentationService } = await import("../../__app_modules/personal/gratitude/server/print-presentation.mjs");
    const householdId = configService.getDefaultHouseholdId();
    const presentation = new GratitudePrintPresentationService({
      gratitude: gratitudeServices.gratitudeService,
      resolveGroupLabel: (userId) => userService.resolveGroupLabel(userId),
      clock: { now: () => Date.now() },
      random: Math.random,
      counts: { gratitude: 2, hopes: 2 },
    });
    const renderer = createGratitudeCardRenderer({
      getSelectionsForPrint: () => presentation.prepare(householdId),
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

  // Household economy — per-user wallets, earn/deposit, metered spend sessions.
  // `economyApi` is created earlier (above the content routers) so its
  // economyService can back the play /log earn-hook; here we only mount the router.
  v1Routers.economy = economyApi.router;

  // Automotive — the vehicle record system (trips, maintenance, fuel, glove
  // box). Reads the history tree the relay above writes, plus hand-entered
  // records under household/automotive/. Same `vehicles` config as the relay,
  // so both agree on where trips live.
  v1Routers.automotive = createAutomotiveApi({
    configService,
    vehiclesConfig: configService.getHouseholdAppConfig(householdId, 'vehicles') || {},
    logger: rootLogger.child({ module: 'automotive-api' }),
  }).router;

  // Printer router — thermal printer control, multi-printer via optional {/:location} URL segment
  v1Routers.printer = createPrinterRouter({
    printerService: new PrinterControlService({
      fleet: hardwareAdapters.printerRegistry,
      readPrintOutcome,
    }),
  });

  // QR Code renderer and router
  const { createQRCodeRenderer } = await import('#rendering/qrcode/QRCodeRenderer.mjs');
  const { createGenerateQRCode } = await import('#apps/qrcode/GenerateQRCode.mjs');
  const { QRCodeAssetAdapter } = await import('#adapters/qrcode/QRCodeAssetAdapter.mjs');
  const { createQRCodeRouter } = await import("./4_api/v1/routers/qrcode.mjs");
  const qrcodeRenderer = createQRCodeRenderer({ mediaPath: mediaBasePath });
  // Resolve default barcode target screen from devices config
  const _qrDeviceConfig = configService.getHouseholdDevices(householdId) || {};
  const _qrDevices = _qrDeviceConfig.devices || {};
  const _qrDefaultScreen = Object.values(_qrDevices)
    .find(d => d.type === 'barcode-scanner')?.target_screen || null;
  const qrcodeLogger = rootLogger.child({ module: 'qrcode' });
  const qrcodeInternalBaseUrl = _qrDeviceConfig.daylightHostInternal
    || _qrDeviceConfig.daylightHost
    || `http://localhost:${process.env.PORT || 3111}`;
  const generateQRCode = createGenerateQRCode({
    renderer: qrcodeRenderer,
    createContentExpression: (value) => new ContentExpression(value),
    knownCommands: KNOWN_COMMANDS,
    contentIdResolver: contentServices.contentIdResolver,
    contentCatalog: contentServices.contentCatalog,
    assetGateway: new QRCodeAssetAdapter({
      mediaPath: mediaBasePath,
      defaultLogoPath: `${mediaBasePath}/img/buttons/play.svg`,
      internalBaseUrl: qrcodeInternalBaseUrl,
      logger: qrcodeLogger,
    }),
    defaultScreen: _qrDefaultScreen,
    logger: qrcodeLogger,
  });

  v1Routers.qrcode = createQRCodeRouter({
    generateQRCode,
    contentExpression: ContentExpression,
    logger: qrcodeLogger,
  });

  // Catalog PDF router
  const { createGenerateCatalog } = await import("../../__capabilities/content-catalog/server/application/catalog/GenerateCatalog.mjs");
  const { HttpCatalogListSource } = await import('#adapters/catalog/HttpCatalogListSource.mjs');
  const { renderCatalogPdf } = await import("../../__capabilities/content-catalog/server/rendering/catalog/renderCatalogPdf.mjs");
  const { createCatalogRouter } = await import("../../__capabilities/content-catalog/server/api/catalog.mjs");
  v1Routers.catalog = createCatalogRouter({
    generateCatalog: createGenerateCatalog({
      createContentExpression: (value) => new ContentExpression(value),
      listSource: new HttpCatalogListSource({ baseUrl: qrcodeInternalBaseUrl }),
      generateQRCode,
      renderPdf: renderCatalogPdf,
      logger: rootLogger.child({ module: 'catalog' }),
    }),
    contentExpression: ContentExpression,
    logger: rootLogger.child({ module: 'catalog' }),
  });

  // Printable sheets — config-driven pages of scannable marks that act as input
  // devices (the nutrition fridge sheet is the first). Providers are injected
  // rather than imported by the service, which is what keeps the printed codes
  // and the parsing grammar from drifting: both come from ScanVocabularyService.
  v1Routers.sheets = await createInstalledPrintableSheets({configService,householdId,rootLogger});

  // Nutribot report renderer (canvas-based PNG generation)
  const nutribotReportRenderer = await createNutribotReportRenderer({ configService, rootLogger });

  // Fitness receipt renderer (canvas-based PNG generation)
  const { createFitnessReceiptCanvas } = await createFitnessReceiptRuntime({ fitnessServices, householdId, userService, configService, mediaBasePath, rootLogger });

  // One playable authority is shared by Fitness, Piano, School, and Agents.
  // It owns the ProviderFitnessContentCatalog boundary and its caches.
  const fitnessPlayableModule = createFitnessPlayableModule({
    configService,
    fitnessConfig: loadFitnessConfig(householdId),
    contentRegistry,
    contentQueryService: contentServices.contentQueryService,
    logger: rootLogger.child({ module: 'fitness-playable' }),
  });
  const { fitnessConfigService, fitnessPlayableService } = fitnessPlayableModule;

  // Piano kiosk API — per-user studio, preferences, lesson progress, and
  // course video progress. Composition root: build the persistence adapter +
  // PianoContainer (persistence + the two course algorithms), inject the
  // container into the thin router. fitnessPlayableService provides Plex
  // enrichment for the /courses/:id/playable + /courses/progress endpoints.
  const { router: pianoRouter, pianoStudioDatastore, composerSongStore, pianoContainer, pianoGameBudgetService, pianoChallengeProfileService, schoolPianoChallengeCompletionService, schoolTeacherConfig, schoolTeacherGate } = await createPianoModule({
    configService, userService, rootLogger, contentRegistry, householdId, contentPath, fitnessPlayableService, contentServices, eventBus, shortId, pianoBoardGameDayService, PianoConfigProjection,
    schoolLearnerDirectory: { listLearners: () => schoolLearnerDirectory.listLearners() },
  });
  v1Routers.piano = pianoRouter;

  // School (portal homeschool): banks from data/content/school/{subject}/quizzes/, per-user
  // append-only attempt log under data/users/{id}/apps/school/attempts/, plus
  // the materials framework (catalog + per-unit progress/quiz gates).
  const { schoolDatastore, schoolFullConfig, schoolSessionResultArtifacts, schoolLearnerDirectory, schoolAcademicPeriods, schoolMilestoneStore, schoolEnrichmentLog, schoolService, schoolLearningEvidence, schoolLearningLoop, getLearningProgress, getInstructionalInsights, recordLearningReflection } = await createSchoolLearningRuntime({ configService, userService, householdId, rootLogger, schoolTeacherGate, get schoolTeacherNotes() { return schoolTeacherNotes; }, contentPath, scopedGateway, get sharedAiGateway() { return sharedAiGateway; }, get schoolLifecycle() { return schoolLifecycle; }, });
  // The shared exercise-reference corpus (~1,296 exercises, 38 muscle essays, 29
  // equipment records). TWO products read it: Fitness (browse/build/run, plus
  // SaveWorkout's existence check) and School (the anatomy shelf, which projects
  // the muscle essays into learning-catalog lessons). It is constructed HERE,
  // ahead of both, because it parses a ~2.8 MB manifest once and serves everything
  // from memory — a second instance would double that for no benefit. A missing
  // manifest degrades to an empty corpus rather than failing boot.
  const exerciseLibrary = new YamlExerciseLibraryRepository({
    indexPath: configService.getHouseholdPath('fitness/exercise-index.yml'),
    logger: rootLogger.child({ module: 'exercise-library' })
  }).load();
  // The authored Catalog is a School capability shared by web, print, and
  // calculator surfaces. It is composed before—and independently of—the
  // optional SchoolCalc device product.
  const { schoolCatalog, flashcardStudy, flashcardAssets, cardLadderConfig, cardLadderStudy, cardLadderTest, cardLadderTuning, openCatalogLearningSession, offerCatalogQuizRemediation, issueContinuationCode, schoolSurfaces, getSchoolScreenConfig, schoolCalc, schoolMaterialProgressStore, getMaterialCatalog, getMaterialUnits, getMaterialProgressSummary } = await createSchoolCatalogRuntime({ configService, householdId, schoolLearnerDirectory, exerciseLibrary, rootLogger, schoolService, schoolTeacherGate, schoolFullConfig, dataDir, scopedGateway, get sharedAiGateway() { return sharedAiGateway; }, get decisionGateway() { return decisionGateway; }, schoolDatastore, agentUsageRecorder, notificationStack, server, enableScheduler, schoolLearningLoop, householdDir, getLearningProgress, schoolLearningEvidence, SchoolUserVideoProgressStore, contentRegistry, NodeAsyncScheduler });

  // Sentence Ladder mounts under School at /api/v1/school/sentence-ladder.
  // /language remains a deprecated compatibility alias. Corpora live in
  // data/content/language/, per-user
  // progress + append-only log under data/users/{id}/apps/school/language/,
  // audio + recordings on the media mount. The timezone is passed rather than
  // a fixed offset so the 4am study-day boundary survives DST.
  // In memory by design: a restart loses presence, which the gate resolves to
  // `hindered` (the safe direction), and the next APK heartbeat restores it.
  const presenceStore = new PresenceStore({
    logger: rootLogger.child({ module: 'device-presence' })
  });
  {
    // A misspelled role fails OPEN (correct), but silently — which is the very
    // failure mode the design rejects: "the control stops working and nobody
    // finds out". Say so at boot.
    const cfg = configService.getHouseholdAppConfig(null, 'school')?.gate;
    for (const d of cfg?.devices || []) {
      if (!ROLE_SEVERITY[d?.role]) {
        rootLogger.warn('school.gate.role-unknown', {
          role: d?.role, mac: d?.mac, known: Object.keys(ROLE_SEVERITY),
        });
      }
    }
  }

  // Physical parental gate: the Portal APK reports Bluetooth presence, and
  // School obeys. Required devices come from school.yml `gate.devices`; with
  // none configured the gate resolves open, so a household that has not opted
  // in is never locked out. Failure direction is "cannot confirm -> hindered"
  // (see 2_domains/school/accessGate.mjs).
  // Read PER RESOLUTION, not once at boot. Household app config is boot-cached,
  // so a gate misfiring at 8pm would otherwise need a container restart to
  // relieve — the worst possible recovery story for a control that will
  // sometimes be wrong. `gate.force: open|closed|auto` is the parent's lever.
  const { schoolStudyGrants, schoolReelGrants, schoolCubeGrants, schoolBookGrants, schoolBookPanelGrants, schoolLaunchPreviewTokens, schoolDebriefGrants, languageReelService, rubiksCubeService, languageTranscription, languageStudyService } = await createSchoolLanguageRuntime({ configService, rootLogger, jwtSecret, PANEL_BOOK_GRANT_TTL_MS, createLanguageTranscriptionService, scopedGateway, get sharedAiGateway() { return sharedAiGateway; }, get decisionGateway() { return decisionGateway; }, schoolFullConfig, eventBus, presenceStore });
  // School lifecycle (+ its report/print-service/router mounting) moved
  // further down this function (Task 13) — it now depends on the real,
  // household-level DoNow service, which itself depends on seams
  // (`wakeAndLoadService`, home-automation adapters, the playback-hub
  // container) that don't exist yet at this point in boot. See "School
  // physical console" below, right after `donow` is constructed.

  // Strava webhook enrichment (provider-agnostic webhook, Strava adapter)
  let fitnessStateGatesProducer = null;
  const { stravaEnrichmentService, stravaReconciliationService, stravaSyncHealth } = await createFitnessApiRuntime({ createSchoolLearnerDirectory, get fitnessStateGatesProducer() { return fitnessStateGatesProducer; }, configService, rootLogger, axios, NodeApplicationScheduler, get householdAdapters() { return householdAdapters; }, userService, harvesterServices, v1Routers, eventBus, loadFitnessConfig, householdId, exerciseLibrary, fitnessServices, userDataService, contentRegistry, contentServices, get createFitnessReceiptCanvas() { return createFitnessReceiptCanvas; }, hardwareAdapters, fingerprintProfileWriter, fitnessPlayableModule });

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

  // Ambient brightness: HA illuminance sensors → per-zone eventbus topics → ArtMode dim.
  // ambient.yml lives under the household config dir → read via the household apps map.
  // Each zone (room) broadcasts its lux on its own topic; the screen config picks the
  // topic + curve for that room. See ambientZones.mjs.
  await startHomeAmbient({ configService, homeAutomationAdapters, rootLogger, eventBus, server });
  // Import FileIO functions for state persistence (replaces legacy io.mjs)
  // Reuse householdDir from earlier (line 157)
  const householdYamlDocuments = new HouseholdYamlDocumentStore({ householdDirectory: householdDir });
  const loadFile = householdYamlDocuments.load;
  const saveFile = householdYamlDocuments.save;
  // Directory listing for config that is split into grouped files (NFC tag
  // bindings: books.yml, cards.yml, …). Returns [] when the directory is absent
  // so a household still on the single-file layout loads unchanged.
  const yamlDirectoryCatalog = new FilesystemYamlDirectoryCatalog({ root: householdDir });
  const listDir = (relativePath) => yamlDirectoryCatalog.list(relativePath);

  const eventAggregationService = await createHomeEvents({ configService, dataService, rootLogger });

  v1Routers.home = createHomeAutomationApiRouter({
    adapters: homeAutomationAdapters,
    loadFile,
    saveFile,
    householdId,
    entropyService: entropyServices.entropyService,
    configService,
    eventAggregationService,
    immichAdapter: contentRegistry?.get?.('immich') || null,  // gallery source for /home/photo (eink)
    artAdapter,  // ArtMode collection resolver for /home/photo?collection=<name> (eink)
    logger: rootLogger.child({ module: 'home-automation-api' })
  });

  // Home-dashboard (unified dashboard API: config/state/history/toggle/scene).
  // Only mounted when a Home Assistant gateway is available.
  const homeDashboardRouter = createHomeDashboardApiRouter({
    haGateway: homeAutomationAdapters.haGateway,
    configService,
    logger: rootLogger.child({ module: 'home-dashboard-api' })
  });
  if (homeDashboardRouter) {
    v1Routers['home-dashboard'] = homeDashboardRouter;
  }

  // Playback Hub domain — wraps the kckern-playback-hub HTTP API + YAML config
  // datastore. Container starts the HubStatusBroadcaster long-running service
  // and is stopped on SIGTERM below.
  let playbackHubContainer = null;
  try {
    const playbackHubServices = await createPlaybackHubServices({
      configService,
      eventBus,
      logger: rootLogger.child({ module: 'playback-hub' }),
    });
    if (playbackHubServices) {
      playbackHubContainer = playbackHubServices.container;
      v1Routers['playback-hub'] = playbackHubServices.router;
    }
  } catch (err) {
    rootLogger.error('playback-hub.bootstrap_failed', {
      error: err?.message,
      stack: err?.stack,
    });
  }

  // Device registry domain
  const devicesConfig = configService.getHouseholdDevices(householdId);
  // daylight_host is the callback URL for this app - derive from app port or device config
  const appPort = configService.getAppPort();
  const daylightHost = devicesConfig.daylightHost || `http://localhost:${appPort}`;
  const deviceServices = await createDeviceServices({
    devicesConfig: devicesConfig.devices || {},
    screenAddressResolver,
    haGateway: homeAutomationAdapters.haGateway,
    httpClient: axios,
    wsBus: eventBus,
    remoteExec: homeAutomationAdapters.remoteExecAdapter,
    daylightHost,
    configService,
    logger: rootLogger.child({ module: 'devices' })
  });

  // Screen presence → HA input_boolean (e.g. office_tv_active). Reads the
  // `presence:` block on each device in devices.yml. No-op if no device declares
  // one or the HA gateway is absent.
  createScreenPresenceService({
    presenceGateway: devicePresenceGateway,
    haGateway: homeAutomationAdapters.haGateway,
    devicesConfig: devicesConfig.devices || {},
    logger: rootLogger.child({ module: 'screen-presence' }),
  });

  // Play-time observation for devices declaring `arcade_session_observation: true`, plus
  // the always-available HTTP ingress used by self-reporting browser emulators.
  // Observation is the default; warning/termination behavior exists only when
  // games.yml explicitly selects `arcade_sessions.mode: enabled`. While no game
  // is in the foreground, each polled device costs one kiosk
  // REST call per device per interval — ADB is only consulted once the emulator
  // is actually in front, so an idle house is nearly free.
  const arcadeGameSessionTracking = createArcadeGameSessionTracking({
    devicesConfig: devicesConfig.devices || {},
    gamesConfig: configService.getHouseholdAppConfig(householdId, 'games'),
    gamesCatalog: dataService.household.read('gaming/retroarch/catalog'),
    arcadeOverlayConfig: configService.getHouseholdAppConfig(householdId, 'arcade-overlay'),
    configService,
    eventBus,
    httpClient: axios,
    daylightHost,
    haGateway: homeAutomationAdapters.haGateway,
    profileFor: (username) => userService.getProfile(username),
    logger: rootLogger.child({ module: 'arcade-game-sessions' }),
  });
  await arcadeGameSessionTracking.start();
  server?.once?.('close', () => arcadeGameSessionTracking.stop());

  // HTTP surface: push ingress for surfaces that report their own lifecycle,
  // plus session and health reads. Present even when nothing is metered, so a
  // caller gets an explicit 503 rather than a 404 that looks like a typo.
  v1Routers['arcade-game-sessions'] = createArcadeGameSessionsRouter({
    recordObservation: arcadeGameSessionTracking.recordObservation,
    sessions: arcadeGameSessionTracking.sessions,
    trackers: arcadeGameSessionTracking.trackers,
    watchdog: arcadeGameSessionTracking.watchdog,
    sessionMonitor: arcadeGameSessionTracking.sessionMonitor,
    grantLedger: arcadeGameSessionTracking.grantLedger,
    grantArcadeGameTime: arcadeGameSessionTracking.grantArcadeGameTime,
    checkEligibility: arcadeGameSessionTracking.checkEligibility,
    summariseArcadeGameUsage: arcadeGameSessionTracking.summariseArcadeGameUsage,
    logger: rootLogger.child({ module: 'arcade-game-sessions-api' }),
    placements: arcadeGameSessionTracking.placements,
  });

  // Piano-power → tablet-screen authority. DS becomes the single writer for the
  // OFF side of the yellow-room tablet's FKB screen: piano OFF ⇒ screen OFF
  // (debounced + reconciled), piano OFF→ON edge ⇒ pulse screen ON. Disabled by
  // default (config `piano.screen_power_sync.enabled`); no-ops without HA/device.
  // Not a two-writer conflict with screen-presence: that device is not
  // presence-managed, and presence actuates HA input_booleans, not the backlight.
  createPianoScreenPowerSync({
    getScreenOverrideService,
    haGateway: homeAutomationAdapters.haGateway,
    deviceService: deviceServices.deviceService,
    configService,
    householdId,
    logger: rootLogger.child({ module: 'piano-screen-authority' }),
  });

  // MIDI-note → tablet-screen wake. An always-on WS client of the piano-bridge
  // APK's note fan-out: playing the piano pokes FKB screenOn even when the WebView
  // is dark (so its own Web-MIDI/touch wake can't fire). Debounced; disabled by
  // default (config `piano.midi_wake.enabled`). Complements the power-edge wake in
  // PianoScreenAuthorityService — no two-writer conflict (that service force-OFFs
  // only when the piano is off, i.e. when there is no MIDI to wake on).
  const { pianoMidiWakeService } = createPianoMidiWake({
    getScreenOverrideService,
    deviceService: deviceServices.deviceService,
    configService,
    householdId,
    logger: rootLogger.child({ module: 'piano-midi-wake' }),
  });

  // Kiosk unsupervised-input friction (Portal, yellow-room tablet, …) →
  // State Gates. Republishes a per-device-per-day `kiosk.friction-score`
  // claim (corrected in place, strictly increasing sourceRevision) that the
  // installed `kiosk.friction-ok` gate/`kiosk.access` entitlement (fail_open)
  // read. `stateGatesModule`/`kioskFrictionStateGatesPrincipal` are wired
  // above alongside `producerPrincipals`. windowMs AND denialThreshold both
  // mirror the installed policy's `kiosk.friction-ok` gate — see the
  // "PROVISIONAL threshold" comment on that gate in
  // installedStateGatesPolicy.mjs (currently `lt 5`); keep all three in
  // sync if any changes. denialThreshold only affects the tracker's publish
  // debounce (a ping that crosses it always publishes immediately, so a
  // cooldown starts/ends promptly) — left at the class default otherwise.
  const kioskFrictionTracker = new KioskFrictionTracker({
    ingress: stateGatesModule.ingress,
    householdId,
    principal: kioskFrictionStateGatesPrincipal,
    windowMs: 5 * 60 * 1000,
    denialThreshold: 5,
    scheduler: new NodeApplicationScheduler(),
    logger: rootLogger.child({ module: 'kiosk-friction-tracker' }),
  });

  // Per-device "is a video playing" registry (excludes ArtMode scenes), fed by
  // the same `screen.presence` heartbeat. Read by the ambient scheduler.
  const screenContentTracker = new ScreenContentTracker({
    presenceGateway: devicePresenceGateway,
    logger: rootLogger.child({ module: 'screen-content' }),
  });
  screenContentTracker.start();

  // Transcode pre-warming for device loads
  const { prewarmService } = createTranscodePrewarmService({
    contentIdResolver: contentServices.contentIdResolver,
    contentCatalog: contentServices.contentCatalog,
    mediaProgressMemory: mediaProgressMemory,
    appBaseUrl: `http://localhost:${appPort}`,
    logger: rootLogger.child({ module: 'prewarm' })
  });

  // Command-handler liveness tracker — gates WS-first warm-switch on positive
  // proof a frontend command handler (useCommandAckPublisher) is mounted.
  const commandHandlerLivenessService = new CommandHandlerLivenessService({
    presenceGateway: devicePresenceGateway,
    logger: rootLogger.child({ module: 'command-handler-liveness' }),
  });
  commandHandlerLivenessService.start();

  const { wakeAndLoadService } = createWakeAndLoadService({
    deviceService: deviceServices.deviceService,
    haGateway: homeAutomationAdapters.haGateway,
    devicesConfig: devicesConfig.devices || {},
    broadcast: broadcastEvent,
    eventBus,
    prewarmService,
    sessionControlService,
    commandHandlerLivenessService,
    deviceLivenessService,
    logger: rootLogger.child({ module: 'wake-and-load' })
  });

  callLeaseService = createHomelineLease({ deviceService: deviceServices.deviceService, wakeAndLoadService, logger: rootLogger.child({ module: 'homeline-lease' }), clock: { now: () => Date.now() }, scheduler: new NodeApplicationScheduler() });
  setCallLeaseAuthority(callLeaseService);

  // ==========================================================================
  // DoNow — the household "start this, there, now" dispatch facade
  // (ops:docs/superpowers/specs/2026-07-30-household-donow-dispatch-design.md).
  // HOUSEHOLD-LEVEL (spec §2 decision 2), constructed here — AFTER
  // `wakeAndLoadService`, `homeAutomationAdapters` and `playbackHubContainer`
  // all exist, since three of its seven v1 surfaces delegate straight to
  // them. Mounts unconditionally, independent of `school.yml`'s lifecycle
  // gate — School (below) is one CONSUMER, not the owner.
  // ==========================================================================
  const donowLogger = rootLogger.child({ module: 'donow' });
  // `donowModule` itself is declared much earlier (right after `eventBus`) —
  // the WS message handler's `ingestFrontendLogs` tap closes over that SAME
  // variable and needs it in scope before this point runs; this is a
  // reassignment, not a re-declaration.
  try {
    const { createDonow } = await import("../../__app_modules/household/donow/server/composition/donow.mjs");
    donowModule = await createDonow({
      configService,
      householdId,
      eventBus,
      thermalPrinterRegistry: printerRegistry,
      homeAutomationAdapters,
      wakeAndLoadService,
      playbackHubContainer,
      schoolService,
      logger: donowLogger,
    });
    v1Routers.donow = donowModule.router;
  } catch (err) {
    // Every surface DoNow wraps is independently optional-degrading; a throw
    // here means the composition module itself blew up (a coding error, not
    // a missing seam) — log loudly and leave the rest of the house booting,
    // same posture as `school.lifecycle.wiring-failed` below.
    donowLogger.error('donow.wiring-failed', { error: err.message });
  }

  // ==========================================================================
  // School physical console (printed agenda → worksheet/media → graded →
  // receipt). Fails closed: unwired unless school.yml sets
  // `lifecycle.enabled: true` AND the document renderer is present. Moved
  // here (Task 13, was constructed much earlier in this function) because it
  // now takes the real `donow` service as a dependency, and `donow` itself
  // needed the seams just above to exist first.
  // ==========================================================================
  const schoolLifecycleLogger = rootLogger.child({ module: 'school-lifecycle' });
  // The parsed NFC reader locations, for the school reachability check. Set
  // when the trigger API is composed further down; read only from inside a
  // thunk, long after that has happened.
  //
  // Returning `null` while unset is load-bearing: it means "could not tell",
  // which reports an assigned program as unstartable rather than silently
  // passing it. An empty object here would be a confident — and wrong —
  // "no reader declares anything".
  let triggerNfcLocations = null;
  const nfcLocationsForReachability = () => triggerNfcLocations;
  // The trigger owner's content-tag query, so a refused story-time book can
  // suggest the other stickered books. Null until the trigger API is composed
  // below.
  let triggerContentTags = null;
  const contentTagsForStoryTime = () => triggerContentTags?.() ?? null;

  let schoolLifecycle = {
    wired: false, reason: 'not attempted', handlesCode: () => false, handleScan: null,
    reporter: null, router: null, devicesRouter: null, donowSchoolBridge: null,
  };
  // Same adapter class, same guard, own `school.yml` block — see the grading
  // hook's wiring below for why a home-automation failure must never take the
  // rest of School down with it.
  // The one learner-name resolver every school/piano push producer below uses.
  const { learnerDisplayName, pianoLessonHook } = await createSchoolLessonHookRuntime({ configService, homeAutomationAdapters, rootLogger, schoolLifecycleLogger });
  /**
   * Wake a room's screen for a widget that is ALREADY MOUNTED on it: power the
   * display on, bring the kiosk forward, and stop there.
   *
   * Deliberately NOT a content load and NOT `clearContent()`. Both reload the
   * page, and a reload drops the WebSocket that the broadcast which follows
   * has to arrive on — the screen would be told at the exact moment it could
   * not hear. Shared by BOTH broadcast-driven screen features so there is one
   * answer in the house: story time (`makeReadingSessionHandler`) and gated
   * media lessons (`ScreenPlaybackAdapter`, §8).
   *
   * @param {{target: string}} a - `target` is a devices.yml id
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  let startReadingSession = null;
  const broadcastScreenWake = new WakeScreenForBroadcast({ devices: deviceServices.deviceService });
  const wakeScreenForBroadcast = (args) => broadcastScreenWake.execute(args);

  // The Books domain (metadata gateways, household repository, ResolveBook),
  // built once here so School's shelf and the household `/books` API share
  // one repository and one resolver.
  const books = createBooksModule({ configService, logger: rootLogger });

  const { schoolStateGatesProducer, bookScans, schoolPrintService, schoolTeacherNotes } = await createSchoolLifecycleRuntime({ nfcLocationsForReachability, get schoolDebriefGrants() { return schoolDebriefGrants; }, scopedGateway, get sharedAiGateway() { return sharedAiGateway; }, get decisionGateway() { return decisionGateway; }, contentTagsForStoryTime, configService, householdId, schoolService, schoolAcademicPeriods, schoolDatastore, economyApi, userService, eventBus, printerRegistry, wakeScreenForBroadcast, get startReadingSession() { return startReadingSession; }, languageStudyService, get schoolStudyGrants() { return schoolStudyGrants; }, languageReelService, get schoolReelGrants() { return schoolReelGrants; }, get schoolLaunchPreviewTokens() { return schoolLaunchPreviewTokens; }, pianoContainer, schoolPianoChallengeCompletionService, fitnessPlayableService, v1Routers, schoolLearningEvidence, get pianoLessonHook() { return pianoLessonHook; }, flashcardStudy, cardLadderStudy, rubiksCubeService, get schoolCubeGrants() { return schoolCubeGrants; }, get schoolBookGrants() { return schoolBookGrants; }, books, get donowModule() { return donowModule; }, get schoolCalc() { return schoolCalc; }, kioskFrictionTracker, schoolLifecycleLogger, getSchoolScreenConfig, get schoolLifecycle() { return schoolLifecycle; }, set schoolLifecycle(value) { schoolLifecycle = value; }, schoolLearnerDirectory, get schoolBookPanelGrants() { return schoolBookPanelGrants; }, stateGatesModule, schoolStateGatesPrincipal, stateGatesProducerScheduler, rootLogger, schoolTeacherGate, schoolSessionResultArtifacts, homeAutomationAdapters, learnerDisplayName, omrReadersConfig, NodeAsyncScheduler, dataDir, get getMaterialProgressSummary() { return getMaterialProgressSummary; }, getLearningProgress, fitnessServices, schoolFullConfig, LaserPrinterAdapter, schoolSurfaces, schoolEnrichmentLog, schoolMilestoneStore, cardLadderTest, get cardLadderTuning() { return cardLadderTuning; }, cardLadderConfig, flashcardAssets, get getMaterialCatalog() { return getMaterialCatalog; }, get getMaterialUnits() { return getMaterialUnits; }, schoolMaterialProgressStore, getInstructionalInsights, schoolCatalog, get issueContinuationCode() { return issueContinuationCode; }, openCatalogLearningSession, recordLearningReflection, schoolLearningLoop, offerCatalogQuizRemediation, schoolTeacherConfig, mediaBasePath, languageTranscription, createBooksApiRouter });

  // Shared dispatch-level idempotency cache for multi-step HTTP dispatches
  // (e.g. POST /api/v1/device/:id/load?mode=adopt).
  const { dispatchIdempotencyService } = createDispatchIdempotencyService({
    logger: rootLogger.child({ module: 'dispatch-idempotency' })
  });

  // Loads run inside a request context (User-Agent, X-Daylight-Device) so the
  // media load recorder can tell a Home Assistant routine from a person, name
  // the routine, record its outcome and stamp the screen's next start.
  // See __docs/reference/media/media-app-technical.md §2.6.
  v1Routers.device = withRequestContext(createDeviceApiRouter({
    presenceStore,
    // "It locked and I don't know why" needs an endpoint, not a log grep.
    readGate: () => languageStudyService.describeGate(),
    deviceServices,
    wakeAndLoadService: mediaHouse.wrapWakeAndLoad(wakeAndLoadService),
    sessionControlService,
    dispatchIdempotencyService,
    configService,
    loadFile,
    pianoMidiWakeService,
    kioskFrictionTracker,
    startStatusService: deviceStartStatusService,
    logger: rootLogger.child({ module: 'device-api' })
  }));

  // Home Line has no user provisioning, no sign-in and no identification by
  // design: it is a tin can between two ends of the house, reachable only on
  // the LAN or over the VPN. Whoever reaches it can talk into it. There is
  // deliberately no role check here — access control is the VPN, and adding
  // one back would mean asking a person at a wall phone to log in.
  v1Routers.homeline = createHomelineRouter({
    leaseService: callLeaseService,
    logger: rootLogger.child({ app: 'homeline', module: 'homeline-api' }),
  });

  const barcodeRelayConfig = configService.getHouseholdAppConfig(householdId, 'barcode-relay') || {};
  const barcodeRelayInstances = barcodeRelayConfig.relays || {};

  // Scan-enriched food logging: the DURABLE observation ledger. Every scale signal — a
  // settled weight, a scanned density, a scanned tare — is a row in this store, so it
  // survives a restart, is visible on the day it happened, and can be re-paired to an
  // entry after the fact. It is what the scale observation service recomputes the
  // in-progress composition from on every read.
  let observationService = null;
  const { observationStore, applyScanToComposition } = createHealthScanRuntime({ rootLogger, householdId, getObservationService: () => observationService });

  // ==========================================================================
  // Living-room reading sessions.
  // Authority on behaviour: __docs/reference/school/reading-sessions.md.
  //
  // Four pieces, and they must all be built from the SAME two instances or the
  // feature is wrong in ways nothing errors on:
  //   sessions       who is standing at each reader, in memory, per location
  //   interceptor    first refusal on a book tap there, and the D8 teardown
  //                  suppression that stops `end: tv-off` killing the ceremony
  //   recordStoryRead  the evidence a finished story becomes
  //   reading router the screen's three HTTP calls
  //
  // `storyTimeLauncher` is the shared one: the interceptor asks it `status()`
  // for the assignment/browsing mode, and `RecordStoryRead` takes its
  // `studyDay()` as the shard key. A second launcher with its own timezone
  // would file a 10pm read under tomorrow while this one still read today.
  // ==========================================================================
  /**
   * A learner's display name, for the surfaces that greet them by it.
   *
   * PROFILES CARRY `display_name`, NOT `name`. Reading `profile.name` yields
   * undefined, which is why the reading rail drew a face with no caption under
   * it all evening and `GET /reading/summary` answered `displayName: null` for
   * a child whose profile says `display_name` on its first page. The
   * piano roster hit exactly this and fixed it locally (see GetCourseProgress:
   * "a bare p.name shipped 'undefined' labels"); this is the same resolution,
   * shared, so the next caller does not have to rediscover it.
   *
   * Falls back to the username and then to the id: a greeting by id is a worse
   * greeting, never a broken screen.
   *
   * Declared HERE, not inside the reading block, because the media-lesson
   * router is a SIBLING block that also greets by name. While it lived in the
   * reading scope, lesson wiring threw `resolveLearnerProfile is not defined`
   * on every boot and every TV lesson surface was lost — silently, because that
   * wiring is deliberately caught so a broken lesson cannot take the rest of
   * School with it.
   */
  const resolveLearnerProfile = (id) => {
    const profile = configService.getUserProfile?.(id) ?? null;
    if (!profile) return null;
    return { ...profile, id: String(id), name: profile.display_name || profile.username || String(id) };
  };

const { readingSessions, readingSessionInterceptor } = await createSchoolReadingRuntime({ schoolLifecycle, rootLogger, configService, eventBus, NodeAsyncScheduler, nfcLocationsForReachability, homeAutomationAdapters, server, wakeScreenForBroadcast, resolveLearnerProfile, v1Routers });
  // ==========================================================================
  // Gated media lessons on the living-room TV — the screen's four HTTP calls.
  //
  // Mounted beside the reading router because it is the same screen and the
  // same doctrine: a widget that renders nothing until a lesson is dispatched
  // to its room, and four routes for the things the backend cannot see.
  //
  // Guarded on the SAME lifecycle the routes' use cases are built from. There
  // is no `storyTimeLauncher` equivalent to also require — a lesson is
  // dispatched through `DispatchMedia`, which the lifecycle already owns — but
  // without `stores.sessions` and `stores.curriculum` there is nothing to read
  // a lesson out of, and mounting routes that could only 500 would turn "this
  // household has no school" into an error in front of a child.
  //
  // `schoolService` is the bank reader for BOTH the answer grader and the
  // snapshot's question projection, deliberately the same instance: the
  // questions the screen shows and the questions the server marks must come
  // out of one bank, or a child answers something that is not what is being
  // graded.
  // ==========================================================================
  if (schoolLifecycle.wired && schoolLifecycle.stores?.sessions && schoolLifecycle.stores?.curriculum
      && schoolLifecycle.useCases?.recordMediaCompletion) {
    try {
      const lessonLogger = rootLogger.child({ module: 'school-lesson' });
      const { ReadLessonSnapshot } = await import("../../__app_modules/learning/school/server/application-usecases-read-lesson-snapshot.mjs");
      const { RecordCheckpointAnswer } = await import("../../__app_modules/learning/school/server/application-usecases-record-checkpoint-answer.mjs");
      const { createMediaLessonRouter } = await import("../../__app_modules/learning/school/server/api-media-lesson.mjs");

      v1Routers.school.use('/lesson', createMediaLessonRouter({
        readLessonSnapshot: new ReadLessonSnapshot({
          curriculum: schoolLifecycle.stores.curriculum,
          sessions: schoolLifecycle.stores.sessions,
          bankReader: schoolService,
          logger: lessonLogger,
        }),
        // Built HERE rather than in the lifecycle because the lifecycle has no
        // bank reader of its own to hand it — `RenderPrintDocument` keeps one
        // privately — and `schoolService` is the reader every other on-screen
        // grading path already goes through.
        recordCheckpointAnswer: new RecordCheckpointAnswer({
          curriculum: schoolLifecycle.stores.curriculum,
          sessions: schoolLifecycle.stores.sessions,
          bankReader: schoolService,
          logger: lessonLogger,
        }),
        recordMediaCompletion: schoolLifecycle.useCases.recordMediaCompletion,
        positionReporter: new LessonPositionReporter({
          publish: (topic, payload) => eventBus.broadcast(topic, payload),
        }),
        // Optional: without it the score placard names the learner id, which is
        // a worse placard and not a broken lesson.
        resolveLearner: resolveLearnerProfile,
        logger: lessonLogger,
      }));
    } catch (err) {
      // A lesson router that failed to wire must not take the rest of School
      // with it: every other surface (agenda, print, grading) is independent of
      // it, and a household whose TV lessons are broken still has its paper.
      rootLogger.error('school.lesson.wiring-failed', { error: err.message });
    }
  } else {
    rootLogger.warn('school.lesson.unwired', {
      reason: schoolLifecycle.wired ? 'no session or curriculum store' : 'school lifecycle not wired',
    });
  }

  // What a school learner card DOES, per reader. Registered here rather than
  // inside the trigger module so the trigger pipeline keeps no School import:
  // it knows op names and nothing about School.
  const learnerActions = createLearnerActions({ logger: rootLogger.child({ module: 'trigger-learner' }) });
  if (schoolLifecycle.useCases?.resolvePersonalCard) {
    // The handler lives in `learnerCardActions.mjs` rather than inline here so
    // its contract — the retryable `print_failed`, and the `agenda-suppressed`
    // acknowledgement that is a cooldown tap's only feedback — is testable
    // without booting the app.
    const { makePrintAgendaHandler } = await import("../../__app_modules/learning/school/server/composition-learner-card-actions.mjs");
    learnerActions.register('print-agenda', makePrintAgendaHandler({
      resolvePersonalCard: schoolLifecycle.useCases.resolvePersonalCard,
      eventBus,
      logger: rootLogger.child({ module: 'trigger-learner' }),
    }));
  } else {
    rootLogger.warn('trigger.learner.school-unwired', { reason: 'no resolvePersonalCard' });
  }

  // `reading-session` — the registration plan 01 deliberately withheld through
  // six agents, so that a card tapped in the living room answered `no_handler`
  // by name rather than printing an agenda in the study two rooms away because
  // that was the only learner action wired. It is registered now, and only
  // when the sessions store it needs actually exists: the refusal it replaces
  // is still the right answer for a household with no story-time launcher.
  ({ startReadingSession } = await registerSchoolReadingAction({ readingSessions, deviceServices, homeAutomationAdapters, learnerDisplayName, screenContentTracker, wakeScreenForBroadcast, schoolLifecycle, eventBus, rootLogger, learnerActions, nfcLocationsForReachability }));

  // Trigger dispatch (NFC modality source: apps/nfc/config.yml; barcode modality
  // shares this same dispatch core — see the barcode-relay wiring just below).
  const { router: triggerRouter, triggerDispatchService, triggerConfig, contentTags: triggerContentTagsQuery } = createTriggerApiRouter({
    listDir,
    learnerActions,
    deviceServices,
    wakeAndLoadService,
    haGateway: homeAutomationAdapters.haGateway,
    tvControlAdapter: homeAutomationAdapters.tvAdapter,
    contentIdResolver: contentServices.contentIdResolver,
    broadcast: broadcastEvent,
    loadFile,
    saveFile,
    contentDispatcher: barcodeContentDispatcher,
    // First refusal on a book tap at a reader with a session open — and the
    // D8 half: while one IS open, the location's `end: tv-off` is suppressed
    // so the ceremony gets to render before the room goes dark.
    contentInterceptors: readingSessionInterceptor ? [readingSessionInterceptor] : [],
    // D9 — a tag that resolves to nothing never becomes a content Response, so
    // the interceptor seam above never sees it. This is the only point that
    // can tell the screen in front of the child "I don't know that book yet",
    // and it runs IN ADDITION to the observed-registry write and the phone
    // push that actually get the book enrolled.
    onUnknownTag: (info) => readingSessionInterceptor?.noteUnknownTag(info),
    screenBroadcast: barcodeScreenBroadcast,
    commandResolver: resolveCommand,
    // Voice transcripts (POST /trigger/:location/voice) match free text to a
    // location's commands with this; null leaves voice exact-keyword only.
    decisionGateway: scopedGateway(decisionGateway, { app: 'trigger' }),
    logger: rootLogger.child({ module: 'trigger' }),
  });
  // The school reachability check can now answer for real (it has been
  // returning "could not tell" for every projection until this line).
  triggerNfcLocations = triggerConfig?.nfc?.locations ?? null;
  triggerContentTags = triggerContentTagsQuery ?? null;
  reportUnreachableSchoolPrograms({
    launchers: schoolLifecycle?.launchers ?? null,
    declared: declaredEntryActions(triggerNfcLocations),
    logger: rootLogger.child({ module: 'school' }),
  });
  v1Routers.trigger = triggerRouter;
  // Shared public-kiosk shutdown is deliberately server-owned: NFC writes one
  // hand-editable state file and both kiosks observe its read-only projection.
  const { YamlShutdownDatastore } = await import('#adapters/persistence/yaml/YamlShutdownDatastore.mjs');
  const { PortalKeysLockdownAdapter } = await import('#adapters/devices/PortalKeysLockdownAdapter.mjs');
  const { ShutdownService } = await import('#apps/shutdown/ShutdownService.mjs');
  const { createShutdownRouter } = await import('#api/v1/routers/shutdown.mjs');
  // Reload the small policy document on each safety check. That makes an NFC
  // tag/target change take effect from YAML without a process restart, while
  // the separately persisted lockdown.yml remains the only authority on an
  // already-active window.
  const readShutdownConfig = () => {
    if (typeof configService.reloadHouseholdAppConfig === 'function') {
      return configService.reloadHouseholdAppConfig(householdId, 'shutdown') || {};
    }
    return configService.getHouseholdAppConfig?.(householdId, 'shutdown') || {};
  };
  const shutdownConfig = readShutdownConfig();
  const portalAuth = shutdownConfig.portal_keys?.auth_ref
    ? configService.getHouseholdAuth?.(shutdownConfig.portal_keys.auth_ref, householdId) : null;
  const portal = new PortalKeysLockdownAdapter({
    baseUrl: shutdownConfig.portal_keys?.base_url,
    token: typeof portalAuth === 'string' ? portalAuth : portalAuth?.token,
    logger: rootLogger.child({ module: 'shutdown-portal' }),
  });
  const getShutdownPolicy = () => {
    const current = readShutdownConfig();
    return {
      durationSeconds: current.duration_seconds,
      reconcileSeconds: current.reconcile_seconds,
      targets: [
        ...(current.targets?.school_screen_ids || []).map((id) => `school:${id}`),
        ...(current.targets?.piano_device_ids || []).map((id) => `piano:${id}`),
      ],
    };
  };
  const shutdownCue = homeAutomationAdapters.haGateway?.callService ? {
    announce: ({ lockedUntil, source, notification }) => {
      const script = readShutdownConfig().home_assistant?.script;
      if (!script) return undefined;
      // `notification` is the composed phone push; the HA script relays it.
      return homeAutomationAdapters.haGateway.callService('script', 'turn_on', {
        entity_id: script,
        variables: { locked_until: lockedUntil, source, notification: notification ?? null },
      });
    },
  } : null;
  const shutdownService = new ShutdownService({
    repo: new YamlShutdownDatastore({ configService }),
    notifier: { publishState: (payload) => eventBus.broadcast('shutdown.state', payload) },
    getPolicy: getShutdownPolicy,
    cue: shutdownCue,
    portal,
    timezone: configService.getTimezone?.() || null,
    scheduleEvery: (intervalMs, task) => {
      const timer = setInterval(task, intervalMs);
      timer.unref?.();
      return () => clearInterval(timer);
    },
    logger: rootLogger.child({ module: 'shutdown' }),
  });
  shutdownService.start();
  server?.once?.('close', () => shutdownService.dispose());
  v1Routers.shutdown = createShutdownRouter({ shutdownService });

  // Weekly measures — the school board's ring figure. One registry, one
  // provider in v1; the seam exists so a second measure is a new file rather
  // than a refactor of this one. Read-only: it mints nothing and writes
  // nothing, it only sums what fitness already recorded.
  const {router: measuresRouter,fitnessRings,weeklyMeasures,measuresTimezone} = await createInstalledWeeklyMeasures({configService,householdId,fitnessServices,schoolLearnerDirectory,rootLogger,studyDayFor,isInWindow});
  v1Routers.measures = measuresRouter;

  // Weekly earnings preview — what each learner's week is worth in silver
  // under the household earn rules. Read-only (no ledger writes); evidence
  // through ports School and Fitness implement. Reads at /api/v1/earnings;
  // the teacher console's rate edits go through the school router's gate.
  // A failure here must not stop School booting: without it there is no
  // earnings preview, no payouts and no week close, and it says so.
  let economyEarnings = { router: null, payoutService: null, weekCloseService: null };
  try {
    economyEarnings = await createEconomyEarningsRuntime({schoolLifecycle,economyApi,fitnessRings,schoolLearnerDirectory,measuresTimezone,rootLogger});
  } catch (error) {
    rootLogger.error('economy.earnings.unavailable', { error: error.message });
  }
  v1Routers.earnings = economyEarnings.router;
  try {
    const { WeeklyMeasuresStateGatesProducer } = await import("../../__app_modules/wellness/fitness/server/application/measures/WeeklyMeasuresStateGatesProducer.mjs");
    fitnessStateGatesProducer = new WeeklyMeasuresStateGatesProducer({
      weeklyMeasures,
      publishAssertion: (assertion) => stateGatesModule.ingress.observe(
        householdId, fitnessStateGatesPrincipal, assertion,
      ),
      timezone: measuresTimezone,
      scheduler: stateGatesProducerScheduler,
      logger: rootLogger.child({ module: 'state-gates-fitness-producer' }),
    });
    await fitnessStateGatesProducer.start();
  } catch (err) {
    fitnessStateGatesProducer?.stop();
    fitnessStateGatesProducer = null;
    rootLogger.error('fitness.state-gates-producer.wiring-failed', { error: err.message });
  }
  // The action executor is deliberately late-bound: SchoolCalc is composed
  // before the existing print and trigger services, but scans cannot arrive
  // until boot is complete. This keeps one shared policy path rather than a
  // calculator-only printer or media dispatcher.
  schoolCalc.actionExecutor?.bind({
    printService: schoolPrintService,
    triggerDispatchService,
  });
  if (schoolCalc.studyOutcomeExecutor && schoolLifecycle.stores?.sessions) {
    schoolCalc.studyOutcomeExecutor.bind({ sessions: schoolLifecycle.stores.sessions });
  }

  // NFC taps arriving on a hardware-relay topic (the omr-relay carries an M5
  // Unit NFC alongside the bubble-sheet reader). TRANSPORT ONLY: every tap —
  // book sticker, learner card, unknown tag — goes to the same pipeline every
  // other reader in the house uses. What a learner card MEANS is the reader
  // location's `learner_action`, resolved in NfcResolver.
  const { createNfcTapIngress } = await import('#composition/modules/nfcTapIngress.mjs');
  const nfcTapIngress = createNfcTapIngress({
    eventBus,
    topics: ['omr'],
    triggerDispatchService,
    shutdownService,
    getShutdownConfig: readShutdownConfig,
    // Reader id -> trigger location. Was a single global `location`, which
    // assumed every reader on this bus was in one room. The fallback names the
    // one reader that exists today so the study card keeps working without a
    // config edit; add a key here (or in school.yml) for each new relay reader.
    readerLocations: configService.getHouseholdAppConfig?.(householdId, 'school')?.lifecycle?.nfcReaderLocations
      ?? { 'study-omr': 'study' },
    logger: rootLogger.child({ module: 'nfc-tap' }),
  });

  // Every scan in the house resolves through ONE vocabulary. The five branches
  // the relay's `onScan` used to hold inline (school, nutriscan, UPC, trigger,
  // and the reader's route) live in `scanDispatch`, where each is a handler and
  // the routing decision belongs to `ScanCode`/`ScanDispatcher` rather than to
  // an `if` chain only the reader's configured route could steer.
  //
  // Every scan that WORKS today works identically. Four that do not are named
  // and pinned in `tests/unit/composition/scanDispatch.test.mjs`; the one to
  // know about here is that a namespaced code now dead-ends in its own domain
  // rather than falling through, so a malformed fridge code (`dl:99`) no longer
  // reaches the UPC lookup — and logs nothing on the barcode channel when it
  // happens. That is the dispatcher's claim-is-not-success rule, which exists so
  // a typo is never answered with a nonsense food. Do not read "refactor" as
  // "no observable difference on any path".
  //
  // Wired here (rather than in the earlier "Barcode ingress" block) because it
  // needs triggerDispatchService, which createTriggerApiRouter() just returned.
  const { TelegramNutribotIdentity } = await import("../../__app_modules/wellness/nutribot/server/adapters/TelegramNutribotIdentity.mjs");
  const scanDispatch = createScanDispatch({
    schoolLifecycle,
    book: bookScans,
    schoolCalcResultImporter: schoolCalc.resultImporter,
    triggerDispatchService,
    relayInstances: barcodeRelayInstances,
    relayConfig: barcodeRelayConfig,
    applyScanToComposition,
    // Both LATE-BOUND: constructed further down this function, long before any
    // scan arrives but well after this line. Read at scan time, never captured.
    getObservationService: () => observationService,
    getLogFoodFromUPC: () => nutribotServices.nutribotContainer.getLogFoodFromUPC(),
    nutribotIdentity: new TelegramNutribotIdentity({ configService, userIdentityService }),
    screenNames: barcodeScreenNames,
    logger: rootLogger.child({ module: 'scan-dispatch' }),
    barcodeLogger,
  });

  // Persistence (per-device day-log under the barcode domain) and the relay's
  // own device/gatekeeper config are untouched by everything above — only
  // where a scan goes has ever changed here.
  createBarcodeRelay({
    relayGateway: new BarcodeFirmwareGateway({
      eventBus,
      defaultDevice: 'barcode-relay',
      defaultRoute: 'content',
      timezone: configService.getHouseholdTimezone?.(householdId),
    }),
    dayLog: relayDayLog({ persistence: { dir: barcodePersistDir } }, 'hardware/barcode/log', 'barcode_relay'),
    logger: rootLogger.child({ module: 'barcode-relay' }),
    onScan: (relay) => {
      // `dispatch` never rejects (see its invariant); the catch is the belt to
      // that braces, so a future change there cannot surface as an unhandled
      // rejection on a scan.
      scanDispatch.handleScan(relay).catch((err) => {
        // `emit` + `errText`, the same pair every `.catch` in `scanDispatch`
        // uses, and for the same two reasons. `errText` because reading a
        // rejection can itself throw (`{ get message() { throw } }`, a bare
        // `throw 'nope'`, a null-prototype value) and a throw INSIDE this
        // callback is an unhandledRejection nothing can catch. `emit` because
        // the logger has a transport behind it that can fail, and this is the
        // outermost catch on the scan path — there is nothing above it to
        // report to.
        emit(barcodeLogger, 'warn', 'scan.dispatch.failed', {
          device: relay.device, error: errText(err),
        });
      });
    },
  });

  rootLogger.info('barcode.pipeline.ready', {
    source: 'ble-relay',
    scanners: barcodeKnownScanners,
  });

  // Camera feeds
  const { createCameraServices } = await import('#composition/bootstrap.mjs');
  const { cameraService } = createCameraServices({
    configService,
    householdId,
    haGateway: homeAutomationAdapters.haGateway,
    logger: rootLogger.child({ module: 'camera' }),
  });

  v1Routers.camera = createCameraRouter({
    cameraService,
    cameraEvents: new CameraEvents({ publish: broadcastEvent }),
    logger: rootLogger.child({ module: 'camera-api' }),
  });

  const { createPrewarmRouter } = await import("./4_api/v1/routers/prewarm.mjs");
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
      // Base attribution only: SystemBotLoader narrows it per bot
      // (nutribot → health/voice-log, journalist, homebot).
      { openaiAdapter: scopedGateway(sharedAiGateway, { app: 'messaging' }) },
      { httpClient: voiceHttpClient, logger: rootLogger.child({ module: 'voice-transcription' }) }
    );
  }

  // Load system-level bots from config (system/bots.yml + system/auth/telegram.yml)
  // This creates bot adapters that can be looked up by household messaging platform
  try {
    const botsLoaded = loadSystemBots({
      httpClient: axios,
      // Base app only; SystemBotLoader narrows it per bot (later tags win).
      transcriptionService: scopedGateway(voiceTranscriptionService, { app: 'messaging' })
    });
    rootLogger.info('system.bots.loaded', { count: botsLoaded });
  } catch (err) {
    rootLogger.warn('system.bots.error', {
      reason: err.message,
      message: 'System bots not loaded - messaging services may not work'
    });
  }

  // Health's view of the shared gateway: its use cases narrow the feature
  // (photo-log, text-log, …) so the ledger answers "what does Health spend on".
  const nutribotAiGateway = scopedGateway(sharedAiGateway, { app: 'health' });
  // Nutribot voice memos: the default messaging adapter and the web capture path.
  const nutribotVoiceTranscription = scopedGateway(voiceTranscriptionService, { app: 'health', feature: 'voice-log' });

  // Default adapter uses nutribot token. Auth may be a string or an object
  // with a token property — passing the object through produced a broken
  // adapter (Telegram API 404s on every send).
  const nutribotTelegramAuth = configService.getSystemAuth('telegram', 'nutribot');
  const messagingServices = createMessagingServices({
    dataService,
    telegram: {
      token: (typeof nutribotTelegramAuth === 'string' ? nutribotTelegramAuth : nutribotTelegramAuth?.token) || ''
    },
    gmail: gmailConfig.credentials ? {
      credentials: gmailConfig.credentials,
      token: gmailConfig.token
    } : null,
    transcriptionService: nutribotVoiceTranscription,  // Voice message transcription (nutribot token)
    httpClient: axios,  // Required for TelegramAdapter API calls
    logger: rootLogger.child({ module: 'messaging' })
  });

  // The notification stack has no bot of its own, so it used to borrow
  // NutriBot's token. That turned the food-logging DM into the whole house's
  // alert firehose: two ceremony nudges a day that never stop (the periodId is
  // in the dedupeKey, so the cooldown can never collapse them) plus one message
  // per feedback recording (same problem — the item id is in the dedupeKey).
  // Mixing that into the nutrition conversation is what made all of it spam.
  //
  // So the telegram channel is deliberately left unwired until a dedicated
  // notifications bot exists. Nothing breaks: TelegramNotificationAdapter
  // reports every intent undelivered, the in-app card still lands, and the
  // governance ledger still records each intent — so
  // data/household/notifications/ledger.yml remains the running account of what
  // the future bot will inherit.
  //
  // To turn delivery back on, register the new bot in data/system/config/bots.yml
  // and point this at getMessagingAdapter(householdId, '<newbot>'). Do not point
  // it back at 'nutribot' (or at messagingServices.telegramAdapter, which is
  // built from the same NutriBot token) — that is the bug this replaced.
  notificationTelegram.adapter = null;

  const upcGateway = createHealthNutritionLookup({ rootLogger, nutribotConfig });

  // Create conversation state store for nutribot (persists lastReportMessageId for cleanup)
  // Per-user storage: users/{username}/conversations/nutribot/
  const nutribotStateStore = new YamlConversationStateDatastore({
    dataService,
    botName: 'nutribot',
    userResolver,
    logger: rootLogger.child({ module: 'nutribot-state' })
  });

  // Get nutribot adapter from config-driven SystemBotLoader
  const nutribotTelegramAdapter = getMessagingAdapter(householdId, 'nutribot');

  const nutribotServices = await createNutribotServices({
    transcribeAudio: async ({ buffer, mimeType }) => {
      if (!nutribotVoiceTranscription) throw Object.assign(new Error('Transcription not configured'), { code: 'MISSING_CONFIG' });
      const extension = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }[mimeType] || 'ogg';
      return (await nutribotVoiceTranscription.transcribe(buffer, { filename: `voice.${extension}`, contentType: mimeType })).text;
    },
    configService,
    dataService,
    telegramAdapter: nutribotTelegramAdapter,
    aiGateway: nutribotAiGateway,
    decisionGateway: scopedGateway(decisionGateway, { app: 'health' }),
    upcGateway,
    googleImageGateway: null,  // TODO: Add Google Image gateway when available
    conversationStateStore: nutribotStateStore,
    reportRenderer: nutribotReportRenderer,  // Canvas-based PNG report renderer
    nutribotConfig,
    reconciliationReader: healthServices.reconciliationReader,
    healthStore: healthServices.healthStore,
    catalogService: healthServices.catalogService,
    scaleRawConfig: configService.getHouseholdAppConfig(householdId, 'scales'),
    // Lazy proxy: agentOrchestrator is created later in createAgentsServices
    agentOrchestrator: { runAssignment: (...args) => v1Routers.agents?.orchestrator?.runAssignment(...args) },
    // Lazy proxy: the coaching trigger is built later in createAgentsServices
    mealCoachingTrigger: { notify: (args) => v1Routers.agents?.mealCoachingTrigger?.notify(args) ?? false },
    logger: rootLogger.child({ module: 'nutribot' })
  });

  startHealthScaleObservation({ userIdentityService, systemBots, eventBus, observationStore, nutribotServices, householdId, rootLogger, setObservationService: (service) => { observationService = service; } });

  const nutribotApiResult = createNutribotApiRouter({
    cleanupProvider: () => nutritionCleanup,
    nutribotServices,
    userResolver,
    userIdentityService,
    telegramIdentityAdapter,
    defaultMember: configService.getHeadOfHousehold(),
    botId: systemBots.nutribot?.telegram?.bot_id || '',
    secretToken: systemBots.nutribot?.telegram?.secret_token || '',
    gateway: nutribotTelegramAdapter,
    aiGatewayAvailable: Boolean(nutribotAiGateway),
    logger: rootLogger.child({ module: 'nutribot-api' })
  });
  v1Routers.nutribot = nutribotApiResult.router;
  // Wire real adapter into the proxy now that it's available
  webNutribotAdapterProxy._delegate = nutribotApiResult.webNutribotAdapter;

  try {
    const { startNutritionSurfaceSync } = await import("../../__app_modules/wellness/health/server/composition/nutritionSurfaceSync.mjs");
    const receiptSync = startNutritionSurfaceSync({ configService, createDestinationFor: () => createNutribotDestinationResolver({ configService, userIdentityService }), dataService, nutribotServices,
      logger: rootLogger.child({ module: 'nutrition-surface-sync' }), server });
    nutritionReceiptPublisher = receiptSync.publisher || null;
  } catch (error) {
    rootLogger.warn('nutrition.surface.unavailable', { error: error.message });
  }

  // Journalist application
  const journalistConfig = configService.getAppConfig('journalist') || {};

  // Journalist's view of the shared AI adapter
  const journalistAiGateway = scopedGateway(sharedAiGateway, { app: 'journalist' });

  // Get journalist adapter from config-driven SystemBotLoader
  const journalistTelegramAdapter = getMessagingAdapter(householdId, 'journalist');

  // Create conversation state store for journalist
  // Per-user storage: users/{username}/conversations/journalist/
  const journalistStateStore = new YamlConversationStateDatastore({
    dataService,
    botName: 'journalist',
    userResolver,
    logger: rootLogger.child({ module: 'journalist-state' })
  });

  const journalistServices = createJournalistServices({
    dataService,
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
    aiGatewayAvailable: Boolean(journalistAiGateway),
    logger: rootLogger.child({ module: 'journalist-api' })
  });

  // HomeBot application
  const homebotConfig = configService.getAppConfig('homebot') || {};

  // HomeBot's view of the shared AI adapter
  const homebotAiGateway = scopedGateway(sharedAiGateway, { app: 'homebot' });

  // Get homebot adapter from config-driven SystemBotLoader
  const homebotTelegramAdapter = getMessagingAdapter(householdId, 'homebot');

  // Create conversation state store for homebot
  // Per-user storage: users/{username}/conversations/homebot/
  const homebotStateStore = new YamlConversationStateDatastore({
    dataService,
    botName: 'homebot',
    userResolver,
    logger: rootLogger.child({ module: 'homebot-state' })
  });

  const homebotServices = createHomebotServices({
    telegramAdapter: homebotTelegramAdapter,
    aiGateway: homebotAiGateway,
    addSelections: gratitudeServices.addSelections,
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

  // Agents services — build orchestrator + services without constructing a router
  const agentsServices = await createAgentsServices({
    logger: rootLogger.child({ module: 'agents-api' }),
    agentUsageRecorder,
    healthStore: healthServices.healthStore,
    healthService: healthServices.healthService,
    fitnessPlayableService,
    sessionService: fitnessServices.sessionService,
    mediaProgressMemory,
    dataService,
    configService,
    aiGateway: scopedGateway(sharedAiGateway, { app: 'agents' }),
    httpClient: axios,
    messagingGateway: nutribotTelegramAdapter,
    // Nutribot chat ID for agent→Telegram delivery
    // extractChatId splits on '_' and takes last segment, so just pass raw chatId
    // TODO: derive chatId from user identity mapping instead of hardcoding
    conversationId: '575596036',
    nutriListStore: healthServices.nutriListStore,
    // Task 9: pass foodLogStore so NutritionEventAdapter can be wired for baselines
    foodLogStore: nutribotServices.foodLogStore,
    nutribotConfig,
    lifeplanServices: {
      container: lifeplanResult.container,
      services: lifeplanResult.services,
      aggregator: lifelogServices.lifelogAggregator,
    },
    // Real notification delivery for agent tools (was a no-op stub fallback)
    notificationService: notificationStack.notificationService,
    // Same instance the health router uses (already delegated to the real
    // WebNutribotAdapter by this point — nutribotApiResult ran above).
    webNutribotAdapter: webNutribotAdapterProxy,
  });

  try {
    const { createNutritionCleanup } = await import("../../__app_modules/wellness/health/server/composition/nutritionCleanup.mjs");
    nutritionCleanup = createNutritionCleanup({ configService, createDestinationFor: () => createNutribotDestinationResolver({ configService, userIdentityService, optional: true }), dataService, nutribotServices, upcGateway,
      decisionGateway: scopedGateway(decisionGateway, { app: 'health' }),
      agentOrchestrator: agentsServices.agentOrchestrator, usageRecorder: agentUsageRecorder,
      logger: rootLogger.child({ module: 'nutrition-cleanup' }), server,
      journalSource: process.env.DAYLIGHT_ENV || 'docker', usageLedger: aiUsageLedger,
      scheduled: enableScheduler && (process.env.NODE_ENV === 'production' || process.env.ENABLE_CRON === 'true') });
  } catch (error) {
    rootLogger.error('nutrition.cleanup.unavailable', { error: error.message });
  }

  // Weekly earnings payouts (economy B3): mint what the earnings preview
  // says was earned. Settles on school outcomes and piano lessons (debounced
  // per learner and week) and in the hourly reconcile. Gated like the other
  // scheduled jobs; inert while economy/config.yml reads `mode: off`, and
  // `dry-run` only logs. School's own per-unit reward
  // (`lifecycle.economy.enabled`) stays off so a unit is never paid twice.
  // Skipped when the earnings runtime did not build (economy.earnings.unavailable).
  if (economyEarnings.payoutService && economyEarnings.weekCloseService) {
    try {
      startEconomyPayouts({
        payoutService: economyEarnings.payoutService,
        config: economyApi.configProjection,
        enabled: enableScheduler && (process.env.NODE_ENV === 'production' || process.env.ENABLE_CRON === 'true'),
        eventBus,
        scheduler: agentsServices.scheduler,
        logger: rootLogger.child({ module: 'economy-payout' }),
      });
    } catch (error) {
      rootLogger.error('economy.earnings.unavailable', { error: error.message, job: 'payouts' });
    }
    // Sunday week close (economy B4): settle the week once more, then unspent
    // silver converts to gold on `week_close.cron` (read at boot; a change needs
    // a restart). Same gate and modes as the payouts.
    try {
      startWeekClose({
        weekCloseService: economyEarnings.weekCloseService,
        config: economyApi.configProjection,
        enabled: enableScheduler && (process.env.NODE_ENV === 'production' || process.env.ENABLE_CRON === 'true'),
        scheduler: agentsServices.scheduler,
        logger: rootLogger.child({ module: 'economy-week-close' }),
      });
    } catch (error) {
      rootLogger.error('economy.earnings.unavailable', { error: error.message, job: 'week-close' });
    }
  }

  // Lifeplan ceremony reminders — hourly check for due ceremonies across all
  // users with a life plan. CeremonyScheduler gates each ceremony to its
  // household-local delivery hour (plan.ceremonies[type].at or per-type
  // default), so each nudge fires at most once per day. Dedupe is per period
  // via ceremony records, so a completed ceremony is never re-notified.
  // Teacher backlog nudge (teacher-console advocacy A1): a child's session
  // BLOCKS on review, so the teachers must be told, not left to poll.
  // Hourly check, deduped per study-day+counts, so a stable backlog nudges
  // once and a grown one nudges again — Telegram via the same notification
  // stack the lifeplan ceremonies use, with a tappable console link.
  if (agentsServices.scheduler && notificationStack?.notificationService) {
    agentsServices.scheduler.registerTask('school:teacher-backlog-nudge', '0 * * * *', async () => {
      try {
        const pendingReview = schoolLifecycle.stores?.reviewQueue
          ? (await schoolLifecycle.stores.reviewQueue.listPending()).length : 0;
        const pendingPrints = schoolPrintService ? schoolPrintService.listPending().length : 0;
        if (!pendingReview && !pendingPrints) return;
        // Re-read fresh from disk so a teacher added to school.yml since boot
        // is nudged this hour, not only after a restart; fall back to the
        // boot-cached snapshot on any reload failure (missing file, disk
        // error) so the task never throws.
        let freshSchoolConfig;
        try {
          freshSchoolConfig = await configService.reloadHouseholdAppConfig?.(null, 'school');
        } catch (err) {
          rootLogger.warn('school.teacher-nudge.reload-failed', { error: err.message });
        }
        const teacherIds = (freshSchoolConfig || configService.getHouseholdAppConfig(null, 'school') || {}).teachers ?? [];
        rootLogger.info('school.teacher-nudge.teachers', { count: teacherIds.length });
        const day = new Date().toISOString().slice(0, 10);
        const parts = [];
        if (pendingReview) parts.push(`${pendingReview} item${pendingReview === 1 ? '' : 's'} waiting on a mark`);
        if (pendingPrints) parts.push(`${pendingPrints} print${pendingPrints === 1 ? '' : 's'} awaiting approval`);
        for (const username of teacherIds) {
          // eslint-disable-next-line no-await-in-loop
          await notificationStack.notificationService.send({
            title: 'School backlog',
            body: `${parts.join(' and ')} — a child may be blocked on you.`,
            category: 'school',
            urgency: 'normal',
            actions: [{ label: 'Open the console', action: 'open', data: { url: '/school/teacher' } }],
            metadata: { username },
            // Once per study day per teacher — count changes must not
            // re-nudge (the 60-min category cooldown in notifications.yml is
            // the belt; this key is the braces).
            dedupeKey: `school-backlog:${username}:${day}`,
          });
        }
      } catch (err) {
        rootLogger.warn('school.teacher-nudge.failed', { error: err.message });
      }
    });
  }

  // Parent digest (school economy C6): one push to each teacher at the
  // economy catalog's `digest.cron` (read here, at boot: a change needs a
  // restart; null registers nothing) summing each child's school day, plus a
  // `zero-days` alert after `digest.zero_days_alert` study days in a row with
  // work asked and none done. A push held by quiet hours is resent by an
  // hourly retry tick. Gated like the economy payouts.
  if (agentsServices.scheduler && notificationStack?.notificationService
      && schoolLifecycle.useCases?.getLearnerDayCompletion) {
    try {
      const { createSchoolParentDigest } = await import("../../__app_modules/learning/school/server/composition-parent-digest.mjs");
      createSchoolParentDigest({
        economyConfig: economyApi.configProjection,
        economyService: economyApi.economyService,
        // One zone and 4 am boundary for both School's day and the economy's
        // (getHouseholdTimezone || 'UTC', set where economyApi is built).
        studyCalendar: economyApi.studyCalendar,
        roster: () => schoolLearnerDirectory.listLearners(),
        learnerName: learnerDisplayName,
        getLearnerDayCompletion: schoolLifecycle.useCases.getLearnerDayCompletion,
        termVerdicts: schoolLifecycle.useCases.termVerdicts ?? null,
        sessions: schoolLifecycle.stores?.sessions ?? null,
        notificationService: notificationStack.notificationService,
        teachers: () => (configService.getHouseholdAppConfig(null, 'school') || {}).teachers ?? [],
        logsDir: path.join(configService.getMediaDir(), 'logs'),
        scheduler: agentsServices.scheduler,
        enabled: enableScheduler && (process.env.NODE_ENV === 'production' || process.env.ENABLE_CRON === 'true'),
        logger: rootLogger.child({ module: 'school-parent-digest' }),
      });
    } catch (err) {
      rootLogger.error('school.parent-digest.unavailable', { error: err.message });
    }
  }

  // Relay staleness watchdog — the hardware relays are pass-throughs that keep
  // no liveness state, so a dead ESP board is invisible except as history that
  // stopped being written. The kitchen relay sat dark 2026-07-31 → 2026-08-12
  // (12 days) and only surfaced because someone went looking. This turns that
  // into a same-day Telegram alert.
  //
  // ONLY the kitchen board is watched, deliberately. This detects "no frames
  // from <source>", not "board offline" — no relay sends a hello or keepalive
  // on connect, so an idle board is indistinguishable from a dead one. That is
  // tolerable for the kitchen relay, whose scale rests connected on the shelf
  // and heartbeats at 0.5 Hz. It is NOT tolerable for the OBD relay (in a car,
  // legitimately absent for days) or the OMR relay (used a few times a term),
  // which would page constantly. Add them only once the firmware sends a
  // heartbeat frame that means "I am alive" independent of its peripherals.
  //
  // 12h threshold: long enough to sleep through a quiet kitchen overnight with
  // the scale switched off, short enough that a real death is same-day news.
  //
  // TIGHTEN THIS TO ~1h ONCE THE BOARD RUNS THE HELLO-FRAME FIRMWARE (a 60s
  // liveness heartbeat, added 2026-08-12 but NOT yet flashed). Until that build
  // is actually on the board, silence still just means "the scale is switched
  // off" and a short threshold would cry wolf every evening. The hello frame
  // also carries the board's post-mortem, which the watchdog logs as
  // `relay_watchdog.boot` whenever the NVS boot counter moves — that is where a
  // TASK_WDT (loop wedged, watchdog recovered it) or BROWNOUT (bad supply)
  // reset shows up.
  if (agentsServices.scheduler && notificationStack?.notificationService) {
    const relayWatchdog = createRelayWatchdog({
      relayGateway: new RelayWatchdogFirmwareGateway({ eventBus }),
      sources: {
        // The unified kitchen board and the legacy per-board sources it may
        // still emit if an older firmware is flashed (see foodScaleRelay's
        // INGEST_SOURCES) — any of the three proves the board is alive.
        'kitchen-relay': { label: 'Kitchen relay', thresholdMs: 12 * 3600_000 },
        'food-scale-relay': { label: 'Kitchen relay (legacy scale source)', thresholdMs: 12 * 3600_000 },
      },
      logger: rootLogger.child({ module: 'relay-watchdog' }),
      onStale: ({ label, silentMs, lastSeenAt }) => {
        const hours = Math.round(silentMs / 3600_000);
        // Resolve the board's status page from devices.yml rather than hardcoding
        // an IP here — the whole point of that entry is being the one place the
        // address lives. Read at send time so a config reload is picked up.
        let statusHint = '';
        try {
          const dev = configService.getDeviceConfig?.('kitchen-relay');
          const host = dev?.host || dev?.mdns;
          if (host) statusHint = ` Status: http://${host}${dev.port && dev.port !== 80 ? `:${dev.port}` : ''}${dev.endpoints?.status || '/status'}`;
        } catch { /* a missing device entry must not block the alert */ }
        notificationStack.notificationService.send({
          title: 'Relay has gone quiet',
          body: `${label} has sent nothing for ${hours}h (last frame ${new Date(lastSeenAt).toLocaleString()}). `
            + `Check that it has power.${statusHint}`,
          category: 'system',
          // HIGH is what routes this off the dashboard and onto a phone; see
          // DEFAULT_PREFERENCES in 5_composition/modules/notifications.mjs.
          urgency: 'high',
          dedupeKey: `relay-stale:${label}:${lastSeenAt}`,
        }).catch((err) => rootLogger.warn('relay-watchdog.notify-failed', { error: err.message }));
      },
      onRecover: ({ label, silentMs }) => {
        rootLogger.info('relay-watchdog.recovered', { label, silentMs });
      },
    });
    agentsServices.scheduler.registerTask('hardware:relay-watchdog', '*/30 * * * *', async () => {
      relayWatchdog.check();
    });
  }

  // Playback stall watchdog — the kiosk half of the same idea. On 2026-08-16 a
  // child sat in front of a wedged piano kiosk for 17 minutes: the APK watchdog
  // read 37 fps, heartbeats arrived every second, and every health check we
  // owned said HEALTHY, because all of them measured frame rate or beat arrival
  // rather than progress. PlaybackStallDetector reads the `position` the 5s
  // device-state heartbeat has always carried and alerts when a device claiming
  // `playing` stops advancing. It rides the event bus directly, so no scheduler
  // tick is involved — the verdict lands on the heartbeat that proves it.
  if (notificationStack?.notificationService) {
    createPlaybackStallDetector({
      presenceGateway: devicePresenceGateway,
      logger: rootLogger.child({ module: 'playback-stall' }),
      onStall: ({ deviceId, contentId, title, position, stalledForMs }) => {
        const minutes = Math.max(1, Math.round(stalledForMs / 60_000));
        notificationStack.notificationService.send({
          title: 'A screen is stuck',
          body: `${deviceId} says it is playing ${title || contentId || 'something'} `
            + `but the playhead has not moved in ${minutes} minute${minutes === 1 ? '' : 's'} `
            + `(stuck at ${Math.round(position)}s). Someone is probably waiting in front of it.`,
          category: 'system',
          // HIGH routes this to a phone rather than an in-app card; the whole
          // point is reaching someone who is NOT looking at the dashboard. See
          // DEFAULT_PREFERENCES in 5_composition/modules/notifications.mjs.
          urgency: 'high',
          // One alert per episode per item. The detector already latches, so
          // this is the belt to that pair of braces: it also survives a restart,
          // which would otherwise re-arm the detector and re-alert.
          dedupeKey: `playback-stall:${deviceId}:${contentId || 'unknown'}`,
        }).catch((err) => rootLogger.warn('playback-stall.notify-failed', { error: err.message }));
      },
      onRecover: ({ deviceId, reason, stalledForMs }) => {
        rootLogger.info('playback-stall.cleared', { deviceId, reason, stalledForMs });
      },
    });
  }

  // Content-tree manifest (admin advocacy #20): nightly hash of the authored
  // school content; the diff vs yesterday is logged and the manifest file is
  // the record — version control the Dropbox-synced volume can't safely have.
  if (agentsServices.scheduler) {
    agentsServices.scheduler.registerTask('school:content-manifest', '50 3 * * *', async () => {
      try {
        const { ContentTreeManifest } = await import("../../__app_modules/learning/school/server/adapters-content-content-tree-manifest.mjs");
        new ContentTreeManifest({
          contentDir: path.join(contentPath, 'school'),
          manifestFile: configService.getRuntimeCachePath('school/content-manifest.yml'),
          logger: rootLogger.child({ module: 'school-content-manifest' }),
        }).run();
      } catch (err) {
        rootLogger.warn('school.content-manifest.failed', { error: err.message });
      }
    });
  }

  // School retention sweep (admin advocacy A5): the one scheduled janitor
  // for the household stores that grew forever. Daily at 03:30 — before the
  // 4am study-day roll, after the house is asleep.
  if (agentsServices.scheduler && schoolDatastore) {
    agentsServices.scheduler.registerTask('school:retention-sweep', '30 3 * * *', async () => {
      try {
        const { SchoolRetentionSweep } = await import("../../__app_modules/learning/school/server/application-school-retention-sweep.mjs");
        const sweep = new SchoolRetentionSweep({
          datastore: schoolDatastore,
          schoolService,
          logger: rootLogger.child({ module: 'school-retention' }),
        });
        await sweep.execute();
      } catch (err) {
        rootLogger.warn('school.retention.failed', { error: err.message });
      }
    });
  }

  registerHealthMaintenance({ healthServices, rootLogger, scheduler: agentsServices.scheduler });

  registerLifeplanMaintenance({ agentsServices, lifeplanResult, rootLogger });

  // Fitness recap sweep — safety net that recaps sessions ended via the common
  // paths (inactivity, closed tab, crash) that never fire a per-event trigger,
  // reclaiming their orphaned frames via the use case's cleanup-on-success.
  // Runs on the agents Scheduler (Docker/prod-gated, so no dev-zombie double-fire).
  if (agentsServices.scheduler && v1Routers.fitness?.recapSweep) {
    agentsServices.scheduler.registerTask('fitness:recap-sweep', '*/10 * * * *', async () => {
      await v1Routers.fitness.recapSweep.run();
    });
  }

  // Trash retention: hard-delete recap frames that have sat in `_trash` past the
  // 7-day window (frames are soft-deleted there after a confirmed recap). Daily is
  // plenty for a 7-day TTL. The ONLY hard-delete in the session media lifecycle,
  // and it only ever touches the `_trash` root.
  if (agentsServices.scheduler && v1Routers.fitness?.trashRetentionSweep) {
    agentsServices.scheduler.registerTask('fitness:trash-retention', '17 4 * * *', async () => {
      await v1Routers.fitness.trashRetentionSweep.run();
    });
  }

  // Voice-memo retry worker — the second half of durable capture. Recordings
  // are written to disk before transcription, so a provider outage leaves a
  // retryable artifact rather than nothing; this drains that queue, reclaims
  // leases from attempts that died mid-flight, and enforces the retention that
  // keeps raw voice from outliving its purpose. Every minute, because the
  // first backoff rung is 60s and a person is waiting on their memo.
  if (agentsServices.scheduler && v1Routers.fitness?.voiceMemoRetryWorker) {
    agentsServices.scheduler.registerTask('fitness:voice-memo-retry', '* * * * *', async () => {
      await v1Routers.fitness.voiceMemoRetryWorker.tick();
    });
  }

  // Strava reconciliation sweep — propagates LOCAL session corrections (splits,
  // edited primary media, late voice memos) back to Strava without waiting for
  // the next workout's webhook to opportunistically trigger reconcile(). The
  // service's own 1-hour per-session cooldown (last_reconciled_at) prevents
  // thrash; this just guarantees the lookback window is actually swept.
  if (agentsServices.scheduler && stravaReconciliationService) {
    agentsServices.scheduler.registerTask('fitness:strava-reconcile', '23 * * * *', async () => {
      await stravaReconciliationService.reconcile();
    });
  }
  // Strava sync health — reads recorded state only (no Strava calls); pushes
  // on a healthy<->stale transition. Separate from the stages it watches, so a
  // sweep that stops running is still noticed.
  if (agentsServices.scheduler && stravaSyncHealth) {
    agentsServices.scheduler.registerTask('fitness:strava-sync-health', '*/15 * * * *', async () => {
      await stravaSyncHealth.evaluate();
    });
  }

  // Mount each registered agent's HTTP surface (run, run-stream, run-background) via mountAgentHttp
  for (const { id: agentId } of agentsServices.orchestrator.list()) {
    mountAgentHttp(app, {
      orchestrator: agentsServices.orchestrator,
      agentId,
      mountPath: '/api/v1/agents',
      wireFormat: 'native',
      logger: rootLogger.child({ module: `agents/${agentId}` }),
    });
  }

  // Memory CRUD router — mounted once for all agents (Phase 3 T4)
  const { AgentMemoryAdministrationService } = await import("../../__capabilities/agent-runtime/server/application/AgentMemoryAdministrationService.mjs");
  const { WorkingMemoryState } = await import("../../__capabilities/agent-runtime/server/application/framework/WorkingMemory.mjs");
  v1Routers.agentMemory = createAgentMemoryRouter({
    memoryAdministration: new AgentMemoryAdministrationService({
      orchestrator: agentsServices.orchestrator,
      workingMemory: agentsServices.workingMemory,
      createEmptyState: () => new WorkingMemoryState(),
    }),
    logger: rootLogger.child({ module: 'agent-memory' }),
  });
  app.use('/api/v1/agents', v1Routers.agentMemory);

  // Listing + assignments router — mounted once for all agents (Phase 3 T5)
  v1Routers.agentMeta = createAgentMetaRouter({
    orchestrator: agentsServices.orchestrator,
    logger: rootLogger.child({ module: 'agent-meta' }),
  });
  app.use('/api/v1/agents', v1Routers.agentMeta);

  // Expose for downstream consumers (createHealthMentionsRouter, createConciergeServices, scheduler)
  v1Routers.agents = {
    orchestrator: agentsServices.orchestrator,
    workingMemory: agentsServices.workingMemory,
    scheduler: agentsServices.scheduler,
    coachingOrchestrator: agentsServices.coachingOrchestrator,
    mealCoachingTrigger: agentsServices.mealCoachingTrigger,
    coaching: agentsServices.coaching,
    healthAnalyticsService: agentsServices.healthAnalyticsService,
  };

  healthAnalyticsService = v1Routers.agents?.healthAnalyticsService ?? null;

  // Recover Strava enrichment jobs left pending by a restart — deliberately
  // after v1Routers.agents exists (see onActivityFetched).
  try { stravaEnrichmentService?.recoverPendingJobs(); }
  catch (err) { rootLogger.error?.('strava.enrichment.recovery_failed', { error: err?.message }); }

  // Register morning debrief as a scheduled task (via agents scheduler)
  const agentsScheduler = v1Routers.agents?.scheduler;
  if (agentsScheduler && journalistServices?.journalistContainer && journalistAiGateway) {
    const debriefCron = journalistConfig.morning_debrief?.schedule || '0 7 * * *';
    const debriefUsername = configService.getHeadOfHousehold?.() || 'user_1';

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
  } else if (agentsScheduler && journalistServices?.journalistContainer) {
    rootLogger.warn?.('journalist.scheduled_debrief.disabled', { reason: 'ai_gateway_unavailable' });
  }

  // AI API router - provides direct AI endpoints (/api/ai/*)
  // Create adapters for OpenAI and Anthropic
  const anthropicApiKey = configService.getSecret('ANTHROPIC_API_KEY') || '';

  // Reuse shared AI adapter for OpenAI (loaded from integration system)
  const aiOpenaiAdapter = scopedGateway(sharedAiGateway, { app: 'ai-console' });

  // Anthropic adapter - could be loaded from integration system if configured
  // For now, create directly if API key is available
  let aiAnthropicAdapter = null;
  if (anthropicApiKey) {
    const { AnthropicAdapter } = await import('#adapters/ai/AnthropicAdapter.mjs');
    aiAnthropicAdapter = wrapAiWire(new AnthropicAdapter(
      { apiKey: anthropicApiKey },
      { httpClient: axios, logger: rootLogger.child({ module: 'ai-anthropic' }), aiUsageLedger }
    ));
  }

  const { AiGatewayService } = await import('#apps/ai/AiGatewayService.mjs');
  v1Routers.ai = createAIRouter({
    aiService: new AiGatewayService(
      { openai: aiOpenaiAdapter, anthropic: scopedGateway(aiAnthropicAdapter, { app: 'ai-console' }) },
      { logger: rootLogger.child({ module: 'ai-api' }) },
    ),
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


  const {mediaExecutor,mediaDownloadService}=await createMediaJobsRuntime({rootLogger,mediaBasePath,loadFile});

  // Camera detection ledger (Pipeline C). Registered unconditionally: it needs
  // no media path and no NAS — only the Reolink search API — so it should keep
  // running even when the heavier media plumbing is unavailable. It is the
  // perishable half of the camera archive (see cameraLedgerJobHandler).
  // D1: bootstrap owns which concrete camera adapters are used; the handlers
  // receive them through one semantic runtime gateway.
  await registerCameraJobs({ configService, householdAdapters, householdId, mediaExecutor, rootLogger });
  const schedulerService = new SchedulerService({
    timezone: 'America/Los_Angeles'
  });

  // NewsReporter — surfaces configured reporters as scheduler jobs and runs them.
  // Adapters/renderer are constructed in bootstrap (createNewsReporterServices);
  // the container receives instances (Decision D1).
  const newsReporter = createNewsReporterServices({
    configService,
    mediaDir: mediaBasePath || null,
    printerRegistry: hardwareAdapters.printerRegistry,
    dataService,
    httpClient: axios,
    logger: rootLogger.child({ module: 'newsreporter' }),
    agentUsageRecorder,
  });

  // Compose the canonical jobs.yml store with the newsreporter store. Order is
  // [yaml, newsreporter] so jobs.yml ids win on collision.
  const compositeJobStore = new CompositeJobDatastore({
    stores: [schedulingJobStore, newsReporter.jobDatastore],
    logger: rootLogger.child({ module: 'scheduling-jobs' }),
  });

  // School housekeeping. The stale-session sweep had no way to run before
  // this: `listStale` was reachable only through a manual, teacher-gated
  // route, so the threshold in it was never consulted and an issued-and-
  // forgotten session stayed live indefinitely. Wired only when the school
  // lifecycle itself is (an install without it has no sessions to sweep).
  let schoolMaintenanceExecutor = null;
  if (schoolLifecycle.wired && schoolLifecycle.useCases?.markSessionAbandoned) {
    const { SchoolMaintenanceExecutor } = await import("../../__app_modules/learning/school/server/application-school-maintenance-executor.mjs");
    schoolMaintenanceExecutor = new SchoolMaintenanceExecutor({
      markSessionAbandoned: schoolLifecycle.useCases.markSessionAbandoned,
      sweepAnswerSheets: schoolLifecycle.useCases.sweepAnswerSheets ?? null,
      logger: rootLogger.child({ module: 'school-maintenance' }),
    });
  }

  const mediaMemoryValidator=createMediaMemoryValidator({contentRegistry,mediaMemoryPath});
  const applicationJobExecutor = createApplicationScheduledJobs({
    financeHarvestService: financeServices.harvestService,
    healthService: healthServices.healthService,
    archiveService: ArchiveService,
    loadArchiveConfig,
    foodLogStore: nutribotServices.foodLogStore,
    nutriListStore: nutribotServices.nutriListStore,
    mediaMemoryValidator,
    resolveHouseholdId: () => defaultHouseholdId,
    resolveUsername: () => configService.getHeadOfHousehold?.() || 'user_1',
    logger: rootLogger.child({ module: 'scheduled-applications' }),
  });

  const schedulerOrchestrator = new SchedulerOrchestrator({
    schedulerService,
    timestampCodec: new SchedulerTimestampCodec({ timezone: process.env.TZ }),
    newExecutionId: () => crypto.randomUUID(),
    scheduler: new NodeApplicationScheduler(),
    jobStore: compositeJobStore,
    stateStore: schedulingStateStore,
    harvesterExecutor: harvesterServices.jobExecutor,
    applicationExecutor: applicationJobExecutor,
    mediaExecutor,
    newsReporterExecutor: newsReporter.executor,
    schoolExecutor: schoolMaintenanceExecutor,
    // AI spend a job causes is stamped `job:<id>` in the usage ledger.
    runInJobContext: (jobId, work) => runWithOrigin(`job:${jobId}`, work)
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

  // Ambient TV schedule — wakes the living-room TV to a scheduled art preset and
  // powers it off at the window's end, always yielding to active content. Reads
  // the `schedule:` block in artmode.yml; "is a video playing" comes from the
  // ScreenContentTracker. Shares the scheduler enable gate.
  const ambientDataDir = configService.getDataDir();
  const ambientScheduler = createAmbientScheduler({ loadSchedule: async () => normalizeWindows(
      (await loadArtmodeConfig(configService.getHouseholdPath(''), rootLogger)).schedule,
      { defaultDevice: 'livingroom-tv' },
    ), tracker: screenContentTracker, wakeAndLoadService, deviceService: deviceServices.deviceService, dataDir: ambientDataDir, createScheduler: () => new NodeApplicationScheduler(), loggerFor: module => rootLogger.child({ module }) });
  if (enableScheduler) {
    ambientScheduler.start();
  }

  v1Routers.scheduling = createSchedulingRouter({
    schedulerOrchestrator,
    schedulerService,
    scheduler,
    logger: rootLogger.child({ module: 'scheduling-api' })
  });

  // NewsReporter manual-run endpoint (POST /api/v1/newsreporter/:id/run)
  v1Routers.newsreporter = createNewsReporterRouter({
    newsReporterService: newsReporter.service,
    logger: rootLogger.child({ module: 'newsreporter-api' })
  });

  // Canvas router for art display. The content registry stores the configured
  // root on Express; translate it into the image-use-case contract here.
  const canvasBasePath = app.get('canvasBasePath');
  v1Routers.canvas = createCanvasRouter({
    canvasService: null,
    getCanvasImage: createCanvasImageUseCase(canvasBasePath),
  });

  // Screens router for screen configurations
  const screensLogger = rootLogger.child({ module: 'screens-api' });
  const screensHouseholdDir = configService.getHouseholdPath('');
  v1Routers.screens = createScreensRouter({
    screensQueryService: new ScreensQueryService({
      screensRepository: new FilesystemScreensRepository({
        householdDir: screensHouseholdDir,
        logger: screensLogger,
      }),
      logger: screensLogger,
      expandScreensaverPreset: createArtScreenPresets({ screensHouseholdDir, screensLogger }),
    }),
    logger: screensLogger,
  });

  // Auth router
  v1Routers.auth = createAuthRouter({
    authService,
    jwtSecret,
    jwtConfig,
    sessionStore: authSessionStore,
    authPublicContext: new AuthPublicContextService({
      defaultHouseholdId: () => configService.getDefaultHouseholdId(),
      readHousehold: () => dataService.household.read('household') || {},
      listUserProfiles: () => configService.getAllUserProfiles(),
    }),
    logger: rootLogger.child({ module: 'auth-api' })
  });

  // Admin app-services — constructed at the composition root and injected into the
  // admin router so 4_api/**/admin/* never imports #apps. Persistence + rules live
  // in these services; the sub-routers are thin HTTP shells.
  const adminApiLogger = rootLogger.child({ module: 'admin-api' });
  // D5: the admin services decide WHICH config file; this store does the I/O.
  const adminConfigStore = new YamlAdminConfigStore({ dataRoot: configService.getDataDir() });
  const householdAdminService = new HouseholdAdminService({
    configStore: adminConfigStore,
    logger: adminApiLogger.child?.({ submodule: 'household' }) || adminApiLogger
  });
  const deviceRemoteAdministrationService = new DeviceRemoteAdministrationService({
    gateway: new FullyKioskRemoteAdministrationAdapter({
      readDevices: () => adminConfigStore.readDevices(),
      resolveAuth: authRef => configService.getHouseholdAuth(authRef),
      httpClient: axios,
      logger: adminApiLogger.child?.({ submodule: 'fully-kiosk-transport' }) || adminApiLogger,
    }),
    logger: adminApiLogger.child?.({ submodule: 'device-remote' }) || adminApiLogger,
  });

  // Off-tablet watcher for the piano-bridge APK: relaunches it through FKB when its
  // control plane goes dark and pushes when that does not work. The tablet cannot
  // be trusted to restart its own bridge (2026-09-30: dead two days, unnoticed).
  // Prod container only, so a dev backend on the same data tree neither
  // relaunches the app nor pages anyone a second time.
  if (isDocker && enableScheduler) {
    createPianoBridgeSupervisor({
      configService,
      remoteAdmin: deviceRemoteAdministrationService,
      haGateway: homeAutomationAdapters.haGateway,
      householdId,
      eventBus,
      deviceService: deviceServices.deviceService,
      getScreenOverrideService,
      logger: rootLogger.child({ module: PIANO_BRIDGE_SUPERVISOR_LOG_MODULE }),
    });
  } else {
    rootLogger.info?.('piano-bridge.supervisor.skipped', { reason: 'not the prod container', isDocker, enableScheduler });
  }
  const yamlConfigFileService = new YamlConfigFileService({
    configStore: adminConfigStore,
    logger: adminApiLogger.child?.({ submodule: 'config' }) || adminApiLogger
  });
  const appsConfigService = new AppsConfigService({
    configStore: adminConfigStore,
    // Household clock for kiosk time windows (piano curfew / quiet hours).
    getHouseholdTimezone: () => configService.getTimezone?.() || null,
    logger: adminApiLogger.child?.({ submodule: 'apps' }) || adminApiLogger
  });
  const schedulerAdminService = new SchedulerAdminService({
    configStore: adminConfigStore,
    // Real manual-run path: the same orchestrator the scheduling loop uses.
    schedulerOrchestrator,
    logger: adminApiLogger.child?.({ submodule: 'scheduler' }) || adminApiLogger
  });
  const integrationsQueryService = new IntegrationsQueryService({
    configStore: adminConfigStore,
    // Environment resolved at the composition root (was process.env in the router).
    environment: process.env.DAYLIGHT_ENV || 'docker',
    logger: adminApiLogger.child?.({ submodule: 'integrations' }) || adminApiLogger
  });
  const listManagementService = new ListManagementService({
    listStore: new YamlListDatastore({
      dataDir: configService.getDataDir(),
      listConfigCodec: ListConfigCodec,
    }),
    logger: adminApiLogger.child?.({ submodule: 'content' }) || adminApiLogger,
  });
  const adminArtService = createArtAdminService({ mediaBasePath, imgBasePath, configService, adminApiLogger });
  const adminImageService = new AdminImageService({
    store: new AdminImageFileStore({ mediaPath: mediaBasePath || imgBasePath }),
    source: new FetchAdminImageSource(),
    createId: () => crypto.randomUUID(),
    logger: adminApiLogger.child?.({ submodule: 'images' }) || adminApiLogger,
  });
  const adminNotificationOperations = new AdminNotificationOperations({
    configuration: notificationConfigService,
    ledger: notificationStack.ledgerStore,
  });

  // Withings reconnect: admin-only, server-side code exchange (Withings codes
  // expire in ~30s, so the exchange has to happen in the callback itself).
  // The redirect URI must match one registered with the Withings app; set
  // system auth withings.connect_redirect_uri when the request host differs.
  let oauthRouter = null;
  if (harvesterServices.withingsOAuth) {
    oauthRouter = createOAuthRouter({
      withingsOAuth: harvesterServices.withingsOAuth,
      authStore: harvesterServices.authStore,
      harvesterService: harvesterServices.harvesterService,
      resolveUsername: () => configService.getHeadOfHousehold(),
      // Only household members (same roster normalization as the /life switcher).
      isKnownUser: (username) => (configService.getHouseholdUsers(configService.getDefaultHouseholdId()) || [])
        .map((u) => (typeof u === 'string' ? u : (u?.username || u?.userId || u?.name)))
        .includes(username),
      redirectUri: (req) => configService.getSystemAuth?.('withings', 'connect_redirect_uri')
        || `${(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim()}://${req.get('host')}${req.baseUrl}/withings/callback`,
      newState: () => crypto.randomUUID(),
      logger: adminApiLogger.child?.({ submodule: 'oauth' }) || adminApiLogger,
    });
  } else {
    adminApiLogger.info?.('oauth.withings.disabled', { reason: 'Withings client_id/client_secret not configured' });
  }

  // Admin router - combined content, images, and eventbus management
  v1Routers.admin = createAdminRouter({
    householdContext,
    listManagementService,
    adminArtService,
    adminImageService,
    adminNotificationOperations,
    householdAdminService,
    deviceRemoteAdministrationService,
    yamlConfigFileService,
    appsConfigService,
    schedulerAdminService,
    integrationsQueryService,
    notificationConfigService,
    notificationLedgerStore: notificationStack.ledgerStore,
    stateGatesAdministration: stateGatesModule.administrationOperations,
    stateGatesActorFromRequest: stateGatesModule.actorFromRequest,
    oauthRouter,
    logger: adminApiLogger
  });

  // Test infrastructure router (dev/test only)
  const { createTestRouter } = await import("./4_api/v1/routers/test.mjs");
  // Shutoff-valve test controls target the live registered Plex proxy instance
  // (per-instance state, no module-level singleton). Null when Plex isn't configured.
  const plexProxyAdapter = contentProxyService.getAdapter('plex');
  const plexShutoffControls = plexProxyAdapter
    ? {
        enable: (opts) => plexProxyAdapter.enableShutoff(opts),
        disable: () => plexProxyAdapter.disableShutoff(),
        getStatus: () => plexProxyAdapter.getShutoffStatus()
      }
    : null;

  v1Routers.test = createTestRouter({
    plexShutoffControls,
    logger: rootLogger.child({ module: 'test-api' })
  });

  // Launch & Sync routers
  const { createLaunchRouter } = await import("./4_api/v1/routers/launch.mjs");
  const { createSyncRouter } = await import("./4_api/v1/routers/sync.mjs");
  const { LaunchService } = await import("../../__capabilities/device-dispatch/server/application/LaunchService.mjs");
  const { SyncService } = await import("../../__capabilities/content-catalog/server/application/services/SyncService.mjs");
  const { AdbLauncher } = await import('#adapters/devices/AdbLauncher.mjs');

  const adbLauncher = new AdbLauncher({
    configService,
    logger: rootLogger.child({ module: 'adb-launcher' })
  });

  // RetroArch per-game overrides: before a game launches, its override file on
  // the device gets the catalog's `resume` flag as savestate_auto_load. The ADB
  // endpoint is the configured device's content_control.fallback.
  let prepareLaunch = null;
  const gamesLaunchConfig = configService.getHouseholdAppConfig(null, 'games')?.launch;
  const overrideDeviceId = gamesLaunchConfig?.game_overrides?.device;
  if (overrideDeviceId) {
    const overrideLogger = rootLogger.child({ module: 'retroarch-overrides' });
    const adbFallback = configService.getDeviceConfig(overrideDeviceId)?.content_control?.fallback;
    if (adbFallback?.provider === 'adb' && adbFallback.host) {
      const { AdbAdapter } = await import('#adapters/devices/AdbAdapter.mjs');
      const { createRetroArchPrepareLaunch } = await import("../../__capabilities/content-catalog/server/composition/retroarch-overrides.mjs");
      const overrideAdb = new AdbAdapter({ host: adbFallback.host, port: adbFallback.port }, { logger: overrideLogger });
      let adbConnected = false;
      prepareLaunch = createRetroArchPrepareLaunch({
        shell: async (script) => {
          if (!adbConnected) {
            const conn = await overrideAdb.connect();
            if (!conn.ok) return conn;
            adbConnected = true;
          }
          const result = await overrideAdb.shellArgv(script);
          if (!result.ok) adbConnected = false;
          return result;
        },
        getConfig: () => configService.getHouseholdAppConfig(null, 'games'),
        readCatalog: () => dataService.household.read('gaming/retroarch/catalog'),
        logger: overrideLogger
      });
    } else {
      overrideLogger.warn?.('retroarch.override.disabled', { reason: 'device has no adb fallback', device: overrideDeviceId });
    }
  }

  const launchService = new LaunchService({
    contentCatalog: contentServices.contentCatalog,
    deviceLauncher: adbLauncher,
    prepareLaunch,
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
    const { RetroArchSyncAdapter } = await import("../../__capabilities/content-catalog/server/adapters/providers/retroarch/RetroArchSyncAdapter.mjs");
    const retroarchSyncAdapter = new RetroArchSyncAdapter({
      xploreBaseUrl,
      sourceConfig: retroarchConfig.source || {},
      consoleConfig: retroarchConfig.consoles,
      thumbnailBasePath: configService.getHouseholdPath('gaming/retroarch/thumbnails'),
      httpClient: axios,
      readCatalog: () => dataService.household.read('gaming/retroarch/catalog'),
      writeCatalog: (data) => dataService.household.write('gaming/retroarch/catalog', data),
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
  if (immichConfig) {  await installWeeklyReview({ configService, dataService, immichConfig, sharedAiGateway, rootLogger, householdId, userDataService, dataBasePath, mediaBasePath, fitnessServices, v1Routers });
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
    // POST /system/reload re-reads household app YAML through this. Omitting
    // it (as the 2026-08-29 boundary refactor did) makes the route answer 503.
    configReloadService: configService,
    logger: rootLogger.child({ module: 'api-v1' })
  });

  // DevProxy middleware - only intercepts webhook routes
  app.use('/api/v1/nutribot/webhook', devProxy.middleware);
  app.use('/api/v1/journalist/webhook', devProxy.middleware);
  app.use('/api/v1/homebot/webhook', devProxy.middleware);
  app.use('/api/v1/fitness/provider/webhook', devProxy.middleware);

  // ==========================================================================
  // Concierge endpoint (OpenAI-compatible /v1) — for HA Voice / external clients
  // ==========================================================================
  try {
    const conciergeServices = await createConciergeServices({
      configService,
      agentUsageRecorder,
      dataService,
      agentOrchestrator: v1Routers.agents?.orchestrator ?? null,
      workingMemory: v1Routers.agents?.workingMemory ?? null,
      contentQueryService: contentServices?.contentQueryService ?? null,
      contentRegistry,
      haGateway: homeAutomationAdapters?.haGateway ?? null,
      devicesConfig,
      mediaLogsDir: join(configService.getMediaDir(), 'logs'),
      logger: rootLogger.child({ module: 'concierge' }),
    });

    const bearerAuth = satelliteBearerAuth({
      satelliteRegistry: conciergeServices.satelliteRegistry,
      logger: rootLogger.child({ module: 'concierge-auth' }),
    });

    mountAgentHttp(app, {
      orchestrator: v1Routers.agents?.orchestrator ?? null,
      agentId: 'concierge',
      mountPath: '/v1',
      wireFormat: 'openai-chat-completions',
      authMiddleware: [bearerAuth],
      contextExtractor: (req) => ({
        satellite: req.satellite,
        conversationId: req.body?.conversation_id ?? req.body?.conversationId ?? null,
      }),
      advertisedModels: conciergeServices.advertisedModels,
      logger: rootLogger.child({ module: 'agents/concierge' }),
    });
  } catch (error) {
    rootLogger.error('concierge.mount_failed', { error: error.message, stack: error.stack });
  }
  // Installed third-party assets (npm run install:assets): media/vendor -> /vendor.
  // Before the SPA catch-all so a missing file 404s instead of returning index.html.
  app.use('/vendor', createVendorApiRouter({
    mediaDir: mediaBasePath,
    logger: rootLogger.child({ module: 'vendor-assets' })
  }));

  // ==========================================================================
  // Frontend Static Files (Production Only) - MUST be before API router
  // ==========================================================================

  // GUARDRAIL: Only serve static dist in production (Docker).
  // Dev server should NEVER serve dist - Vite handles frontend in development.
  // Static files are served BEFORE API router so frontend paths like /fitness
  // get the React app, not the API JSON response.
  if (isDocker) {
    const frontendPath = join(__dirname, '..', '..', 'frontend', 'dist');
    const frontendExists = assetProbe.exists(frontendPath);

    if (frontendExists) {
      // Serve static assets (JS, CSS, images) — hashed filenames are immutable
      app.use(express.static(frontendPath, {
        setHeaders: (res, filePath) => {
          // index.html must never be cached so location.reload() always gets fresh script tags
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            // Enable the JS Self-Profiling API (window.Profiler) for on-device
            // renderer CPU profiling on the kiosk tablets (no DevTools/adb needed).
            res.setHeader('Document-Policy', 'js-profiling');
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
        // Skip genuine static-asset requests (already tried by express.static
        // above). Match a known asset extension on the FINAL path segment only
        // — a dot inside a SPA deep-link segment must NOT divert the request.
        // SPA content ids can carry dots (e.g. a sheet-music score route
        // /piano/sheetmusic/view/files:docs/sheet-music/song.musicxml); a broad
        // `req.path.includes('.')` skip sent those past this handler to a
        // dead-end (no route matches → the request hangs).
        const lastSeg = req.path.slice(req.path.lastIndexOf('/') + 1);
        if (/\.(js|mjs|cjs|css|map|json|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp[34]|m4a|ogg|oga|wav|webm|mov|pdf|wasm|txt|zip)$/i.test(lastSeg)) {
          return next();
        }
        // SPA route - serve index.html with no-cache so deploys take effect on reload
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        // Enable window.Profiler (JS Self-Profiling API) for on-device renderer profiling.
        res.setHeader('Document-Policy', 'js-profiling');
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

  // Graceful shutdown: stop the HubStatusBroadcaster loop cleanly.
  if (playbackHubContainer) {
    process.on('SIGTERM', async () => {
      try {
        await playbackHubContainer.stop();
        rootLogger.info?.('playback-hub.shutdown.complete');
      } catch (err) {
        rootLogger.error?.('playback-hub.shutdown.error', { error: err?.message });
      }
    });
  }

  // Graceful shutdown: unsubscribe DoNow's eventBus-backed presence trackers
  // (MIDI, playback) so a redeploy doesn't leak listeners on the outgoing bus.
  if (donowModule) {
    process.on('SIGTERM', () => {
      try {
        donowModule.stop();
        rootLogger.info?.('donow.shutdown.complete');
      } catch (err) {
        rootLogger.error?.('donow.shutdown.error', { error: err?.message });
      }
    });
  }

  // Graceful shutdown: unsubscribe the School lifecycle's DoNow bridge
  // (the pending->approved half of the launch-unit loop).
  if (schoolLifecycle.donowSchoolBridge) {
    process.on('SIGTERM', () => {
      try {
        schoolLifecycle.donowSchoolBridge.stop();
        rootLogger.info?.('school.donow-bridge.shutdown.complete');
      } catch (err) {
        rootLogger.error?.('school.donow-bridge.shutdown.error', { error: err?.message });
      }
    });
  }

  // Graceful shutdown: unsubscribe the School lifecycle's completion bridge.
  if (schoolLifecycle.schoolCompletionBridge) {
    process.on('SIGTERM', () => {
      try {
        schoolLifecycle.schoolCompletionBridge.stop();
        rootLogger.info?.('school.completion-bridge.shutdown.complete');
      } catch (err) {
        rootLogger.error?.('school.completion-bridge.shutdown.error', { error: err?.message });
      }
    });
  }

  // Graceful shutdown: stop forwarding the economy's coins-changed to the Portal.
  if (schoolLifecycle.coinsChangedRelay) {
    process.on('SIGTERM', () => {
      try {
        schoolLifecycle.coinsChangedRelay.stop();
        rootLogger.info?.('school.coins-changed-relay.shutdown.complete');
      } catch (err) {
        rootLogger.error?.('school.coins-changed-relay.shutdown.error', { error: err?.message });
      }
    });
  }

  if (schoolStateGatesProducer) {
    process.on('SIGTERM', () => {
      schoolStateGatesProducer.stop();
      rootLogger.info?.('school.state-gates-producer.shutdown.complete');
    });
  }

  if (fitnessStateGatesProducer) {
    process.on('SIGTERM', () => {
      fitnessStateGatesProducer.stop();
      rootLogger.info?.('fitness.state-gates-producer.shutdown.complete');
    });
  }

  // Graceful shutdown: unsubscribe the Fitness-to-School assessment bridge.
  if (schoolLifecycle.fitnessSchoolAssessmentBridge) {
    process.on('SIGTERM', () => {
      try {
        schoolLifecycle.fitnessSchoolAssessmentBridge.stop();
        rootLogger.info?.('school.fitness-assessment-bridge.shutdown.complete');
      } catch (err) {
        rootLogger.error?.('school.fitness-assessment-bridge.shutdown.error', { error: err?.message });
      }
    });
  }

  process.on('SIGTERM', () => stateGatesModule.dispose());

  return app;
}
