// backend/src/5_composition/modules/fitnessApi.mjs
// Composition wiring for Fitness API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { PlexPosterProvider } from "../../../../capabilities/content-catalog/server/adapters/providers/plex/PlexPosterProvider.mjs";
import { FitnessAssetResolver } from "../adapters/FitnessAssetResolver.mjs";
import { equipmentImageMap } from "../application/equipmentImages.mjs";
import { ProviderFitnessContentCatalog } from "../adapters/ProviderFitnessContentCatalog.mjs";
import { FitnessConfigProjection } from "../adapters/FitnessConfigProjection.mjs";
import { FilesystemMenuMusicCatalog } from "../adapters/FilesystemMenuMusicCatalog.mjs";
import { FilesystemScreenshotStore } from "../adapters/FilesystemScreenshotStore.mjs";
import { FilesystemSessionTrashStore } from "../adapters/FilesystemSessionTrashStore.mjs";
import { FilesystemTimelapseArtifactStore } from "../adapters/FilesystemTimelapseArtifactStore.mjs";
import { FilesystemVoiceMemoArtifactStore } from "../adapters/FilesystemVoiceMemoArtifactStore.mjs";
import { FilesystemVoiceMemoDebugStore } from "../adapters/FilesystemVoiceMemoDebugStore.mjs";
import { TemporaryImagePrintGateway } from "../../../gratitude/server/print-gateway.mjs";
import { YamlRecapSnapshotStore } from "../adapters/persistence/YamlRecapSnapshotStore.mjs";
import { YamlFitnessSchoolAttemptStore } from "../adapters/persistence/YamlFitnessSchoolAttemptStore.mjs";
import { FitnessSchoolPublications } from "../adapters/eventbus/FitnessSchoolPublications.mjs";
import { FfmpegVideoAdapter } from '#adapters/video/FfmpegVideoAdapter.mjs';
import { createFitnessRouter } from "../api/fitness.mjs";
import { ContentQueryService } from "../../../../capabilities/content-catalog/server/application/ContentQueryService.mjs";
import { FitnessConfigService } from "../application/FitnessConfigService.mjs";
import { FitnessPlayableService } from "../application/FitnessPlayableService.mjs";
import { FitnessSchoolCourseService } from "../application/FitnessSchoolCourseService.mjs";
import { FitnessSimulationService } from "../adapters/FitnessSimulationProcess.mjs";
import { ScreenshotService } from "../application/services/ScreenshotService.mjs";
import { SessionLockService } from "../application/services/SessionLockService.mjs";
import { FitnessLiveSessionAuthority } from "../application/services/FitnessLiveSessionAuthority.mjs";
import { getManageService } from "../application/manageService.mjs";
import { getUnlockService } from "../application/unlockService.mjs";
import { DiscoveryStrategy } from "../application/suggestions/DiscoveryStrategy.mjs";
import { FavoriteStrategy } from "../application/suggestions/FavoriteStrategy.mjs";
import { FitnessSuggestionService } from "../application/suggestions/FitnessSuggestionService.mjs";
import { SuggestionsSnapshot } from "../application/suggestions/SuggestionsSnapshot.mjs";
import { MemorableStrategy } from "../application/suggestions/MemorableStrategy.mjs";
import { NextUpStrategy } from "../application/suggestions/NextUpStrategy.mjs";
import { ResumeStrategy } from "../application/suggestions/ResumeStrategy.mjs";
import { BrowseExerciseLibrary } from "../application/usecases/BrowseExerciseLibrary.mjs";
import { GenerateSessionTimelapse } from "../application/usecases/GenerateSessionTimelapse.mjs";
import { LogStrengthRun } from "../application/usecases/LogStrengthRun.mjs";
import { PrepareWorkoutRun } from "../application/usecases/PrepareWorkoutRun.mjs";
import { QuerySessions } from "../application/usecases/QuerySessions.mjs";
import { WorkoutCatalogService } from "../application/services/WorkoutCatalogService.mjs";
import { FitnessContentService } from "../application/services/FitnessContentService.mjs";
import { FitnessUserHydrator } from "../application/services/FitnessUserHydrator.mjs";
import { FitnessHardwareService } from "../application/services/FitnessHardwareService.mjs";
import { FitnessWebhookService } from "../application/services/FitnessWebhookService.mjs";
import { EmergencyAccessService } from "../application/services/EmergencyAccessService.mjs";
import { EmergencyLockdownService } from "../application/services/EmergencyLockdownService.mjs";
import { FitnessVoiceMemoService } from "../application/services/FitnessVoiceMemoService.mjs";
import { VoiceMemoRetryWorker } from "../application/services/VoiceMemoRetryWorker.mjs";
import { FitnessSessionOperations } from "../application/services/FitnessSessionOperations.mjs";
import { GarageHumanActivityService } from "../application/services/GarageHumanActivityService.mjs";
import { CycleRaceApiService } from "../application/services/CycleRaceApiService.mjs";
import { GetFitnessMenuMusic } from "../application/usecases/GetFitnessMenuMusic.mjs";
import { PrintFitnessReceipt } from "../application/usecases/PrintFitnessReceipt.mjs";
import { SaveDebugVoiceMemo } from "../application/usecases/SaveDebugVoiceMemo.mjs";
import { ManageAccess } from "../application/usecases/ManageAccess.mjs";
import { RecapSweep } from "../application/usecases/RecapSweep.mjs";
import { TrashRetentionSweep } from "../application/usecases/TrashRetentionSweep.mjs";
import { FitnessProgressClassifier } from "../domain/index.mjs";
import { TimelapseFrameMapper } from "../domain/services/TimelapseFrameMapper.mjs";
import { makeDeviceColorResolver } from "../domain/strapColors.mjs";
import { createTimelapseFrameRenderer } from "../rendering/TimelapseFrameRenderer.mjs";
import { HttpClient } from '#system/services/HttpClient.mjs';
import path from 'path';
import { runtimeLogDirectory } from '#system/boot/runtimePaths.mjs';
import { createFitnessServices } from "#composition/bootstrap.mjs";

/**
 * Create fitness API router
 * @param {Object} config
 * @param {Object} config.fitnessServices - Services from createFitnessServices
 * @param {Object} config.userService - UserService for config hydration
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
    createSchoolLearnerDirectory,
    configService,
    fitnessConfig,
    contentRegistry,
    contentQueryService,
    createReceiptCanvas,
    printerRegistry,
    providerWebhookAdapters,
    enrichmentService,
    stravaSyncHealth = null,
    fingerprintProfileWriter = null,
    triggerEmergencyLockdown = null,
    releaseEmergencyLockdown = null,
    getLockdownState = null,
    identityRelay = null,
    garageHumanActivityGateway = null,
    eventBus = null,
    // Workout persistence + its save-time slug guard, both built in app.mjs and passed
    // straight through — this module composes fitness services, and these are already
    // composed by the time they arrive.
    workoutRepository = null,
    saveWorkout = null,
    // The one loaded exercise-library instance (app.mjs). Shared by the write path's
    // slug guard and the browse read path — never constructed twice.
    exerciseLibrary = null,
    fitnessPlayableModule = null,
    onSessionsChanged = null,
    logger = console
  } = config;

  // The application root may provide the canonical household-level playable
  // module. Isolated router consumers can still compose one locally.
  const playableModule = fitnessPlayableModule || createFitnessPlayableModule({
    configService,
    fitnessConfig,
    contentRegistry,
    contentQueryService,
    logger,
  });
  const {
    fitnessConfigService,
    fitnessContentAdapter,
    fitnessContentCatalog,
    fitnessPlayableService,
  } = playableModule;
  const fitnessSchoolCourseService = createFitnessSchoolCourseOperation({
    attemptStore: new YamlFitnessSchoolAttemptStore({ configService, logger }),
    sessionService: fitnessServices.sessionService,
    publications: new FitnessSchoolPublications({ eventBus }),
    logger,
  });

  // Create ScreenshotService for session screenshot handling
  const screenshotService = new ScreenshotService({
    screenshotStore: new FilesystemScreenshotStore({
      sessionService: fitnessServices.sessionService,
      // Keypad screenshots sit beside the fitness session logs they explain.
      kioskScreenshotDir: path.join(runtimeLogDirectory(configService.getMediaDir()), 'fitness', 'screenshots'),
      logger,
    }),
    logger
  });

  // Create suggestion strategies and orchestrator
  const fitnessSuggestionService = new FitnessSuggestionService({
    strategies: [
      new ResumeStrategy(),
      new NextUpStrategy(),
      new FavoriteStrategy(),
      new MemorableStrategy(),
      new DiscoveryStrategy(),
    ],
    sessionService: fitnessServices.sessionService,
    sessionDatastore: fitnessServices.sessionStore,
    fitnessConfigService,
    fitnessPlayableService,
    contentCatalog: fitnessContentCatalog,
    logger,
  });
  // The grid is served from a snapshot built at boot, at midnight, and once a
  // workout settles — not recomputed against Plex on every home refresh.
  const suggestionsSnapshot = new SuggestionsSnapshot({
    service: fitnessSuggestionService,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    logger,
  });
  suggestionsSnapshot.preload({});

  // Session time-lapse recap generator (background render at session end).
  const timelapseConfig = fitnessConfigService.getNormalizedConfig()?.timelapse;
  // Poster artwork bytes for the recap title card (adapter extracted from
  // the former inline closure — see PlexPosterProvider for behavior notes).
  const plexPosterProvider = new PlexPosterProvider({
    host: fitnessContentAdapter?.host,
    token: fitnessContentAdapter?.token,
    proxyPath: fitnessContentAdapter?.proxyPath,
    getThumbnails: typeof fitnessContentAdapter?.getThumbnails === 'function'
      ? fitnessContentAdapter.getThumbnails.bind(fitnessContentAdapter)
      : null,
    httpClient: new HttpClient({ logger }),
    logger,
  });
  // User avatars (media/img/users) + equipment (bike) icons by name
  // (media/img/equipment/{name}.{ext}) — the latter label each cadence/RPM
  // readout with its device in the recap footer.
  const fitnessImgDir = configService.getPath('img') || path.join(configService.getMediaDir(), 'img');
  const fitnessAssetResolver = new FitnessAssetResolver({
    imgDir: fitnessImgDir,
    // Equipment whose picture is not named after its id declares the filename
    // in fitness config — same map the live /static/img/equipment route uses.
    equipmentImages: equipmentImageMap(fitnessConfig),
  });
  const generateSessionTimelapse = new GenerateSessionTimelapse({
    sessionDatastore: fitnessServices.sessionStore,
    snapshotStore: new YamlRecapSnapshotStore({ sessionDatastore: fitnessServices.sessionStore, logger }),
    frameMapper: new TimelapseFrameMapper(),
    frameRenderer: createTimelapseFrameRenderer(timelapseConfig || {}),
    artifactStore: new FilesystemTimelapseArtifactStore({
      mediaDir: configService.getMediaDir(),
      videoEncoder: new FfmpegVideoAdapter({ logger }),
      logger,
    }),
    posterProvider: plexPosterProvider.getPoster.bind(plexPosterProvider),
    avatarProvider: fitnessAssetResolver.getAvatars.bind(fitnessAssetResolver),
    equipmentProvider: fitnessAssetResolver.getEquipmentImages.bind(fitnessAssetResolver),
    resolveName: userService?.resolveDisplayName ? userService.resolveDisplayName.bind(userService) : null,
    // When a group is exercising, prefer each user's short group label (e.g. "Dad").
    resolveGroupLabel: userService?.resolveGroupLabel ? userService.resolveGroupLabel.bind(userService) : null,
    // Each rider's real assigned strap colour (fitness.yml device_colors.heart_rate),
    // keyed by HR device id — the same colours the live fitness UI uses.
    resolveColor: makeDeviceColorResolver(fitnessConfig?.device_colors?.heart_rate),
    // Cadence (bike) device → equipment name + per-bike colour, for the RPM readouts.
    cadenceDevices: fitnessConfig?.devices?.cadence || null,
    cadenceColors: fitnessConfig?.device_colors?.cadence || null,
    config: timelapseConfig,
    logger
  });

  // Recap sweep: the safety net that recaps sessions which ended via the common
  // paths (inactivity, closed tab, crash) that never fire a per-event trigger.
  // Registered on the agents Scheduler in app.mjs (Docker/prod-gated cron).
  const recapSweep = new RecapSweep({
    sessionService: fitnessServices.sessionService,
    generateSessionTimelapse,
    resolveDefaultHouseholdId: () => configService.getDefaultHouseholdId?.(),
    logger
  });

  // Trash retention: the ONLY hard-delete in the session media lifecycle. A
  // confirmed recap moves raw frames into `_trash` (recoverable); this sweep
  // permanently removes trash entries older than the retention window. Bound to
  // the `_trash` root so it can never reach the live sessions tree. Registered on
  // the agents Scheduler in app.mjs (Docker/prod-gated cron).
  const trashRetentionSweep = new TrashRetentionSweep({
    trashStore: new FilesystemSessionTrashStore({
      mediaDir: configService.getMediaDir(),
    }),
    logger
  });

  // Session lock + simulation supervision + session-query use case are
  // constructed HERE (composition root) and injected — they must not be
  // module-scope shared state inside the router.
  const sessionLockService = new SessionLockService();
  const liveSessionAuthority = new FitnessLiveSessionAuthority();
  const simulationService = new FitnessSimulationService({ logger });
  const querySessions = new QuerySessions({
    sessionService: fitnessServices.sessionService,
    sessionGroupingService: fitnessServices.sessionGroupingService,
    logger
  });
  const manageAccess = new ManageAccess({
    userService,
    fitnessConfigService,
    identityRelay,
    resolveUnlockService: getUnlockService,
    resolveManageService: getManageService,
    fingerprintProfileWriter,
    logger,
  });

  // Browse: the read side of the exercise corpus. Wraps the SAME library instance
  // app.mjs already loaded for SaveWorkout — constructing a second repository here
  // would re-parse the 2.8 MB manifest and hold the corpus twice for no gain.
  const browseExerciseLibrary = exerciseLibrary
    ? new BrowseExerciseLibrary({ exerciseLibrary, logger })
    : null;

  // A finished strength run is written onto the SAME session record a cycle ride uses,
  // so session detail, recaps, the longitudinal widget and Strava reconciliation pick it
  // up with no new plumbing. This is the one place holding BOTH the authored plan (the
  // repository, which supplies the prescribed counts) and the session (which supplies the
  // identity the run is attributed to). Absent a workout repository there is no plan to
  // reduce a run against, so the route reports 503 rather than logging half a record.
  const logStrengthRun = workoutRepository
    ? new LogStrengthRun({
      sessionService: fitnessServices.sessionService,
      workoutRepository,
      logger
    })
    : null;

  // Build -> Run. The runner consumes a FLAT ordered step list joined against the corpus,
  // and only this layer can produce one: the domain owns the ordering but has no corpus
  // access, the repository has no corpus access either, and the frontend cannot import
  // the domain at all. Needs BOTH the shelf and the SAME library instance the browse and
  // save paths use — absent either, the run routes report 503 rather than serving a plan
  // with no exercise names on it.
  const prepareWorkoutRun = workoutRepository && exerciseLibrary
    ? new PrepareWorkoutRun({ workoutRepository, exerciseLibrary, logger })
    : null;
  const workoutCatalog = workoutRepository
    ? new WorkoutCatalogService({ workoutRepository })
    : null;

  // Filesystem access the router used to do inline now lives behind these
  // injected providers (keeps the API layer free of fs/path).
  // `media/fitness/ux/menus`, NOT `media/apps/fitness/ux/menus`. The UX assets
  // moved out from under `apps/` and this function was half-migrated: the
  // emitted path on the way out was updated, the directory it reads was not, so
  // it listed a directory that no longer exists and the catch below turned that
  // into an empty playlist. Menu music was silently off. Read and emit are now
  // built from ONE base so they cannot drift apart again.
  const menuMusicCatalog = new FilesystemMenuMusicCatalog({
    mediaDir: configService.getMediaDir(),
    logger,
  });
  const householdId = configService?.getDefaultHouseholdId?.() ?? null;
  const schoolLearnerDirectory = createSchoolLearnerDirectory({userService,configService,householdId,logger});
  const voiceMemoDebugStore = new FilesystemVoiceMemoDebugStore({ dataDir: configService.getDataDir() });
  const fitnessContentService = new FitnessContentService({
    fitnessConfigService,
    userHydrator: new FitnessUserHydrator({ profileReader: userService, schoolLearnerDirectory, logger }),
    contentAccessAvailable: Boolean(contentRegistry),
    contentCatalog: fitnessContentCatalog,
    logger,
  });
  const fitnessHardwareService = new FitnessHardwareService({
    zoneLedController: fitnessServices.ambientLedController,
    danceLightingController: fitnessServices.danceLightingController,
    equipmentFanController: fitnessServices.equipmentFanController,
  });
  const fitnessWebhookService = new FitnessWebhookService({
    providerWebhookAdapters,
    enrichmentService,
    syncHealth: stravaSyncHealth,
    logger,
  });
  const printFitnessReceipt = new PrintFitnessReceipt({
    printerRegistry,
    createReceiptCanvas,
    imagePrintGateway: new TemporaryImagePrintGateway(),
  });
  const getFitnessMenuMusic = new GetFitnessMenuMusic({
    menuMusicCatalog,
    fitnessConfigService,
  });
  const saveDebugVoiceMemo = new SaveDebugVoiceMemo({
    debugAudioStore: voiceMemoDebugStore,
    logger,
  });
  const emergencyAccessService = new EmergencyAccessService({
    identityRelay,
    resolveUnlockService: getUnlockService,
    manageAccess,
    logger,
  });
  // Durable capture store: a voice memo is written here BEFORE the provider is
  // called, which is what makes a provider outage recoverable instead of
  // terminal. Household-scoped so a memo sits beside the session it belongs to.
  const voiceMemoArtifactStore = new FilesystemVoiceMemoArtifactStore({
    configService,
    logger,
  });
  const voiceMemoOperations = new FitnessVoiceMemoService({
    transcription: fitnessServices.transcriptionService,
    sessions: fitnessServices.sessionService,
    config: fitnessConfigService,
    enrichment: enrichmentService,
    artifacts: voiceMemoArtifactStore,
    logger,
  });
  // Drains the retry queue and enforces retention. Registered on the agents
  // Scheduler in app.mjs (Docker/prod-gated, so a dev instance cannot race
  // prod for the same leases).
  const voiceMemoRetryWorker = new VoiceMemoRetryWorker({
    artifacts: voiceMemoArtifactStore,
    memos: voiceMemoOperations,
    logger,
  });
  const emergencyOperations = new EmergencyLockdownService({
    access: emergencyAccessService,
    trigger: triggerEmergencyLockdown,
    release: releaseEmergencyLockdown,
    state: getLockdownState,
    sessions: fitnessServices.sessionService,
    timelapse: generateSessionTimelapse,
    logger,
  });
  const fitnessSessionOperations = new FitnessSessionOperations({
    sessions: fitnessServices.sessionService,
    grouping: fitnessServices.sessionGroupingService,
    timelapse: generateSessionTimelapse,
    renderReceipt: createReceiptCanvas,
    config: fitnessConfigService,
    onSessionsChanged: (change) => {
      suggestionsSnapshot.invalidate(`session-${change?.operation ?? 'changed'}`);
      return onSessionsChanged?.(change);
    },
    logger,
  });
  const cycleRaceApi = new CycleRaceApiService({ races: fitnessServices.cycleRaceService, config: fitnessConfigService });

  const fitnessRouter = createFitnessRouter({
    sessionService: fitnessServices.sessionService,
    fitnessSessionOperations,
    cycleRaceService: fitnessServices.cycleRaceService,
    cycleRaceApi,
    skylineGliderCourses: fitnessServices.skylineGliderCourseCatalog,
    skylineGliderRuns: fitnessServices.skylineGliderRunService,
    generateSessionTimelapse,
    sessionGroupingService: fitnessServices.sessionGroupingService,
    sessionLockService,
    liveSessionAuthority,
    simulationService,
    querySessions,
    manageAccess,
    isScreenshotValidationError: (error) => error?.name === 'ScreenshotValidationError',
    fitnessHardwareService,
    garageHumanActivity: new GarageHumanActivityService({ gateway: garageHumanActivityGateway, logger }),
    voiceMemoOperations,
    screenshotService,
    fitnessConfigService,
    fitnessPlayableService,
    fitnessSchoolCourseService,
    fitnessContentService,
    fitnessSuggestionService: suggestionsSnapshot,
    defaultHouseholdId: configService?.getDefaultHouseholdId?.() ?? null,
    printFitnessReceipt,
    fitnessWebhookService,
    stravaSyncHealth,
    emergencyOperations,
    getFitnessMenuMusic,
    saveDebugVoiceMemo,
    workoutCatalog,
    saveWorkout,
    logStrengthRun,
    browseExerciseLibrary,
    prepareWorkoutRun,
    logger
  });

  // Expose the sweeps so app.mjs can register them on the agents Scheduler.
  fitnessRouter.recapSweep = recapSweep;
  fitnessRouter.trashRetentionSweep = trashRetentionSweep;
  fitnessRouter.voiceMemoRetryWorker = voiceMemoRetryWorker;
  // Shared with School's lifecycle composition: these are the already-wired
  // Fitness authorities, not second instances with drifting config/caches.
  fitnessRouter.fitnessPlayableService = fitnessPlayableService;
  fitnessRouter.fitnessSchoolCourseService = fitnessSchoolCourseService;
  return fitnessRouter;
}

/**
 * Compose the one Fitness playable authority shared by Fitness, Piano, School,
 * and Agents. This keeps its content-catalog port and caches consistent.
 */
export function createFitnessPlayableModule({
  configService,
  fitnessConfig,
  contentRegistry,
  contentQueryService,
  logger = console,
} = {}) {
  const fitnessConfigService = new FitnessConfigService({
    configProjection: new FitnessConfigProjection({ configService }),
    logger,
  });
  const fitnessContentSource = fitnessConfig?.content_source || 'plex';
  const fitnessContentAdapter = contentRegistry?.get(fitnessContentSource);
  const fitnessContentCatalog = fitnessContentAdapter
    ? new ProviderFitnessContentCatalog({
      contentAdapter: fitnessContentAdapter,
      contentQueryService,
      source: fitnessContentSource,
      fitnessLibraryId: fitnessConfig?.plex?.library_id || 14,
      logger,
    })
    : null;
  const fitnessPlayableService = new FitnessPlayableService({
    fitnessConfigService,
    contentCatalog: fitnessContentCatalog,
    createProgressClassifier: (cfg) => new FitnessProgressClassifier(cfg),
    logger,
  });

  return {
    fitnessConfigService,
    fitnessContentAdapter,
    fitnessContentCatalog,
    fitnessPlayableService,
  };
}

export function createFitnessSchoolCourseOperation({ attemptStore, sessionService, publications = null,
  clock = () => new Date(), logger = console }) {
  return new FitnessSchoolCourseService({ attemptStore, sessionService, publications, clock, logger });
}
