/** Existing fitness api runtime assembly; preserves construction order. */
import path from "path";
import { YamlFitnessHistoryRepository as YamlFitnessHistoryRepository } from "../adapters/YamlFitnessHistoryRepository.mjs";
import { YamlEmergencyLockDatastore as YamlEmergencyLockDatastore } from "../adapters/persistence/YamlEmergencyLockDatastore.mjs";
import { FitnessEmergencyPublications as FitnessEmergencyPublications } from "../adapters/eventbus/FitnessEmergencyPublications.mjs";
import { TriggerEmergencyLockdown as TriggerEmergencyLockdown } from "../application/usecases/TriggerEmergencyLockdown.mjs";
import { ReleaseEmergencyLockdown as ReleaseEmergencyLockdown } from "../application/usecases/ReleaseEmergencyLockdown.mjs";
import { GetLockdownState as GetLockdownState } from "../application/usecases/GetLockdownState.mjs";
import { createIdentityRelay as createIdentityRelay } from "../application/identityRelay.mjs";
import { FitnessIdentityChannel as FitnessIdentityChannel } from "../adapters/eventbus/FitnessIdentityChannel.mjs";
import { YamlWorkoutRepository as YamlWorkoutRepository } from "../adapters/YamlWorkoutRepository.mjs";
import { SaveWorkout as SaveWorkout } from "../application/usecases/SaveWorkout.mjs";
import { createFitnessApiRouter as createFitnessApiRouter } from "./fitnessApi.mjs";

export async function createFitnessApiRuntime(dependencies) {
  const { configService, rootLogger, axios, NodeApplicationScheduler, userService, harvesterServices, v1Routers, eventBus, loadFitnessConfig, householdId, exerciseLibrary, fitnessServices, userDataService, contentRegistry, contentServices, hardwareAdapters, fingerprintProfileWriter, fitnessPlayableModule } = dependencies;
let providerWebhookAdapters = {};
  let stravaEnrichmentService = null;
  let stravaReconciliationService = null;
  let stravaSyncHealth = null;
  try {
    const stravaClientId = configService.getSystemAuth?.('strava', 'client_id');
    if (!stravaClientId) {
      rootLogger.info?.('strava.enrichment.skipped', { reason: 'no strava client_id in system auth' });
    } else {
      const { StravaClientAdapter } = await import("../adapters/StravaClientAdapter.mjs");
      const { StravaWebhookAdapter } = await import("../adapters/strava/StravaWebhookAdapter.mjs");
      const { StravaWebhookJobStore } = await import("../adapters/strava/StravaWebhookJobStore.mjs");
      const { StravaActivityAccessGateway } = await import("../adapters/StravaActivityAccessGateway.mjs");
      const { FitnessActivityEnrichmentService } = await import("../application/FitnessActivityEnrichmentService.mjs");
      const { shouldSendExerciseReaction, toReactionActivity } = await import("../application/webhookCoachingPolicy.mjs");
      const { ActivityReconciliationService } = await import("../application/ActivityReconciliationService.mjs");
      const { buildSelectionConfig } = await import("../domain/services/selectPrimaryMedia.mjs");

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
      const fitnessHistoryRepository = new YamlFitnessHistoryRepository({
        root: configService.getHouseholdPath('fitness/log'),
        logger: rootLogger.child({ module: 'fitness-history' }),
      });
      const stravaActivityAccess = new StravaActivityAccessGateway({
        client: stravaClient,
        configService,
      });
      const stravaRetryScheduler = new NodeApplicationScheduler();

      // Sync health: every stage reports success; a separate 15-min task
      // (below, "fitness:strava-sync-health") pushes when one goes stale.
      const { StravaSyncHealth } = await import("../application/StravaSyncHealth.mjs");
      const { YamlSyncHealthStore } = await import("../adapters/YamlSyncHealthStore.mjs");
      const stravaHealthHaGateway = dependencies.householdAdapters?.has?.('home_automation') ? dependencies.householdAdapters.get('home_automation') : null;
      const stravaHealthLogger = rootLogger.child({ module: 'strava-sync-health' });
      stravaSyncHealth = new StravaSyncHealth({
        store: new YamlSyncHealthStore({ path: configService.getHouseholdPath('fitness/sync-health') }),
        sendPush: async ({ title, message, data }) => {
          const recipient = configService.getHeadOfHousehold?.();
          const notifyService = recipient
            ? userService.getProfile(recipient)?.identities?.homeassistant?.notify_service
            : null;
          if (!stravaHealthHaGateway || !notifyService) {
            stravaHealthLogger.warn?.('strava.sync_health.no_push_target', { recipient: recipient || null });
            return;
          }
          await stravaHealthHaGateway.callService('notify', notifyService, { title, message, data });
        },
        hasWebhookJob: (activityId) => !!jobStore.findById(activityId),
        timezone: stravaTimezone,
        logger: stravaHealthLogger,
      });
      harvesterServices.harvesterService.onResult(({ serviceId, result, error }) => {
        if (serviceId !== 'strava') return;
        stravaSyncHealth.recordHarvest({
          ok: !error && result?.status === 'success',
          error: error?.message || result?.reason || result?.error || null,
          activities: result?.activities || [],
        });
      });

      stravaReconciliationService = new ActivityReconciliationService({
        activityGateway: stravaClient,
        lookbackDays: stravaLookbackDays,
        selectionConfig: stravaSelectionConfig,
        timezone: stravaTimezone,
        historyRepository: fitnessHistoryRepository,
        pause: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
        ensureAccess: () => stravaActivityAccess.ensure(configService.getHeadOfHousehold?.() || 'user_1'),
        health: stravaSyncHealth,
        logger: rootLogger.child({ module: 'strava-reconciliation' }),
      });

      stravaEnrichmentService = new FitnessActivityEnrichmentService({
        activityGateway: stravaClient,
        jobStore,
        userContext: {
          defaultUserId: () => configService.getHeadOfHousehold?.() || 'user_1',
          timezone: () => configService.getTimezone?.() || 'America/Los_Angeles',
        },
        ensureActivityAccess: (username) => stravaActivityAccess.ensure(username),
        scheduleRetry: (task, milliseconds) => stravaRetryScheduler.after(milliseconds, task),
        selectionConfig: stravaSelectionConfig,
        resolveDisplayName: (slug) => userService.resolveDisplayName(slug),
        historyRepository: fitnessHistoryRepository,
        reconciliationService: stravaReconciliationService,
        // Exercise reaction: the webhook event has no calories, so the policy is
        // judged on the fetched activity. Coaching is built later — resolve lazily.
        onActivityFetched: async (activity) => {
          const coaching = v1Routers.agents?.coaching;
          const orchestrator = v1Routers.agents?.coachingOrchestrator;
          // Not wired yet: resolve false so the job is left unstamped and retried.
          if (!orchestrator || !coaching) {
            rootLogger.warn?.('strava.exercise_reaction.coaching_unavailable', { activityId: activity?.id });
            return false;
          }
          const reactionCfg = coaching.config?.exercise_reaction || {};
          if (!coaching.conversationId || reactionCfg.enabled === false) return true;
          const eligible = shouldSendExerciseReaction(activity, {
            now: new Date(),
            timezone: coaching.timezone,
            ...(Number.isFinite(Number(reactionCfg.min_calories)) ? { minCalories: Number(reactionCfg.min_calories) } : {}),
          });
          rootLogger.info?.('strava.exercise_reaction.evaluated', { activityId: activity?.id, calories: activity?.calories ?? null, eligible });
          if (!eligible) return true;
          await orchestrator.sendExerciseReaction({
            userId: coaching.userId, conversationId: coaching.conversationId, activity: toReactionActivity(activity),
          });
          return true;
        },
        logger: rootLogger.child({ module: 'strava-enrichment' }),
      });

      providerWebhookAdapters = { strava: stravaWebhookAdapter };

      // Pending-job recovery runs after the agents are wired (below), so a
      // workout synced during a restart is judged for an exercise reaction
      // against a live coach rather than silently skipped.

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
  const emergencyHaGateway = dependencies.householdAdapters?.has?.('home_automation') ? dependencies.householdAdapters.get('home_automation') : null;
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
    createSchoolLearnerDirectory: dependencies.createSchoolLearnerDirectory,
    fitnessServices,
    userService,
    userDataService,
    configService,
    fitnessConfig: loadFitnessConfig(householdId),
    contentRegistry,
    contentQueryService: contentServices.contentQueryService,
    createReceiptCanvas: dependencies.createFitnessReceiptCanvas,
    printerRegistry: hardwareAdapters.printerRegistry,
    providerWebhookAdapters,
    enrichmentService: stravaEnrichmentService,
    stravaSyncHealth,
    fingerprintProfileWriter,
    triggerEmergencyLockdown,
    releaseEmergencyLockdown,
    getLockdownState,
    identityRelay,
    garageHumanActivityGateway: emergencyHaGateway,
    eventBus,
    workoutRepository,
    saveWorkout,
    exerciseLibrary,
    fitnessPlayableModule,
    onSessionsChanged: (change) => dependencies.fitnessStateGatesProducer?.requestReconcile(change),
    logger: rootLogger.child({ module: 'fitness-api' })
  });
  return { stravaEnrichmentService, stravaReconciliationService, stravaSyncHealth };
}
