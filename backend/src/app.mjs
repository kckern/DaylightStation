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
import crypto from 'node:crypto';
import path, { join } from 'path';
import { renderSessionResultPng } from '#rendering/school/documents/SessionResultRenderer.mjs';
import { YamlSessionResultArtifactStore } from '#adapters/persistence/yaml/YamlSessionResultArtifactStore.mjs';
import { FitnessConfigProjection, PartyGamesConfigProjection, PianoConfigProjection } from '#adapters/config/ApplicationConfigProjections.mjs';
import { publicResourceUrl } from '#api/v1/presenters/publicResourceRefs.mjs';

// Infrastructure imports
import { ConfigValidationError, configService } from './0_system/config/index.mjs';
import { dataService, userService } from '#composition/runtimePersistence.mjs';
import { ConfigUserResolver as UserResolver } from '#adapters/identity/ConfigUserResolver.mjs';
import { UserIdentityService } from './2_domains/messaging/services/UserIdentityService.mjs';
import { TelegramIdentityAdapter } from './1_adapters/messaging/TelegramIdentityAdapter.mjs';
import { HttpClient } from './0_system/services/HttpClient.mjs';

// Logging system
import { getDispatcher } from './0_system/logging/dispatcher.mjs';
import { createLogger } from './0_system/logging/logger.mjs';
import { ingestFrontendLogs } from '#adapters/logging/FrontendLogIngestion.mjs';
import { shouldRelayBtTopic, shouldRelayKioskLaunchTopic } from '#apps/eventbus/ClientRelayPolicy.mjs';
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
  createFitnessServices,
  createFeedServices,
  createFinanceServices,
  createEntropyServices,
  createHealthServices,
  createGratitudeServices,
  createHomeAutomationAdapters,
  createPlaybackHubServices,
  createDeviceServices,
  createWakeAndLoadService,
  createDispatchIdempotencyService,
  createTranscodePrewarmService,
  createHardwareAdapters,
  createProxyService,
  createMessagingServices,
  createJournalistServices,
  createHomebotServices,
  createNutribotServices,
  createLifelogServices,
  createEventBus,
  createDeviceLivenessService,
  broadcastEvent,
  createHarvesterServices,
  createNewsReporterServices,
  createAgentsServices,
  createConciergeServices,
  createCostServices,
  createMediaServices
} from '#composition/bootstrap.mjs';

import { bootstrapLifeplan } from '#composition/modules/lifeplan.mjs';
import { bootstrapNotifications } from '#composition/modules/notifications.mjs';
import { createPlaybackStallDetector } from '#composition/modules/playbackStall.mjs';
import { createHubFleetBridge } from '#composition/modules/hubFleetBridge.mjs';
import { createApiRouters } from '#composition/modules/contentApi.mjs';
import { createFitnessApiRouter } from '#composition/modules/fitnessApi.mjs';
import { createFinanceApiRouter } from '#composition/modules/financeApi.mjs';
import { createCostApiRouter } from '#composition/modules/costApi.mjs';
import { createHomeAutomationApiRouter, createHomeDashboardApiRouter } from '#composition/modules/homeApi.mjs';
import { createDeviceApiRouter } from '#composition/modules/deviceApi.mjs';
import { createTriggerApiRouter } from '#composition/modules/triggerApi.mjs';
import { declaredEntryActions } from '#domains/school/reachability.mjs';
import { reportUnreachableSchoolPrograms } from '#composition/modules/schoolReachability.mjs';
import { createLearnerActions } from '#apps/trigger/learnerActions.mjs';
import { createScanDispatch, errText } from '#composition/modules/scanDispatch.mjs';
import { createSchoolCalc } from '#composition/modules/schoolCalc.mjs';
import { createSchoolCatalog } from '#composition/modules/schoolCatalog.mjs';
import { createSchoolSurfaces } from '#composition/modules/schoolSurfaces.mjs';
import { createLearningReflectionEvidenceId, createSchoolLearningLoop } from '#composition/modules/schoolLearning.mjs';
import { emit } from '#apps/scan/ScanDispatcher.mjs';
import { createGratitudeApiRouter } from '#composition/modules/gratitudeApi.mjs';
import { createEconomyApi } from '#composition/modules/economyApi.mjs';
import { createJournalistApiRouter } from '#composition/modules/journalistApi.mjs';
import { createHomebotApiRouter } from '#composition/modules/homebotApi.mjs';
import { createNutribotApiRouter } from '#composition/modules/nutribotApi.mjs';
import { createHealthApiRouter, createHealthDashboardApiRouter } from '#composition/modules/healthApi.mjs';
import { createEntropyApiRouter } from '#composition/modules/entropyApi.mjs';
import { createLifelogApiRouter } from '#composition/modules/lifelogApi.mjs';
import { createStaticApiRouter } from '#composition/modules/staticApi.mjs';
import { createCalendarApiRouter } from '#composition/modules/calendarApi.mjs';
import { createScreenPresenceService } from '#composition/modules/screenPresence.mjs';
import { createPianoScreenPowerSync } from '#composition/modules/pianoScreenPowerSync.mjs';
import { createPianoMidiWake } from '#composition/modules/pianoMidiWake.mjs';

// AI router import
import { createAIRouter } from './4_api/v1/routers/ai.mjs';

// Health mentions router (CoachChat autocomplete)
import { createHealthMentionsRouter } from './4_api/v1/routers/health-mentions.mjs';

// Native-wire agent HTTP mounter
import { mountAgentHttp } from './4_api/v1/agents/mountAgentHttp.mjs';
import { satelliteBearerAuth } from './4_api/v1/agents/middlewares/satelliteBearerAuth.mjs';

// Agent memory CRUD router (mounted once at /api/v1/agents)
import { createAgentMemoryRouter } from './4_api/v1/agents/createAgentMemoryRouter.mjs';
// Agent listing + assignments router (Phase 3 T5)
import { createAgentMetaRouter } from './4_api/v1/agents/createAgentMetaRouter.mjs';

// Feed harvester adapter for scheduler integration
import { HeadlineHarvesterAdapter } from './1_adapters/feed/HeadlineHarvesterAdapter.mjs';

// UPC Gateway for barcode lookups
import { UPCGateway } from '#adapters/nutribot/UPCGateway.mjs';
import { YamlFitnessHistoryRepository } from '#adapters/fitness/YamlFitnessHistoryRepository.mjs';
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
import { errorHandlerMiddleware, requestLoggerMiddleware } from './0_system/http/middleware/index.mjs';
import { createDevProxy } from '#api/v1/middleware/createDevProxy.mjs';
import { DevRequestForwarder } from '#adapters/http/DevRequestForwarder.mjs';
import { createEventBusRouter } from './4_api/v1/routers/admin/eventbus.mjs';
import { createAdminRouter } from './4_api/v1/routers/admin/index.mjs';
// Admin app-services (constructed HERE at the composition root and injected into
// the admin router; keeps 4_api/**/admin/* free of #apps imports).
import { HouseholdAdminService } from '#apps/admin/HouseholdAdminService.mjs';
import { YamlConfigFileService } from '#apps/admin/YamlConfigFileService.mjs';
import { AppsConfigService } from '#apps/admin/AppsConfigService.mjs';
import { SchedulerAdminService } from '#apps/admin/SchedulerAdminService.mjs';
import { IntegrationsQueryService } from '#apps/admin/IntegrationsQueryService.mjs';
import { AdminArtService } from '#apps/admin/AdminArtService.mjs';
import { AdminImageService } from '#apps/admin/AdminImageService.mjs';
import { AdminNotificationOperations } from '#apps/admin/AdminNotificationOperations.mjs';
import { ListManagementService } from '#apps/content/services/ListManagementService.mjs';
import { HouseholdContextService } from '#apps/common/context/HouseholdContextService.mjs';
import { YamlListDatastore } from '#adapters/persistence/yaml/YamlListDatastore.mjs';
import { ListConfigCodec } from '#adapters/content/list/ListConfigCodec.mjs';
import { FilesystemArtAdminRepository } from '#adapters/persistence/files/FilesystemArtAdminRepository.mjs';
import { AdminImageFileStore } from '#adapters/admin/AdminImageFileStore.mjs';
import { FetchAdminImageSource } from '#adapters/admin/FetchAdminImageSource.mjs';
import { createMediaRouter } from './4_api/v1/routers/media.mjs';
import { MediaSurfaceConfigService } from '#apps/media/MediaSurfaceConfigService.mjs';
import { MediaQueue } from '#domains/media/entities/MediaQueue.mjs';
import { MediaQueueEvents } from '#apps/events/RealtimePublications.mjs';
import { createLivestreamRouter } from './4_api/v1/routers/livestream.mjs';
import { createCameraRouter } from './4_api/v1/routers/camera.mjs';
import { createPrinterRouter } from './4_api/v1/routers/printer.mjs';

// Homeline call state tracking
import { setCallLeaseAuthority } from '#apps/homeline/CallStateService.mjs';
import { CallLeaseService } from '#apps/homeline/CallLeaseService.mjs';
import { createHomelineRouter } from '#api/v1/routers/homeline.mjs';
import { SecureHomelineIdentityIssuer } from '#adapters/homeline/SecureHomelineIdentityIssuer.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { NodeAsyncScheduler } from '#adapters/scheduling/NodeAsyncScheduler.mjs';
import { SchedulerTimestampCodec } from '#adapters/scheduling/SchedulerTimestampCodec.mjs';

// Pose frame logging
import { createPoseLogHandler } from '#adapters/fitness/PoseLogHandler.mjs';

// Fitness application services (shared between fitness router and agents router)
import { FitnessPlayableService } from '#apps/fitness/FitnessPlayableService.mjs';
import { FitnessConfigService } from '#apps/fitness/FitnessConfigService.mjs';
import { FitnessProgressClassifier } from '#domains/fitness/services/FitnessProgressClassifier.mjs';
import { initUnlockService } from '#apps/fitness/unlockService.mjs';
import { initManageService } from '#apps/fitness/manageService.mjs';
import { EventBusBiometricGateway } from '#adapters/fitness/EventBusBiometricGateway.mjs';
import { FitnessEmergencyPublications } from '#adapters/eventbus/FitnessEmergencyPublications.mjs';
import { FitnessIdentityChannel } from '#adapters/eventbus/FitnessIdentityChannel.mjs';
import { createFoodScaleRelay } from '#apps/hardware/foodScaleRelay.mjs';
import { createOmrRelay } from '#apps/hardware/omrRelay.mjs';
import { createOmrReaderLiveness } from '#adapters/hardware/omrReaderLiveness.mjs';
import { createPressureMatRelay } from '#apps/hardware/pressureMatRelay.mjs';
import { PressureMatOperations } from '#apps/hardware/PressureMatOperations.mjs';
import { PressureMatAdapter } from '#adapters/hardware/pressure-mat/index.mjs';
import { createPressureMatRouter } from '#api/v1/routers/pressureMat.mjs';
import { createAutomotiveRelay } from '#apps/hardware/automotiveRelay.mjs';
import { createAutomotiveApi } from '#composition/modules/automotiveApi.mjs';
import { createQuizScanRecorder } from '#apps/quizzes/quizScanRecorder.mjs';
import { EventBusEventInputSource } from '#adapters/scan/EventBusEventInputSource.mjs';
import { YamlDecodedQuizScanStore } from '#adapters/persistence/yaml/YamlDecodedQuizScanStore.mjs';
import { createScaleNutribotBridge } from '#adapters/hardware/ScaleNutribotBridge.mjs';
import { CompositionStore } from '#apps/nutribot/CompositionStore.mjs';
import { ApplyScanToComposition } from '#apps/nutribot/usecases/ApplyScanToComposition.mjs';
import { validateScanConfig } from '#apps/nutribot/lib/validateScanConfig.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';
import { createBarcodeRelay } from '#apps/hardware/barcodeRelay.mjs';
import { createRelayWatchdog } from '#apps/hardware/relayWatchdog.mjs';
import {
  AutomotiveFirmwareGateway,
  BarcodeFirmwareGateway,
  FoodScaleFirmwareGateway,
  OmrFirmwareGateway,
  RelayWatchdogFirmwareGateway,
} from '#adapters/hardware/firmware/EventBusFirmwareRelayGateways.mjs';
import { YamlAutomotiveTripStore } from '#adapters/hardware/automotive/YamlAutomotiveTripStore.mjs';
import { createFingerprintProfileWriter } from '#apps/fitness/fingerprintProfileWriter.mjs';
import { YamlUserProfileDatastore } from '#adapters/persistence/yaml/YamlUserProfileDatastore.mjs';
import { YamlMenuMemoryRepository } from '#adapters/persistence/yaml/YamlMenuMemoryRepository.mjs';
import { YamlEmergencyLockDatastore } from '#adapters/persistence/yaml/YamlEmergencyLockDatastore.mjs';
import { TriggerEmergencyLockdown } from '#apps/fitness/usecases/TriggerEmergencyLockdown.mjs';
import { ReleaseEmergencyLockdown } from '#apps/fitness/usecases/ReleaseEmergencyLockdown.mjs';
import { GetLockdownState } from '#apps/fitness/usecases/GetLockdownState.mjs';
import { createIdentityRelay } from '#apps/fitness/identityRelay.mjs';
// Workout persistence (Build authors, Run performs) + the corpus index it validates against
import { YamlWorkoutRepository } from '#adapters/fitness/YamlWorkoutRepository.mjs';
import { YamlExerciseLibraryRepository } from '#adapters/reference/exercise-library/index.mjs';
import { SaveWorkout } from '#apps/fitness/usecases/SaveWorkout.mjs';

// Scheduling domain + orchestrator
import { SchedulerService } from '#domains/scheduling/services/SchedulerService.mjs';
import { SchedulerOrchestrator } from '#apps/scheduling/SchedulerOrchestrator.mjs';
import { ScreenContentTracker } from '#apps/devices/services/ScreenContentTracker.mjs';
import { AmbientSchedulerService } from '#apps/ambient/AmbientSchedulerService.mjs';
import { YamlAmbientStateStore } from '#adapters/ambient/YamlAmbientStateStore.mjs';
import { normalizeWindows } from '#domains/ambient/normalizeWindows.mjs';
import { loadArtmodeConfig } from '#adapters/content/art/artmodeConfig.mjs';
import { YamlJobDatastore } from '#adapters/scheduling/YamlJobDatastore.mjs';
import { YamlStateDatastore } from '#adapters/scheduling/YamlStateDatastore.mjs';
import { CompositeJobDatastore } from '#adapters/scheduling/CompositeJobDatastore.mjs';
import { Scheduler } from './0_system/scheduling/Scheduler.mjs';
import { createSchedulingRouter } from './4_api/v1/routers/scheduling.mjs';

// NewsReporter domain — scheduled, LLM-generated reports
import { createNewsReporterRouter } from './4_api/v1/routers/newsreporter.mjs';

// Canvas domain
import { createCanvasRouter } from './4_api/v1/routers/canvas.mjs';

// Screens domain
import { createScreensRouter } from './4_api/v1/routers/screens.mjs';
import { ScreensQueryService } from '#apps/screens/ScreensQueryService.mjs';
import { FilesystemScreensRepository } from '#adapters/persistence/files/FilesystemScreensRepository.mjs';
import { FilesystemWeeklyReviewStore } from '#adapters/persistence/files/FilesystemWeeklyReviewStore.mjs';
import { NodeCommandRunner } from '#adapters/process/NodeCommandRunner.mjs';

// Auth system
import { AuthService } from '#apps/auth/AuthService.mjs';
import { AuthPublicContextService } from '#apps/auth/AuthPublicContextService.mjs';
import { ContentAccessService } from '#apps/content/ContentAccessService.mjs';
import { DataServiceAuthAccountRepository } from '#adapters/auth/DataServiceAuthAccountRepository.mjs';
import { NodeAuthenticationPrimitives } from '#adapters/auth/NodeAuthenticationPrimitives.mjs';
import { networkTrustResolver } from '#api/middleware/networkTrustResolver.mjs';
import { tokenResolver } from '#api/middleware/tokenResolver.mjs';
import { expandRolesToApps, permissionGate } from '#api/middleware/permissionGate.mjs';
import { createAuthRouter } from '#api/v1/routers/auth.mjs';
import { householdResolver } from '#api/middleware/householdResolver.mjs';
import { deviceResolver } from '#api/middleware/deviceResolver.mjs';

// Conversation state persistence
import { YamlConversationStateDatastore } from '#adapters/messaging/YamlConversationStateDatastore.mjs';

// Media jobs (fresh video downloads)
import { MediaJobExecutor } from './3_applications/media/MediaJobExecutor.mjs';
import { MediaDownloadService } from './3_applications/media/services/MediaDownloadService.mjs';
import { createFreshVideoJobHandler } from './3_applications/media/FreshVideoJobHandler.mjs';
import { createCameraLedgerJobHandler } from './3_applications/camera/cameraLedgerJobHandler.mjs';
import { createCameraArchiveJobHandler } from './3_applications/camera/cameraArchiveJobHandler.mjs';
import { YtDlpAdapter } from '#adapters/media/YtDlpAdapter.mjs';

// Content composition use case
import { ComposePresentationUseCase } from './3_applications/content/usecases/ComposePresentationUseCase.mjs';

// Barcode scanner pipeline — ingress now routes through the unified trigger
// pipeline (TriggerDispatchService); BarcodeScanService is retired from the
// boot path here (kept in-tree for Plan 4 to delete) and no longer constructed.
import { KNOWN_COMMANDS, resolveCommand } from '#domains/barcode/BarcodeCommandMap.mjs';
import { ContentDispatcher } from '#apps/trigger/ContentDispatcher.mjs';

// Weekly Review domain
import { WeeklyReviewImmichAdapter } from './1_adapters/weekly-review/WeeklyReviewImmichAdapter.mjs';
import { WeeklyReviewCalendarAdapter } from './1_adapters/weekly-review/WeeklyReviewCalendarAdapter.mjs';
import { WeeklyReviewService } from './3_applications/weekly-review/WeeklyReviewService.mjs';
import { createWeeklyReviewRouter } from './4_api/v1/routers/weekly-review.mjs';

// Harvest domain (data collection)
import { createHarvestRouter } from './4_api/v1/routers/harvest.mjs';

// FileIO utilities for image saving
// API versioning
import { createApiRouter } from './4_api/v1/routers/api.mjs';
import { createArtRouter } from './4_api/v1/routers/art.mjs';
import { createPianoRouter } from './4_api/v1/routers/piano.mjs';
import { PianoContainer } from './3_applications/piano/PianoContainer.mjs';
import { PianoGameBudgetService } from './3_applications/piano/PianoGameBudgetService.mjs';
import { PianoChallengeProfileService } from './3_applications/piano/PianoChallengeProfileService.mjs';
import { SchoolPianoChallengeCompletionService } from './3_applications/piano/SchoolPianoChallengeCompletionService.mjs';
import { YamlPianoStudioDatastore } from './1_adapters/piano/YamlPianoStudioDatastore.mjs';
import { YamlPianoGameBudgetStore } from '#adapters/persistence/yaml/YamlPianoGameBudgetStore.mjs';
import { YamlPianoBoardGameDayStore } from '#adapters/persistence/yaml/YamlPianoBoardGameDayStore.mjs';
import { PianoBoardGameDayService } from '#apps/piano-games/PianoBoardGameDayService.mjs';
import { YamlComposerSongStore as ComposerSongStore } from '#adapters/persistence/yaml/YamlComposerSongStore.mjs';
import { createFeedbackRouter } from './4_api/v1/routers/feedback.mjs';
import { createGamingRouter } from './4_api/v1/routers/gaming.mjs';
import { createPresentationRouter } from './4_api/v1/routers/presentation.mjs';
import { YamlGamingDefinitionStore } from './1_adapters/persistence/yaml/gaming/YamlGamingDefinitionStore.mjs';
import { YamlGamingAssetCatalog } from './1_adapters/persistence/yaml/gaming/YamlGamingAssetCatalog.mjs';
import { YamlPresentationCatalog } from './1_adapters/persistence/yaml/presentation/YamlPresentationCatalog.mjs';
import { YamlPianoAttemptStore } from './1_adapters/persistence/yaml/piano/YamlPianoAttemptStore.mjs';
import { YamlPianoLearningStore } from './1_adapters/persistence/yaml/piano/YamlPianoLearningStore.mjs';
import { YamlExerciseBank } from './1_adapters/piano/YamlExerciseBank.mjs';
import { PianoScaleChallengePolicy } from './3_applications/piano/PianoScaleChallengePolicy.mjs';
import { BankChallengePolicy } from './3_applications/piano/BankChallengePolicy.mjs';
import { PianoLearningService } from './3_applications/piano/PianoLearningService.mjs';
import { YamlGamingExperienceManifestStore } from '#adapters/persistence/yaml/gaming/YamlGamingExperienceManifestStore.mjs';
import { createWikipediaRouter } from './4_api/v1/routers/wikipedia.mjs';
import { createChessRouter } from './4_api/v1/routers/chess.mjs';
import { buildChessArchiveFilename, buildGameRecordFilename } from '#adapters/persistence/chess/ChessRecordNames.mjs';
import { createStockfishEngine } from './1_adapters/chess/StockfishEngineAdapter.mjs';
import { createStockfishAnalyst } from './1_adapters/chess/StockfishAnalysisAdapter.mjs';
import { chessArchiveDayDir } from '#shared/gaming/rulesets/chess/archivePaths.mjs';
import { createChessConfigService } from './3_applications/chess/ChessConfigService.mjs';
import { createChessLadderService } from './3_applications/chess/ChessLadderService.mjs';
import { createPianoGamesModule } from '#composition/modules/pianoGames.mjs';
import { WikipediaAdapter } from './1_adapters/reference/WikipediaAdapter.mjs';
import { PartyGamesCatalog } from './3_applications/gaming/usecases/PartyGamesCatalog.mjs';
import { buzzersToSelectors, makeBuzzerSelectHandler } from './3_applications/gaming/effects/partyGamesBuzzerInput.mjs';
import { createGamingApiModule } from './5_composition/modules/gamingApi.mjs';
import { createSchoolRouter } from './4_api/v1/routers/school.mjs';
import { SchoolService } from './3_applications/school/SchoolService.mjs';
import { YamlSchoolDatastore } from './1_adapters/persistence/yaml/YamlSchoolDatastore.mjs';
import { createSentenceLadderRouter } from './4_api/v1/routers/sentenceLadder.mjs';
import { SentenceLadderService } from './3_applications/school/SentenceLadderService.mjs';
import { YamlLanguageStudyDatastore } from './1_adapters/persistence/yaml/YamlLanguageStudyDatastore.mjs';
import { YamlAssignmentStore } from './1_adapters/persistence/yaml/YamlAssignmentStore.mjs';
import { HmacSchoolStudyGrantIssuer } from './1_adapters/school/actions/HmacSchoolStudyGrantIssuer.mjs';
import { HmacSchoolReelGrantIssuer } from './1_adapters/school/actions/HmacSchoolReelGrantIssuer.mjs';
import { HmacSchoolCubeGrantIssuer } from './1_adapters/school/actions/HmacSchoolCubeGrantIssuer.mjs';
import { KociembaCubeRecoverySolver } from './1_adapters/school/rubiksCube/KociembaCubeRecoverySolver.mjs';
import { FilesystemLanguageReelRepository } from './1_adapters/school/FilesystemLanguageReelRepository.mjs';
import { FilesystemRubiksCubeProgressRepository } from './1_adapters/school/FilesystemRubiksCubeProgressRepository.mjs';
import { LanguageReelService } from './3_applications/school/LanguageReelService.mjs';
import { createLanguageReelsRouter } from './4_api/v1/routers/languageReels.mjs';
import { RubiksCubeCourseService } from './3_applications/school/rubiksCube/RubiksCubeCourseService.mjs';
import { RubiksPacketPlanner } from './3_applications/school/rubiksCube/RubiksPacketPlanner.mjs';
import { YamlDocumentFileStore } from './1_adapters/school/YamlDocumentFileStore.mjs';
import { RUBIKS_CUBE_COURSE_ID, RUBIKS_CUBE_REVISION } from './3_applications/school/rubiksCube/courseCatalog.mjs';
import { createRubiksCubeRouter } from './4_api/v1/routers/rubiksCube.mjs';
import { GetSchoolReport } from './3_applications/school/GetSchoolReport.mjs';
import { GetLearningProgress } from './3_applications/school/GetLearningProgress.mjs';
import { GetInstructionalInsights } from './3_applications/school/GetInstructionalInsights.mjs';
import { RecordLearningReflection } from './3_applications/school/RecordLearningReflection.mjs';
import { OpenCatalogLearningSession } from './3_applications/school/OpenCatalogLearningSession.mjs';
import { OfferCatalogQuizRemediation } from './3_applications/school/remediation/OfferCatalogQuizRemediation.mjs';
import { IssueSchoolContinuationCode } from './3_applications/school/IssueSchoolContinuationCode.mjs';
import { AssessmentReviewFollowUpSource } from './3_applications/school/AssessmentReviewFollowUpSource.mjs';
import {
  ConfiguredAcademicPeriodSource,
  ConfiguredLearningExpectationSource,
  ConfiguredSchoolLearningDirectory,
  CurriculumExpectationSource,
  YamlConceptRegistry,
  YamlLearningEvidenceRepository,
  YamlSchoolAttemptEvidenceSource,
} from './1_adapters/school/progress/index.mjs';
import { shortId } from '#system/utils/id.mjs';
import { PresenceStore } from './1_adapters/devices/PresenceStore.mjs';
import { resolveGate, ROLE_SEVERITY } from './2_domains/school/accessGate.mjs';
import { GetMaterialCatalog } from './3_applications/school/GetMaterialCatalog.mjs';
import { GetMaterialUnits, buildBankIndex } from './3_applications/school/GetMaterialUnits.mjs';
import { GetMaterialProgressSummary } from './3_applications/school/GetMaterialProgressSummary.mjs';
import { MediaAlbumSource } from './3_applications/school/sources/MediaAlbumSource.mjs';
import { MediaSeriesSource } from './3_applications/school/sources/MediaSeriesSource.mjs';
import { MediaLabelSource } from './3_applications/school/sources/MediaLabelSource.mjs';
import { PlexSchoolMediaCatalog } from './1_adapters/school/media/plex/PlexSchoolMediaCatalog.mjs';
import { GeneratedBankSource } from '#adapters/school/generated-content/GeneratedBankSource.mjs';
import { GetLearnerRecord } from '#apps/school/usecases/GetLearnerRecord.mjs';
import { RegradeBankAttempts } from '#apps/school/usecases/RegradeBankAttempts.mjs';
import { AdjustSessionGrade, RetractSessionGradeAdjustment } from '#apps/school/usecases/AdjustSessionGrade.mjs';
import { GetTeacherSession, GetLearnerTimeline } from '#apps/school/usecases/GetTeacherSession.mjs';
import { PreviewTeacherLessonMaterial } from '#apps/school/usecases/PreviewTeacherLessonMaterial.mjs';
import { TeacherCapabilitySessions } from '#apps/school/TeacherCapabilitySessions.mjs';
import { YamlUserVideoProgressStore as SchoolUserVideoProgressStore } from '#adapters/persistence/yaml/YamlUserVideoProgressStore.mjs';
import { PrintService } from './3_applications/school/PrintService.mjs';
import { renderBankWorksheet } from './1_rendering/school/WorksheetRenderer.mjs';
import { createArtifactPostviewRenderer, renderPdfFirstPagePng } from '#rendering/school/documents/ArtifactPostviewRenderer.mjs';
import { createContentFilterRouter } from './4_api/v1/routers/contentFilter.mjs';
import { FeedbackService } from './3_applications/common/feedback/FeedbackService.mjs';
import { NotificationConfigService } from './3_applications/notification/NotificationConfigService.mjs';
import { YamlNotificationConfigRepository } from '#adapters/notification/YamlNotificationConfigRepository.mjs';
import { createArtAdapter } from './1_adapters/content/art/ArtAdapter.mjs';
import { createConfigRouter } from './4_api/v1/routers/config.mjs';
import { createItemRouter } from './4_api/v1/routers/item.mjs';
import { createEmulatorRouter } from './4_api/v1/routers/emulator.mjs';
import { loadEmulatorConfig } from './3_applications/emulator/loadEmulatorConfig.mjs';
import { createAmbientLightService } from './3_applications/home-automation/AmbientLightService.mjs';
import { startAmbientZones } from './3_applications/home-automation/ambientZones.mjs';
import { projectAmbientZones } from '#adapters/home-automation/ConfiguredAmbientZones.mjs';
import { BuildMetadataSource } from '#adapters/runtime/BuildMetadataSource.mjs';
import { ReadalongRuntimePaths } from '#adapters/content/ReadalongRuntimePaths.mjs';
import { ContentPrefixConfigSource } from '#adapters/content/ContentPrefixConfigSource.mjs';
import { YamlFeedQueryRepository } from '#adapters/feed/YamlFeedQueryRepository.mjs';
import { HarvesterImageStore } from '#adapters/harvester/HarvesterImageStore.mjs';
import { YamlSchoolScreenConfigSource } from '#adapters/school/YamlSchoolScreenConfigSource.mjs';
import { FilesystemAssetProbe } from '#adapters/runtime/FilesystemAssetProbe.mjs';
import { FilesystemWorksheetPdfReader } from '#adapters/school/documents/FilesystemWorksheetPdfReader.mjs';
import { HouseholdYamlDocumentStore } from '#adapters/persistence/yaml/HouseholdYamlDocumentStore.mjs';
import { FilesystemYamlDirectoryCatalog } from '#adapters/persistence/files/FilesystemYamlDirectoryCatalog.mjs';
import { FilesystemEmulatorAssetRepository } from '#adapters/emulator/FilesystemEmulatorAssetRepository.mjs';
import { FilesystemEmulatorConfigRepository } from '#adapters/emulator/FilesystemEmulatorConfigRepository.mjs';
import { FilesystemEmulatorSaveRepository } from '#adapters/emulator/FilesystemEmulatorSaveRepository.mjs';
import { EmulatorResourceService } from '#apps/emulator/EmulatorResourceService.mjs';
import { EmulatorLibraryService } from '#apps/emulator/EmulatorLibraryService.mjs';
import { buildCatalog, resolveGameRules } from '#apps/emulator/EmulatorCatalog.mjs';
import { GamingMediaService } from '#apps/gaming/GamingMediaService.mjs';
import { FilesystemGamingMediaRepository } from '#adapters/gaming/FilesystemGamingMediaRepository.mjs';
import { ReolinkClient, makeSource, parseTriggerBits } from '#adapters/camera/ReolinkRecordingAdapter.mjs';
import { createHaDetectionSource } from '#adapters/camera/HaDetectionSource.mjs';
import { ArchiveEncoder } from '#adapters/camera/ArchiveEncoder.mjs';
import { ArchiveManifestStore } from '#adapters/camera/ArchiveManifestStore.mjs';
import { getCurriculumIndex, mergeSeason } from '#adapters/content/media/plex/CurriculumIndex.mjs';
import { ContentExpression } from '#domains/content/ContentExpression.mjs';
import { resolveFormat } from '#domains/content/utils/resolveFormat.mjs';
import * as schoolErrors from '#domains/school/errors.mjs';
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
  const authConfig = dataService.system.read('config/auth') || {};
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
      aiUsageLedger
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
    sharedAiGateway = new OpenAIAdapter({ apiKey: openaiApiKey }, { httpClient: axios, logger: rootLogger.child({ module: 'shared-ai' }), aiUsageLedger });
    rootLogger.debug('ai.adapter.fallback', { reason: 'Using hardcoded OpenAI adapter creation' });
  }

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

  eventBus.setClientSubscriptionAuthorizer((clientId, topic) =>
    !String(topic).startsWith('homeline-call:') || callLeaseService?.canSubscribe(clientId, topic) === true);
  eventBus.setClientMessageAuthorizer((clientId, message) =>
    message?.type !== 'homeline-authorize' && String(message?.topic).startsWith('homeline-call:')
      ? (callLeaseService?.validateSignal(clientId, message) || { ok: false, code: 'LEASES_NOT_READY' })
      : { ok: true, message });
  eventBus.onClientDisconnection(clientId => callLeaseService?.disconnect(clientId));

  // DeviceLivenessService — caches last-known device-state snapshots and
  // synthesizes `offline` broadcasts when heartbeats stop. Also wires
  // itself into the event bus so new subscribers get a replayed snapshot.
  const devicePresenceGateway = new EventBusDeviceTransportGateway({ eventBus });
  const { livenessService: deviceLivenessService } = createDeviceLivenessService({
    eventBus,
    presenceGateway: devicePresenceGateway,
    logger: rootLogger.child({ module: 'device-liveness' })
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

  // Register message handlers for incoming client messages
  // These handlers rebroadcast messages to subscribed clients
  eventBus.onClientMessage((clientId, message) => {
    if (message.type === 'homeline-authorize') {
      const result = callLeaseService?.authorize({ ...message, clientId }) || { ok: false, code: 'LEASES_NOT_READY' };
      eventBus.sendToClient(clientId, { type: 'homeline-authorize-ack', topic: message.topic, ...result });
      return;
    }

    if (message.topic?.startsWith('homeline-call:')) {
      eventBus.broadcast(message.topic, message);
      return;
    }

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

    // The legacy homeline device topic remains wake/load progress only. Call
    // signaling is accepted exclusively on authorized homeline-call topics.
    if (message.topic?.startsWith('homeline:')) {
      eventBus.broadcast(message.topic, message);
      return;
    }

    // Screen session-state publishes (SessionStatePublisher sends the bare
    // 'device-state' topic per buildDeviceStateBroadcast). Normalize to the
    // per-device topic so DeviceLivenessService and /media fleet subscribers
    // receive it — without this relay a screen's state never leaves the
    // socket and the fleet shows "unknown" forever.
    if (message.topic === 'device-state' && typeof message.deviceId === 'string' && message.deviceId) {
      eventBus.broadcast(`device-state:${message.deviceId}`, {
        deviceId: message.deviceId,
        snapshot: message.snapshot ?? null,
        reason: message.reason ?? 'change',
        ts: message.ts,
      });
      return;
    }

    // Screen command acks (buildCommandAck sends the bare 'device-ack'
    // topic). Republish on the per-device topic SessionControlService
    // awaits — without this every WS command "times out" and dispatch
    // steamrolls through the slow FKB-URL fallback. (Returning here is safe:
    // CommandHandlerLivenessService reads acks via its own onClientMessage
    // dispatcher, which runs independently of this handler.)
    if (message.topic === 'device-ack' && typeof message.deviceId === 'string' && message.deviceId) {
      eventBus.broadcast(`device-ack:${message.deviceId}`, message);
      return;
    }

    // Frontend logging messages - ingest to backend log system
    if (message.source === 'playback-logger' || message.topic === 'logging') {
      const clientMeta = eventBus.getClientMeta(clientId);
      ingestFrontendLogs(message, {
        ip: clientMeta?.ip,
        userAgent: clientMeta?.userAgent
      }, {
        // DoNow's garage-fitness soft-occupancy tap (Task 7 discovery, Task 13
        // wiring): `FitnessPresenceTracker.observe` guards on event name/shape
        // itself, so every normalized event is safe to hand it unconditionally.
        // `donowModule` is null until `createDonow` resolves later in boot —
        // before that, this is a no-op (nothing observed yet, occupancy reads
        // `unknown`, fail-closed).
        onEvent: (normalized) => donowModule?.presence?.fitness?.observe(normalized)
      });
      return;
    }
  });

  // Bluetooth controller management relay (browser ⇄ garage fitness extension).
  // The bus does not relay client→client by default; whitelist the bt.* control
  // topics so pairing/inventory/remove flow both ways. Whitelist only — never blanket.
  eventBus.onClientMessage((clientId, message) => {
    if (message && shouldRelayBtTopic(message.topic)) {
      eventBus.broadcast(message.topic, message);
      rootLogger.debug?.('eventbus.bt.relay', { clientId, topic: message.topic });
    }
  });

  // Kiosk app-launch relay (admin ⇒ kiosk SPA, and the result back). The launch
  // must execute inside the kiosk page — intent extras need FKB's in-page
  // startIntent — so the command is relayed to the page rather than issued from
  // the backend. Whitelist only. The kiosk drops anything not addressed to its
  // own deviceId.
  eventBus.onClientMessage((clientId, message) => {
    if (message && shouldRelayKioskLaunchTopic(message.topic)) {
      eventBus.broadcast(message.topic, message);
      rootLogger.debug?.('eventbus.kiosk.relay', {
        clientId,
        topic: message.topic,
        deviceId: message.deviceId
      });
    }
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
  const decodedQuizRoot = omrReadersConfig?.quizzes?.dir
    ? path.join(dataDir, ...String(omrReadersConfig.quizzes.dir).replace(/^\/+/, '').split('/'))
    : configService.getHouseholdPath('school/records/assessments/omr', householdId);
  createQuizScanRecorder({
    scanSource: new EventBusEventInputSource({ eventBus, topics: ['omr'] }),
    decodedScanStore: new YamlDecodedQuizScanStore({
      decodedRoot: decodedQuizRoot,
      rawHistoryRoot: relayHistoryRoot(omrReadersConfig, 'hardware/omr/log'),
    }),
    logger: rootLogger.child({ module: 'quiz-scan' }),
  });

  // Automotive relay — ingests the in-car Freematics device's trip/snapshot
  // stream (source: 'obd-relay') whenever the car is on home WiFi and
  // re-broadcasts on the `automotive` topic; a decoupled persister writes
  // trips + snapshots to history/automotive/. See _extensions/obd-relay.
  const vehiclesRelayConfig = configService.getHouseholdAppConfig(householdId, 'vehicles')
    || configService.reloadHouseholdAppConfig?.(householdId, 'vehicles')
    || {};
  createAutomotiveRelay({
    relayGateway: new AutomotiveFirmwareGateway({
      eventBus,
      config: vehiclesRelayConfig,
      timezone: configService.getHouseholdTimezone(householdId),
    }),
    tripStore: new YamlAutomotiveTripStore({
      root: relayHistoryRoot(vehiclesRelayConfig, 'automotive/log'),
    }),
    dayLog: relayDayLog(vehiclesRelayConfig, 'automotive/log', 'automotive'),
    // Threaded, not read from a config singleton inside the relay — day keys and
    // trip filenames must follow the household's zone, not UTC or DEFAULT_TIMEZONE.
    timezone: configService.getHouseholdTimezone(householdId),
    logger: rootLogger.child({ module: 'obd-relay' }),
  });

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
  const biometricGateway = new EventBusBiometricGateway({ eventBus });
  initUnlockService({
    biometricGateway,
  });

  // Fingerprint manager — enroll/delete relay over the same garage WS, plus the
  // browser progress rebroadcast. Auth reuses the unlock service above.
  initManageService({
    biometricGateway,
  });
  // Persistence adapter (1_adapters) → application writer (3_applications): the
  // writer never touches the filesystem itself, satisfying the DDD layering.
  const userProfileDatastore = new YamlUserProfileDatastore({ configService });
  const fingerprintProfileWriter = createFingerprintProfileWriter({ datastore: userProfileDatastore, configService });

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
    const { AudiobookshelfClient } = await import('./1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs');
    const { ABSProgressAdapter } = await import('./1_adapters/content/readable/audiobookshelf/ABSProgressAdapter.mjs');
    const { ProgressWriteRuntime } = await import('./1_adapters/content/ProgressWriteRuntime.mjs');
    const { ProgressSyncService } = await import('./3_applications/content/services/ProgressSyncService.mjs');
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

  const { registry: contentRegistry, savedQueryService } = createContentRegistry({
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
    storagePaths                 // Collection → media_memory filename mapping
  }, { httpClient: axios, mediaProgressMemory, app, configService, logger: rootLogger });

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
    logger: rootLogger.child({ module: 'economy-api' })
  });

  const { routers: contentRouters, services: contentServices } = createApiRouters({
    registry: contentRegistry,
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
    logger: rootLogger.child({ module: 'content' })
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
  const costDataRoot = configService.getHouseholdPath('cost');
  const costServices = createCostServices({
    dataRoot: costDataRoot,
    // budgetRepository not yet implemented - will be added when YamlBudgetDatastore is created
    logger: rootLogger.child({ module: 'cost' })
  });

  // Entropy domain - use DataService for user-specific data (replaces legacy io.mjs)
  const userLoadFile = (username, service) => dataService.user.read(`lifelog/${service}`, username);
  const userLoadCurrent = (username, service) => dataService.user.read(`current/${service}`, username);
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
  rootLogger.info('content.routers.created', { keys: ['item', 'content', 'proxy', 'list', 'siblings', 'queue', 'play', 'localContent', 'local', 'stream'] });

  // Info router (action-based metadata)
  const { createInfoRouter } = await import('./4_api/v1/routers/info.mjs');
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
  const { createDisplayRouter } = await import('./4_api/v1/routers/display.mjs');
  v1Routers.display = createDisplayRouter({
    contentAccessService,
    logger: rootLogger.child({ module: 'display-api' })
  });

  // Media queue management
  v1Routers.media = createMediaRouter({
    mediaQueueService: mediaServices.mediaQueueService,
    mediaSurfaceConfig: new MediaSurfaceConfigService({
      loadAppConfig: (householdId, app) => configService.getHouseholdAppConfig(householdId, app),
    }),
    contentIdResolver: contentServices.contentIdResolver,
    mediaQueueEvents: new MediaQueueEvents({ publish: (topic, payload) => eventBus.broadcast(topic, payload) }),
    createMediaQueue: (props) => new MediaQueue(props),
    logger: rootLogger.child({ module: 'media-api' }),
  });

  // Livestream engine — concrete adapters composed here, injected as factories
  const { ChannelManager } = await import('./3_applications/livestream/ChannelManager.mjs');
  const { FFmpegStreamAdapter } = await import('./1_adapters/livestream/FFmpegStreamAdapter.mjs');
  const { SourceFeeder } = await import('./1_adapters/livestream/SourceFeeder.mjs');
  const { StreamChannelRuntimeAdapter } = await import('./1_adapters/livestream/StreamChannelRuntimeAdapter.mjs');
  const programsBasePath = configService.getHouseholdPath('livestream/programs');
  const livestreamConfigFiles = new YamlConfigFileStore({ logger: rootLogger.child({ module: 'livestream-config' }) });
  const channelManager = new ChannelManager({
    broadcastEvent: (topic, payload) => eventBus.broadcast(topic, payload),
    createChannelRuntime: (opts) => new StreamChannelRuntimeAdapter({
      ...opts,
      createEncoder: (encoderOpts) => new FFmpegStreamAdapter(encoderOpts),
      createFeeder: (feederOpts) => new SourceFeeder({
        ...feederOpts,
        resolveMediaAsset: (asset) => path.isAbsolute(asset) ? asset : path.join(mediaBasePath, asset),
      }),
    }),
    loadProgram: (programPath) => livestreamConfigFiles.readYaml(
      path.isAbsolute(programPath) ? programPath : path.join(programsBasePath, programPath),
    ),
    clock: () => Date.now(),
    random: Math.random,
    scheduler: new NodeApplicationScheduler(),
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

  // Health mentions router — powers CoachChat @-mention autocomplete dropdowns.
  // Mounted BEFORE the health router so /health/mentions/* is matched first.
  // NOTE: healthAnalyticsService is set later (after createAgentsServices) via
  // v1Routers.agents.healthAnalyticsService. See the re-assignment below.
  v1Routers.healthMentions = createHealthMentionsRouter({
    healthAnalyticsService: null,  // placeholder — replaced after agents router boots
    healthStore: healthServices.healthStore,
    healthService: healthServices.healthService,
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
    // content/lists is a top-level tree, sibling to household/ — NOT household-scoped.
    const feedQueries = new YamlFeedQueryRepository({ dataService, configService, logger: rootLogger });
    const queryConfigs = feedQueries.loadHouseholdQueries();
    const loadUserQueries = (username) => feedQueries.loadUserQueries(username);

    // Feed source adapters (extracted from FeedAssemblyService)
    // Shared system HttpClient for all raw-HTTP feed adapters (P1.9).
    const feedHttpClient = new HttpClient({ logger: rootLogger.child({ module: 'feed-http' }) });
    const redditAdapter = new RedditFeedAdapter({
      dataService,
      httpClient: feedHttpClient,
      logger: rootLogger.child({ module: 'reddit-feed' }),
    });
    const weatherAdapter = new WeatherFeedAdapter({
      dataService,
      logger: rootLogger.child({ module: 'weather-feed' }),
    });
    const healthAdapter = new HealthFeedAdapter({
      loadLifelog: userLoadFile,
      logger: rootLogger.child({ module: 'health-feed' }),
    });
    const gratitudeAdapter = new GratitudeFeedAdapter({
      dataService,
      userService,
      logger: rootLogger.child({ module: 'gratitude-feed' }),
    });
    const stravaAdapter = new StravaFeedAdapter({
      loadLifelog: userLoadFile,
      logger: rootLogger.child({ module: 'strava-feed' }),
    });
    const todoistAdapter = new TodoistFeedAdapter({
      loadCurrentTasks: (username) => userLoadCurrent(username, 'todoist'),
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
      loadLifelog: userLoadFile,
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
      httpClient: feedHttpClient,
      logger: rootLogger.child({ module: 'youtube-adapter' }),
    }) : null;
    const youtubeAdapter = googleAuth?.api_key ? new YouTubeFeedAdapter({
      apiKey: googleAuth.api_key,
      youtubeAdapter: youtubeContentAdapter,
      httpClient: feedHttpClient,
      logger: rootLogger.child({ module: 'youtube-feed' }),
    }) : null;
    const googleNewsAdapter = new GoogleNewsFeedAdapter({
      httpClient: feedHttpClient,
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
      httpClient: feedHttpClient,
      logger: rootLogger.child({ module: 'komga-feed' }),
    }) : null;

    const readalongContentAdapter = contentRegistry?.get('readalong') || null;
    const readalongFeedAdapter = readalongContentAdapter ? new ReadalongFeedAdapter({
      readalongAdapter: readalongContentAdapter,
      logger: rootLogger.child({ module: 'readalong-feed' }),
    }) : null;

    const goodreadsFeedAdapter = new GoodreadsFeedAdapter({
      loadLifelog: userLoadFile,
      httpClient: feedHttpClient,
      logger: rootLogger.child({ module: 'goodreads-feed' }),
    });

    const { AudiobookshelfClient } = await import('./1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs');
    const absEbookFeedAdapter = audiobookshelfConfig ? new ABSEbookFeedAdapter({
      absClient: new AudiobookshelfClient(audiobookshelfConfig, { httpClient: axios }),
      token: audiobookshelfConfig.token,
      mediaDir: mediaBasePath,
      webUrl: configService.resolveServiceWebUrl('audiobookshelf'),
      httpClient: feedHttpClient,
      logger: rootLogger.child({ module: 'abs-ebooks-feed' }),
    }) : null;

    // Start daily prefetch timer for abs-ebooks chapter cache
    if (absEbookFeedAdapter) {
      const allQueries = [...queryConfigs, ...loadUserQueries('user_1')];
      absEbookFeedAdapter.startPrefetchTimer(allQueries);
    }

    const { ScrollConfigLoader } = await import('./3_applications/feed/services/ScrollConfigLoader.mjs');
    const { DataServiceFeedConfigRepository } = await import('./1_adapters/feed/DataServiceFeedConfigRepository.mjs');
    const { SpacingEnforcer } = await import('./3_applications/feed/services/SpacingEnforcer.mjs');
    const { TierAssemblyService } = await import('./3_applications/feed/services/TierAssemblyService.mjs');
    const { SourceResolver } = await import('./3_applications/feed/services/SourceResolver.mjs');
    const { FeedCacheService } = await import('./3_applications/feed/services/FeedCacheService.mjs');
    const { YamlFeedCacheRepository } = await import('./1_adapters/feed/YamlFeedCacheRepository.mjs');

    const scrollConfigLoader = new ScrollConfigLoader({
      configRepository: new DataServiceFeedConfigRepository({ dataService }),
    });
    const spacingEnforcer = new SpacingEnforcer();
    const feedCacheService = new FeedCacheService({
      cacheRepository: new YamlFeedCacheRepository({ dataService }),
      scheduler: new NodeApplicationScheduler(),
      logger: rootLogger.child({ module: 'feed-cache' }),
    });

    const webContentAdapter = new WebContentAdapter({
      httpClient: feedHttpClient,
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
      scheduler: new NodeApplicationScheduler(),
      logger: rootLogger.child({ module: 'feed-pool' }),
    });

    const { FeedFilterResolver } = await import('./3_applications/feed/services/FeedFilterResolver.mjs');
    const { FeedPrincipalResolver } = await import('./3_applications/feed/services/FeedPrincipalResolver.mjs');
    const { FeedReaderService } = await import('./3_applications/feed/services/FeedReaderService.mjs');
    const { FeedReaderTimelineService } = await import('./3_applications/feed/services/FeedReaderTimelineService.mjs');
    const { FeedScrollSessionService } = await import('./3_applications/feed/services/FeedScrollSessionService.mjs');
    const { FeedSessionPersistenceService } = await import('./3_applications/feed/services/FeedSessionPersistenceService.mjs');
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
    const { YamlFeedItemStateStore } = await import('./1_adapters/persistence/yaml/YamlFeedItemStateStore.mjs');
    const { JsonlFeedHistoryStore } = await import('./1_adapters/persistence/feed/JsonlFeedHistoryStore.mjs');
    const { YamlFeedSessionStore } = await import('./1_adapters/persistence/yaml/YamlFeedSessionStore.mjs');
    const { FeedStateService } = await import('./3_applications/feed/services/FeedStateService.mjs');
    const feedItemStateStore = new YamlFeedItemStateStore({
      dataService,
      logger: rootLogger.child({ module: 'feed-item-state-store' }),
    });
    const feedHistoryStore = new JsonlFeedHistoryStore({
      dataService,
      logger: rootLogger.child({ module: 'feed-history-store' }),
    });
    const feedSessionStore = new YamlFeedSessionStore({ dataService });
    const feedStateService = new FeedStateService({
      store: feedItemStateStore,
      historyStore: feedHistoryStore,
      sourceAdapters: feedSourceAdapters,
      legacyDismissedStore: dismissedItemsStore,
      clock: { now: () => Date.now() },
      createId: crypto.randomUUID,
      scheduler: new NodeApplicationScheduler(),
      logger: rootLogger.child({ module: 'feed-state' }),
    });
    const feedReaderService = new FeedReaderService({
      readerGateway: feedServices.freshRSSAdapter,
      sourceAdapters: feedSourceAdapters,
      dismissedItemsStore,
      contentPluginRegistry,
      logger: rootLogger.child({ module: 'feed-reader' }),
    });
    const feedPrincipalResolver = new FeedPrincipalResolver({
      defaultUsername: () => configService.getHeadOfHousehold?.(),
    });
    const feedReaderTimelineService = new FeedReaderTimelineService({
      reader: feedReaderService,
      content: feedContentService,
      state: feedStateService,
    });
    const feedScrollSessionService = new FeedScrollSessionService({
      assembly: feedAssemblyService,
      state: feedStateService,
      persistence: new FeedSessionPersistenceService({ store: feedSessionStore }),
      createId: crypto.randomUUID,
    });
    v1Routers.feed = createFeedRouter({
      feedReaderService,
      headlineService: feedServices.headlineService,
      feedAssemblyService,
      feedContentService,
      feedStateService,
      feedPrincipalResolver,
      feedReaderTimelineService,
      feedScrollSessionService,
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
  const { DefaultPrincipalResolver } = await import('./3_applications/common/context/DefaultPrincipalResolver.mjs');
  const { NodePromiseDeadline } = await import('./1_adapters/scheduling/NodePromiseDeadline.mjs');
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
    dataService,
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

  // Art collections + optional Immich source for ArtMode.
  const artConfig = configService.getHouseholdAppConfig(null, 'art') || {};
  let artImmichSource = null;
  if (immichConfig) {
    const { ImmichClient } = await import('#adapters/content/gallery/immich/ImmichClient.mjs');
    const { createImmichSource } = await import('./1_adapters/content/art/sources/immichSource.mjs');
    const artImmichClient = new ImmichClient(immichConfig, { httpClient: axios });
    const fetchImageBytes = async (assetId) => {
      const r = await axios.get(
        `${immichConfig.host.replace(/\/$/, '')}/api/assets/${assetId}/thumbnail?size=preview`,
        { headers: { 'x-api-key': immichConfig.apiKey }, responseType: 'arraybuffer' }
      );
      return Buffer.from(r.data);
    };
    artImmichSource = createImmichSource({
      client: artImmichClient,
      fetchImageBytes,
      proxyPath: '/api/v1/proxy/immich',
      logger: rootLogger.child({ module: 'art-immich' }),
    });
  }
  const artAdapter = createArtAdapter({
    imgBasePath,
    householdDir: configService.getHouseholdPath(''),
    collections: artConfig.collections || {},
    immichSource: artImmichSource,
    logger: rootLogger.child({ module: 'art-adapter' })
  });
  // Register a thin `art` content source so /display/art:<preset> resolves to a
  // representative thumbnail (menu cards for art presets). The screensaver
  // adapter itself isn't a full IContentSource — the wrapper delegates the
  // thumbnail path and stubs the unused list/playable interface.
  if (contentRegistry?.register) {
    const { createArtContentSource } = await import('./1_adapters/content/art/ArtContentSource.mjs');
    contentRegistry.register(
      createArtContentSource({ artAdapter, logger: rootLogger.child({ module: 'art-content' }) }),
      { category: 'art' }
    );
  }
  const { ArtPresetService } = await import('#apps/content/ArtPresetService.mjs');
  const { FilesystemArtPresetCatalog } = await import('#adapters/content/art/FilesystemArtPresetCatalog.mjs');
  v1Routers.art = createArtRouter({
    artService: new ArtPresetService({
      catalog: new FilesystemArtPresetCatalog({
        householdDir: configService.getHouseholdPath(''),
        logger: rootLogger.child({ module: 'art-catalog' }),
      }),
      artSource: artAdapter,
    }),
    logger: rootLogger.child({ module: 'art-api' })
  });

  // App-wide voice-feedback capture + inbox. Background-transcribes via the shared
  // OpenAI gateway (null-safe: items still save when transcription isn't configured).
  // The notification service is what finally gives the inbox a reader: until now
  // arrival triggered nothing but a log line, so a recorded complaint sat in a
  // YAML file until somebody thought to go looking.
  const { FilesystemFeedbackRepository } = await import('./1_adapters/feedback/FilesystemFeedbackRepository.mjs');
  v1Routers.feedback = createFeedbackRouter({
    feedbackService: new FeedbackService({
      feedbackRepository: new FilesystemFeedbackRepository({
        itemsRoot: configService.getHouseholdPath('feedback'),
        mediaDir: mediaBasePath,
      }),
      transcriptionService: sharedAiGateway || null,
      notificationService: notificationStack?.notificationService || null,
      logger: rootLogger.child({ module: 'feedback' }),
    }),
    logger: rootLogger.child({ module: 'feedback-api' }),
  });

  const gamingDefinitionStore = new YamlGamingDefinitionStore({
    definitionsDir: configService.getHouseholdPath('gaming/games'),
    archiveDir: configService.getHouseholdPath('gaming/definitions'),
    logger: rootLogger.child({ module: 'gaming-definitions' }),
  });
  const gamingManifestStore = new YamlGamingExperienceManifestStore({
    manifestsDir: configService.getHouseholdPath('gaming/manifests'),
  });
  const partyGamesCatalog = new PartyGamesCatalog({
    configProjection: new PartyGamesConfigProjection({ configService }),
    userService,
    definitionStore: gamingDefinitionStore,
    manifestStore: gamingManifestStore,
    resourcePresenter: publicResourceUrl,
    logger: rootLogger.child({ module: 'party-games' }),
  });
  const partyGamesProfile = partyGamesCatalog.getConfig();
  const partyGamesPrinterAdapter = partyGamesProfile.printing.host ? new LaserPrinterAdapter({
    host: partyGamesProfile.printing.host,
    port: partyGamesProfile.printing.port,
    logger: rootLogger.child({ module: 'gaming-print' }),
  }) : null;
  const partyGamesPrinter = partyGamesPrinterAdapter ? {
    print: (pdf, { sessionId }) => partyGamesPrinterAdapter.printPdf(pdf, { jobName: `Party Games host packet — ${sessionId}`, user: 'party-games', copies: 1 }),
  } : null;

  // One Gaming authority serves every experience.
  const gamingModule = createGamingApiModule({
    definitionStore: gamingDefinitionStore,
    manifestStore: gamingManifestStore,
    snapshotsDir: configService.getHouseholdPath('gaming/snapshots'),
    journalsDir: configService.getHouseholdPath('gaming/journals'),
    effectsDir: configService.getHouseholdPath('gaming/effects'),
    drawingCheckpointsDir: configService.getHouseholdPath('gaming/drawing-checkpoints'),
    partyGamesCatalog,
    aiGateway: partyGamesProfile.ai.commentary || partyGamesProfile.ai.advisory_judgment ? sharedAiGateway : null,
    aiConfig: partyGamesProfile.ai,
    printer: partyGamesPrinter,
    broadcastEvent,
    logger: rootLogger.child({ module: 'gaming-runtime' }),
    autoPrint: partyGamesProfile.printing.auto_print_once_per_session,
  });
  const gamingAssetCatalog = new YamlGamingAssetCatalog({
    catalogsDir: join(mediaBasePath, 'games/_common/catalog'),
    assetRoot: join(mediaBasePath, 'games/_common'),
  });
  const presentationCatalog = new YamlPresentationCatalog({
    catalogsDir: join(mediaBasePath, 'games/_common/catalog'),
    assetRoot: join(mediaBasePath, 'games/_common'),
  });
  const gamingRouter = createGamingRouter({
    gamingApplication: gamingModule.gamingApplication,
    gamingMediaService: new GamingMediaService({ repository: new FilesystemGamingMediaRepository({
      assetCatalog: gamingAssetCatalog,
      partyMediaRoot: join(mediaBasePath, 'games', 'party-games'),
    }) }),
    broadcastEvent,
    logger: rootLogger.child({ module: 'gaming-api' }),
  });
  v1Routers.gaming = gamingRouter;
  const { GetPublicPresentationCatalog } = await import('./3_applications/presentation/GetPublicPresentationCatalog.mjs');
  v1Routers.presentation = createPresentationRouter({
    catalog: presentationCatalog,
    getPublicCatalog: new GetPublicPresentationCatalog({ catalog: presentationCatalog }),
    logger: rootLogger.child({ module: 'presentation-api' }),
  });

  // Chess: server-side Stockfish behind a worker thread + household/user config layers.
  const chessEngine = createStockfishEngine({ logger: rootLogger.child({ module: 'chess-engine' }) });
  // A SECOND engine, never handicapped, for hints and analysis. Separate from
  // the opponent because the bottom ladder rungs are no longer Stockfish at all
  // — asking the opponent engine for the best move would now return a
  // beginner's guess — and because the two want different UCI conversations:
  // one throttled bestmove out versus a scored search.
  const chessAnalyst = createStockfishAnalyst({
    depth: 14,
    logger: rootLogger.child({ module: 'chess-analyst' }),
  });
  server?.once?.('close', () => { chessEngine.dispose(); chessAnalyst.dispose(); });
  const chessConfigService = createChessConfigService({
    readHouseholdConfig: () => configService.getHouseholdAppConfig(null, 'chess'),
    readUserConfig: (userId) => dataService.user.read('apps/chess/config', userId) || {},
    writeUserConfig: (userId, data) => dataService.user.write('apps/chess/config', data, userId),
    logger: rootLogger.child({ module: 'chess-config' }),
  });
  const readChessLadderConfig = async (userId) => {
    const household = configService.getHouseholdAppConfig(null, 'chess') || {};
    const user = userId ? (dataService.user.read('apps/chess/config', userId) || {}) : {};
    return { ...household, ladder: { ...(household.ladder || {}), ...(user.ladder || {}) } };
  };
  const chessLadderService = createChessLadderService({
    readConfig: readChessLadderConfig,
    readProgress: (userId) => dataService.user.read('apps/chess/ladder', userId) || null,
    writeProgress: (userId, progress) => dataService.user.write('apps/chess/ladder', progress, userId),
    logger: rootLogger.child({ module: 'chess-ladder' }),
  });
  const pianoBoardGameDayStore = new YamlPianoBoardGameDayStore({
    historyRoot: configService.getHouseholdPath('history/piano-board-game-days', householdId),
  });
  const pianoBoardGameDayService = new PianoBoardGameDayService({
    store: pianoBoardGameDayStore,
    timezone: configService.getTimezone?.() || null,
    logger: rootLogger.child({ component: 'piano-board-game-day' }),
  });
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
  };
  const pianoChessRouter = createChessRouter({
    engine: chessEngine,
    analyst: chessAnalyst,
    configService: chessConfigService,
    recordStore: {
      save: (userId, record) => dataService.user.write(
        `apps/chess/games/${buildGameRecordFilename()}`,
        { ...record, user_id: userId, created_at: new Date().toISOString() },
        userId,
      ),
    },
    // The household archive: one file per game, under the day it was played,
    // named for the player. Household rather than per-user because it is the
    // instrument's history — the basis for comparing progress across the
    // children who share this piano, and the corpus the engine reads back when
    // asked where a game went wrong.
    archiveStore: {
      save: (record, userSegment) => {
        const day = /^\d{4}-\d{2}-\d{2}$/.test(record.played_on || '')
          ? record.played_on
          : new Date().toISOString().slice(0, 10);
        return dataService.household.write(
          `${chessArchiveDayDir(day)}/${buildChessArchiveFilename(record, userSegment)}`,
          { ...record, archived_at: new Date().toISOString() },
        );
      },
    },
    ladderService: chessLadderService,
    commentaryService: sharedChessCommentary,
    rivalryMemory: sharedChessRivalry,
    boardGameDayService: pianoBoardGameDayService,
    logger: rootLogger.child({ module: 'chess-api' }),
  });

  pianoGamesModule = createPianoGamesModule({
    dataService,
    configService,
    logger: rootLogger.child({ module: 'piano-games' }),
    nativeRouters: { chess: pianoChessRouter },
    boardGameDayService: pianoBoardGameDayService,
    aiGateway: sharedAiGateway,
  });
  server?.once?.('close', () => pianoGamesModule.container.dispose());
  v1Routers['piano-games'] = pianoGamesModule.router;

  // Self-hosted Wikipedia (kiwix-backed, plain-text) proxy. URL from services.yml;
  // router is skipped entirely when no wikipedia service is declared.
  const wikipediaUrl = configService.resolveServiceUrl('wikipedia');
  if (wikipediaUrl) {
    v1Routers.wikipedia = createWikipediaRouter({
      adapter: new WikipediaAdapter({
        baseUrl: wikipediaUrl,
        logger: rootLogger.child({ module: 'wikipedia' }),
      }),
      logger: rootLogger.child({ module: 'wikipedia-api' }),
    });
  }

  // School router (banks/sessions + materials framework) is constructed below
  // after the shared content adapters have been registered.

  // Content-filter cascade (EDL + profile + override) for the Player's
  // useContentFilter hook. Curated policy from data/household/content-filter/,
  // machine-fetched EDLs from media/content-filter/.
  const { FilesystemContentFilterRepository } = await import('./1_adapters/persistence/files/FilesystemContentFilterRepository.mjs');
  const { GetContentFilter } = await import('./3_applications/content-filter/usecases/GetContentFilter.mjs');
  v1Routers['content-filter'] = createContentFilterRouter({
    getContentFilter: new GetContentFilter({
      contentFilterRepository: new FilesystemContentFilterRepository({
        householdDir: configService.getHouseholdPath(''),
        mediaDir: configService.getMediaDir(),
      }),
    }),
    logger: rootLogger.child({ module: 'content-filter-api' }),
  });

  // Emulator console (games on the media mount). Addresses media by safe
  // (system, gameId) slugs and resolves the real (messy) on-disk filenames
  // server-side; also serves the vendored EmulatorJS engine bundle.
  {
    const emulationDir = path.join(configService.getMediaDir(), 'emulation');
    const engineDir = path.join(emulationDir, '_engine');
    const emuLogger = rootLogger.child({ module: 'emulator-api' });
    const configRepository = new FilesystemEmulatorConfigRepository({ emulationDir });
    const loadConfig = () => loadEmulatorConfig({ emulationDir, configRepository, logger: emuLogger });
    const emulatorResources = new EmulatorResourceService({
      assetRepository: new FilesystemEmulatorAssetRepository({ emulationDir, engineDir, loadCatalog: loadConfig }),
      saveRepository: new FilesystemEmulatorSaveRepository({ emulationDir }),
      loadConfig,
      resolveGameRules,
    });
    const emulatorLibrary = new EmulatorLibraryService({ loadConfig, buildCatalog, resolveGameRules, logger: emuLogger });
    v1Routers.emulator = createEmulatorRouter({
      logger: emuLogger,
      emulatorResources,
      emulatorLibrary,
      // Broadcasts the bt.pair.request bus topic the garage fitness bridge
      // listens for (puts the box into controller-pairing mode without SSH).
      // eventBus is already constructed (above) and in scope here.
      publishBtPair: (payload) => eventBus.broadcast('bt.pair.request', { topic: 'bt.pair.request', ...payload }),
    });
  }

  // Eink router — renders panels for hardware e-paper displays (Seeed reTerminal).
  const { EinkPanelService } = await import('./3_applications/eink/EinkPanelService.mjs');
  const { createEinkRouter } = await import('./4_api/v1/routers/eink.mjs');
  const { DataServiceEinkPanelStore } = await import('./1_adapters/eink/DataServiceEinkPanelStore.mjs');
  const { HttpEinkDataSourceGateway } = await import('./1_adapters/eink/HttpEinkDataSourceGateway.mjs');
  const { Sha1ContentFingerprint } = await import('./1_adapters/eink/Sha1ContentFingerprint.mjs');
  const { createEinkPanelRenderer } = await import('./1_rendering/eink/EinkPanelRenderer.mjs');
  // Self-fetch base for panel data sources comes from household config, never a
  // literal — same source the MediaBundle uses (see bootstrap.mjs). Internal
  // host (e.g. http://daylight-station:3111) so the round-trip stays on-LAN.
  const einkDevices = configService.getHouseholdDevices(householdId) || {};
  const einkPanelService = new EinkPanelService({
    panelStore: new DataServiceEinkPanelStore({ dataService }),
    dataSourceGateway: new HttpEinkDataSourceGateway({
      baseUrl: einkDevices.daylightHostInternal || einkDevices.daylightHost,
    }),
    panelRenderer: createEinkPanelRenderer({ fontDir: configService.getPath('font') || `${mediaBasePath}/fonts` }),
    fingerprint: new Sha1ContentFingerprint(),
    logger: rootLogger.child({ module: 'eink' }),
  });
  v1Routers.eink = createEinkRouter({
    einkPanelService,
    logger: rootLogger.child({ module: 'eink-api' }),
  });

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
    const screenToDevice = {};
    for (const [id, device] of Object.entries(barcodeDevices)) {
      const screenPath = device.screen_path; // e.g. "/screen/living-room"
      if (screenPath) {
        const screenName = screenPath.replace(/^\/screen\//, '');
        screenToDevice[screenName] = id;
      }
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
    const { createGratitudeCardRenderer } = await import('#rendering/gratitude/GratitudeCardRenderer.mjs');
    const { selectItemsForPrint } = await import('#domains/gratitude/services/PrintSelectionService.mjs');
    const householdId = configService.getDefaultHouseholdId();
    // Print-selection POLICY (how many of each category go on a card) is an
    // application decision — the renderer just draws what it is handed.
    const GRATITUDE_PRINT_COUNTS = { gratitude: 2, hopes: 2 };
    const renderer = createGratitudeCardRenderer({
      getSelectionsForPrint: async () => {
        const selections = await gratitudeServices.gratitudeService.getSelectionsForPrint(
          householdId,
          (userId) => userService.resolveGroupLabel(userId)
        );
        if (!selections) return null;
        const nowMs = Date.now();
        const pick = (items, count) => (items?.length > 0
          ? selectItemsForPrint(items, count, nowMs).map(s => ({
            id: s.id,
            text: s.item.text,
            displayName: s.displayName
          }))
          : []);
        return {
          gratitude: pick(selections.gratitude, GRATITUDE_PRINT_COUNTS.gratitude),
          hopes: pick(selections.hopes, GRATITUDE_PRINT_COUNTS.hopes),
        };
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
    printerRegistry: hardwareAdapters.printerRegistry,
    logger: rootLogger.child({ module: 'printer-api' })
  });

  // QR Code renderer and router
  const { createQRCodeRenderer } = await import('#rendering/qrcode/QRCodeRenderer.mjs');
  const { createGenerateQRCode } = await import('#apps/qrcode/GenerateQRCode.mjs');
  const { QRCodeAssetAdapter } = await import('#adapters/qrcode/QRCodeAssetAdapter.mjs');
  const { createQRCodeRouter } = await import('./4_api/v1/routers/qrcode.mjs');
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
  const { createGenerateCatalog } = await import('#apps/catalog/GenerateCatalog.mjs');
  const { HttpCatalogListSource } = await import('#adapters/catalog/HttpCatalogListSource.mjs');
  const { renderCatalogPdf } = await import('#rendering/catalog/renderCatalogPdf.mjs');
  const { createCatalogRouter } = await import('./4_api/v1/routers/catalog.mjs');
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
  const { createSheetService } = await import('#apps/sheets/SheetService.mjs');
  const { PrintableSheetOperations } = await import('#apps/sheets/PrintableSheetOperations.mjs');
  const { createCellRenderers } = await import('#rendering/pdf/cellRenderers.mjs');
  const { layout: layoutSheet } = await import('#rendering/pdf/SheetLayout.mjs');
  const { renderSheetPdf } = await import('#rendering/pdf/QRSheetRenderer.mjs');
  const { createNutritionProviders } = await import('#composition/modules/sheetProviders.mjs');
  const { createIconLoader } = await import('#composition/modules/iconLoader.mjs');
  const { createSheetsRouter } = await import('./4_api/v1/routers/sheets.mjs');

  const sheetCellKinds = createCellRenderers();
  const sheetsLogger = rootLogger.child({ module: 'sheets' });
  const sheetService = createSheetService({
    getConfig: () => configService.getHouseholdAppConfig(householdId, 'sheets') || {},
    providers: createNutritionProviders({
      // Read per build, not once: the sheet must reflect the scale config as it
      // stands when somebody asks for a printout.
      getScaleConfig: () => normalizeScaleNutribotConfig(
        configService.getHouseholdAppConfig(householdId, 'scales') || {},
      ),
      loadIcon: createIconLoader({
        dir: configService.getHouseholdPath('nutrition/icons'),
        logger: sheetsLogger,
      }),
    }),
    cellKinds: sheetCellKinds,
    layoutSheet,
    logger: sheetsLogger,
  });
  v1Routers.sheets = createSheetsRouter({
    printableSheets: new PrintableSheetOperations({
      sheets: sheetService,
      cellKinds: sheetCellKinds,
      renderPdf: renderSheetPdf,
      logger: sheetsLogger,
    }),
    logger: sheetsLogger,
  });

  // Nutribot report renderer (canvas-based PNG generation)
  let nutribotReportRenderer = null;
  try {
    const { NutriReportRenderer } = await import('#rendering/nutribot/NutriReportRenderer.mjs');
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
    configProjection: new FitnessConfigProjection({ configService }),
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

  // Piano kiosk API — per-user studio, preferences, lesson progress, and
  // course video progress. Composition root: build the persistence adapter +
  // PianoContainer (persistence + the two course algorithms), inject the
  // container into the thin router. fitnessPlayableService provides Plex
  // enrichment for the /courses/:id/playable + /courses/progress endpoints.
  const pianoStudioDatastore = new YamlPianoStudioDatastore({
    configService,
    userService,
    logger: rootLogger.child({ module: 'piano-datastore' })
  });
  const composerSongStore = new ComposerSongStore({
    configService,
    logger: rootLogger.child({ module: 'composer-store' })
  });
  // Minimal Plex children seam for the piano activity strip (collection →
  // shows). Same contract as schoolPlexClient.children below: thumbs come
  // back app-proxied.
  const pianoPlexAdapter = contentRegistry?.get('plex') || null;
  const pianoPlexClient = pianoPlexAdapter ? {
    children: async (ratingKey) => {
      if (!pianoPlexAdapter?.client) return [];
      // Collections MUST list via /library/collections/{id}/items — the
      // generic /children endpoint returns WRONG contents for some
      // collections (observed live: 675686's "children" were another
      // collection's shows, doubling six courses and dropping two).
      const data = await pianoPlexAdapter.client.getContainer(`/library/collections/${ratingKey}/items`);
      const items = data?.MediaContainer?.Metadata || [];
      const proxyPath = pianoPlexAdapter.proxyPath;
      return items.map((item) => {
        const rewritten = { ...item };
        if (typeof rewritten.thumb === 'string' && rewritten.thumb.startsWith('/')) {
          rewritten.thumb = `${proxyPath}${rewritten.thumb}`;
        }
        return rewritten;
      });
    },
    // One item's own metadata — for lesson shows that live in NO collection
    // (config `shows:` entries). Same thumb proxy-rewrite contract.
    metadata: async (ratingKey) => {
      if (!pianoPlexAdapter?.client) return null;
      const data = await pianoPlexAdapter.client.getContainer(`/library/metadata/${ratingKey}`);
      const item = data?.MediaContainer?.Metadata?.[0];
      if (!item) return null;
      const rewritten = { ...item };
      const proxyPath = pianoPlexAdapter.proxyPath;
      if (typeof rewritten.thumb === 'string' && rewritten.thumb.startsWith('/')) {
        rewritten.thumb = `${proxyPath}${rewritten.thumb}`;
      }
      return rewritten;
    },
  } : null;
  // Piano program assignments are edited from the existing Teacher console, so
  // they use that console's one authorization predicate rather than inventing a
  // second grown-up/PIN interpretation in the piano bounded context.
  const { makeTeacherGate } = await import('#apps/school/TeacherGate.mjs');
  const { SchoolTeacherConfigSource } = await import('#adapters/school/SchoolTeacherConfigSource.mjs');
  const schoolTeacherConfig = new SchoolTeacherConfigSource({ configService });
  const schoolTeacherGate = makeTeacherGate({
    loadTeachers: schoolTeacherConfig.teachers,
    loadTeacherPin: schoolTeacherConfig.pin,
    userService,
    householdId,
    logger: rootLogger.child({ module: 'school-teacher-gate' }),
  });
  const pianoAttemptStore = new YamlPianoAttemptStore({
    usersDir: join(configService.getDataDir(), 'users'),
  });
  // Exercise bank: seeds at data/content/music/, instances computed on demand.
  const exerciseBank = new YamlExerciseBank({ contentDir: contentPath });
  const pianoLearningStore = new YamlPianoLearningStore({
    usersDir: join(configService.getDataDir(), 'users'),
    assignmentsDir: configService.getHouseholdPath('piano/program-assignments'),
  });
  const pianoLearningService = new PianoLearningService({
    exerciseBank,
    attemptStore: pianoAttemptStore,
    learningStore: pianoLearningStore,
    studioDatastore: pianoStudioDatastore,
    teacherGate: schoolTeacherGate,
    logger: rootLogger.child({ module: 'piano-learning' }),
  });
  // School's learner assignments, read by Piano's `GetPlayableUnits` for one
  // decision only: whether a co-progress lockout is standing in front of the
  // lesson School assigned today, which pacing must never block. Its own
  // instance for the same reason `flashcardAssignments` has one — the store is
  // a stateless reader of parent-editable YAML, and School's lifecycle is built
  // later in this file (it consumes the piano use case, so piano cannot wait
  // on it).
  const pianoSchoolAssignments = new YamlAssignmentStore({
    configService, logger: rootLogger.child({ module: 'piano-school-assignments' }),
  });
  const pianoContainer = new PianoContainer({
    // D1: the use case receives the Plex curriculum reader, never imports it.
    curriculumIndex: { getCurriculumIndex, mergeSeason },
    schoolAssignments: pianoSchoolAssignments,
    studioDatastore: pianoStudioDatastore,
    fitnessPlayableService,
    userVideoProgressStore: contentServices.userVideoProgressStore,
    composerSongStore,
    configProjection: new PianoConfigProjection({ configService }),
    plexClient: pianoPlexClient,
    learningService: pianoLearningService,
    logger: rootLogger.child({ module: 'piano-api' })
  });
  // Game-time budget (design 2026-08-27): layer-2 YAML store (a balance, not
  // a ledger — see the store's header) behind the pure orchestration service.
  // Both get a real child logger here so budget.opened/settled/depleted/
  // config-invalid events actually reach the log store — until wired they
  // silently defaulted to console.
  //
  // historyRoot goes through configService.getHouseholdPath, NOT a hardcoded
  // `path.join(dataDir, 'household/...')` — the comment above (household
  // domain-path resolution, ~line 744) exists specifically to keep storage
  // layout (household vs household-{hid}) out of the application layer.
  // Identical output today (single-household); wrong the moment a second
  // household exists.
  const pianoGameBudgetStore = new YamlPianoGameBudgetStore({
    historyRoot: configService.getHouseholdPath('history/piano-games', householdId),
    logger: rootLogger.child({ component: 'piano-game-budget' }),
  });
  const pianoGameBudgetService = new PianoGameBudgetService({
    store: pianoGameBudgetStore,
    config: () => configService.getHouseholdAppConfig(null, 'piano')?.gameLimit,
    // Same accessor School's own composition uses (schoolLifecycle.mjs) —
    // NOT getHouseholdAppConfig(null,'school')?.timezone. A wrong timezone
    // here silently moves the 4am study-day boundary (D6).
    timezone: configService.getTimezone?.() || null,
    logger: rootLogger.child({ component: 'piano-game-budget' }),
  });
  const pianoChallengeProfileService = new PianoChallengeProfileService({
    datastore: pianoStudioDatastore,
  });
  const schoolPianoChallengeCompletionService = new SchoolPianoChallengeCompletionService({
    datastore: pianoStudioDatastore,
    config: () => configService.getHouseholdAppConfig(null, 'piano')?.pianoChallenge ?? {},
    timezone: configService.getTimezone?.() || null,
  });
  v1Routers.piano = createPianoRouter({
    pianoContainer,
    pianoAttemptStore,
    pianoLearningService,
    pianoGameBudgetService,
    pianoBoardGameDayService,
    pianoChallengeProfileService,
    schoolPianoChallengeCompletionService,
    eventBus,
    idFactory: shortId,
    producerRecords: await import('#apps/piano/producerRecords.mjs'),
    pianoChallengePolicy: exerciseBank.available()
      ? new BankChallengePolicy({ exerciseBank, attemptStore: pianoAttemptStore })
      : new PianoScaleChallengePolicy({ attemptStore: pianoAttemptStore }),
    exerciseBank,
    logger: rootLogger.child({ module: 'piano-api' })
  });

  // School (portal homeschool): banks from data/content/school/{subject}/quizzes/, per-user
  // append-only attempt log under data/users/{id}/apps/school/attempts/, plus
  // the materials framework (catalog + per-unit progress/quiz gates).
  const schoolDatastore = new YamlSchoolDatastore({ configService });
  const schoolFullConfig = configService.getHouseholdAppConfig(null, 'school') || {};
  const schoolSessionResultArtifacts = new YamlSessionResultArtifactStore({ configService });
  const schoolLearnerDirectory = new ConfiguredSchoolLearningDirectory({
    userService,
    config: schoolFullConfig,
    householdId,
    logger: rootLogger.child({ module: 'school-learners' }),
  });
  // Periods: config→data promotion (teacher-console W3-1). The stored source
  // serves the boot-validated config until the first teacher edit writes
  // school/plans/periods.yml; every downstream consumer (report cards, the
  // /periods route, agendas) inherits the same instance.
  const { YamlAcademicPeriodStore } = await import('#adapters/persistence/yaml/YamlAcademicPeriodStore.mjs');
  const schoolAcademicPeriods = new YamlAcademicPeriodStore({
    configService,
    fallback: new ConfiguredAcademicPeriodSource({ config: schoolFullConfig }),
    logger: rootLogger.child({ module: 'school-periods' }),
  });
  // The console write predicate for SchoolService's own teacher writes
  // (quiz-request dismissal). Built through the same factory the lifecycle
  // composition uses — one copy of the accessor text, no drift.
  // Wave-3 planning domains: stores + gated writes (teacher-console W3-1..4).
  const { SetAcademicPeriods } = await import('#apps/school/usecases/SetAcademicPeriods.mjs');
  const { SetPassOverride } = await import('#apps/school/usecases/SetPassOverride.mjs');
  const { YamlMilestoneStore } = await import('#adapters/persistence/yaml/YamlMilestoneStore.mjs');
  const { SetMilestones } = await import('#apps/school/usecases/SetMilestones.mjs');
  const { GetMilestoneStatuses } = await import('#apps/school/usecases/GetMilestoneStatuses.mjs');
  const { YamlEnrichmentLog } = await import('#adapters/persistence/yaml/YamlEnrichmentLog.mjs');
  const { RecordEnrichment } = await import('#apps/school/usecases/RecordEnrichment.mjs');
  const schoolMilestoneStore = new YamlMilestoneStore({ configService, logger: rootLogger.child({ module: 'school-milestones' }) });
  const schoolEnrichmentLog = new YamlEnrichmentLog({ configService, logger: rootLogger.child({ module: 'school-enrichment' }) });
  // Mid-quiz resumability (Task 17): per-user users/{id}/apps/school/sittings.yml.
  const { YamlSittingStore } = await import('#adapters/persistence/yaml/YamlSittingStore.mjs');
  const schoolSittingStore = new YamlSittingStore({ configService, logger: rootLogger.child({ module: 'school-sittings' }) });
  const schoolService = new SchoolService({
    datastore: schoolDatastore,
    userService,
    sittings: schoolSittingStore,
    teacherGate: schoolTeacherGate,
    // Thunk: the notes store is constructed later in this function; dismissal
    // notes resolve it at call time.
    teacherNotesRef: () => schoolTeacherNotes,
    learnerDirectory: schoolLearnerDirectory,
    logger: rootLogger.child({ module: 'school' }),
    bankSources: [new GeneratedBankSource({
      dataDir: path.join(contentPath, 'school', 'generated-banks'),
      logger: rootLogger.child({ module: 'school-generated-banks' })
    })]
  });
  const schoolLearningEvidence = new YamlLearningEvidenceRepository({ configService });
  const schoolEvidenceSources = [
    new YamlSchoolAttemptEvidenceSource({ datastore: schoolDatastore }),
    schoolLearningEvidence,
  ];
  const schoolLearningLoop = createSchoolLearningLoop({
    configService,
    householdId,
    aiGateway: sharedAiGateway,
    logger: rootLogger.child({ module: 'school-remediation' }),
    evidenceRepository: schoolLearningEvidence,
    learnerDirectory: schoolLearnerDirectory,
  });
  // One configured-expectations instance shared by every consumer (Task 11):
  // constructed once, validated once, rather than re-parsing school.yml's
  // `progress.expectations` per use case.
  const schoolConfiguredExpectationSource = new ConfiguredLearningExpectationSource({ config: schoolFullConfig });
  // The curriculum accessor (`schoolLifecycle.stores.curriculum`) does not
  // exist yet at this point in composition — `schoolLifecycle` wires up
  // several hundred lines below, and `schoolCalc`'s composition (just below
  // this block) already depends on THIS EXACT `getLearningProgress` instance,
  // so construction can't simply be deferred until after the lifecycle block.
  // This thin forwarding source lets `getLearningProgress` be built now while
  // still picking up the real curriculum-derived outline the moment
  // `schoolLifecycle` finishes wiring: `schoolLifecycle` is a `let` reassigned
  // later in this same function, and a closure over it observes that
  // reassignment by the time an actual request runs `listExpectations`. An
  // unwired lifecycle (or no `stores.curriculum`) makes this emit nothing —
  // GetLearningProgress and curriculumHistory behave exactly as before Task 11.
  const schoolCurriculumExpectationSource = {
    async listExpectations(query) {
      const curriculum = schoolLifecycle.stores?.curriculum;
      return curriculum ? new CurriculumExpectationSource({ curriculum }).listExpectations(query) : [];
    },
  };
  const getLearningProgress = new GetLearningProgress({
    evidenceSources: schoolEvidenceSources,
    cohortDirectory: schoolLearnerDirectory,
    academicPeriods: schoolAcademicPeriods,
    followUpSources: [new AssessmentReviewFollowUpSource({
      thresholdPercent: schoolFullConfig.progress?.reviewThresholdPercent ?? 80,
    }), schoolLearningLoop.followUps],
    // Configured pacing dates win a same-target collision over the
    // curriculum-derived outline (Task 11 merge rule) — order matters here.
    expectationSources: [schoolConfiguredExpectationSource, schoolCurriculumExpectationSource],
    logger: rootLogger.child({ module: 'school-progress' }),
  });
  const getInstructionalInsights = new GetInstructionalInsights({
    evidenceSources: schoolEvidenceSources,
    cohortDirectory: schoolLearnerDirectory,
    expectationSource: schoolConfiguredExpectationSource,
    policy: {
      accuracyThresholdPercent: schoolFullConfig.progress?.instructionalInsights?.accuracyThresholdPercent ?? 70,
      minimumResponses: schoolFullConfig.progress?.instructionalInsights?.minimumResponses ?? 2,
    },
    logger: rootLogger.child({ module: 'school-instructional-insights' }),
  });
  const recordLearningReflection = new RecordLearningReflection({
    evidenceRepository: schoolLearningEvidence,
    learnerDirectory: schoolLearnerDirectory,
    evidenceIdFactory: createLearningReflectionEvidenceId,
  });
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
  const schoolCatalog = createSchoolCatalog({
    configService,
    householdId,
    learnerDirectory: schoolLearnerDirectory,
    exerciseLibrary,
    logger: rootLogger.child({ module: 'school-catalog' }),
  });
  const { YamlFlashcardProgressStore } = await import('#adapters/persistence/yaml/YamlFlashcardProgressStore.mjs');
  const { SchoolFlashcardAssetRepository } = await import('#adapters/school/catalog/SchoolFlashcardAssetRepository.mjs');
  const { TsFsrsFlashcardScheduler } = await import('#adapters/school/flashcards/TsFsrsFlashcardScheduler.mjs');
  const { FlashcardStudyService } = await import('#apps/school/FlashcardStudyService.mjs');
  const { FlashcardSchedulerPolicyResolver } = await import('#apps/school/FlashcardSchedulerPolicyResolver.mjs');
  const { ConfigFlashcardSchedulerPolicySource } = await import('#adapters/school/flashcards/ConfigFlashcardSchedulerPolicySource.mjs');
  const flashcardAssignments = new YamlAssignmentStore({ configService, logger: rootLogger.child({ module: 'school-flashcard-assignments' }) });
  const flashcardStudy = schoolCatalog.content
    ? new FlashcardStudyService({
      progressStore: new YamlFlashcardProgressStore({ configService, logger: rootLogger.child({ module: 'school-flashcards' }) }),
      decks: schoolCatalog.content,
      assignments: flashcardAssignments,
      grader: schoolService,
      scheduler: new TsFsrsFlashcardScheduler(),
      policyResolver: new FlashcardSchedulerPolicyResolver({
        policySource: new ConfigFlashcardSchedulerPolicySource({ configService }),
        assignments: flashcardAssignments,
        catalog: schoolCatalog.query,
      }),
      teacherGate: schoolTeacherGate,
      timezone: configService.getTimezone?.() || null,
      now: Date.now,
      id: shortId,
    })
    : null;
  const flashcardAssets = new SchoolFlashcardAssetRepository({
    rootDir: schoolFullConfig.flashcards?.assets?.dir ?? path.join(dataDir, 'content', 'assets'),
  });
  const openCatalogLearningSession = schoolCatalog.query
    ? new OpenCatalogLearningSession({ catalog: schoolCatalog.query, grader: schoolService })
    : null;
  const offerCatalogQuizRemediation = schoolCatalog.query
    ? new OfferCatalogQuizRemediation({
      catalog: schoolCatalog.query,
      grader: schoolService,
      remediationOffers: schoolLearningLoop.offers,
    })
    : null;
  // Six-digit codes have to remain valid after ordinary roster edits.  Their
  // explicitly configured slots are therefore a School-wide publication
  // policy, never a device-discovered or array-order-derived implementation
  // detail.
  const continuationSlots = schoolFullConfig.schoolcalc?.continuation?.learner_slots;
  let issueContinuationCode = null;
  try {
    issueContinuationCode = new IssueSchoolContinuationCode({
      learners: schoolLearnerDirectory, learnerSlots: continuationSlots,
    });
  } catch (error) {
    rootLogger.child({ module: 'school-continuation' }).warn?.('school.continuation.unwired', { error: error.message });
  }

  // Surface certification (spec §4.2/§7.1/§9): the registry of static
  // surface profiles + per-family certification ports, and a per-request
  // certification facade for `/api/v1/school/certification` and
  // `/api/v1/school/surfaces/profile`. Inert (both null) whenever the shared
  // School Catalog itself is not wired — certification has nothing to
  // certify without it.
  const schoolSurfaces = await createSchoolSurfaces({
    schoolCatalog,
    // Profiles live under `household/school/surfaces` — render policy, not
    // curriculum, so deliberately NOT under the catalog's contentRoot.
    dataDir: configService.getDataDir(),
    logger: rootLogger.child({ module: 'school-surfaces' }),
  });
  // Screen-config lookup for surface-profile resolution, reusing the same
  // `data/household/screens/<id>.yml` mount `screens.mjs` serves —
  // `loadYamlFromPath` returns null on a missing/unparsable file rather than
  // throwing, which is exactly the "no config" case the resolver treats as a
  // 404 (fail closed, never a synthesized default).
  const getSchoolScreenConfig = new YamlSchoolScreenConfigSource({ householdDirectory: householdDir }).get;
  // Optional calculator-native School product. The composition module is the
  // only place that joins calculator-family adapters, SchoolCalc application
  // use cases, persistence, relay credentials, and the thin HTTP router.
  const schoolCalcLogger = rootLogger.child({ module: 'schoolcalc' });
  let schoolCalc = {
    wired: false, reason: 'not attempted', container: null, router: null, resultImporter: null,
  };
  try {
    schoolCalc = createSchoolCalc({
      configService,
      schoolService,
      learnerDirectory: schoolLearnerDirectory,
      learningProgress: getLearningProgress,
      remediationOffers: schoolLearningLoop.offers,
      remediationTutor: schoolLearningLoop.tutor,
      probeEvidenceRepository: schoolLearningEvidence,
      schoolCatalog,
      householdId,
      logger: schoolCalcLogger,
    });
  } catch (err) {
    // SchoolCalc is explicitly opt-in. A bad calculator content mount or relay
    // credential disables that surface without taking down the rest of School.
    schoolCalcLogger.error('schoolcalc.wiring-failed', { error: err.message });
  }
  // Dumb playhead/percent/duration store only (spec §6) — School never reads
  // its threshold/engaged/completedAt fields, unlike Piano's own instance.
  const schoolMaterialProgressStore = new SchoolUserVideoProgressStore({
    configService,
    app: 'school',
    filename: 'material-progress',
    logger: rootLogger.child({ module: 'school-materials' })
  });

  const schoolMaterialsConfig = configService.getHouseholdAppConfig(null, 'school')?.materials || null;
  let getMaterialCatalog = null;
  let getMaterialUnits = null;
  let getMaterialProgressSummary = null;
  if (schoolMaterialsConfig) {
    // School sees one neutral media catalog. Provider metadata translation is
    // isolated here in the adapter and can later be swapped for Jellyfin.
    const schoolMediaCatalog = new PlexSchoolMediaCatalog({
      plexAdapter: contentRegistry?.get('plex') || null
    });
    const mediaAlbumSource = new MediaAlbumSource({ mediaCatalog: schoolMediaCatalog, logger: rootLogger.child({ module: 'school-materials' }) });
    const mediaSeriesSource = new MediaSeriesSource({ mediaCatalog: schoolMediaCatalog });
    const schoolMaterialSources = {
      'media-album': mediaAlbumSource,
      'media-series': mediaSeriesSource,
      'media-label': new MediaLabelSource({
        mediaCatalog: schoolMediaCatalog,
        videoSource: mediaSeriesSource,
        audioSource: mediaAlbumSource
      })
    };
    getMaterialCatalog = new GetMaterialCatalog({
      sources: schoolMaterialSources,
      config: schoolMaterialsConfig,
      logger: rootLogger.child({ module: 'school-materials' })
    });
    // Pre-warm the catalog in the background at boot so the first subject-open
    // after a (cache-clearing) redeploy hits a warm cache instead of paying the
    // full Plex fan-out. Fire-and-forget — never blocks startup, and a failure
    // just means the first real request rebuilds it.
    getMaterialCatalog.execute()
      .then((c) => rootLogger.child({ module: 'school-materials' }).info?.('school.materials.prewarmed', { count: c?.materials?.length ?? 0 }))
      .catch((err) => rootLogger.child({ module: 'school-materials' }).warn?.('school.materials.prewarm-failed', { error: err.message }));
    // Pre-warm the bank summaries too (the 4600-file scan), ASYNC so it never
    // blocks boot/the event loop, and keep them warm on a background interval so
    // a home load / gating lookup always hits the cache instead of a cold scan.
    const warmSchoolBanks = () => schoolService.warmBanks({ force: true })
      .then((list) => rootLogger.child({ module: 'school-materials' }).info?.('school.banks.prewarmed', { count: list.length }))
      .catch((err) => rootLogger.child({ module: 'school-materials' }).warn?.('school.banks.prewarm-failed', { error: err.message }));
    warmSchoolBanks();
    setInterval(warmSchoolBanks, 4 * 60 * 1000).unref(); // force a refresh before the 5-min TTL lapses, so requests always hit a warm cache
    // Rebuilt from schoolService.listBanks() (cheap YAML-directory read, no
    // cache of its own) on every lookup rather than once at boot, so a newly
    // authored gating bank takes effect without a restart — matching
    // listBanks()'s own no-cache behaviour.
    // `opts.trackParents` (Map<trackId, unitId>, from the material fetch)
    // rolls chapter-level bank backlinks up to the unit they gate (Blocker 2).
    const schoolMaterialBankIndex = { byUnit: (unitId, opts) => buildBankIndex(schoolService.listBanks(), opts).byUnit(unitId) };
    // Disk snapshot of the compiled material index: seeds the units cache at
    // boot so a redeploy serves in ~0.5s from day-old data (refreshed in the
    // background) instead of re-paying the serialized Plex sweep cold.
    const { YamlMaterialSnapshotStore } = await import('#adapters/persistence/yaml/YamlMaterialSnapshotStore.mjs');
    getMaterialUnits = new GetMaterialUnits({
      catalog: getMaterialCatalog,
      sources: schoolMaterialSources,
      config: schoolMaterialsConfig,
      progressStore: schoolMaterialProgressStore,
      bankIndex: schoolMaterialBankIndex,
      attemptsReader: { read: (userId) => schoolDatastore.readAllAttempts(userId) },
      logger: rootLogger.child({ module: 'school-materials' }),
      snapshot: new YamlMaterialSnapshotStore({ configService, logger: rootLogger.child({ module: 'school-materials' }) })
    });
    getMaterialProgressSummary = new GetMaterialProgressSummary({
      catalog: getMaterialCatalog,
      getMaterialUnits,
      progressStore: schoolMaterialProgressStore,
      logger: rootLogger.child({ module: 'school-materials' })
    });
  }

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
  const readGateConfig = () => configService.getHouseholdAppConfig(null, 'school')?.gate || null;
  const languageAssignments = new YamlAssignmentStore({ configService, logger: rootLogger });
  let schoolStudyGrants = null;
  let schoolReelGrants = null;
  let schoolCubeGrants = null;
  try {
    schoolStudyGrants = new HmacSchoolStudyGrantIssuer({ key: jwtSecret });
  } catch (error) {
    rootLogger.error('school.sentence-ladder.study-grants-unavailable', { error: error.message });
  }
  try { schoolReelGrants = new HmacSchoolReelGrantIssuer({ key: jwtSecret }); } catch (error) {
    rootLogger.error('school.language-reels.grants-unavailable', { error: error.message });
  }
  try { schoolCubeGrants = new HmacSchoolCubeGrantIssuer({ key: jwtSecret }); } catch (error) {
    rootLogger.error('school.rubiks-cube.grants-unavailable', { error: error.message });
  }
  const schoolDocumentFileStore = new YamlDocumentFileStore();
  const languageReelService = new LanguageReelService({
    repository: new FilesystemLanguageReelRepository({
      configService,
      store: schoolDocumentFileStore,
    }),
    idFactory: crypto.randomUUID,
  });
  const rubiksRecoverySolver = new KociembaCubeRecoverySolver();
  const rubiksCubeService = new RubiksCubeCourseService({
    repository: new FilesystemRubiksCubeProgressRepository({
      configService,
      store: schoolDocumentFileStore,
      courseId: RUBIKS_CUBE_COURSE_ID,
    }),
    recoverySolver: rubiksRecoverySolver,
    packetPlanner: new RubiksPacketPlanner({
      solver: rubiksRecoverySolver,
      idFactory: crypto.randomUUID,
    }),
    idFactory: crypto.randomUUID,
  });
  const languageStudyService = new SentenceLadderService({
    datastore: new YamlLanguageStudyDatastore({ configService }),
    readProgramEnrollment: (learnerId, corpusId) => languageAssignments.readProgramEnrollment(learnerId, corpusId),
    eventBus,
    timezone: configService.getTimezone?.() || null,
    readGate: () => {
      const cfg = readGateConfig();
      if (cfg?.force === 'open') return { level: 'open', reason: 'forced-open', missing: [], stale: false };
      if (cfg?.force === 'closed') return { level: 'disabled', reason: 'forced-closed', missing: [], stale: false };
      return resolveGate({
        presence: presenceStore.get(cfg?.device_id || 'portal'),
        now: Date.now(),
        required: cfg?.devices || [],
        // `??` not `||`: an explicit ttl_ms of 0 must mean 0, not the default.
        ttlMs: cfg?.ttl_ms ?? undefined,
      });
    },
    logger: rootLogger.child({ module: 'school-language' })
  });
  // School lifecycle (+ its report/print-service/router mounting) moved
  // further down this function (Task 13) — it now depends on the real,
  // household-level DoNow service, which itself depends on seams
  // (`wakeAndLoadService`, home-automation adapters, the playback-hub
  // container) that don't exist yet at this point in boot. See "School
  // physical console" below, right after `donow` is constructed.

  // Strava webhook enrichment (provider-agnostic webhook, Strava adapter)
  let providerWebhookAdapters = {};
  let stravaEnrichmentService = null;
  let stravaReconciliationService = null;
  try {
    const stravaClientId = configService.getSystemAuth?.('strava', 'client_id');
    if (!stravaClientId) {
      rootLogger.info?.('strava.enrichment.skipped', { reason: 'no strava client_id in system auth' });
    } else {
      const { StravaClientAdapter } = await import('./1_adapters/fitness/StravaClientAdapter.mjs');
      const { StravaWebhookAdapter } = await import('./1_adapters/strava/StravaWebhookAdapter.mjs');
      const { StravaWebhookJobStore } = await import('./1_adapters/strava/StravaWebhookJobStore.mjs');
      const { FitnessActivityEnrichmentService } = await import('./3_applications/fitness/FitnessActivityEnrichmentService.mjs');
      const { ActivityReconciliationService } = await import('./3_applications/fitness/ActivityReconciliationService.mjs');
      const { buildSelectionConfig } = await import('#domains/fitness/services/selectPrimaryMedia.mjs');

      const stravaClient = new StravaClientAdapter({
        httpClient: axios,
        configService,
        logger: rootLogger.child({ module: 'strava-client' }),
      });

      // Resolve fitness config at the composition root and inject pre-resolved
      // values into the use cases (they stay provider-/config-agnostic).
      const stravaPlexConfig = configService.getAppConfig('fitness')?.plex || {};
      const stravaSelectionConfig = buildSelectionConfig(stravaPlexConfig);
      const stravaLookbackDays = stravaPlexConfig.reconciliation_lookback_days ?? 10;
      const stravaTimezone = configService.getTimezone?.() || 'America/Los_Angeles';

      const stravaVerifyToken = configService.getSystemAuth?.('strava', 'verify_token') || '';
      const stravaWebhookAdapter = new StravaWebhookAdapter({
        verifyToken: stravaVerifyToken,
        logger: rootLogger.child({ module: 'strava-webhook' }),
      });

      const jobStore = new StravaWebhookJobStore({
        basePath: path.join(configService.getMediaDir(), 'archives', 'strava-webhooks'),
        logger: rootLogger.child({ module: 'strava-jobs' }),
      });

      stravaReconciliationService = new ActivityReconciliationService({
        activityGateway: stravaClient,
        lookbackDays: stravaLookbackDays,
        selectionConfig: stravaSelectionConfig,
        timezone: stravaTimezone,
        historyRepository: new YamlFitnessHistoryRepository({
          root: configService.getHouseholdPath('fitness/log'),
        }),
        pause: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
        logger: rootLogger.child({ module: 'strava-reconciliation' }),
      });

      stravaEnrichmentService = new FitnessActivityEnrichmentService({
        activityGateway: stravaClient,
        jobStore,
        authStore: {
          loadUserAuth: (provider, username) => configService.getUserAuth?.(provider, username),
        },
        configService,
        selectionConfig: stravaSelectionConfig,
        resolveDisplayName: (slug) => userService.resolveDisplayName(slug),
        fitnessHistoryDir: configService.getHouseholdPath('fitness/log'),
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

  // Emergency lockdown: backend-driven detection keeps an `emergency` fingerprint
  // scan armed; an admin match shuts down the garage (HA script) after the
  // browser ceremony. State persists server-side so it survives reboot.
  const emergencyLogger = rootLogger.child({ module: 'fitness-emergency' });
  const emergencyHaGateway = householdAdapters?.has?.('home_automation') ? householdAdapters.get('home_automation') : null;
  const emergencyLockRepo = new YamlEmergencyLockDatastore({ configService });
  const emergencyPublications = new FitnessEmergencyPublications({ eventBus });
  const emergencyConfig = loadFitnessConfig(householdId)?.emergency || {};
  const triggerEmergencyLockdown = emergencyHaGateway ? new TriggerEmergencyLockdown({
    repo: emergencyLockRepo,
    haGateway: emergencyHaGateway,
    publications: emergencyPublications,
    pause: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    scriptId: emergencyConfig.ha_script || 'garage_deactivate',
    defaultDurationSec: Number(emergencyConfig.duration_sec) || 1800,
    logger: emergencyLogger
  }) : null;
  const releaseEmergencyLockdown = new ReleaseEmergencyLockdown({
    repo: emergencyLockRepo,
    publications: emergencyPublications,
    logger: emergencyLogger,
  });
  const getLockdownState = new GetLockdownState({ repo: emergencyLockRepo });
  // Passive identity relay: enriches the garage's dumb `biometric.scan` events into
  // `fitness.identity.detected` and stamps a short-lived pending-detection that the
  // /emergency/{commit,abort,release} endpoints consume. No reader loop, no contention.
  const identityRelay = createIdentityRelay({
    identityChannel: new FitnessIdentityChannel({ eventBus }),
    userService,
    loadFitnessConfig: () => loadFitnessConfig(householdId) || {},
    getLockdownState,
    triggerEmergencyLockdown,
    commitScheduler: {
      schedule: (delayMs, task) => setTimeout(task, delayMs),
      cancel: (handle) => clearTimeout(handle),
    },
    serverCommitDelayMs: Number(emergencyConfig?.abuse?.server_commit_delay_ms) > 0
      ? Number(emergencyConfig.abuse.server_commit_delay_ms)
      : undefined,
    logger: emergencyLogger,
  });

  // Workout persistence: household-scoped files under apps/fitness/workouts/, plus the
  // SaveWorkout use case that guards them. SaveWorkout is the only place holding BOTH an
  // authored plan and the corpus index, so it is the only place that can refuse a workout
  // referencing an exercise that does not exist — which otherwise fails at Run time, in
  // front of someone mid-session. The library reads the manifest `exercise-library build`
  // writes offline; a missing manifest degrades to an empty corpus, so saves fail loudly
  // instead of persisting plans nothing can run.
  // NOTE: `exerciseLibrary` itself is constructed far earlier (just above
  // createSchoolCatalog), because School's anatomy shelf projects the same corpus
  // and must share this one instance — it parses a ~2.8 MB manifest and holds the
  // whole corpus in memory.
  const workoutRepository = new YamlWorkoutRepository({
    configService,
    logger: rootLogger.child({ module: 'fitness-workouts' })
  });
  const saveWorkout = new SaveWorkout({
    workoutRepository,
    exerciseLibrary,
    logger: rootLogger.child({ module: 'fitness-workouts' })
  });

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
    fingerprintProfileWriter,
    triggerEmergencyLockdown,
    releaseEmergencyLockdown,
    getLockdownState,
    identityRelay,
    eventBus,
    workoutRepository,
    saveWorkout,
    exerciseLibrary,
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

  // Ambient brightness: HA illuminance sensors → per-zone eventbus topics → ArtMode dim.
  // ambient.yml lives under the household config dir → read via the household apps map.
  // Each zone (room) broadcasts its lux on its own topic; the screen config picks the
  // topic + curve for that room. See ambientZones.mjs.
  const ambientConfig = configService.getHouseholdAppConfig(null, 'ambient') || {};
  const ambientZones = projectAmbientZones(ambientConfig);
  startAmbientZones({
    zones: ambientZones,
    haGateway: homeAutomationAdapters.haGateway,
    eventBus,
    logger: rootLogger.child({ module: 'ambient-light' }),
  });

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

  const { EventAggregationService } = await import('./3_applications/home/EventAggregationService.mjs');
  const { DataServiceEventFeedRepository } = await import('./1_adapters/home/DataServiceEventFeedRepository.mjs');
  const eventAggregationService = new EventAggregationService({
    eventRepository: new DataServiceEventFeedRepository({
      dataService,
      defaultUser: () => configService.getHeadOfHousehold?.(),
    }),
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

  // Piano-power → tablet-screen authority. DS becomes the single writer for the
  // OFF side of the yellow-room tablet's FKB screen: piano OFF ⇒ screen OFF
  // (debounced + reconciled), piano OFF→ON edge ⇒ pulse screen ON. Disabled by
  // default (config `piano.screen_power_sync.enabled`); no-ops without HA/device.
  // Not a two-writer conflict with screen-presence: that device is not
  // presence-managed, and presence actuates HA input_booleans, not the backlight.
  createPianoScreenPowerSync({
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
    deviceService: deviceServices.deviceService,
    configService,
    householdId,
    logger: rootLogger.child({ module: 'piano-midi-wake' }),
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
    logger: rootLogger.child({ module: 'wake-and-load' })
  });

  callLeaseService = new CallLeaseService({
    deviceService: deviceServices.deviceService,
    wakeAndLoadService,
    logger: rootLogger.child({ module: 'homeline-lease' }),
    clock: { now: () => Date.now() },
    scheduler: new NodeApplicationScheduler(),
    identityIssuer: new SecureHomelineIdentityIssuer(),
  });
  setCallLeaseAuthority(callLeaseService);

  // ==========================================================================
  // DoNow — the household "start this, there, now" dispatch facade
  // (docs/superpowers/specs/2026-07-30-household-donow-dispatch-design.md).
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
    const { createDonow } = await import('#composition/modules/donow.mjs');
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

  let schoolLifecycle = {
    wired: false, reason: 'not attempted', handlesCode: () => false, handleScan: null,
    reporter: null, router: null, devicesRouter: null, donowSchoolBridge: null,
  };
  // Same adapter class, same guard, own `school.yml` block — see the grading
  // hook's wiring below for why a home-automation failure must never take the
  // rest of School down with it.
  let pianoLessonHook = null;
  if (homeAutomationAdapters.haGateway) {
    try {
      const { SchoolGradingHookAdapter } = await import('#adapters/school/SchoolGradingHookAdapter.mjs');
      pianoLessonHook = new SchoolGradingHookAdapter({
        gateway: homeAutomationAdapters.haGateway,
        configKey: 'piano_lesson_hook',
        loadSchoolConfig: () => configService.getHouseholdAppConfig(null, 'school') || {},
        resolveStudent: (learnerId) => configService.getUserProfile?.(learnerId)?.name ?? learnerId,
        logger: rootLogger.child({ module: 'school-piano-lesson-hook' }),
      });
    } catch (err) {
      pianoLessonHook = null;
      schoolLifecycleLogger.warn('school.piano_lesson_hook.wiring-failed', { error: err.message });
    }
  }
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

  try {
    const { createSchoolLifecycle } = await import('#composition/modules/schoolLifecycle.mjs');
    schoolLifecycle = await createSchoolLifecycle({
      // Deliberately a THUNK: the trigger API that owns the parsed sources is
      // composed further down this file, so there is no value to read yet. It
      // resolves per projection, which also means a reloaded trigger config is
      // picked up without restarting School.
      declaredEntryActions: () => declaredEntryActions(nfcLocationsForReachability()),
      configService,
      householdId,
      schoolService,
      economyService: economyApi.economyService,
      userService,
      eventBus,
      thermalPrinterRegistry: printerRegistry,
      // §8's real playback target: School builds a `ScreenPlaybackAdapter`
      // around this rather than waking a TV itself.
      //
      // NOT `wakeAndLoadService`. That service ends in a content load, and on
      // the living-room Shield a content load is an unconditional FKB
      // `loadURL` — a page load, which drops the very WebSocket the lesson is
      // about to be announced on. `wakeScreenForBroadcast` is the reading
      // path's seam and is shared with it verbatim, one room, one way to wake
      // a screen that a mounted widget is about to be told something on.
      wakeScreen: wakeScreenForBroadcast,
      startReadingSession: (args) => startReadingSession?.(args) ?? { status: 'reading_session_failed', message: 'Story time is still starting up.' },
      languageStudyService,
      studyGrants: schoolStudyGrants,
      languageReelService,
      languageReelGrants: schoolReelGrants,
      // Piano's own use case, so School's piano-course program reads exactly
      // what the kiosk reads (progress, sequential gating, co-progress lock)
      // instead of a second implementation that could disagree with it.
      pianoPlayableUnits: pianoContainer?.getPlayableUnits?.() ?? null,
      schoolPianoChallengeCompletionService,
      fitnessPlayableService: v1Routers.fitness?.fitnessPlayableService ?? null,
      fitnessSchoolCourseService: v1Routers.fitness?.fitnessSchoolCourseService ?? null,
      learningEvidenceRepository: schoolLearningEvidence,
      // Same adapter class the grading hook uses, pointed at its own
      // `school.yml` block. Guarded on the HA gateway exactly as the grading
      // hook is: no Home Assistant means the Portal banner still fires and
      // only the chime is absent.
      pianoLessonHook,
      flashcardStudyService: flashcardStudy,
      rubiksCubeService,
      rubiksCubeGrants: schoolCubeGrants,
      donow: donowModule?.service ?? null,
      donowSurfaces: donowModule?.surfaces ?? null,
      donowDatastore: donowModule?.datastore ?? null,
      tokenRegistry: schoolCalc.tokenRegistry ?? null,
      schoolCalcActionResolver: schoolCalc.actionResolver ?? null,
      schoolCalcStudies: schoolCalc.wired ? schoolCalc.studySessions : null,
      logger: schoolLifecycleLogger
    });
  } catch (err) {
    // A console that cannot be built must not stop the house from booting: the
    // rest of School (banks, materials, language) is untouched by its absence.
    schoolLifecycleLogger.error('school.lifecycle.wiring-failed', { error: err.message });
  }
  const teacherCapabilitySessions = new TeacherCapabilitySessions({
    teacherGate: schoolTeacherGate,
    tokenFactory: () => crypto.randomBytes(32).toString('base64url'),
  });
  schoolTeacherGate.bindCapabilitySessions(teacherCapabilitySessions);
  if (typeof schoolLifecycle.teacherGate?.bindCapabilitySessions === 'function'
      && schoolLifecycle.teacherGate !== schoolTeacherGate) {
    schoolLifecycle.teacherGate.bindCapabilitySessions(teacherCapabilitySessions);
  }

  // Print-document scan-back (Task 7, spec §9): ResolveCardScan joins the
  // SAME decoded-scan stream createQuizScanRecorder (wired much earlier,
  // above) already persists — see schoolPrintScanConsumer.mjs's own header.
  // Reuses schoolLifecycle's OWN allocationStore/printDocuments repository
  // instances (not fresh ones) so a live scan resolves against exactly what
  // IssueDocument's tracked-quiz path just wrote — two YamlAllocationStore
  // instances pointed at the same directory would each serialize their OWN
  // writes but not against each other, a real read-modify-write race this
  // avoids by construction. Wired only once the lifecycle itself is (no
  // lifecycle, no allocationStore/repository to resolve against either).
  if (schoolLifecycle.wired && schoolLifecycle.stores?.allocationStore && schoolLifecycle.stores?.printDocuments) {
    try {
      const { createSchoolPrintScanConsumer } = await import('#composition/modules/schoolPrintScanConsumer.mjs');
      const { ResolveCardScan } = await import('#apps/school/documents/ResolveCardScan.mjs');
      const { createYamlBankReader } = await import('#adapters/school/documents/YamlBankReader.mjs');
      const resolveCardScan = new ResolveCardScan({
        allocationStore: schoolLifecycle.stores.allocationStore,
        repository: schoolLifecycle.stores.printDocuments,
        // Bank-select tracked quizzes need this to re-derive the row->item
        // mapping at scan time (F2 review fix, High: absent it, every scan
        // against a bank-select document dies as BANK_SELECT_BANK_NOT_FOUND,
        // swallowed into `prepareV2Document`'s own null-bank throw and caught
        // as one opaque warn below). Rooted at the SAME `dataDir` the
        // lifecycle's own `RenderPrintDocument` built its bank reader from
        // (`schoolLifecycle.mjs`'s `createYamlBankReader({ dataDir })`) — a
        // fresh reader instance, not the lifecycle's own private one (that
        // reader is a `RenderPrintDocument` constructor-private field, not
        // exposed), but functionally identical: same directory, same
        // deterministic id->bank map, so a scan re-derives EXACTLY what the
        // render produced.
        banks: createYamlBankReader({ dataDir }),
      });
      // B1 (review wave): graded scans become durable evidence — per-learner
      // attempt records through the SAME datastore the on-screen quiz engine
      // writes, plus the session bridge (submitted → graded) for cards whose
      // allocation record carries its issuing session.
      const { RecordCardScanOutcome } = await import('#apps/school/documents/RecordCardScanOutcome.mjs');
      const recordCardScanOutcome = new RecordCardScanOutcome({
        datastore: schoolDatastore,
        sessions: schoolLifecycle.stores.sessions ?? null,
        reviewQueue: schoolLifecycle.stores.reviewQueue ?? null,
        resultArtifacts: schoolSessionResultArtifacts,
        renderMachineResult: renderSessionResultPng,
        logger: rootLogger.child({ module: 'school-print-scan-record' }),
      });
      // Grading hook (Task 4, spec §grading-hook): fires one HA script per
      // terminal scan outcome. Guarded on `homeAutomationAdapters.haGateway`
      // the SAME way `homeApi.mjs`'s `callHomeAssistantService` is — a
      // household with no Home Assistant configured gets `gradingHook: null`
      // and boots exactly as it did before this task existed.
      //
      // Own try/catch, deliberately separate from the outer one wrapping this
      // whole block (final review Fix 2): the outer catch's job is "the print
      // scan-back consumer failed to wire, skip it" — but this construction
      // used to run BEFORE `createSchoolPrintScanConsumer` inside that SAME
      // outer try, so a broken import or constructor here (home automation's
      // problem) would trip the outer catch and take the entire scan-back
      // consumer down with it: no scan resolves, nothing is recorded, for the
      // whole process lifetime. Home automation must never be able to do
      // that, so a failure here degrades to `gradingHook: null` and the
      // consumer below is still created.
      let gradingHook = null;
      if (homeAutomationAdapters.haGateway) {
        try {
          const { SchoolGradingHookAdapter } = await import('#adapters/school/SchoolGradingHookAdapter.mjs');
          gradingHook = new SchoolGradingHookAdapter({
            gateway: homeAutomationAdapters.haGateway,
            // Same accessor/call shape `getPrintTeacherPin` above uses for this
            // same `school.yml` — the household-id arg is accepted for the
            // adapter's contract but this module always resolves against `null`.
            loadSchoolConfig: () => configService.getHouseholdAppConfig(null, 'school') || {},
            resolveStudent: (learnerId) => configService.getUserProfile?.(learnerId)?.name ?? learnerId,
            logger: rootLogger.child({ module: 'school-grading-hook' }),
          });
        } catch (err) {
          gradingHook = null;
          schoolLifecycleLogger.warn('school.grading_hook.wiring-failed', { error: err.message });
        }
      }
      createSchoolPrintScanConsumer({
        eventBus,
        config: omrReadersConfig,
        resolveCardScan,
        recordCardScanOutcome,
        closeSessionOutcome: schoolLifecycle.useCases?.closeSessionOutcome ?? null,
        gradingHook,
        logger: rootLogger.child({ module: 'school-print-scan' }),
      });
    } catch (err) {
      schoolLifecycleLogger.error('school.print.scan-consumer-wiring-failed', { error: err.message });
    }
  }

  const getSchoolReport = new GetSchoolReport({
    // The lifecycle reporter is filtered out by GetSchoolReport itself when it
    // is null, so an unwired console simply does not appear on the board.
    reporters: [schoolService, languageStudyService, schoolLifecycle.reporter],
    userService,
    cohortDirectory: schoolLearnerDirectory,
    logger: rootLogger.child({ module: 'school-report' })
  });

  // Concept registry (Task 10, R8) — household concept labels for the report
  // card's `concepts` facet (`data/content/school/concepts.yml`). Its own
  // narrow try/catch, independent of the report-card gate below: a
  // missing file degrades to an empty registry inside the adapter itself
  // (never throws), but a PRESENT, malformed one does throw at construction
  // — and that must disable only concept LABELING, never the report card
  // (or the rest of School) entirely. `GetReportCard` already falls back to
  // the raw conceptId as its own label whenever `conceptRegistry` is null.
  let schoolConceptRegistry = null;
  try {
    schoolConceptRegistry = new YamlConceptRegistry({ dataDir });
  } catch (err) {
    schoolLifecycleLogger.error('school.concept-registry.wiring-failed', { error: err.message });
  }

  // Report cards, period close, teacher digest (Task 6, spec R5b). Needs the
  // lifecycle's shared curriculum/sessions/assignments stores AND the SAME
  // grown-up gate every other parent-only write already asserts through
  // (`schoolLifecycle.grownUps`) — tolerant of an unwired lifecycle exactly
  // like the print-scan consumer above: no sessions store, no report cards,
  // rather than a half-built feature reaching for a store that isn't there.
  let getReportCard = null;
  let closeAcademicPeriod = null;
  let getTeacherToday = null;
  if (schoolLifecycle.wired && schoolLifecycle.stores?.sessions && schoolLifecycle.stores?.assignments
      && schoolLifecycle.stores?.curriculum && schoolLifecycle.grownUps) {
    try {
      const { GetReportCard } = await import('#apps/school/usecases/GetReportCard.mjs');
      const { CloseAcademicPeriod } = await import('#apps/school/usecases/CloseAcademicPeriod.mjs');
      const { GetTeacherToday } = await import('#apps/school/usecases/GetTeacherToday.mjs');
      getReportCard = new GetReportCard({
        curriculum: schoolLifecycle.stores.curriculum,
        assignments: schoolLifecycle.stores.assignments,
        sessions: schoolLifecycle.stores.sessions,
        datastore: schoolDatastore,
        academicPeriods: schoolAcademicPeriods,
        getMaterialProgressSummary,
        getLearningProgress,
        reviewQueue: schoolLifecycle.stores.reviewQueue ?? null,
        conceptRegistry: schoolConceptRegistry,
        logger: rootLogger.child({ module: 'school-report-card' })
      });
      closeAcademicPeriod = new CloseAcademicPeriod({
        teacherGate: schoolLifecycle.teacherGate ?? null,
        getReportCard,
        datastore: schoolDatastore,
        grownUps: schoolLifecycle.grownUps,
        logger: rootLogger.child({ module: 'school-report-card' })
      });
      getTeacherToday = new GetTeacherToday({
        learnerDirectory: schoolLearnerDirectory,
        datastore: schoolDatastore,
        sessions: schoolLifecycle.stores.sessions,
        reviewQueue: schoolLifecycle.stores.reviewQueue ?? null,
        evidenceRepository: schoolLearningEvidence ?? null,
        curriculum: schoolLifecycle.stores.curriculum,
        timezone: configService.getTimezone?.() || null,
        logger: rootLogger.child({ module: 'school-teacher-today' })
      });
    } catch (err) {
      schoolLifecycleLogger.error('school.report-card.wiring-failed', { error: err.message });
    }
  }

  // Printable report card (Task 7, spec R5b adequacy MUST 2) — a bespoke
  // pdfkit renderer under `1_rendering/school/reportcard/`, sharing the
  // `documents/` theme's fonts but none of the block-pipeline machinery.
  // Unlike the three use cases just above, this has no lifecycle store
  // dependency at all — constructed unconditionally, so `format=pdf` works
  // on any wired report-card route regardless of the (independent) lifecycle
  // gate those routes' own use cases are behind.
  let renderReportCardPdf = null;
  try {
    const { createReportCardPdfRenderer } = await import('#rendering/school/reportcard/ReportCardRenderer.mjs');
    renderReportCardPdf = createReportCardPdfRenderer();
  } catch (err) {
    schoolLifecycleLogger.error('school.report-card.pdf-wiring-failed', { error: err.message });
  }

  // Printing (worksheets → kitchen laser printer). Wired only when the school
  // config declares a `printer` host — no printer, no print feature (the
  // router serves inert). The printer host defaults to the `kitchen-printer`
  // device entry so config need only opt in.
  let schoolPrintService = null;
  const printerHost = schoolFullConfig.printing?.host
    || configService.getDeviceConfig?.('kitchen-printer')?.host
    || null;
  if (printerHost && (schoolFullConfig.printables?.length || schoolFullConfig.printing)) {
    const laserPrinter = new LaserPrinterAdapter({
      host: printerHost,
      port: schoolFullConfig.printing?.port || 631,
      path: schoolFullConfig.printing?.path || '/ipp/print',
      // Double-sided by default; `school.yml` printing.duplex/.binding override.
      duplex: schoolFullConfig.printing?.duplex ?? true,
      binding: schoolFullConfig.printing?.binding || 'LONGEDGE',
      // Renders at most this many pages of a document. Distinct from
      // `maxPagesPerJob`, which REFUSES an oversized job — this one TRIMS, so a
      // supervised hardware test can ask for exactly one page and still get a
      // real print rather than a refusal. Unset in normal operation.
      renderPageLimit: schoolFullConfig.printing?.renderPageLimit ?? null,
      logger: rootLogger.child({ module: 'school-print' })
    });
    // Paper-certification gate (Task 15, spec §9/§11): a `bank` printable is
    // offered only if AT LEAST ONE paper surface profile can render it —
    // built straight from the surfaces registry's family:'paper' ports/
    // profiles rather than through GetSurfaceCertification, which certifies
    // whole lessons, not standalone banks. `schoolSurfaces.registry` is null
    // whenever the School Catalog itself is not wired; no paper profile
    // authored yields the same `null` — PrintService then falls back to its
    // legacy, ungated `listPrintables()` byte-for-byte.
    const paperProfiles = schoolSurfaces.registry
      ? schoolSurfaces.registry.list().filter((profile) => profile.family === 'paper')
      : [];
    const paperCertifyBank = paperProfiles.length
      ? (bank) => {
        const results = paperProfiles.map((profile) => schoolSurfaces.registry.portFor(profile).certifyBank(bank, profile));
        if (results.some((r) => r.verdict === 'render')) return { verdict: 'render', reasons: [] };
        return { verdict: 'incompatible', reasons: results.flatMap((r) => r.reasons || []) };
      }
      : null;
    schoolPrintService = new PrintService({
      config: schoolFullConfig,
      datastore: schoolDatastore,
      printerAdapter: laserPrinter,
      worksheetRenderer: { renderBankWorksheet },
      // getBank throws on miss; PrintService wants null-on-miss.
      bankReader: { getBank: (id) => { try { return schoolService.getBank(id); } catch { return null; } } },
      pdfReader: new FilesystemWorksheetPdfReader({ rootDir: path.join(configService.getDataDir(), 'household', 'content', 'worksheets') }),
      userService,
      paperCertifyBank,
      teacherGate: schoolLifecycle.teacherGate ?? null,
      logger: rootLogger.child({ module: 'school-print' })
    });
    rootLogger.child({ module: 'school-print' }).info?.('school.print.ready', { host: printerHost, printables: schoolFullConfig.printables?.length || 0, paperCertified: paperProfiles.length > 0 });
  }

  // Teacher console picker (teacher-console spec §4.7.1): config-declared
  // `teachers:` ids resolved against the LIVE roster per request — never a
  // boot-time snapshot, and only {id, name} ever leaves. Deliberately NOT
  // lifecycle-gated: the teachers read works on any install.
  const { GetTeachers } = await import('#apps/school/usecases/GetTeachers.mjs');
  const getTeachers = new GetTeachers({
    teachers: () => (configService.getHouseholdAppConfig(null, 'school') || {}).teachers,
    roster: () => userService.getHouseholdRoster(householdId) ?? [],
    logger: rootLogger.child({ module: 'school-teachers' }),
  });

  // Wave-5 repair stores + gated writes (spec D1/D2/D3).
  const { YamlAttestationLog } = await import('#adapters/persistence/yaml/YamlAttestationLog.mjs');
  const { YamlTeacherNotes } = await import('#adapters/persistence/yaml/YamlTeacherNotes.mjs');
  const { RecordAttestation } = await import('#apps/school/usecases/RecordAttestation.mjs');
  const { RecordTeacherNote } = await import('#apps/school/usecases/RecordTeacherNote.mjs');
  const { ReassignEvidence } = await import('#apps/school/usecases/ReassignEvidence.mjs');
  const { YamlReassignmentLog } = await import('#adapters/persistence/yaml/YamlReassignmentLog.mjs');
  const schoolAttestations = new YamlAttestationLog({ configService, logger: rootLogger.child({ module: 'school-attestations' }) });
  const schoolTeacherNotes = new YamlTeacherNotes({ configService, logger: rootLogger.child({ module: 'school-teacher-notes' }) });
  const recordAttestation = new RecordAttestation({ log: schoolAttestations, teacherGate: schoolTeacherGate, notes: schoolTeacherNotes });
  const recordTeacherNote = new RecordTeacherNote({ notes: schoolTeacherNotes, teacherGate: schoolTeacherGate, logger: rootLogger.child({ module: 'school-planning' }) });
  // Task 12 (debt M5): reassignments write their own audit trail — a
  // best-effort append that never blocks or unwinds the move itself.
  const schoolReassignmentLog = new YamlReassignmentLog({ configService, logger: rootLogger.child({ module: 'school-reassignments' }) });
  const reassignEvidence = new ReassignEvidence({
    datastore: schoolDatastore, teacherGate: schoolTeacherGate, notes: schoolTeacherNotes,
    auditLog: schoolReassignmentLog, logger: rootLogger.child({ module: 'school-reassignments' }),
  });
  // Its session-level twin (plan 4.1) — the repair for work with no machine
  // attempts to move. Shares the ONE audit-log instance above deliberately: a
  // second `YamlReassignmentLog` would race that instance's append chain.
  // Null when the lifecycle is unwired (no sessions repo, nothing to move),
  // which 404s the route rather than half-answering it.
  const { ReassignSession } = await import('#apps/school/usecases/ReassignSession.mjs');
  const schoolSessionsRepo = schoolLifecycle.stores?.sessions ?? null;
  const reassignSession = schoolSessionsRepo
    ? new ReassignSession({
      sessions: schoolSessionsRepo, teacherGate: schoolTeacherGate, notes: schoolTeacherNotes,
      auditLog: schoolReassignmentLog, logger: rootLogger.child({ module: 'school-reassignments' }),
    })
    : null;
  const { RetractTeacherRecord } = await import('#apps/school/usecases/RetractTeacherRecord.mjs');
  const retractTeacherRecord = new RetractTeacherRecord({
    stores: { enrichment: schoolEnrichmentLog, attestation: schoolAttestations, note: schoolTeacherNotes },
    teacherGate: schoolTeacherGate,
    notes: schoolTeacherNotes,
    logger: rootLogger.child({ module: 'school-planning' }),
  });
  const { GetTranscript } = await import('#apps/school/usecases/GetTranscript.mjs');
  const getTranscript = new GetTranscript({ reportCardsStore: schoolDatastore });
  const { createTranscriptPdfRenderer } = await import('#rendering/school/reports/TranscriptRenderer.mjs');
  const { createSyllabusPdfRenderer } = await import('#rendering/school/reports/SyllabusRenderer.mjs');
  // Wave-3 gated planning writes — constructed HERE because they borrow the
  // lifecycle's pass-override store and sessions repo (both null-safe when
  // the lifecycle is unwired).
  const setAcademicPeriods = new SetAcademicPeriods({
    store: schoolAcademicPeriods,
    teacherGate: schoolTeacherGate,
    logger: rootLogger.child({ module: 'school-planning' }),
    // Frozen-card guard (admin advocacy #15): the roster-wide set of periodIds
    // holding a FROZEN card — removing/renaming one of those ids is refused.
    frozenPeriodIds: async () => {
      const roster = userService.getHouseholdRoster?.() ?? [];
      const ids = [];
      for (const member of roster) {
        try {
          (schoolDatastore.listReportCards(member.id) ?? []).forEach((r) => { if (r?.periodId) ids.push(r.periodId); });
        } catch { /* one unreadable shard must not lock period edits */ }
      }
      return ids;
    },
  });
  const setPassOverride = schoolLifecycle.passOverrides
    ? new SetPassOverride({ store: schoolLifecycle.passOverrides, teacherGate: schoolTeacherGate, logger: rootLogger.child({ module: 'school-planning' }) })
    : null;
  const setMilestones = new SetMilestones({ store: schoolMilestoneStore, teacherGate: schoolTeacherGate, logger: rootLogger.child({ module: 'school-planning' }) });
  const milestoneStatuses = new GetMilestoneStatuses({
    store: schoolMilestoneStore, sessions: schoolLifecycle.stores?.sessions ?? null,
    attestations: schoolAttestations,
    timezone: configService.getTimezone?.() || null,
  });
  const recordEnrichment = new RecordEnrichment({ log: schoolEnrichmentLog, teacherGate: schoolTeacherGate, logger: rootLogger.child({ module: 'school-planning' }) });
  // Wave-4 records: the progress-report read model + the two renderers.
  let getProgressReport = null;
  if (getReportCard) {
    const { GetProgressReport } = await import('#apps/school/usecases/GetProgressReport.mjs');
    getProgressReport = new GetProgressReport({
      getReportCard,
      milestoneStatuses,
      enrichmentLog: schoolEnrichmentLog,
      timezone: configService.getTimezone?.() || null,
    });
  }
  const { offsetMinutesFor: schoolOffsetMinutesFor } = await import('#domains/school/studyDay.mjs');
  const { createProgressReportPdfRenderer } = await import('#rendering/school/reports/ProgressReportRenderer.mjs');
  const { createCertificatePdfRenderer } = await import('#rendering/school/reports/CertificateRenderer.mjs');

  v1Routers.school = createSchoolRouter({
    schoolErrors,
    schoolService,
    flashcardStudy,
    flashcardAssets,
    getMaterialCatalog,
    getMaterialUnits,
    getMaterialProgressSummary,
    materialProgressStore: schoolMaterialProgressStore,
    getSchoolReport,
    getLearningProgress,
    getInstructionalInsights,
    learningCatalog: schoolCatalog.query,
    issueContinuationCode,
    openCatalogLearningSession,
    recordLearningReflection,
    recordLearningProbeInteraction: schoolLearningLoop.probeInteractions,
    remediationTutor: schoolLearningLoop.tutor,
    offerCatalogQuizRemediation,
    learnerDirectory: schoolLearnerDirectory,
    printService: schoolPrintService,
    academicPeriodStore: schoolAcademicPeriods,
    schoolDatastore,
    regradeBankAttempts: schoolTeacherGate ? new RegradeBankAttempts({
      datastore: schoolDatastore,
      bankReader: schoolService,
      teacherGate: schoolTeacherGate,
      learnerDirectory: schoolLearnerDirectory,
      sessions: schoolLifecycle.stores?.sessions ?? null,
      worksheetInstances: schoolLifecycle.stores?.worksheetInstances ?? null,
      // A systematic bank correction must update the session's effective
      // grade through the same append-only, reward-aware path as a one-off
      // teacher adjustment. That path also creates the corrected receipt
      // artifact; regrading attempts alone must never pretend history changed.
      sessionCorrection: schoolLifecycle.stores?.sessions ? async (args) => new AdjustSessionGrade({
        sessions: schoolLifecycle.stores.sessions,
        teacherGate: schoolTeacherGate,
        worksheetInstances: schoolLifecycle.stores.worksheetInstances ?? null,
        reviewQueue: schoolLifecycle.stores.reviewQueue ?? null,
        curriculum: schoolLifecycle.stores.curriculum ?? null,
        economy: economyApi.economyService,
        economyEnabled: schoolFullConfig.lifecycle?.economy?.enabled === true,
        receiptIssuer: schoolLifecycle.useCases?.issueCorrectedResultReceipt ?? null,
        logger: rootLogger.child({ module: 'school-systematic-regrade' }),
      }).execute(args) : null,
      logger: rootLogger.child({ module: 'school-regrade' }),
    }) : null,
    getTeacherSession: schoolLifecycle.stores?.sessions
      ? new GetTeacherSession({
        sessions: schoolLifecycle.stores.sessions,
        curriculum: schoolLifecycle.stores.curriculum ?? null,
        issuedArtifacts: schoolLifecycle.stores.issuedArtifacts ?? null,
        reviewQueue: schoolLifecycle.stores.reviewQueue ?? null,
        allocationStore: schoolLifecycle.stores.allocationStore ?? null,
        worksheetInstances: schoolLifecycle.stores.worksheetInstances ?? null,
        curriculumExceptions: schoolLifecycle.stores.curriculumExceptionStore ?? null,
        printDocuments: schoolLifecycle.stores.printDocuments ?? null,
      }) : null,
    // Built inside the lifecycle module, where the companion code store and the
    // household id live — never re-constructed here over a second store
    // instance, which would be a second way to describe one file.
    getCompanionFinishCode: schoolLifecycle.useCases?.getCompanionFinishCode ?? null,
    previewTeacherLessonMaterial: schoolLifecycle.stores?.curriculum && schoolLifecycle.stores?.printDocuments && schoolLifecycle.renderPrintDocument
      ? new PreviewTeacherLessonMaterial({
        curriculum: schoolLifecycle.stores.curriculum,
        printDocuments: schoolLifecycle.stores.printDocuments,
        renderPrintDocument: schoolLifecycle.renderPrintDocument,
      }) : null,
    getLearnerTimeline: schoolLifecycle.stores?.sessions
      ? new GetLearnerTimeline({ sessions: schoolLifecycle.stores.sessions, curriculum: schoolLifecycle.stores.curriculum ?? null }) : null,
    adjustSessionGrade: schoolLifecycle.stores?.sessions && schoolTeacherGate
      ? new AdjustSessionGrade({
        sessions: schoolLifecycle.stores.sessions,
        teacherGate: schoolTeacherGate,
        worksheetInstances: schoolLifecycle.stores.worksheetInstances ?? null,
        reviewQueue: schoolLifecycle.stores.reviewQueue ?? null,
        curriculum: schoolLifecycle.stores.curriculum ?? null,
        economy: economyApi.economyService,
        economyEnabled: schoolFullConfig.lifecycle?.economy?.enabled === true,
        receiptIssuer: schoolLifecycle.useCases?.issueCorrectedResultReceipt ?? null,
        logger: rootLogger.child({ module: 'school-grade-adjustment' }),
      }) : null,
    retractSessionGradeAdjustment: schoolLifecycle.stores?.sessions && schoolTeacherGate
      ? new RetractSessionGradeAdjustment({
        sessions: schoolLifecycle.stores.sessions,
        teacherGate: schoolTeacherGate,
        curriculum: schoolLifecycle.stores.curriculum ?? null,
        economy: economyApi.economyService,
        economyEnabled: schoolFullConfig.lifecycle?.economy?.enabled === true,
        receiptIssuer: schoolLifecycle.useCases?.issueCorrectedResultReceipt ?? null,
        logger: rootLogger.child({ module: 'school-grade-adjustment' }),
      }) : null,
    issuedArtifactStore: schoolLifecycle.stores?.issuedArtifacts ?? null,
    teacherAgendaDispatch: schoolLifecycle.useCases?.teacherAgendaDispatch ?? null,
    reprintIssuedArtifact: schoolLifecycle.useCases?.reprintIssuedArtifact ?? null,
    reprintResultReceiptArtifact: schoolLifecycle.useCases?.reprintResultReceiptArtifact ?? null,
    manageCurriculumException: schoolLifecycle.useCases?.manageCurriculumException ?? null,
    manageProgramDayBypass: schoolLifecycle.useCases?.manageProgramDayBypass ?? null,
    teacherCapabilitySessions,
    teacherGate: schoolTeacherGate,
    openRemediation: schoolLifecycle.useCases?.openRemediation ?? null,
    renderArtifactPostview: createArtifactPostviewRenderer(),
    renderWorksheetThumbnail: renderPdfFirstPagePng,
    milestoneStore: schoolMilestoneStore,
    assignmentsStore: schoolLifecycle.stores?.assignments ?? null,
    getLearnerRecord: new GetLearnerRecord({
      teacherNotes: schoolTeacherNotes,
      reviewQueue: schoolLifecycle.stores?.reviewQueue ?? null,
      attestations: schoolAttestations,
      enrichment: schoolEnrichmentLog,
      quizRequests: () => schoolService.listQuizRequests(),
      printRequests: (learnerId) => schoolPrintService?.listRequestsFor?.(learnerId) ?? [],
      logger: rootLogger.child({ module: 'school-learner-record' }),
    }),
    schoolCalcRouter: schoolCalc.router,
    surfaceCertification: schoolSurfaces.certification,
    surfaceRegistry: schoolSurfaces.registry,
    getScreenConfig: getSchoolScreenConfig,
    // The SAME render pipeline + repository the tracked-quiz path uses (spec
    // §9 shared-instance rule) — GET /print/:id renders through the identical
    // allocation store, so a freshCard render here is a real card allocation.
    renderPrintDocument: schoolLifecycle.renderPrintDocument ?? null,
    printDocumentsRepo: schoolLifecycle.stores?.printDocuments ?? null,
    printAllocationStore: schoolLifecycle.stores?.allocationStore ?? null,
    // Teacher-key gate: answer keys deny until `print.teacherPin` is set in
    // the household school config and matched via `?pin=`.
    getPrintTeacherPin: () => {
      const schoolConfig = configService.getHouseholdAppConfig(null, 'school') || {};
      return schoolConfig.print?.teacherPin != null ? String(schoolConfig.print.teacherPin) : null;
    },
    // Report cards, period close, teacher digest (Task 6, spec R5b).
    getReportCard,
    closeAcademicPeriod,
    getTeacherToday,
    getTeachers,
    setAcademicPeriods,
    passOverrideStore: schoolLifecycle.passOverrides ?? null,
    setPassOverride,
    milestoneStatuses,
    setMilestones,
    enrichmentLog: schoolEnrichmentLog,
    recordEnrichment,
    getProgressReport,
    renderProgressReportPdf: createProgressReportPdfRenderer(),
    renderCertificatePdf: createCertificatePdfRenderer(),
    getHouseholdOffsetMinutes: (nowMs) => schoolOffsetMinutesFor(configService.getTimezone?.() || null, nowMs),
    attestationLog: schoolAttestations,
    recordAttestation,
    teacherNotesStore: schoolTeacherNotes,
    recordTeacherNote,
    reassignEvidence,
    reassignSession,
    reassignmentLog: schoolReassignmentLog,
    attemptsStore: schoolDatastore,
    retractTeacherRecord,
    getTranscript,
    renderTranscriptPdf: createTranscriptPdfRenderer(),
    renderSyllabusPdf: createSyllabusPdfRenderer(),
    curriculumForSyllabus: schoolLifecycle.stores?.curriculum ?? null,
    // Frozen-record reads work off `schoolDatastore` alone (no lifecycle
    // stores needed), so this is wired unconditionally.
    reportCardsStore: schoolDatastore,
    // Printable report card PDF (Task 7) — also wired unconditionally.
    renderReportCardPdf,
    // Feedback delivery + kid-visible standing (Task 9, spec R7 / adequacy
    // SHOULD 9) — the SAME review-queue store and academic-period source
    // `getReportCard` already reads above, reused rather than rebuilt.
    reviewQueue: schoolLifecycle.stores?.reviewQueue ?? null,
    academicPeriods: schoolAcademicPeriods,
    logger: rootLogger.child({ module: 'school-api' })
  });

  const { LanguageAudioResource } = await import('#apps/school/LanguageAudioResource.mjs');
  const { FilesystemLanguageAudioRepository } = await import('#adapters/media/FilesystemLanguageAudioRepository.mjs');
  const languageAudioResource = new LanguageAudioResource({
    languageAudioRepository: new FilesystemLanguageAudioRepository({
      mediaDir: mediaBasePath,
      userExists: (userId) => Boolean(configService.getUserProfile(userId)),
    }),
    languageStudyService,
  });
  const sentenceLadderRouter = createSentenceLadderRouter({ schoolErrors,
    languageStudyService,
    languageAudioResource,
    studyGrants: schoolStudyGrants,
    logger: rootLogger.child({ module: 'school-language-api' })
  });
  v1Routers.school.use('/sentence-ladder', sentenceLadderRouter);
  // Compatibility alias for deployed clients and bookmarks. No removal in
  // this migration; legacy traffic is logged by the shared router.
  v1Routers.school.use('/language', sentenceLadderRouter);
  v1Routers.school.use('/language-reels', createLanguageReelsRouter({
    service: languageReelService, grants: schoolReelGrants,
    logger: rootLogger.child({ module: 'school-language-reels-api' }),
  }));
  v1Routers.school.use('/rubiks-cube', createRubiksCubeRouter({
    service: rubiksCubeService, grants: schoolCubeGrants, revision: RUBIKS_CUBE_REVISION,
    logger: rootLogger.child({ module: 'school-rubiks-cube-api' }),
  }));

  if (schoolLifecycle.router) {
    v1Routers.school.use('/lifecycle', schoolLifecycle.router);
  }
  // Only when the doubles were actually constructed (school.yml
  // `virtualDevices: true`). A production deployment never mounts a surface that
  // can knock a printer offline.
  if (schoolLifecycle.devicesRouter) {
    v1Routers.school.use('/devices', schoolLifecycle.devicesRouter);
  }
  // The school-room wall panel's keypad. Built inside the same
  // `lifecycle.enabled` gate as everything else above, so a locked panel
  // configured against a disabled lifecycle 404s here rather than answering
  // half a card.
  if (schoolLifecycle.selfServiceRouter) {
    v1Routers.school.use('/self-service', schoolLifecycle.selfServiceRouter);
  }

  // Shared dispatch-level idempotency cache for multi-step HTTP dispatches
  // (e.g. POST /api/v1/device/:id/load?mode=adopt).
  const { dispatchIdempotencyService } = createDispatchIdempotencyService({
    logger: rootLogger.child({ module: 'dispatch-idempotency' })
  });

  v1Routers.device = createDeviceApiRouter({
    presenceStore,
    // "It locked and I don't know why" needs an endpoint, not a log grep.
    readGate: () => languageStudyService.describeGate(),
    deviceServices,
    wakeAndLoadService,
    sessionControlService,
    dispatchIdempotencyService,
    configService,
    loadFile,
    pianoMidiWakeService,
    logger: rootLogger.child({ module: 'device-api' })
  });

  v1Routers.homeline = createHomelineRouter({
    leaseService: callLeaseService,
    canCall: req => {
      if (!req.user) return false;
      const apps = expandRolesToApps(req.user.roles || [], authConfig?.roles || {});
      return apps.includes('*') || apps.includes('call') || apps.includes('homeline');
    },
  });

  const barcodeRelayConfig = configService.getHouseholdAppConfig(householdId, 'barcode-relay') || {};
  const barcodeRelayInstances = barcodeRelayConfig.relays || {};

  // Scan-enriched food logging: ONE buffer, shared by the scale bridge (which writes
  // weights) and the fridge-sheet scan handler (which writes density/tare). Constructed
  // here because both call sites are below and both must hold the SAME instance — two
  // stores means a scanned density never meets its weight, the entry never completes,
  // and nothing anywhere reports an error. Window is the store's own default; the
  // scales config carries no composition-window knob today.
  const compositionStore = new CompositionStore({ now: () => Date.now() });

  const scanVocabConfig = normalizeScaleNutribotConfig(
    configService.getHouseholdAppConfig(householdId, 'scales') || {},
    { logger: rootLogger.child({ module: 'nutriscan' }) },
  );

  // Fail SOFT, not fatal. A malformed nutriscan table must not keep the whole
  // station from booting — media, fitness and the rest have nothing to do with
  // it. Disable nutriscan, log loudly, let UPC scanning carry on.
  let applyScanToComposition = null;
  try {
    validateScanConfig(scanVocabConfig);
    applyScanToComposition = new ApplyScanToComposition({
      store: compositionStore,
      config: scanVocabConfig,
      logger: rootLogger.child({ module: 'nutriscan' }),
    });
  } catch (err) {
    rootLogger.error('nutriscan.config.invalid', {
      error: err.message, code: err.code, hint: 'fix the nutribot block in scales.yml',
    });
  }

  // Late-bound: the scan handler below needs the scale bridge to ACK a tare on the
  // live prompt, but the bridge is constructed much further down, conditionally on
  // the head-of-household and bot id resolving. Hoisting that block would change
  // startup ordering for a dependency the closure only touches on a scan — long
  // after startup — so we bind the reference instead.
  let scaleNutribotBridge = null;

  // ==========================================================================
  // Living-room reading sessions.
  // Authority on behaviour: docs/reference/school/reading-sessions.md.
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
  let readingSessions = null;
  let readingSessionInterceptor = null;
  if (schoolLifecycle.wired && schoolLifecycle.storyTimeLauncher) {
    const readingLogger = rootLogger.child({ module: 'school-reading' });
    const { ReadingSessionService } = await import('#apps/school/ReadingSessionService.mjs');
    const { ReadingApiService } = await import('#apps/school/ReadingApiService.mjs');
    const { ReadingSessionInterceptor } = await import('#apps/school/readingSessionInterceptor.mjs');
    const { RecordStoryRead } = await import('#apps/school/usecases/RecordStoryRead.mjs');
    const { createReadingRouter } = await import('#api/v1/routers/reading.mjs');
    const { makeReadingTimeoutHandler } = await import('#composition/modules/learnerCardActions.mjs');
    const { YamlReadingSessionTimelineStore } = await import('#adapters/persistence/yaml/YamlReadingSessionTimelineStore.mjs');
    const { EventBusSchoolRealtimeAdapter } = await import('#adapters/eventbus/EventBusSchoolRealtimeAdapter.mjs');
    const readingTimeline = new YamlReadingSessionTimelineStore({ configService, logger: readingLogger });
    // One gateway for the whole reading ceremony. Passing the raw event bus
    // here stopped working when the application layer moved to the School
    // realtime port: JavaScript ignored the unknown `eventBus` option, leaving
    // activation and book-selection broadcasts as silent no-ops.
    const readingRealtime = new EventBusSchoolRealtimeAdapter({ eventBus });

    readingSessions = new ReadingSessionService({
      realtime: readingRealtime,
      logger: readingLogger,
      // Delivery recovery and idle teardown are both scheduler-owned. Without
      // this adapter an ACK wait never reaches its deadline, so the first lost
      // cold-wake broadcast strands the intent forever instead of replaying it.
      scheduler: new NodeAsyncScheduler(),
      observationStore: readingTimeline,
      // D6 — the session owns teardown, and this is it. The location's own
      // `end: tv-off` is suppressed while a session is open (D8), so nothing
      // else will ever turn this TV off: an abandoned prompt would leave the
      // living room lit all night and the next card tap would land in a
      // session belonging to a child who left.
      onTimeout: makeReadingTimeoutHandler({
        locations: nfcLocationsForReachability, tv: homeAutomationAdapters.tvAdapter, logger: readingLogger,
      }),
    });
    readingSessions.start();
    server?.once?.('close', () => readingSessions.stop());

    readingSessionInterceptor = new ReadingSessionInterceptor({
      sessions: readingSessions,
      storyTime: schoolLifecycle.storyTimeLauncher,
      realtime: readingRealtime,
      logger: readingLogger,
    });

    const readingService = new ReadingApiService({
      recordStoryRead: new RecordStoryRead({
        readingLog: schoolLifecycle.stores.readingLog,
        // A FUNCTION, not a timezone, and deliberately so: this is the ONE
        // place the household's 4am study-day boundary is applied, and a
        // second independently-configured source of the shard key would drift
        // from the launcher's own "how many today" without erroring.
        studyDay: () => schoolLifecycle.storyTimeLauncher.studyDay(),
        realtime: readingRealtime,
        logger: readingLogger,
      }),
      sessions: readingSessions,
      storyTime: schoolLifecycle.storyTimeLauncher,
      readingLog: schoolLifecycle.stores.readingLog,
      // Optional: without it the prompt falls back to the learner id, which is
      // a worse greeting and not a broken one.
      resolveLearner: (id) => configService.getUserProfile?.(id) ?? null,
      logger: readingLogger,
      observationStore: readingTimeline,
    });
    v1Routers.school.use('/reading', createReadingRouter({ readingService }));
  } else {
    rootLogger.warn('school.reading.unwired', {
      reason: schoolLifecycle.wired ? 'no story-time launcher' : 'school lifecycle not wired',
    });
  }

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
      const { ReadLessonSnapshot } = await import('#apps/school/usecases/ReadLessonSnapshot.mjs');
      const { RecordCheckpointAnswer } = await import('#apps/school/usecases/RecordCheckpointAnswer.mjs');
      const { createMediaLessonRouter } = await import('#api/v1/routers/mediaLesson.mjs');

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
        // The playhead heartbeat's destination. Same bus the playback adapters
        // announce dispatches on.
        eventBus,
        // Optional: without it the score placard names the learner id, which is
        // a worse placard and not a broken lesson.
        resolveLearner: (id) => configService.getUserProfile?.(id) ?? null,
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
    const { makePrintAgendaHandler } = await import('#composition/modules/learnerCardActions.mjs');
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
  if (readingSessions) {
    const { makeReadingSessionHandler } = await import('#composition/modules/learnerCardActions.mjs');
    const readingSessionHandler = makeReadingSessionHandler({
      sessions: readingSessions,
      // D2 — the one question that can refuse a tap: is unrelated content
      // already up on this reader's TV? The SAME tracker the presence
      // publisher feeds, so "is something playing" has one answer in the house.
      isPlaying: (target) => (target ? screenContentTracker.isPlaying(target) === true : false),
      // Power on and bring the kiosk forward. NOT a content load and NOT a
      // `clearContent()`: the reading widget is already mounted on that
      // screen, and reloading the page would drop the very WebSocket that
      // carried the `session-open` this tap just produced. Now shared with
      // the media-lesson dispatch, which needs it for the same reason — see
      // `wakeScreenForBroadcast` above.
      wakeScreen: wakeScreenForBroadcast,
      alertAdult: async ({ target, location, learnerId }) => {
        const device = target ? deviceServices.deviceService.get(target) : null;
        if (!device?.notifyService || !homeAutomationAdapters.haGateway?.callService) return;
        await homeAutomationAdapters.haGateway.callService('notify', device.notifyService, {
          title: 'Story time screen needs help',
          message: `${learnerId ?? 'A learner'} started story time at ${location}, but the screen did not respond.`,
        });
      },
      eventBus,
      logger: rootLogger.child({ module: 'trigger-learner' }),
    });
    learnerActions.register('reading-session', readingSessionHandler);
    startReadingSession = ({ learnerId, origin = 'portal' } = {}) => {
      const locations = Object.entries(nfcLocationsForReachability() || {})
        .filter(([, cfg]) => cfg?.learner_action === 'reading-session');
      if (locations.length !== 1) {
        return { status: 'reading_session_failed', message: 'Story time needs one configured reading room.' };
      }
      const [location, cfg] = locations[0];
      return readingSessionHandler({ learnerId, location, target: cfg?.target ?? cfg?.device ?? null, origin });
    };
  }

  // Trigger dispatch (NFC modality source: apps/nfc/config.yml; barcode modality
  // shares this same dispatch core — see the barcode-relay wiring just below).
  const { router: triggerRouter, triggerDispatchService, triggerConfig } = createTriggerApiRouter({
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
    logger: rootLogger.child({ module: 'trigger' }),
  });
  // The school reachability check can now answer for real (it has been
  // returning "could not tell" for every projection until this line).
  triggerNfcLocations = triggerConfig?.nfc?.locations ?? null;
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
    announce: ({ lockedUntil, source }) => {
      const script = readShutdownConfig().home_assistant?.script;
      if (!script) return undefined;
      return homeAutomationAdapters.haGateway.callService('script', 'turn_on', {
        entity_id: script,
        variables: { locked_until: lockedUntil, source },
      });
    },
  } : null;
  const shutdownService = new ShutdownService({
    repo: new YamlShutdownDatastore({ configService }),
    notifier: { publishState: (payload) => eventBus.broadcast('shutdown.state', payload) },
    getPolicy: getShutdownPolicy,
    cue: shutdownCue,
    portal,
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
  const { MeasureRegistry } = await import('#apps/measures/MeasureRegistry.mjs');
  const { createFitnessRingsProvider } = await import('#apps/measures/fitnessRingsProvider.mjs');
  const { createMeasuresRouter } = await import('#api/v1/routers/measures.mjs');
  const { GetWeeklyMeasures } = await import('#apps/measures/GetWeeklyMeasures.mjs');
  const measuresTimezone = configService.getHouseholdTimezone?.(householdId) || 'UTC';
  const measureRegistry = new MeasureRegistry().register(createFitnessRingsProvider({
    timezone: measuresTimezone,
    sessions: {
      // The provider asks in study days; SessionService speaks the same
      // YYYY-MM-DD range, so no translation layer is needed.
      listSessions: ({ from, to }) => fitnessServices.sessionService
        .listSessionsInRange(from, to, householdId),
    },
  }));
  v1Routers.measures = createMeasuresRouter({
    weeklyMeasures: new GetWeeklyMeasures({
      registry: measureRegistry,
      learners: async () => schoolLearnerDirectory.listLearners(),
      timezone: measuresTimezone,
      logger: rootLogger.child({ module: 'measures' }),
    }),
  });
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
  const { TelegramNutribotIdentity } = await import('#adapters/nutribot/TelegramNutribotIdentity.mjs');
  const scanDispatch = createScanDispatch({
    schoolLifecycle,
    schoolCalcResultImporter: schoolCalc.resultImporter,
    triggerDispatchService,
    relayInstances: barcodeRelayInstances,
    relayConfig: barcodeRelayConfig,
    applyScanToComposition,
    // Both LATE-BOUND: constructed further down this function, long before any
    // scan arrives but well after this line. Read at scan time, never captured.
    getScaleNutribotBridge: () => scaleNutribotBridge,
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
    transcriptionService: voiceTranscriptionService,  // Voice message transcription
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
    dataService,
    botName: 'nutribot',
    userResolver,
    logger: rootLogger.child({ module: 'nutribot-state' })
  });

  // Get nutribot adapter from config-driven SystemBotLoader
  const nutribotTelegramAdapter = getMessagingAdapter(householdId, 'nutribot');

  const nutribotServices = await createNutribotServices({
    configService,
    dataService,
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
    scaleRawConfig: configService.getHouseholdAppConfig(householdId, 'scales'),
    // Lazy proxy: agentOrchestrator is created later in createAgentsServices
    agentOrchestrator: { runAssignment: (...args) => v1Routers.agents?.orchestrator?.runAssignment(...args) },
    logger: rootLogger.child({ module: 'nutribot' })
  });

  // Scale → Nutribot: settled kitchen-scale weights become density-logged food entries,
  // posted to the household head. Target chat resolved from head identity.
  try {
    const scaleHeadUser = configService.getHeadOfHousehold();
    const scaleHeadPlatformId = scaleHeadUser
      ? userIdentityService.resolvePlatformId('telegram', scaleHeadUser)
      : null;
    const scaleBotId = systemBots.nutribot?.telegram?.bot_id || '';
    if (scaleHeadPlatformId && scaleBotId) {
      scaleNutribotBridge = createScaleNutribotBridge({
        eventBus,
        nutribotContainer: nutribotServices.nutribotContainer,
        userId: scaleHeadUser,
        conversationId: `telegram:b${scaleBotId}_c${scaleHeadPlatformId}`,
        scaleConfig: nutribotServices.scaleConfig,
        compositionStore,
        commitQuietMs: (nutribotServices.scaleConfig?.commitQuietSec ?? 25) * 1000,
        logger: rootLogger.child({ module: 'scale-nutribot-bridge' }),
      });
    } else {
      rootLogger.warn?.('scaleNutribot.bridge.skipped', { hasPlatformId: !!scaleHeadPlatformId, hasBotId: !!scaleBotId });
    }
  } catch (e) {
    rootLogger.warn?.('scaleNutribot.bridge.wireFailed', { error: e.message });
  }

  const nutribotApiResult = createNutribotApiRouter({
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

  // Journalist application
  const journalistConfig = configService.getAppConfig('journalist') || {};

  // Reuse shared AI adapter (loaded from integration system or created above)
  const journalistAiGateway = nutribotAiGateway;

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

  // Reuse shared AI adapter (loaded from integration system or created above)
  const homebotAiGateway = nutribotAiGateway || journalistAiGateway;

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

  // Agents services — build orchestrator + services without constructing a router
  const agentsServices = await createAgentsServices({
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
  });

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
        const { ContentTreeManifest } = await import('#adapters/school/content/ContentTreeManifest.mjs');
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
        const { SchoolRetentionSweep } = await import('#apps/school/SchoolRetentionSweep.mjs');
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

  if (agentsServices.scheduler) {
    agentsServices.scheduler.registerTask('lifeplan:ceremony-check', '0 * * * *', async () => {
      const lifePlanStore = lifeplanResult.container.getLifePlanStore();
      for (const username of lifePlanStore.listUsernames()) {
        await lifeplanResult.ceremonyScheduler.checkAndNotify(username);
      }
    });
  }

  // Nightly drift/allocation snapshot per user with a plan — the dashboard's
  // drift gauge and the weekly retro read these snapshots. Also flushes any
  // stale pre-fix snapshots that carried a false 'reconsidering' status.
  if (agentsServices.scheduler) {
    agentsServices.scheduler.registerTask('lifeplan:drift-refresh', '0 2 * * *', async () => {
      const lifePlanStore = lifeplanResult.container.getLifePlanStore();
      for (const username of lifePlanStore.listUsernames()) {
        try {
          await lifeplanResult.services.driftService.computeAndSave(username);
        } catch (err) {
          rootLogger.warn('lifeplan.drift.refresh_failed', { username, error: err.message });
        }
      }
    });
  }

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
  const { AgentMemoryAdministrationService } = await import('#apps/agents/AgentMemoryAdministrationService.mjs');
  const { WorkingMemoryState } = await import('#apps/agents/framework/WorkingMemory.mjs');
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
    healthAnalyticsService: agentsServices.healthAnalyticsService,
  };

  // Re-create health mentions router now that healthAnalyticsService is available
  // from the agents router. This replaces the null-wired placeholder above so
  // listPeriods() works in CoachChat @-mention autocomplete.
  v1Routers.healthMentions = createHealthMentionsRouter({
    healthAnalyticsService: v1Routers.agents?.healthAnalyticsService ?? null,
    healthStore: healthServices.healthStore,
    healthService: healthServices.healthService,
  });

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
  const aiOpenaiAdapter = sharedAiGateway;

  // Anthropic adapter - could be loaded from integration system if configured
  // For now, create directly if API key is available
  let aiAnthropicAdapter = null;
  if (anthropicApiKey) {
    const { AnthropicAdapter } = await import('#adapters/ai/AnthropicAdapter.mjs');
    aiAnthropicAdapter = new AnthropicAdapter(
      { apiKey: anthropicApiKey },
      { httpClient: axios, logger: rootLogger.child({ module: 'ai-anthropic' }), aiUsageLedger }
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
    const { NewsMediaStore } = await import('#adapters/content/media/NewsMediaStore.mjs');
    const newsMediaStore = new NewsMediaStore({ mediaRoot: mediaBasePath });

    const videoSourceGateway = new YtDlpAdapter({
      downloadRoot: mediaPath,
      logger: rootLogger.child({ module: 'ytdlp' })
    });

    mediaDownloadService = new MediaDownloadService({
      videoSourceGateway,
      newsMediaStore,
      downloadThumbnail: (url, provider) => videoSourceGateway.downloadThumbnail(url, provider),
      logger: rootLogger.child({ module: 'media-download' })
    });

    const { FilesystemFreshVideoMediaStore } = await import('#adapters/persistence/files/FilesystemFreshVideoMediaStore.mjs');
    const freshVideoMediaStore = new FilesystemFreshVideoMediaStore({
      mediaRoot: mediaPath,
      logger: rootLogger.child({ module: 'freshvideo-store' }),
    });
    const freshVideoSourceCatalog = {
      list: () => (loadFile('media/sources') || []).map((source) => ({
        provider: source.shortcode,
        sourceRef: {
          platform: source.src || 'youtube',
          collectionType: String(source.type || 'playlist').toLowerCase(),
          locator: source.playlist,
        },
      })),
    };
    mediaExecutor.register('freshvideo', createFreshVideoJobHandler({
      videoSourceGateway,
      sourceCatalog: freshVideoSourceCatalog,
      mediaStore: freshVideoMediaStore,
      lockOwnerId: process.pid,
      logger: rootLogger.child({ module: 'freshvideo' })
    }));
  } else {
    rootLogger.warn?.('freshvideo.disabled', {
      reason: 'mediaBasePath not configured - video downloads disabled'
    });
  }

  // Camera detection ledger (Pipeline C). Registered unconditionally: it needs
  // no media path and no NAS — only the Reolink search API — so it should keep
  // running even when the heavier media plumbing is unavailable. It is the
  // perishable half of the camera archive (see cameraLedgerJobHandler).
  // D1: bootstrap owns which concrete camera adapters are used; the handlers
  // receive them through one semantic runtime gateway.
  const { ConfiguredCameraJobRuntimeGateway } = await import('#composition/modules/ConfiguredCameraJobRuntimeGateway.mjs');
  const { CameraLedgerStore } = await import('#adapters/camera/CameraLedgerStore.mjs');
  const { FilesystemCameraArchiveArtifacts } = await import('#adapters/camera/FilesystemCameraArchiveArtifacts.mjs');
  const { FilesystemContactSheetArtifacts } = await import('#adapters/camera/FilesystemContactSheetArtifacts.mjs');
  const cameraRuntimeGateway = new ConfiguredCameraJobRuntimeGateway({
    configService,
    haGateway: householdAdapters?.has?.('home_automation') ? householdAdapters.get('home_automation') : null,
    factories: {
      createReolinkClient: (options) => new ReolinkClient(options),
      makeSource,
      createDetectionSource: (options) => createHaDetectionSource(options),
      decodeTriggerBits: parseTriggerBits,
      createEncoder: (options) => new ArchiveEncoder(options),
      createManifestStore: (options) => new ArchiveManifestStore(options),
      createArchiveArtifacts: (options) => new FilesystemCameraArchiveArtifacts(options),
      createSheetArtifacts: () => new FilesystemContactSheetArtifacts(),
    },
  });
  const cameraLedgerStore = new CameraLedgerStore({
    resolveDestinations: () => configService
      .getHouseholdAppConfig(householdId, 'camera-archive')?.storage?.ledgerPaths || [],
  });
  mediaExecutor.register('camera-ledger', createCameraLedgerJobHandler({
    runtimeGateway: cameraRuntimeGateway,
    ledgerStore: cameraLedgerStore,
    householdId,
    logger: rootLogger.child({ module: 'camera-ledger' })
  }));

  // Camera archive (Pipeline A) — scored session selection under a hard budget
  // cap, plus day/night timelapses. Scheduled AFTER camera-ledger so the day's
  // detections exist to select against; without them selection degrades to
  // duration and bitrate density alone.
  mediaExecutor.register('camera-archive', createCameraArchiveJobHandler({
    runtimeGateway: cameraRuntimeGateway,
    ledgerStore: cameraLedgerStore,
    householdId,
    logger: rootLogger.child({ module: 'camera-archive' })
  }));

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
    const { SchoolMaintenanceExecutor } = await import('#apps/school/SchoolMaintenanceExecutor.mjs');
    schoolMaintenanceExecutor = new SchoolMaintenanceExecutor({
      markSessionAbandoned: schoolLifecycle.useCases.markSessionAbandoned,
      logger: rootLogger.child({ module: 'school-maintenance' }),
    });
  }

  const schedulerOrchestrator = new SchedulerOrchestrator({
    schedulerService,
    timestampCodec: new SchedulerTimestampCodec({ timezone: process.env.TZ }),
    newExecutionId: () => crypto.randomUUID(),
    scheduler: new NodeApplicationScheduler(),
    jobStore: compositeJobStore,
    stateStore: schedulingStateStore,
    harvesterExecutor: harvesterServices.jobExecutor,
    mediaExecutor,
    newsReporterExecutor: newsReporter.executor,
    schoolExecutor: schoolMaintenanceExecutor
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
  const ambientScheduler = new AmbientSchedulerService({
    loadSchedule: async () => normalizeWindows(
      (await loadArtmodeConfig(configService.getHouseholdPath(''), rootLogger)).schedule,
      { defaultDevice: 'livingroom-tv' },
    ),
    tracker: screenContentTracker,
    wakeAndLoadService,
    deviceService: deviceServices.deviceService,
    stateStore: new YamlAmbientStateStore({
      dataDir: ambientDataDir,
      logger: rootLogger.child({ module: 'ambient-state' }),
    }),
    scheduler: new NodeApplicationScheduler(),
    timeZone: 'America/Los_Angeles',
    logger: rootLogger.child({ module: 'ambient-scheduler' }),
  });
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

  // Canvas router for art display
  v1Routers.canvas = createCanvasRouter({
    canvasService: null  // Uses req.app.get('canvasBasePath') instead
  });

  // Screens router for screen configurations
  const screensLogger = rootLogger.child({ module: 'screens-api' });
  v1Routers.screens = createScreensRouter({
    screensQueryService: new ScreensQueryService({
      screensRepository: new FilesystemScreensRepository({
        householdDir: configService.getHouseholdPath(''),
        logger: screensLogger,
      }),
      logger: screensLogger,
    }),
    logger: screensLogger,
  });

  // Auth router
  v1Routers.auth = createAuthRouter({
    authService,
    jwtSecret,
    jwtConfig,
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
  const yamlConfigFileService = new YamlConfigFileService({
    configStore: adminConfigStore,
    logger: adminApiLogger.child?.({ submodule: 'config' }) || adminApiLogger
  });
  const appsConfigService = new AppsConfigService({
    configStore: adminConfigStore,
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
  const adminArtService = new AdminArtService({
    repository: new FilesystemArtAdminRepository({
      mediaPath: mediaBasePath || imgBasePath,
      householdDir: configService.getHouseholdPath(''),
      logger: adminApiLogger,
    }),
    logger: adminApiLogger.child?.({ submodule: 'art' }) || adminApiLogger,
  });
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

  // Admin router - combined content, images, and eventbus management
  v1Routers.admin = createAdminRouter({
    householdContext,
    listManagementService,
    adminArtService,
    adminImageService,
    adminNotificationOperations,
    householdAdminService,
    yamlConfigFileService,
    appsConfigService,
    schedulerAdminService,
    integrationsQueryService,
    notificationConfigService,
    notificationLedgerStore: notificationStack.ledgerStore,
    logger: adminApiLogger
  });

  // Test infrastructure router (dev/test only)
  const { createTestRouter } = await import('./4_api/v1/routers/test.mjs');
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
    contentCatalog: contentServices.contentCatalog,
    deviceLauncher: adbLauncher,
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
  if (immichConfig) {
    const { ImmichClient } = await import('#adapters/content/gallery/immich/ImmichClient.mjs');
    const wrImmichClient = new ImmichClient(immichConfig, { httpClient: axios });
    const weeklyReviewImmichAdapter = new WeeklyReviewImmichAdapter(
      { priorityPeople: [], proxyPath: '/api/v1/proxy/immich' },
      { client: wrImmichClient, logger: rootLogger.child({ module: 'weekly-review-immich' }) }
    );

    const weeklyReviewCalendarAdapter = new WeeklyReviewCalendarAdapter(
      { householdId, defaultUser: configService.getHeadOfHousehold?.() || 'user_1' },
      { userDataService, logger: rootLogger.child({ module: 'weekly-review-calendar' }) }
    );

    // Weather history store for weekly review (reads daily snapshots)
    const { YamlWeatherDatastore } = await import('#adapters/persistence/yaml/YamlWeatherDatastore.mjs');
    const wrWeatherStore = new YamlWeatherDatastore({
      dataService,
      configService,
      logger: rootLogger.child({ module: 'weekly-review-weather' }),
    });

    const weeklyReviewHouseholdDir = configService.getHouseholdPath('', householdId);
    const weeklyReviewCommandRunner = new NodeCommandRunner();
    const weeklyReviewService = new WeeklyReviewService(
      {
        dataPath: dataBasePath,
        householdDir: weeklyReviewHouseholdDir,
        mediaPath: mediaBasePath,
        householdId,
        timezone: configService.getTimezone?.() || 'UTC',
      },
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
        reviewStore: new FilesystemWeeklyReviewStore({
          householdDir: weeklyReviewHouseholdDir,
          mediaPath: mediaBasePath,
          logger: rootLogger.child({ module: 'weekly-review-store' }),
        }),
        runCommand: weeklyReviewCommandRunner.run,
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
  // Concierge endpoint (OpenAI-compatible /v1) — for HA Voice / external clients
  // ==========================================================================
  try {
    const conciergeServices = await createConciergeServices({
      configService,
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

  return app;
}
