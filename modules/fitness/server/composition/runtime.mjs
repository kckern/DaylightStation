import { SessionService } from "../application/services/SessionService.mjs";
import { YamlSessionDatastore } from "../adapters/persistence/YamlSessionDatastore.mjs";
import { YamlCycleRaceDatastore } from "../adapters/persistence/YamlCycleRaceDatastore.mjs";
import { YamlSkylineGliderRunDatastore } from "../adapters/persistence/YamlSkylineGliderRunDatastore.mjs";
import { CycleRaceService } from "../application/services/CycleRaceService.mjs";
import { SkylineGliderRunService } from "../application/services/SkylineGliderRunService.mjs";
import { ActivityRegistry } from "../application/activities/ActivityRegistry.mjs";
import { CycleGameProvider } from "../application/activities/CycleGameProvider.mjs";
import { SkylineGliderProvider } from "../application/activities/SkylineGliderProvider.mjs";
import { SkylineGliderCourseCatalog } from "../adapters/SkylineGliderCourseCatalog.mjs";
import { SessionGroupingService } from "../application/services/SessionGroupingService.mjs";
import { AmbientLedAdapter } from "../adapters/AmbientLedAdapter.mjs";
import { DanceLightingController } from "../adapters/DanceLightingController.mjs";
import { GarageFanAdapter } from "../adapters/GarageFanAdapter.mjs";
import { VoiceTranscriptionService } from "#adapters/ai/VoiceTranscriptionService.mjs";
import { fitnessTranscriptionProfile } from "../adapters/ai/transcriptionProfiles/fitness.mjs";

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
    mediaRoot,
    logger,
  });

  const sessionService = new SessionService({
    sessionStore,
    defaultHouseholdId,
    logger
  });

  const cycleRaceStore = new YamlCycleRaceDatastore({ configService });
  const cycleRaceService = new CycleRaceService({ datastore: cycleRaceStore, logger });
  const skylineGliderRunStore = new YamlSkylineGliderRunDatastore({ configService });
  const skylineGliderRunService = new SkylineGliderRunService({ datastore: skylineGliderRunStore, logger });
  const skylineGliderCourseCatalog = new SkylineGliderCourseCatalog({ configService, logger });

  const activityRegistry = new ActivityRegistry()
    .register(new CycleGameProvider({ cycleRaceService }))
    .register(new SkylineGliderProvider({ runService: skylineGliderRunService }));
  const sessionGroupingService = new SessionGroupingService({ activityRegistry, sessionService, logger });

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

  // Dance Party lighting controller (reuses the same HA gateway)
  let danceLightingController = null;
  if (haGateway) {
    danceLightingController = new DanceLightingController({
      gateway: haGateway,
      loadFitnessConfig,
      logger
    });
  }

  // Equipment fan controller (uses home automation gateway)
  let equipmentFanController = null;
  if (haGateway) {
    equipmentFanController = new GarageFanAdapter({
      gateway: haGateway,
      loadFitnessConfig,
      logger
    });
  }

  // Voice memo transcription (optional - requires AI gateway).
  // The profile carries the two prompts that used to be baked into the
  // service: the fitness Whisper bias and a cleanup pass that REPAIRS the
  // transcript ("thumbbells -> dumbbells"). Right for a memo shouted
  // mid-workout; see createLanguageTranscriptionService for why it is exactly
  // wrong for anything that assesses the speaker.
  let transcriptionService = null;
  if (openaiAdapter) {
    transcriptionService = new VoiceTranscriptionService({
      openaiAdapter,
      profile: fitnessTranscriptionProfile,
      logger
    }).scoped({ feature: 'voice-memo' });
  }

  return {
    sessionStore,
    sessionService,
    cycleRaceStore,
    cycleRaceService,
    skylineGliderRunStore,
    skylineGliderRunService,
    skylineGliderCourseCatalog,
    sessionGroupingService,
    ambientLedController,
    danceLightingController,
    equipmentFanController,
    transcriptionService,
    haGateway // Expose for other uses
  };
}
