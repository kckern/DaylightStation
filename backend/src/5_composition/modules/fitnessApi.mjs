// backend/src/5_composition/modules/fitnessApi.mjs
// Composition wiring for Fitness API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { PlexPosterProvider } from '#adapters/content/media/plex/PlexPosterProvider.mjs';
import { FitnessAssetResolver } from '#adapters/fitness/FitnessAssetResolver.mjs';
import { YamlRecapSnapshotStore } from '#adapters/persistence/yaml/YamlRecapSnapshotStore.mjs';
import { FfmpegVideoAdapter } from '#adapters/video/FfmpegVideoAdapter.mjs';
import { createFitnessRouter } from '#api/v1/routers/fitness.mjs';
import { Scheduler } from '#apps/agents/index.mjs';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';
import { FitnessConfigService } from '#apps/fitness/FitnessConfigService.mjs';
import { FitnessPlayableService } from '#apps/fitness/FitnessPlayableService.mjs';
import { FitnessSimulationService } from '#apps/fitness/services/FitnessSimulationService.mjs';
import { ScreenshotService } from '#apps/fitness/services/ScreenshotService.mjs';
import { SessionLockService } from '#apps/fitness/services/SessionLockService.mjs';
import { DiscoveryStrategy } from '#apps/fitness/suggestions/DiscoveryStrategy.mjs';
import { FavoriteStrategy } from '#apps/fitness/suggestions/FavoriteStrategy.mjs';
import { FitnessSuggestionService } from '#apps/fitness/suggestions/FitnessSuggestionService.mjs';
import { MemorableStrategy } from '#apps/fitness/suggestions/MemorableStrategy.mjs';
import { NextUpStrategy } from '#apps/fitness/suggestions/NextUpStrategy.mjs';
import { ResumeStrategy } from '#apps/fitness/suggestions/ResumeStrategy.mjs';
import { BrowseExerciseLibrary } from '#apps/fitness/usecases/BrowseExerciseLibrary.mjs';
import { GenerateSessionTimelapse } from '#apps/fitness/usecases/GenerateSessionTimelapse.mjs';
import { LogStrengthRun } from '#apps/fitness/usecases/LogStrengthRun.mjs';
import { PrepareWorkoutRun } from '#apps/fitness/usecases/PrepareWorkoutRun.mjs';
import { QuerySessions } from '#apps/fitness/usecases/QuerySessions.mjs';
import { RecapSweep } from '#apps/fitness/usecases/RecapSweep.mjs';
import { TrashRetentionSweep } from '#apps/fitness/usecases/TrashRetentionSweep.mjs';
import { FitnessProgressClassifier } from '#domains/fitness/index.mjs';
import { TimelapseFrameMapper } from '#domains/fitness/services/TimelapseFrameMapper.mjs';
import { makeDeviceColorResolver } from '#domains/fitness/strapColors.mjs';
import { createTimelapseFrameRenderer } from '#rendering/fitness/TimelapseFrameRenderer.mjs';
import { HttpClient } from '#system/services/HttpClient.mjs';
import { ensureDir, writeBinary } from '#system/utils/FileIO.mjs';
import fs from 'fs/promises';
import nodeFs from 'node:fs';
import path from 'path';
import { createFitnessServices } from '../bootstrap.mjs';

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
    printerRegistry,
    providerWebhookAdapters,
    enrichmentService,
    fingerprintProfileWriter = null,
    triggerEmergencyLockdown = null,
    releaseEmergencyLockdown = null,
    getLockdownState = null,
    identityRelay = null,
    // Workout persistence + its save-time slug guard, both built in app.mjs and passed
    // straight through — this module composes fitness services, and these are already
    // composed by the time they arrive.
    workoutRepository = null,
    saveWorkout = null,
    // The one loaded exercise-library instance (app.mjs). Shared by the write path's
    // slug guard and the browse read path — never constructed twice.
    exerciseLibrary = null,
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
    contentAdapter: fitnessContentAdapter,
    contentQueryService,
    logger,
  });

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
    avatarsDir: path.join(fitnessImgDir, 'users'),
    equipmentDir: path.join(fitnessImgDir, 'equipment'),
  });
  const generateSessionTimelapse = new GenerateSessionTimelapse({
    sessionDatastore: fitnessServices.sessionStore,
    snapshotStore: new YamlRecapSnapshotStore({ sessionDatastore: fitnessServices.sessionStore, fileIO: nodeFs, logger }),
    frameMapper: new TimelapseFrameMapper(),
    frameRenderer: createTimelapseFrameRenderer(timelapseConfig || {}),
    videoEncoder: new FfmpegVideoAdapter({ logger }),
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
    mediaDir: configService.getMediaDir(),
    config: timelapseConfig,
    fileIO: nodeFs,
    logger
  });

  // Recap sweep: the safety net that recaps sessions which ended via the common
  // paths (inactivity, closed tab, crash) that never fire a per-event trigger.
  // Registered on the agents Scheduler in app.mjs (Docker/prod-gated cron).
  const recapSweep = new RecapSweep({
    sessionService: fitnessServices.sessionService,
    generateSessionTimelapse,
    configService,
    logger
  });

  // Trash retention: the ONLY hard-delete in the session media lifecycle. A
  // confirmed recap moves raw frames into `_trash` (recoverable); this sweep
  // permanently removes trash entries older than the retention window. Bound to
  // the `_trash` root so it can never reach the live sessions tree. Registered on
  // the agents Scheduler in app.mjs (Docker/prod-gated cron).
  const trashRetentionSweep = new TrashRetentionSweep({
    trashDir: path.join(configService.getMediaDir(), 'fitness', '_trash'),
    fileIO: nodeFs,
    logger
  });

  // Session lock + simulation supervision + session-query use case are
  // constructed HERE (composition root) and injected — they must not be
  // module-scope shared state inside the router.
  const sessionLockService = new SessionLockService();
  const simulationService = new FitnessSimulationService({ logger });
  const querySessions = new QuerySessions({
    sessionService: fitnessServices.sessionService,
    sessionGroupingService: fitnessServices.sessionGroupingService,
    logger
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

  // Filesystem access the router used to do inline now lives behind these
  // injected providers (keeps the API layer free of fs/path).
  const menuMusicProvider = () => {
    const musicDir = path.join(configService.getMediaDir(), 'apps', 'fitness', 'ux', 'menus');
    try {
      return nodeFs.readdirSync(musicDir)
        .filter(f => /\.(mp3|m4a|ogg|wav)$/i.test(f))
        .sort()
        .map(f => `media/fitness/ux/menus/${f}`);
    } catch (_) {
      // Directory missing or unreadable — return empty list gracefully.
      return [];
    }
  };
  const voiceMemoDebugStore = {
    // DEBUG ONLY: dump the raw webm blob under <dataDir>/_debug/voice_memos/.
    async save(buffer) {
      const savedAt = Date.now();
      const iso = new Date(savedAt).toISOString().replace(/:/g, '-');
      const filename = `${iso}.webm`;
      const filePath = path.join(configService.getDataDir(), '_debug', 'voice_memos', filename);
      // writeBinary handles mkdirSync({ recursive: true }) internally.
      writeBinary(filePath, buffer);
      return { path: filePath, filename, size: buffer.length, savedAt };
    },
  };

  const fitnessRouter = createFitnessRouter({
    sessionService: fitnessServices.sessionService,
    cycleRaceService: fitnessServices.cycleRaceService,
    generateSessionTimelapse,
    sessionGroupingService: fitnessServices.sessionGroupingService,
    sessionLockService,
    simulationService,
    querySessions,
    zoneLedController: fitnessServices.ambientLedController,
    danceLightingController: fitnessServices.danceLightingController,
    equipmentFanController: fitnessServices.equipmentFanController,
    transcriptionService: fitnessServices.transcriptionService,
    screenshotService,
    fitnessConfigService,
    fitnessPlayableService,
    fitnessContentAdapter,
    fitnessSuggestionService,
    userService,
    configService,
    contentRegistry,  // Still needed for playlist thumbnail enrichment
    createReceiptCanvas,
    printerRegistry,
    providerWebhookAdapters,
    enrichmentService,
    fingerprintProfileWriter,
    triggerEmergencyLockdown,
    releaseEmergencyLockdown,
    getLockdownState,
    identityRelay,
    menuMusicProvider,
    voiceMemoDebugStore,
    workoutRepository,
    saveWorkout,
    logStrengthRun,
    browseExerciseLibrary,
    prepareWorkoutRun,
    logger
  });

  // Expose the sweeps so app.mjs can register them on the agents Scheduler.
  fitnessRouter.recapSweep = recapSweep;
  fitnessRouter.trashRetentionSweep = trashRetentionSweep;
  return fitnessRouter;
}
